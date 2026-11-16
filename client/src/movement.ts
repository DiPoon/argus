// 서버가 대원을 움직이는 계산(Match.Input·UpdatePlayer·MoveBody·CanOccupy, BattleMap.CanStand)을 옮긴 것이다.
// 클라이언트 예측은 보낸 입력 하나를 한 틱으로 쳐서 이 계산으로 움직인다. 같은 입력이 같은 틱에 들어가면 서버와 Raw까지 같은 위치가 된다.
// 클라이언트는 숨은 적을 모르고 적이 다음 틱에 어디로 갈지도 모르므로, 그런 몸에 막혀 생긴 차이는 서버 위치로 보정된다.
// 서버의 계산을 바꾸면 이 파일도 함께 고치고 대조 자료(client/tests/fixed-vectors.json)를 다시 만든다.
import {
  type FixedVector, add, angleUnits, ceilingDivide, clamp, direction, distanceSquared, divideInt, divideVectorInt, floorDivide, fromDouble, fromInt,
  length, lengthSquared, multiply, multiplyVectorInt, normalize, one, scaleVector, subtract, subtractVector,
} from './fixed';

// 벽 판정에 쓰는 맵이다. 칸 값은 0 빈 땅, 1·2 벽, 3 분대가 아직 보지 못한 칸(unknownTile)이고, 맵 밖은 모두 벽이다.
export interface Terrain { tiles: Uint8Array; columns: number; rows: number; cell: number }

// 분대가 아직 보지 못한 칸이다(BattleMap.UnknownTile). 클라이언트는 그 칸이 벽인지 모른다.
export const unknownTile = 3;

// 대원을 막는 몸(살아 있는 적)이다. 좌표와 반지름 모두 Raw다.
export interface Body { x: number; y: number; radius: number }

// 서버의 틱 빈도다(Rules.TicksPerSecond). 클라이언트는 입력을 한 틱에 하나씩 보내고, 예측도 입력 하나를 한 틱으로 친다.
// 입력 주기(main.ts)와 그리기 보간(world.ts)도 이 값을 쓴다. 하나만 달라도 예측의 전제가 깨진다.
export const ticksPerSecond = 30;
export const tickMilliseconds = 1000 / ticksPerSecond;
// 새 입력이 없으면 서버는 마지막 입력을 계속 쓰다가, 받은 틱부터 이만큼 쓴 뒤 멈춘다(Match.InputTimeoutTicks - 1).
export const inputHoldTicks = 10;
// 몸끼리 딱 붙은 자리를 겹친 것으로 보지 않게 거리의 제곱에 두는 여유다(Match.TouchTolerance, Raw 4).
const touchTolerance = 4;
// 이동을 나누는 걸음의 길이다(MoveBody의 4단위).
const stride = 4;

// 보지 못한 칸은 빈 땅으로 본다. 서버도 투입 요청에는 본 칸의 벽만으로 답한다(BattleMap.CanStand의 known).
// 서버는 칸의 어느 부분이든 보이면 본 칸으로 치고, 대원이 멈추면 바로, 움직이는 동안은 0.1초나 반 칸마다 다시 둘러본다.
// 그래서 대원 몸이 닿는 칸은 거의 늘 본 칸이고, 예측이 보지 못한 벽을 지나가는 일은 모퉁이를 막 돌 때처럼 드물다.
// 그런 차이는 다음 스냅샷의 서버 위치로 보정된다.
export function solid(terrain: Terrain, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= terrain.columns || y >= terrain.rows) return true;
  const tile = terrain.tiles[y * terrain.columns + x];
  return tile !== 0 && tile !== unknownTile;
}

// 그 자리의 칸을 분대가 보았는지 본다(Match.Explored). 맵 밖이면 거짓이다.
export function known(terrain: Terrain, position: FixedVector): boolean {
  const x = floorDivide(position.x, terrain.cell);
  const y = floorDivide(position.y, terrain.cell);
  if (x < 0 || y < 0 || x >= terrain.columns || y >= terrain.rows) return false;
  return terrain.tiles[y * terrain.columns + x] !== unknownTile;
}

// 그 자리에 몸이 설 수 있는지 본다(BattleMap.CanStand). 몸에 닿는 칸마다 칸 사각형에서 몸의 중심에 가장 가까운 점을 구해
// 반지름보다 가까우면 막힌다.
export function canStand(terrain: Terrain, position: FixedVector, radius: number): boolean {
  const width = fromInt(terrain.columns * terrain.cell);
  const height = fromInt(terrain.rows * terrain.cell);
  if (position.x < radius || position.y < radius || position.x > subtract(width, radius) || position.y > subtract(height, radius)) return false;
  const minX = floorDivide(subtract(position.x, radius), terrain.cell);
  const maxX = floorDivide(add(position.x, radius), terrain.cell);
  const minY = floorDivide(subtract(position.y, radius), terrain.cell);
  const maxY = floorDivide(add(position.y, radius), terrain.cell);
  const radiusSquared = multiply(radius, radius);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!solid(terrain, x, y)) continue;
      const nearest = {
        x: clamp(position.x, fromInt(x * terrain.cell), fromInt((x + 1) * terrain.cell)),
        y: clamp(position.y, fromInt(y * terrain.cell), fromInt((y + 1) * terrain.cell)),
      };
      if (distanceSquared(nearest, position) < radiusSquared) return false;
    }
  }
  return true;
}

// 그 자리에 투입할 수 있는지 서버의 Deploy와 같은 순서로 본다. 분대가 본 칸이어야 하고(unseen), 본 칸의 벽만으로 몸이
// 들어가야 한다(blocked). 지금 보이지 않는 적과 보지 못한 벽은 서버가 착지할 때 보고 가까운 빈 자리로 옮긴다.
export function deployable(terrain: Terrain, position: FixedVector, radius: number): 'ok' | 'unseen' | 'blocked' {
  if (!known(terrain, position)) return 'unseen';
  return canStand(terrain, position, radius) ? 'ok' : 'blocked';
}

// 대원이 그 자리를 차지할 수 있는지 본다(Match.CanOccupy의 대원 쪽). 대원끼리는 통과하고 살아 있는 적에게만 막힌다.
export function canOccupy(terrain: Terrain, bodies: readonly Body[], position: FixedVector, radius: number): boolean {
  if (!canStand(terrain, position, radius)) return false;
  for (const body of bodies) {
    const minimum = add(radius, body.radius);
    if (distanceSquared(position, body) < subtract(multiply(minimum, minimum), touchTolerance)) return false;
  }
  return true;
}

// delta만큼 움직이되 4단위보다 길면 나눠서 조금씩 움직인다(Match.MoveBody). 걸음마다 가로와 세로를 따로 움직여
// 막힌 쪽만 멈추고 벽을 따라 미끄러진다. i번째 걸음은 (delta × i / 걸음 수)에서 앞 걸음까지의 양을 뺀 만큼이라
// 걸음을 다 더하면 정확히 delta다.
export function moveBody(terrain: Terrain, bodies: readonly Body[], from: FixedVector, delta: FixedVector, radius: number): FixedVector {
  const steps = Math.max(1, ceilingDivide(length(delta), stride));
  let planned: FixedVector = { x: 0, y: 0 };
  let position = from;
  for (let i = 1; i <= steps; i++) {
    const reach = divideVectorInt(multiplyVectorInt(delta, i), steps);
    const step = subtractVector(reach, planned);
    planned = reach;
    let next = { x: add(position.x, step.x), y: position.y };
    if (canOccupy(terrain, bodies, next, radius)) position = next;
    next = { x: position.x, y: add(position.y, step.y) };
    if (canOccupy(terrain, bodies, next, radius)) position = next;
  }
  return position;
}

// 보낸 이동 입력을 서버처럼 바꾼다(Match.Input). 길이가 1보다 길면 길이 1로 줄인다.
export function moveDirection(moveX: number, moveY: number): FixedVector {
  const move = { x: fromDouble(moveX), y: fromDouble(moveY) };
  if (lengthSquared(move) > one) return normalize(move);
  return move;
}

// 한 틱에 움직이는 거리다. 1/30을 곱하지 않고 30으로 나눈다(Match._playerStep).
export const playerStep = (speed: number) => divideInt(fromDouble(speed), ticksPerSecond);

// 입력 하나로 한 틱 움직인 자리다(Match.UpdatePlayer).
export function stepPlayer(terrain: Terrain, bodies: readonly Body[], position: FixedVector, moveX: number, moveY: number,
  speed: number, radius: number): FixedVector {
  const delta = scaleVector(moveDirection(moveX, moveY), playerStep(speed));
  return moveBody(terrain, bodies, position, delta, radius);
}

// ---- 내 대원의 기술 차례와 대시 ----
// 대시는 기술을 시작한 틱부터 몸을 움직이므로, 내 위치를 예측하려면 "이 누름으로 어느 틱에 무슨 기술이 시작하는가"도
// 서버와 같게 따라가야 한다. 아래는 서버의 그 부분(Match.Input이 버튼을 적는 곳·ApplyButtons·Press·ReleaseButtons,
// UpdatePlayer·HoldAuras·StartWaitingSkill·MovePlayer)을 옮긴 것이다.
// 다음은 옮기지 않았거나 클라이언트가 미리 알 수 없다. 그렇게 생긴 차이는 다음 스냅샷의 서버 상태로 바로잡힌다.
// - 전투 판정. 완벽 대응으로 기술이 그 자리에서 끝나거나 맞아서 끊기는 것이다.
// - 보급으로 마나가 차는 것.
// - 보낸 입력이 서버에 늦게 닿는 것. 예측은 보낸 입력이 한 틱에 하나씩 닿는다고 본다. 망이 막혀 입력이 0.35초(11틱) 넘게
//   닿지 않으면 서버는 그동안 버튼을 모두 뗀 것으로 본다. 쥐고 기다리던 누름은 버려지고, 쥐고 있던 기운은 장판이 나간다.
//   막혔던 입력이 몰려 닿아도 그 누름은 되살아나지 않는다(그 입력들에는 쥔 버튼만 있고 새 누름이 없다). 화면에서는
//   기다리던 대시가 나갔다가 다음 스냅샷에서 되돌아간다. 걷기만 할 때는 몇 걸음의 차이였는데, 대시는 한 번(150)이 통째로 갈린다.
//   입력이 언제 서버에 닿는지는 클라이언트가 알 수 없다. 스스로 입력을 보내지 못한 틱(타이머가 늦게 깸)은 알므로 서버처럼
//   따라간다(stepPilot의 첫 단계).
// 서버의 계산을 바꾸면 여기도 함께 고치고 대조 자료를 다시 만든다.

// 초로 정한 기간을 틱 수로 바꾼다(Rules.ToTicks). 실수 곱셈의 오차를 막는 아주 작은 여유까지 서버와 같다.
// 0초는 올림한 값이 -0으로 나오므로 0으로 맞춘다.
export function toTicks(seconds: number): number {
  const ticks = Math.ceil(seconds * ticksPerSecond - 0.000001);
  return ticks === 0 ? 0 : ticks;
}

// 방향을 정할 수 없을 만큼 짧은 벡터의 기준이다(Match.TinyLengthSquared, Raw 4).
const tinyLengthSquared = 4;

// 장비 칸 하나에 든 기술에서 예측에 쓰는 값이다. 시간은 틱이고 dashStep은 한 틱의 대시 거리(Raw)다. 대시가 아니면 0이다.
export interface SlotSkill { mana: number; auraTicks: number; durationTicks: number; dashStep: number }

// 서버가 보낸 기술 정의에서 그 값을 구한다(SkillDefinition, PlayerAction의 생성자).
export function slotSkill(skill: { mana: number; auraSeconds: number; duration: number; dashDistance: number }): SlotSkill {
  const durationTicks = toTicks(skill.duration);
  return {
    mana: skill.mana, auraTicks: toTicks(skill.auraSeconds), durationTicks,
    dashStep: skill.dashDistance > 0 ? divideInt(fromDouble(skill.dashDistance), durationTicks) : 0,
  };
}

// 예측에 쓰는 규칙이다. slots는 장비 칸 넷의 기술(1번 칸이 0번째), maxAuraTicks는 최대 기운 시간이다.
export interface PilotRules { speed: number; radius: number; maxAuraTicks: number; slots: SlotSkill[] }

// 쓰는 중인 기술이다(PlayerAction). 틱은 모두 서버의 틱 번호다. 스냅샷이 보낸 시각(contactAt·endsAt·holdUntil)을 그대로 옮길 수 있게
// 시작 틱과 이은 틱 수 대신 서버가 거기서 구하는 세 틱을 둔다.
// - zone: 장판이 나가는 틱(ZoneTick). 버튼을 누르고 있어 기운이 한 틱 이어지면 한 틱 밀린다.
// - ends: 기술이 끝나 다음 기술을 쓸 수 있는 틱(EndsTick). zone과 함께 밀린다.
// - limit: 버튼을 계속 누르고 있어도 장판이 나가는 틱(HoldUntilTick). 바뀌지 않는다.
export interface PilotAction { slot: number; zone: number; ends: number; limit: number; released: boolean; direction: FixedVector }

// 눌렀지만 아직 시작하지 못한 누름이다(WaitingPress).
export interface PilotPress { slot: number; held: boolean; fresh: boolean }

// 내 대원의 상태 가운데 이동과 기술 시작에 쓰이는 것이다(Player). 기술은 한 번에 하나만 쓴다.
// lastInput은 마지막 입력이 도착한 틱이다(Player.LastInputTick). 입력이 끊겼는지를 이것으로 본다.
export interface Pilot { position: FixedVector; mana: number; tick: number; lastInput: number; action?: PilotAction; waiting: PilotPress[] }

// 보낸 입력 하나다. held는 그 순간 누르고 있는 슬롯의 비트 묶음(슬롯 n이 비트 n-1), pressed는 지난 입력 뒤에 누른 슬롯을 누른 차례대로다.
export interface PilotInput { moveX: number; moveY: number; aim: number; held: number; pressed: readonly number[] }

export const slotBit = (slot: number) => 1 << (slot - 1);

// 슬롯 목록을 비트 묶음으로 바꾼다.
export const slotMask = (slots: readonly number[]) => slots.reduce((mask, slot) => mask | slotBit(slot), 0);

export const clonePilot = (pilot: Pilot): Pilot => ({
  ...pilot, action: pilot.action ? { ...pilot.action } : undefined, waiting: pilot.waiting.map(press => ({ ...press })),
});

// 입력이 도착했다(Match.Input). 도착한 틱을 적고 버튼의 변화를 적는다(ApplyButtons). 뗀 버튼의 기술은 기운을 더 잇지 않고,
// 뗀 버튼의 기다리는 누름은 뗀 것으로 적고, 새로 누른 버튼은 기다리는 누름에 넣는다. 이동과 조준은 stepPilot에 입력째로 넘긴다.
export function receiveInput(pilot: Pilot, held: number, pressed: readonly number[]) {
  pilot.lastInput = pilot.tick;
  if (pilot.action && (held & slotBit(pilot.action.slot)) === 0) pilot.action.released = true;
  for (const waiting of pilot.waiting) if ((held & slotBit(waiting.slot)) === 0) waiting.held = false;
  for (const slot of pressed) press(pilot, slot, (held & slotBit(slot)) !== 0);
}

// 버튼 하나를 새로 눌렀다(Match.Press). 쓰던 기술의 버튼은 놓은 것으로 보고, 뗐다가 다시 누른 버튼은 맨 뒤로 간다.
// 쥐고 기다리던 버튼을 또 눌렀으면(같은 슬롯에 묶인 다른 키) 기다리던 자리를 그대로 둔다.
function press(pilot: Pilot, slot: number, held: boolean) {
  if (pilot.action) pilot.action.released = true;
  for (let i = pilot.waiting.length - 1; i >= 0; i--) {
    const waiting = pilot.waiting[i];
    if (waiting.slot !== slot) continue;
    if (waiting.held) return;
    pilot.waiting.splice(i, 1);
  }
  pilot.waiting.push({ slot, held, fresh: true });
}

// 누르고 있던 버튼을 모두 뗀 것으로 본다(Match.ReleaseButtons). 입력이 끊겼을 때다.
function releaseButtons(pilot: Pilot) {
  if (pilot.action) pilot.action.released = true;
  for (const waiting of pilot.waiting) waiting.held = false;
}

// 대시가 갈 방향이다(Match.DashDirection). 걷던 쪽이고, 서 있었으면 조준한 쪽이다.
export function dashDirection(moveX: number, moveY: number, aim: number): FixedVector {
  const move = moveDirection(moveX, moveY);
  if (lengthSquared(move) >= tinyLengthSquared) return normalize(move);
  return direction(angleUnits(aim));
}

// 대원을 한 틱 진행한다(Match.UpdatePlayer). input은 서버가 마지막으로 받은 입력이다. 새 입력이 없는 틱에도 같은 입력을 넘긴다.
// 버튼의 변화는 입력이 도착할 때 receiveInput으로 먼저 적어 둔다.
export function stepPilot(terrain: Terrain, bodies: readonly Body[], pilot: Pilot, input: PilotInput, rules: PilotRules) {
  pilot.tick += 1;
  const tick = pilot.tick;
  // 입력이 0.35초(11틱) 동안 없으면 멈추고, 누르고 있던 버튼을 모두 뗀 것으로 본다(Match.InputTimeoutTicks).
  // 입력 하나는 받은 다음 틱부터 inputHoldTicks틱까지만 쓰인다. 그 뒤로는 새 입력이 올 때까지 틱마다 이렇게 진행한다.
  // 쥐고 기다리던 누름은 이 틱에 버려지고, 쥐고 있던 기운은 장판이 나간다. 대시하는 중이었으면 대시는 끝까지 간다.
  const silent = tick - pilot.lastInput > inputHoldTicks;
  if (silent) releaseButtons(pilot);
  const moveX = silent ? 0 : input.moveX;
  const moveY = silent ? 0 : input.moveY;
  // 끝난 기술을 치운다.
  if (pilot.action && pilot.action.ends <= tick) pilot.action = undefined;
  // 버튼을 누르고 있으면 장판이 나갈 틱에 기운을 한 틱 더 잇는다(HoldAuras). 최대 기운 시간(limit)에 닿았으면 잇지 않는다.
  if (pilot.action) {
    const action = pilot.action;
    if (tick === action.zone && !action.released && action.zone < action.limit) {
      action.zone += 1;
      action.ends += 1;
    }
  }
  // 기술을 쓰고 있지 않으면 가장 먼저 누른 것으로 시작한다(StartWaitingSkill). 마나가 모자란 누름은 버린다.
  while (!pilot.action && pilot.waiting.length > 0) {
    const first = pilot.waiting.shift()!;
    const skill = rules.slots[first.slot - 1];
    if (pilot.mana < skill.mana) continue;
    pilot.mana -= skill.mana;
    // 이미 뗀 누름이거나 뒤에 살아 있는 누름이 기다리고 있으면 기운을 잇지 않는다.
    const released = !first.held || pilot.waiting.some(waiting => waiting.held || waiting.fresh);
    // 기운이 없는 기술(대시)은 누르고 있어도 이을 기운이 없다(PlayerAction의 생성자).
    const holdTicks = skill.auraTicks === 0 ? 0 : Math.max(skill.auraTicks, rules.maxAuraTicks);
    // 대시의 방향은 시작하는 틱에 서버가 쓰는 이동 입력과 조준으로 정한다. 입력이 끊겨 멈춘 틱이면 조준한 쪽이다.
    const heading = skill.dashStep > 0 ? dashDirection(moveX, moveY, input.aim) : { x: 0, y: 0 };
    pilot.action = { slot: first.slot, zone: tick + skill.auraTicks, ends: tick + skill.durationTicks, limit: tick + holdTicks, released, direction: heading };
  }
  // 뗀 누름은 한 번 더 보고 버린다.
  for (let i = pilot.waiting.length - 1; i >= 0; i--) {
    const waiting = pilot.waiting[i];
    if (!waiting.held && !waiting.fresh) { pilot.waiting.splice(i, 1); continue; }
    waiting.fresh = false;
  }
  // 움직인다(MovePlayer). 대시하는 중이면 대시의 방향과 거리로, 아니면 이동 입력으로 걷는다.
  let delta = scaleVector(moveDirection(moveX, moveY), playerStep(rules.speed));
  if (pilot.action) {
    const skill = rules.slots[pilot.action.slot - 1];
    if (skill.dashStep > 0) delta = scaleVector(pilot.action.direction, skill.dashStep);
  }
  pilot.position = moveBody(terrain, bodies, pilot.position, delta, rules.radius);
}
