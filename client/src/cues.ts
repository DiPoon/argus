import type { Affinity, Snapshot } from './types';

// 소리를 낼 사건이다(이슈 #35, 2026-11-24). 서버가 보낸 두 스냅샷을 견줘 새로 일어난 일만 고른다. 판정은 서버가 하고, 여기서는
// 서버가 이미 알린 결과(효과, 적의 예고, 시설·보급·탈출·작전 상태)를 소리로 옮기기만 한다. 스냅샷은 시야 밖의 적과 효과를 이미 뺐으므로
// 소리도 보이는 일에만 난다. 소리를 만드는 쪽(sound.ts)과 나눠 두어 소리 장치 없이 검사한다(sound.spec.ts).
export type CueKind =
  | 'break' | 'partial' | 'draw' | 'guard' | 'hit' | 'hurt' | 'myHurt' | 'heal' | 'deploy' | 'evade'
  | 'telegraph' | 'facility' | 'pickup' | 'extract' | 'victory' | 'defeat' | 'down' | 'press' | 'empty';
// pan은 왼쪽 -1 ~ 오른쪽 1, gain은 거리로 줄인 크기(0~1)다. 예고는 상성과 티어로 소리가 다르다.
export interface Cue { kind: CueKind; pan: number; gain: number; affinity?: Affinity; tier?: number }

// 서버 효과의 종류마다 낼 소리다. 효과가 없는 종류는 소리도 없다.
const effectCues: Record<string, CueKind> = {
  break: 'break', partial: 'partial', draw: 'draw', guard: 'guard', hit: 'hit', hurt: 'hurt', heal: 'heal', deploy: 'deploy', evade: 'evade',
};
// 이 거리(월드 단위)에서 크기가 가장 작아진다. 시야(410)보다 조금 멀다. 그보다 가까우면 거리에 따라 줄인다.
export const hearing = 520;
// 가장 작은 크기다. 보이는 곳의 일은 멀어도 들린다.
const farthest = .25;
// 이만큼 옆에 있으면 소리가 한쪽 끝에서 난다.
const panReach = 480;
// 한 스냅샷(0.1초)에 낼 소리의 상한이다. 섞인 무리와 싸우면 예고와 타격이 몰려 오므로 큰 것부터 고른다.
export const maxCuesPerSnapshot = 8;
// 내 체력이 줄었을 때 내 자리에서 이 거리 안의 새 피격은 모두 내가 맞은 것으로 본다. 대시 한 번(150)에 몸 반지름과 스냅샷 사이(0.1초)의
// 걸음을 더한 거리다. 내 피격 효과는 스냅샷에 없을 수 있어(혼자 떨어져 맞고 쓰러지면 내 자리가 시야 밖), 가장 가까운 하나를 거리와 관계없이
// 내 것으로 지우면 멀리서 맞은 동료의 소리가 빠졌다. 같은 0.1초에 둘에게 맞으면 남은 하나가 내 자리에서 동료가 맞은 소리로 났다(PR #42 리뷰, ee96b62).
// 이 안에서 함께 맞은 동료의 소리는 내가 맞은 소리에 묻는다.
export const myHitReach = 200;
// 나에게 일어난 일과 작전 종료다. 몰려도 늘 먼저 내고, 한 번에 울리는 소리가 상한에 닿아도 낸다(sound.ts).
export const personal: CueKind[] = ['victory', 'defeat', 'down', 'myHurt'];

// 듣는 자리(내 대원)에서 (x, y)의 소리가 어느 쪽에서 얼마나 크게 나는지다.
export function place(x: number, y: number, listener: { x: number; y: number }) {
  const dx = x - listener.x, dy = y - listener.y;
  const distance = Math.hypot(dx, dy);
  const gain = Math.max(farthest, 1 - (1 - farthest) * Math.min(1, distance / hearing));
  const pan = Math.max(-1, Math.min(1, dx / panReach));
  return { pan, gain };
}

// (x, y)에 가장 가까운 살아 있는 대원의 id다. 거리가 같으면 목록에서 먼저 온 대원이다.
function nearestPlayer(snapshot: Snapshot, spot: { x: number; y: number }): string | undefined {
  let nearest: string | undefined;
  let best = Infinity;
  for (const player of snapshot.players) {
    if (player.state !== 'alive') continue;
    const distance = Math.hypot(player.x - spot.x, player.y - spot.y);
    if (distance < best) { best = distance; nearest = player.id; }
  }
  return nearest;
}

// 들은 예고와 효과다. id에서 그 행동·효과가 끝나는 서버 시각(초)으로 간다. 스냅샷은 지금 시야에 든 적과 효과만 담으므로, 바로 앞 스냅샷
// 하나와만 견주면 시야 끝에서 한 장 빠졌다 돌아온 적의 같은 예고가 "새 예고" 소리로 다시 났다(PR #42 리뷰, ee96b62). 그래서 끝날 때까지
// 기억한다. 접속할 때마다 새로 만든다(main.ts).
export class Heard {
  actions = new Map<number, number>();
  effects = new Map<number, number>();

  // 끝난 것은 잊고, 이 스냅샷의 예고와 효과를 적는다.
  remember(current: Snapshot) {
    for (const [id, end] of this.actions) if (end < current.now) this.actions.delete(id);
    for (const [id, end] of this.effects) if (end < current.now) this.effects.delete(id);
    for (const enemy of current.enemies) if (enemy.action) this.actions.set(enemy.action.id, enemy.action.endsAt);
    for (const effect of current.effects) this.effects.set(effect.id, effect.until);
  }
}

// previous에서 current로 오며 새로 일어난 일의 소리다. 같은 방의 이전 스냅샷이 없으면(접속 직후) 지난 일을 울리지 않는다.
// heard는 들은 예고와 효과다. 주지 않으면 previous에 있던 것만 들은 것으로 본다.
export function snapshotCues(previous: Snapshot | undefined, current: Snapshot, heard = new Heard()): Cue[] {
  const seenEffects = new Set(heard.effects.keys());
  const seenActions = new Set(heard.actions.keys());
  for (const effect of previous?.effects ?? []) seenEffects.add(effect.id);
  for (const enemy of previous?.enemies ?? []) if (enemy.action) seenActions.add(enemy.action.id);
  heard.remember(current);
  if (!previous || previous.room !== current.room) return [];
  const me = current.players.find(player => player.id === current.you);
  if (!me) return [];
  const before = previous.players.find(player => player.id === previous.you);
  const listener = { x: me.x, y: me.y };
  const cues: Cue[] = [];
  const at = (kind: CueKind, x: number, y: number, extra: Partial<Cue> = {}) => cues.push({ kind, ...place(x, y, listener), ...extra });

  // 서버 효과: 들은 적 없는 것만 울린다. 효과는 0.4~0.65초 남아 여러 스냅샷에 거듭 온다.
  // 내가 맞았는지는 자리가 아니라 내 체력이 줄었는지로 가린다. 대원끼리는 몸이 막지 않아 겹쳐 설 수 있고, 맞은 뒤 대시하면 효과가 내 자리에서
  // 멀어진다. 자리로 가렸을 때는 겹쳐 선 동료가 맞으면 내가 맞은 소리가, 맞고 대시하면 동료가 맞은 소리가 났다(PR #42 리뷰 1).
  // 체력이 줄었으면 내가 맞은 소리를 한 번 내고(효과를 못 봤어도 낸다), 내 자리에서 myHitReach 안의 새 피격은 모두 그 소리로 본다.
  const fresh = current.effects.filter(effect => !seenEffects.has(effect.id) && effectCues[effect.kind]);
  // 서버의 한 틱에서 보급(체력·마나를 가득 채움)이 전투 판정보다 먼저다. 같은 0.1초에 보급을 받고 맞으면 체력이 지난 스냅샷보다 높을 수 있어
  // (2 → 6 → 5), 그때는 가득 찬 체력과 견준다(PR #42 리뷰, c1d5077). 보급을 받았는지는 마나가 늘었는지(마나는 보급으로만 는다)와, 마나가 이미
  // 가득했을 때를 위해 새 보급 효과에 가장 가까운 대원이 나인지로 본다. 효과는 보급을 받은 대원의 자리에 난다.
  const healedMe = before !== undefined && (me.mana > before.mana || current.effects.some(effect =>
    effect.kind === 'heal' && !seenEffects.has(effect.id) && nearestPlayer(current, effect) === me.id));
  const hurtMe = before !== undefined && before.state === 'alive' && me.hp < (healedMe ? me.maxHp : before.hp);
  if (hurtMe) cues.push({ kind: 'myHurt', pan: 0, gain: 1 });
  // 한 스냅샷의 같은 종류 효과는 가장 가까운 하나만 울린다. 한 스냅샷의 소리는 같은 순간에 시작해 같은 종류면 파형이 똑같이 겹치므로, 그대로
  // 내면 크기가 그 수만큼 더해진다. 회전 베기로 병사 다섯을 한꺼번에 받아치면 받아친 소리가 다섯 배로 커져 넘치고 내가 맞은 소리보다
  // 훨씬 컸다(PR #42 리뷰, ee96b62). 예고를 묶는 것과 같다.
  const effects = new Map<CueKind, { x: number; y: number; distance: number }>();
  for (const effect of fresh) {
    const distance = Math.hypot(effect.x - me.x, effect.y - me.y);
    if (hurtMe && effect.kind === 'hurt' && distance <= myHitReach) continue;
    const kind = effectCues[effect.kind];
    const known = effects.get(kind);
    if (!known || distance < known.distance) effects.set(kind, { x: effect.x, y: effect.y, distance });
  }
  for (const [kind, spot] of effects) at(kind, spot.x, spot.y);

  // 적이 새로 예고하기 시작했다. 상성마다 소리가 달라 귀로도 손을 가린다(RPS 정보를 감추지 않는다).
  // 여럿이 함께 예고하면 상성·티어마다 가장 가까운(거리로 고른다) 하나만 울린다. 크기로 고르면 먼 적끼리는 가장 작은 크기가 같아 목록에서
  // 먼저 온 적의 자리에서 났다(PR #42 리뷰 9).
  const telegraphs = new Map<string, { cue: Cue; distance: number }>();
  for (const enemy of current.enemies) {
    const action = enemy.action;
    if (!action || action.phase !== 'telegraph' || seenActions.has(action.id)) continue;
    const cue: Cue = { kind: 'telegraph', ...place(enemy.x, enemy.y, listener), affinity: action.kind, tier: action.tier };
    const distance = Math.hypot(enemy.x - listener.x, enemy.y - listener.y);
    const key = `${action.kind}-${action.tier}`;
    const known = telegraphs.get(key);
    if (!known || distance < known.distance) telegraphs.set(key, { cue, distance });
  }
  for (const { cue } of telegraphs.values()) cues.push(cue);

  // 시설이 부서졌다. 같은 시설이 지난 스냅샷에서 서 있었을 때만이다(처음 본 부서진 시설은 울리지 않는다).
  for (const facility of current.facilities) {
    const old = previous.facilities.find(item => item.id === facility.id);
    if (old && old.hp > 0 && facility.hp <= 0) at('facility', facility.x, facility.y);
  }
  // 부목표 보급품을 회수했다.
  for (const supply of current.supplies) {
    const old = previous.supplies.find(item => item.id === supply.id);
    if (supply.objective && old && !old.collected && supply.collected) at('pickup', supply.x, supply.y);
  }
  // 탈출 지점을 확보하는 동안 1초마다 짧게 울린다.
  const exit = current.extraction, oldExit = previous.extraction;
  if (exit && oldExit && exit.unlocked && Math.floor(exit.progress) > Math.floor(oldExit.progress)) at('extract', exit.x, exit.y);

  // 내가 쓰러졌다. 작전이 끝나는 순간이면 작전 종료 소리만 낸다.
  if (before?.state === 'alive' && me.state !== 'alive' && current.phase !== 'ended') cues.push({ kind: 'down', pan: 0, gain: 1 });
  if (previous.phase !== 'ended' && current.phase === 'ended') cues.push({ kind: current.result === 'success' ? 'victory' : 'defeat', pan: 0, gain: 1 });

  // 몰리면 나에게 일어난 일과 작전 종료를 먼저, 나머지는 큰 것부터 상한까지만 낸다. 크기로만 고르면 내 자리에서 난 타격(크기 1)
  // 여럿에 작전 종료가 밀린다.
  const mine = cues.filter(cue => personal.includes(cue.kind));
  const rest = cues.filter(cue => !personal.includes(cue.kind)).sort((a, b) => b.gain - a.gain);
  return [...mine, ...rest].slice(0, maxCuesPerSnapshot);
}
