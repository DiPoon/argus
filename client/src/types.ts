export type Position = { x: number; y: number };
export type Skill = 'strike' | 'parry' | 'grab' | 'spin' | 'spinblock' | 'spingrab';
export type Affinity = 'strike' | 'block' | 'channel' | 'none';
export const skillNames: Record<Skill, string> = { strike: '근접 타격', parry: '받아치기', grab: '잡기', spin: '회전 베기', spinblock: '회전 방어', spingrab: '회전 잡기' };
export const affinityNames: Record<Affinity, string> = { strike: '타격', block: '방어', channel: '잡기', none: '반격' };
// 기술에는 몸에 도는 기운과 범위에 깔리는 장판이 있다(protocol v6). auraSeconds는 기운이 도는 가장 짧은 시간,
// zoneSeconds는 장판이 깔려 있는 시간, duration은 버튼을 짧게 눌렀을 때 기술 전체의 길이다.
export interface SkillDefinition {
  id: Skill; kind: Affinity; mana: number; auraSeconds: number; zoneSeconds: number;
  duration: number; range: number; halfWidth: number;
  // 기술별 동작. 그림도 id가 아니라 이 속성으로 정한다.
  // plainZone은 장판에 상성이 없는 기술(받아치기의 반격)이다.
  plainZone: boolean; singleTarget: boolean; breaksStructures: boolean;
  // 조준하지 않는 둘레 기술이다. 기운이 모든 방향으로 돌고, 장판이 대원 둘레의 원(반지름 range)이다.
  around: boolean;
}
// 대원의 기술과 적의 행동이다. startedAt부터 contactAt 전까지 몸에 기운이 돌고, contactAt에 장판이 나가 기운이 사라지며,
// activeUntil에 장판이 걷힌다. 대원의 단계는 aura·zone·recovery, 적의 단계는 telegraph·active·recovery다.
// 대원이 버튼을 누르고 있는 동안에는 서버가 최대 기운 시간까지 누른다고 보고 세 시각을 보낸다. 떼면 당겨진다.
export interface CombatAction {
  id: number; skill: string; kind: Affinity; slot: number; tier: number;
  phase: 'aura' | 'zone' | 'telegraph' | 'active' | 'recovery';
  aim: number; startedAt: number; contactAt: number; activeUntil: number; endsAt: number;
  range: number; halfWidth: number;
  // 적의 행동이 노린 대원의 id다. 대원의 행동과 노린 대원이 없는 행동에는 없다(protocol v5, 2026-11-08).
  target?: string;
}
// x·y는 그리기용(소수 둘째 자리로 반올림)이고, rawX·rawY는 예측용 고정소수점 Raw(4096분의 1 단위 정수)다.
export interface Player extends Position {
  rawX: number; rawY: number;
  id: string; name: string; slots: Skill[]; state: 'waiting' | 'deploying' | 'alive';
  connected: boolean; hasDeployed: boolean; aim: number; hp: number; maxHp: number;
  mana: number; maxMana: number; busy: number; actions: CombatAction[];
  deploy: number; kills: number; deaths: number; ack: number; landingX: number; landingY: number;
}
export interface Enemy extends Position {
  rawX: number; rawY: number;
  id: number; kind: 'grunt' | 'breaker' | 'warden'; name: string; radius: number;
  hp: number; maxHp: number; tiers: number[]; action: CombatAction | null;
}
export interface Snapshot {
  type: 'snapshot'; version: number; room: string; you: string; now: number; elapsed: number;
  phase: 'staging' | 'active' | 'ended'; result: 'success' | 'failure' | null;
  // 벽 배열(base64)이다. 칸마다 0 빈 땅, 1 부술 수 있는 벽, 2 부술 수 없는 벽, 3 분대가 아직 보지 못한 칸이다(protocol v5).
  // 판 번호는 벽이 부서지거나 분대가 새 칸을 볼 때 바뀐다.
  walls: string; mapRevision: number;
  // 탈출 지점은 분대가 그 칸을 보기 전까지 null이다. 시설과 보급도 본 칸에 있는 것만 온다(protocol v5).
  extraction: (Position & { progress: number; duration: number; unlocked: boolean }) | null;
  map: { width: number; height: number; cell: number; columns: number; rows: number; campX: number; campY: number };
  rules: { deploy: number; speed: number; playerRadius: number; guardHalfAngle: number; maxAuraSeconds: number; skills: SkillDefinition[] };
  players: Player[]; enemies: Enemy[];
  facilities: (Position & { id: number; hp: number; maxHp: number })[];
  // kind는 보급 종류(시설 자리 상자도 field)이고 uses는 남은 횟수다. 다 쓴 상자는 0, 부목표 상자는 1에서 회수하면 0이다.
  supplies: (Position & { id: number; kind: 'camp' | 'field' | 'objective'; objective: boolean; collected: boolean; uses: number; cooldown: number })[];
  effects: (Position & { id: number; kind: string; until: number })[];
  sight: number[][]; notices: { id: number; at: number; text: string }[];
}
// 서버가 보내는 그대로의 스냅샷. 벽은 바뀔 때만, 규칙과 맵은 접속 직후에만 담긴다(protocol v3부터).
// 벽은 전체(walls)가 오거나, 이미 받은 배열에서 바뀐 칸만(wallChanges: [칸 번호, 값, …], 앞에서부터 적용) 온다(protocol v5).
export type SnapshotWire = Omit<Snapshot, 'walls' | 'rules' | 'map'> & Partial<Pick<Snapshot, 'walls' | 'rules' | 'map'>> & { wallChanges?: number[] };

// base64 벽 배열에 바뀐 칸([칸 번호, 값, …])을 앞에서부터 적용한 새 base64 배열이다. 같은 칸이 두 번 나오면 뒤의 값이 남는다.
export function applyWallChanges(walls: string, changes: readonly number[]): string {
  const tiles = Uint8Array.from(atob(walls), c => c.charCodeAt(0));
  for (let i = 0; i + 1 < changes.length; i += 2) tiles[changes[i]] = changes[i + 1];
  let binary = '';
  for (const tile of tiles) binary += String.fromCharCode(tile);
  return btoa(binary);
}
export interface Guest { room: string; id: string; token: string }
export interface Control { x: number; y: number; aim: number; slot: number }
