// 서버의 고정소수점 수(server/Argus.Server/Game/Fixed.cs, FixedVector.cs)를 옮긴 것이다. 클라이언트 예측이 서버와
// 같은 계산을 해서 Raw까지 같은 위치를 얻게 한다. 값은 Raw(4096분의 1 단위 정수)를 그대로 number로 다룬다.
//
// JavaScript의 수는 ±(2^53 - 1) 안의 정수만 정확히 다룬다. 서버도 값과 중간값을 이 범위로 제한하므로, 여기서도
// 범위를 넘으면 예외를 낸다. 반올림은 서버와 같다. 곱셈·나눗셈·제곱근은 가장 가까운 값으로, 딱 절반이면 0에서 먼 쪽으로 간다.
// 더한 뒤 나누면 2^53 근처에서 더한 값이 반올림될 수 있어, 몫과 나머지를 따로 구해 정확히 반올림한다.
//
// 서버의 계산을 바꾸면 이 파일도 함께 고치고 대조 자료(client/tests/fixed-vectors.json)를 다시 만든다.

export const fractionBits = 12;
export const scale = 4096;
export const one = scale;
export const safeLimit = Number.MAX_SAFE_INTEGER;
// 실수에서 바꿀 수 있는 가장 큰 크기다(Fixed.MaxConvertible).
const maxConvertible = 1_000_000_000;

// Raw 두 개로 된 벡터다(FixedVector).
export type FixedVector = { x: number; y: number };

// 값이 JavaScript가 정확히 다루는 범위 안인지 확인하고 그대로 돌려준다(Fixed.Safe). NaN도 거른다.
export function safe(value: number): number {
  if (!(value <= safeLimit && value >= -safeLimit)) throw new RangeError(`고정소수점 값 ${value}가 2^53 - 1을 넘습니다`);
  return value;
}

// 0의 부호를 바꾸면 -0이 되어 Object.is로 비교할 때 0과 달라지므로, 부호를 바꿀 때는 이것을 쓴다.
const negate = (value: number) => (value === 0 ? 0 : -value);

// C#의 checked((int)value)처럼 32비트 정수 범위를 넘으면 예외를 낸다.
function int32(value: number): number {
  if (value > 2147483647 || value < -2147483648) throw new RangeError(`정수 ${value}가 32비트 범위를 넘습니다`);
  return value;
}

// 0 이상의 정수를 양의 정수로 나눈 몫을 정확히 내린다. 실수 나눗셈의 몫은 참값과 1까지 다를 수 있어 곱해서 맞춘다.
// 몫이 하나 크면 곱이 2^53을 넘어 반올림되어도 나뉘는 수보다 크게 나오므로, 하나 줄이는 판단은 틀리지 않는다.
function floorQuotient(value: number, divisor: number): number {
  let quotient = Math.floor(value / divisor);
  if (quotient * divisor > value) quotient -= 1;
  else if (value - quotient * divisor >= divisor) quotient += 1;
  return quotient;
}

export const fromRaw = (raw: number) => safe(raw);

export const fromInt = (value: number) => safe(value * scale);

// 실수로 들어온 값을 바꾼다(Fixed.FromDouble, C#의 Math.Round(value * 4096, MidpointRounding.AwayFromZero)).
// Math.round는 딱 절반을 +∞ 쪽으로 보내 음수에서 다르므로 쓰지 않는다. 4096을 곱하는 것과 정수 부분을 빼는 것은 실수에서도 정확하다.
export function fromDouble(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > maxConvertible) throw new RangeError(`고정소수점으로 바꿀 수 없는 값입니다: ${value}`);
  const scaled = value * scale;
  const whole = Math.trunc(scaled);
  const fraction = scaled - whole;
  if (fraction >= .5) return safe(whole + 1);
  if (fraction <= -.5) return safe(whole - 1);
  return safe(whole + 0);
}

// 화면에 그릴 때만 쓴다. 4096으로 나누는 것은 정확하다.
export const toDouble = (raw: number) => raw / scale;

// 2^bits로 나누며 0에서 먼 쪽으로 반올림한다(Fixed.ShiftRounded). 2의 거듭제곱으로 나누는 실수 나눗셈은 정확하다.
export function shiftRounded(value: number, bits: number): number {
  const divisor = 2 ** bits;
  const magnitude = Math.abs(value);
  const quotient = Math.floor(magnitude / divisor);
  const remainder = magnitude - quotient * divisor;
  const rounded = remainder >= divisor / 2 ? quotient + 1 : quotient;
  return value < 0 ? negate(rounded) : rounded;
}

// 0에서 먼 쪽으로 반올림하는 정수 나눗셈이다(Fixed.DivideRounded). 서버는 (크기 + 나누는 수의 절반)을 내려 나누는데,
// 이는 나머지가 나누는 수의 절반(올림) 이상일 때 몫을 하나 올리는 것과 같다.
export function divideRounded(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('고정소수점을 0으로 나눌 수 없습니다');
  const negative = (numerator < 0) !== (denominator < 0);
  const magnitude = Math.abs(numerator);
  const divisor = Math.abs(denominator);
  const quotient = floorQuotient(magnitude, divisor);
  const remainder = magnitude - quotient * divisor;
  const rounded = remainder >= Math.ceil(divisor / 2) ? quotient + 1 : quotient;
  return negative ? negate(rounded) : rounded;
}

// 반올림 나눗셈의 중간값(나뉘는 수의 크기 + 나누는 수의 절반)도 범위 안인지 본 뒤 나눈다(Fixed.SafeDivide).
function safeDivide(numerator: number, denominator: number): number {
  safe(Math.abs(numerator) + Math.trunc(Math.abs(denominator) / 2));
  return safe(divideRounded(numerator, denominator));
}

export const add = (a: number, b: number) => safe(a + b);

export const subtract = (a: number, b: number) => safe(a - b);

// Fixed * Fixed. 곱이 범위를 넘으면 실수 곱도 2^53 이상으로 나오므로 safe가 잡는다.
export const multiply = (a: number, b: number) => shiftRounded(safe(a * b), fractionBits);

// Fixed * int. 정수를 곱할 때는 반올림할 것이 없다.
export const multiplyInt = (a: number, b: number) => safe(a * b);

// Fixed / Fixed.
export const divide = (a: number, b: number) => safeDivide(safe(a * scale), b);

// Fixed / int.
export const divideInt = (a: number, b: number) => safeDivide(a, b);

// 정수 divisor로 나눈 몫을 작은 쪽 정수로 내린다(Fixed.FloorDivide). 좌표로 타일 번호를 구할 때 쓴다.
export function floorDivide(raw: number, divisor: number): number {
  if (!Number.isInteger(divisor) || divisor <= 0) throw new RangeError(`양의 정수로만 나눌 수 있습니다: ${divisor}`);
  const whole = divisor * scale;
  if (raw >= 0) return int32(floorQuotient(raw, whole));
  const quotient = floorQuotient(-raw, whole);
  const exact = quotient * whole === -raw;
  return int32(exact ? negate(quotient) : -quotient - 1);
}

// 정수 divisor로 나눈 몫을 큰 쪽 정수로 올린다(Fixed.CeilingDivide). 이동을 몇 걸음으로 나눌지 구할 때 쓴다.
export function ceilingDivide(raw: number, divisor: number): number {
  if (!Number.isInteger(divisor) || divisor <= 0) throw new RangeError(`양의 정수로만 나눌 수 있습니다: ${divisor}`);
  const whole = divisor * scale;
  if (raw <= 0) return int32(negate(floorQuotient(-raw, whole)));
  const quotient = floorQuotient(raw, whole);
  return int32(quotient * whole === raw ? quotient : quotient + 1);
}

export const clamp = (value: number, min: number, max: number) => (value < min ? min : value > max ? max : value);

// 내림 정수 제곱근이다(Fixed.FloorSqrt). Math.sqrt의 마지막 자리는 명세가 정하지 않으므로, 정수 제곱으로 확인해 맞춘다.
// 값이 2^53 미만이면 제곱근은 2^26.5 미만이라 (제곱근 + 1)²도 정확히 계산된다.
export function floorSqrt(value: number): number {
  if (value < 0) throw new RangeError(`음수의 제곱근은 구할 수 없습니다: ${value}`);
  let root = Math.floor(Math.sqrt(value));
  while (root * root > value) root -= 1;
  while ((root + 1) * (root + 1) <= value) root += 1;
  return root;
}

// 가장 가까운 정수 제곱근이다(Fixed.RoundedSqrt). value - r² > r 이면 (r + 0.5)²보다 크므로 하나 올린다.
export function roundedSqrt(value: number): number {
  const root = floorSqrt(value);
  return value - root * root > root ? root + 1 : root;
}

export const vector = (x: number, y: number): FixedVector => ({ x, y });

export const zero: FixedVector = { x: 0, y: 0 };

export const addVector = (a: FixedVector, b: FixedVector): FixedVector => ({ x: add(a.x, b.x), y: add(a.y, b.y) });

export const subtractVector = (a: FixedVector, b: FixedVector): FixedVector => ({ x: subtract(a.x, b.x), y: subtract(a.y, b.y) });

// FixedVector * Fixed.
export const scaleVector = (v: FixedVector, s: number): FixedVector => ({ x: multiply(v.x, s), y: multiply(v.y, s) });

// FixedVector * int.
export const multiplyVectorInt = (v: FixedVector, n: number): FixedVector => ({ x: multiplyInt(v.x, n), y: multiplyInt(v.y, n) });

// FixedVector / int.
export const divideVectorInt = (v: FixedVector, n: number): FixedVector => ({ x: divideInt(v.x, n), y: divideInt(v.y, n) });

// 길이의 제곱이다. 성분의 제곱을 각각 반올림해 더한다(FixedVector.LengthSquared).
export const lengthSquared = (v: FixedVector) => add(multiply(v.x, v.x), multiply(v.y, v.y));

// 길이다. Raw의 제곱을 반올림하지 않은 채 더하고 제곱근을 구한다(FixedVector.Length).
export const length = (v: FixedVector) => roundedSqrt(safe(v.x * v.x + v.y * v.y));

// 길이가 1인 같은 방향의 벡터다. 길이가 0이면 0 벡터다(FixedVector.Normalize).
export function normalize(v: FixedVector): FixedVector {
  const size = length(v);
  if (size === 0) return zero;
  return { x: divide(v.x, size), y: divide(v.y, size) };
}

export const distanceSquared = (a: FixedVector, b: FixedVector) => lengthSquared(subtractVector(a, b));

// 아래는 서버의 방향(server/Argus.Server/Game/Angle.cs) 가운데 클라이언트 예측에 필요한 부분을 옮긴 것이다.
// 서 있는 대원의 대시는 조준한 쪽으로 가므로(Match.DashDirection), 보낸 조준(라디안)에서 서버와 같은 방향 벡터를 구해야 한다.
// 방향은 한 바퀴를 65536칸으로 나눈 정수(칸 수)다. 사인은 2^30을 1로 보는 정수 급수로 구하는데 중간값이 2^62까지 커져서
// BigInt로 계산한다. 대시를 시작할 때 한 번만 부르므로 느려도 된다.
export const unitsPerTurn = 65536;
const quarterTurn = 16384;
const angleOne = 1n << 30n;
// π/2 × 2^30
const halfPi = 1686629713n;
// 사인의 테일러 급수 계수(1/3!, 1/5!, … 1/11!)를 2^30 단위로 적었다(Angle.SineTerms).
const sineTerms = [178956971n, 8947849n, 213044n, 2959n, 27n];

// 2^bits로 나눠 가장 가까운 정수로 반올림한다. 딱 절반이면 0에서 먼 쪽이다(Fixed.ShiftRounded).
function shiftRoundedBig(value: bigint, bits: bigint): bigint {
  const half = 1n << (bits - 1n);
  return value >= 0n ? (value + half) >> bits : -((-value + half) >> bits);
}

// 2^30 단위 수 둘을 곱한다(Angle.Multiply).
const multiplyAngle = (a: bigint, b: bigint) => shiftRoundedBig(a * b, 30n);

// offset칸(0~16384, 0°~90°)의 사인을 2^30 단위로 구한다(Angle.QuarterSine).
function quarterSine(offset: number): bigint {
  const x = shiftRoundedBig(BigInt(offset) * halfPi, 14n);
  const square = multiplyAngle(x, x);
  let sum = 0n;
  for (let i = sineTerms.length - 1; i >= 0; i--) {
    const term = i % 2 === 0 ? -sineTerms[i] : sineTerms[i];
    sum = term + multiplyAngle(sum, square);
  }
  sum = angleOne + multiplyAngle(sum, square);
  return multiplyAngle(sum, x);
}

// 라디안을 칸 수(0~65535)로 바꾼다(Angle.FromRadians). 실수의 사칙연산·내림·반올림만 쓰므로 서버와 같은 값이 나온다.
// 한 바퀴 안의 몫은 0 이상이라, 딱 절반을 위로 보내는 Math.round가 서버의 "0에서 먼 쪽"과 같다.
export function angleUnits(radians: number): number {
  if (!Number.isFinite(radians)) throw new RangeError(`각도로 바꿀 수 없는 값입니다: ${radians}`);
  const turns = radians / (2 * Math.PI);
  const fraction = turns - Math.floor(turns);
  return Math.round(fraction * unitsPerTurn) & (unitsPerTurn - 1);
}

// 그 방향의 사인이다(Angle.Sin). 사분면의 대칭으로 0°~90°만 계산하고, 2^30 단위를 Raw(2^12 단위)로 반올림한다.
export function sine(units: number): number {
  const quadrant = Math.floor(units / quarterTurn);
  let offset = units % quarterTurn;
  if (quadrant === 1 || quadrant === 3) offset = quarterTurn - offset;
  let value = quarterSine(offset);
  if (quadrant >= 2) value = -value;
  const raw = Number(shiftRoundedBig(value, BigInt(30 - fractionBits)));
  return raw === 0 ? 0 : raw;
}

// 그 방향의 코사인이다(Angle.Cos).
export const cosine = (units: number) => sine((units + quarterTurn) & (unitsPerTurn - 1));

// 그 방향으로 길이가 1인 벡터다(Angle.Direction).
export const direction = (units: number): FixedVector => ({ x: cosine(units), y: sine(units) });
