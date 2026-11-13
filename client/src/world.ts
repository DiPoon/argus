import { Application, Container, Graphics, Text } from 'pixi.js';
import { fromDouble, toDouble, type FixedVector } from './fixed';
import { deployable, inputHoldTicks, stepPlayer, tickMilliseconds, ticksPerSecond, unknownTile, type Body, type Terrain } from './movement';
import { affinityNames, type Affinity, type CombatAction, type Control, type Position, type SkillDefinition, type Snapshot } from './types';
// 색(상성 색, 지도 색, 대원 색, 적 몸 색)은 미니맵·CSS·검사가 함께 쓰도록 pixi 없는 palette.ts에 둔다.
import { affinityColors, bodyColor, colors, extractionRadius, facilityColor, supplyColor, supplyShown, team } from './palette';
import type { Minimap, MinimapScene } from './minimap';

// 효과 색이다. 방어 성공은 방어 상성 색이다. 피격·비김은 상성 색과 겹치지 않는 분홍이다(2026-11-08 사용자 결정). 예전 연어 빨강은
// 새 타격 빨강과 거의 같아(적색약에게는 같은 색) 적 옆에 뜬 피격이 타격 예고로 읽혔다. 분홍은 빨강과 파랑을 섞은 색이라 3원색과
// 겹치지 않는다. 완벽 대응은 라임, 부분 대응은 금색이고, 나머지(−1, 보급 완료, 투입)는 청록이다.
const effectColors: Record<string, number> = { guard: affinityColors.block, hurt: colors.pink, draw: colors.pink, break: colors.lime, partial: colors.gold };
const unitOutline = { color: colors.outline, width: 2.5 };

// 원호는 이 함수로만 그린다. Pixi는 fill·stroke 뒤의 다음 경로를 직전 경로의 마지막 점에서 시작한다.
// 그런데 직전 경로가 원·사각형·다각형 같은 도형으로 끝나면 마지막 점을 계산하지 않고, 읽을 때마다 0으로 되돌리는
// 임시 점(Point.shared)을 그대로 쓴다. 그러면 원호가 지도 원점(왼쪽 위)에서부터 직선으로 이어져 그려진다.
// beginPath로 새 경로를 열면 시작점 없이 원호만 그려진다.
const arcOnNewPath = (g: Graphics, x: number, y: number, radius: number, start: number, end: number) =>
  g.beginPath().arc(x, y, radius, start, end);

// 기운을 그리는 크기다(월드 단위). 기운은 몸 둘레의 옅은 빛으로 그리고, 대원은 그 바깥에 기운이 향한 쪽을 굵은 고리(둘레 기술)나
// 앞 120°의 호로 그린다. 그 바깥의 가는 호는 기운이 남은 시간이고, 호 위의 짧은 눈금은 가장 짧은 기운 시간이 끝나는 자리다.
// 적의 예고 고리(반지름 32)는 가장 큰 적의 빛(23 + 8)보다 바깥이다.
const auraGlow = 8, auraRing = 28, auraTimer = 34, auraNotch = 3, telegraphRing = 32;

// 확인받지 않은 입력을 이만큼(30Hz로 2초 분량)까지 보관한다. 확인이 오지 않는 이상한 상황에서도 끝없이 늘지 않게 한다.
const maxPending = 60;

// 보냈지만 서버가 아직 확인하지 않은 입력이다. ticks는 이 입력이 쓰일 것으로 보는 틱 수다. 보통 1이고, 다음 입력을
// 제때 보내지 못하면(타이머가 늦게 깸) 서버처럼 이 입력을 그만큼 더 쓴 것으로 친다.
type PendingInput = { seq: number; x: number; y: number; at: number; ticks: number };

export class World {
  readonly app = new Application();
  private root = new Container();
  private ground = new Graphics();
  private light = new Graphics();
  // 벽과 분대가 보지 못한 칸은 구역(chunkSize × chunkSize칸)마다 따로 그린다. 분대가 새 칸을 볼 때마다 바뀐 칸이 오므로
  // 바뀐 구역만 다시 그린다. 맵 전체를 매번 다시 그리면 큰 맵에서 초당 여러 번 수천 개의 사각형을 새로 만든다.
  // 보지 못한 칸의 덮개(fog)는 시야(light) 아래, 벽(walls)은 시야 위에 둔다. 지금 보이는 곳은 아직 본 칸으로 오지 않았어도
  // 밝게 보이고, 그 위의 적도 밝은 바닥 위에 그려진다.
  private fog = new Container();
  private walls = new Container();
  private fogChunks: Graphics[] = [];
  private wallChunks: Graphics[] = [];
  private static readonly chunkSize = 8;
  private props = new Graphics();
  private units = new Graphics();
  private labels = new Container();
  private labelsById = new Map<string, Text>();
  // 쓰지 않게 된 라벨을 바로 해제하지 않고 숨겨 두었다가 새 라벨에 다시 쓴다. 상한을 넘는 것만 해제한다.
  private spareLabels: Text[] = [];
  private static readonly spareLimit = 64;
  private snapshot?: Snapshot;
  private previous?: Snapshot;
  private received = 0;
  private interval = 100;
  private tiles = new Uint8Array();
  private revision = -1;
  // 그리는 내 위치(월드 단위)다.
  private predicted?: Position;
  // 보냈지만 서버가 아직 확인하지 않은 내 입력. 서버 재조정에서 서버 위치 위에 다시 적용한다.
  private pending: PendingInput[] = [];
  // 서버가 확인한 마지막 입력 순번과, 보관 상한을 넘어 버린 마지막 입력 순번이다.
  private ack = -1;
  private droppedSeq = -1;
  // 예측에 쓰는 맵과 대원을 막는 몸(시야 안의 살아 있는 적)이다. 좌표는 모두 Raw다.
  private terrain?: Terrain;
  private bodies: Body[] = [];
  // 서버가 보낸 내 위치(Raw)와, 그 위에 남은 입력을 서버와 같은 계산으로 적용한 위치(Raw)다.
  // tip은 입력을 모두 적용한 곳이고, previous는 마지막 입력 하나를 빼고 적용한 곳이다.
  private base?: FixedVector;
  private forecast?: { previous: FixedVector; tip: FixedVector };
  // 서버 위치로 예측을 바로잡을 때 그림이 튀지 않게 남겨 두는 차이(월드 단위)다. 시간이 지나며 0으로 줄어든다.
  private correction: Position = { x: 0, y: 0 };
  private predicting = false;
  private oldState = '';
  private camera = { x: 960, y: 720, zoom: 1 };
  private averageFrame = 16.7;
  private renderBudget = 10000;
  overview = false;
  // 터치 화면의 서랍이 열려 있는지다(main.ts가 알린다). 미니맵은 서랍보다 위에 그려지므로 그동안 숨긴다.
  menuOpen = false;
  // 미니맵이다(minimap.ts). main.ts가 작전 화면의 캔버스로 만들어 붙인다. 보이는지는 draw 한 곳에서 정한다:
  // 메인 화면이 맵 전체를 보이는 동안과 서랍이 열린 동안에는 숨긴다.
  minimap?: Minimap;
  landing?: Position;
  fps = 60;
  shownEnemies = 0;
  control: Control = { x: 0, y: 0, aim: 0 };

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host, background: '#10191b', antialias: true,
      resolution: Math.min(devicePixelRatio, 2), autoDensity: true,
      // Use native 2D drawing when hardware WebGL is unavailable, including software-only browsers.
      preference: ['webgl', 'canvas'], failIfMajorPerformanceCaveat: true,
    });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
    this.root.addChild(this.ground, this.fog, this.light, this.walls, this.props, this.units, this.labels);
    this.app.ticker.add(t => this.draw(Math.min(t.deltaMS / 1000, .05)));
  }

  // 방을 나갈 때 부른다. 지난 방의 스냅샷과 그림을 모두 비운다. 비우지 않으면 다음 방의 첫 스냅샷이 오기 전에(연결이 늦으면 그동안 내내)
  // 메인 화면과 미니맵이 지난 방을 그린다. 다시 켠 ticker가 그리기 전에 지난 그림이 한 프레임 보이지 않도록 빈 화면도 바로 그린다.
  reset() {
    this.snapshot = undefined;
    this.previous = undefined;
    this.tiles = new Uint8Array();
    this.revision = -1;
    this.terrain = undefined;
    this.bodies = [];
    this.base = undefined;
    this.forecast = undefined;
    this.predicted = undefined;
    this.pending = [];
    this.ack = -1;
    this.droppedSeq = -1;
    this.correction = { x: 0, y: 0 };
    this.predicting = false;
    this.oldState = '';
    this.landing = undefined;
    this.overview = false;
    this.menuOpen = false;
    for (const layer of [this.ground, this.light, this.props, this.units]) layer.clear();
    for (const chunk of [...this.fogChunks, ...this.wallChunks]) chunk.destroy();
    this.fogChunks = [];
    this.wallChunks = [];
    this.labelsById.forEach(label => { label.visible = false; });
    this.removeUnusedLabels();
    this.minimap?.show(false);
    // 그래픽 초기화(init)가 끝나기 전에는 그릴 것이 없다.
    if (this.app.renderer) this.app.render();
  }

  update(snapshot: Snapshot) {
    const now = performance.now();
    const before = this.target(now);
    const changedRoom = snapshot.room !== this.snapshot?.room;
    this.previous = changedRoom ? undefined : this.snapshot;
    this.interval = Math.max(50, Math.min(250, performance.now() - this.received));
    this.snapshot = snapshot;
    this.received = performance.now();
    if (changedRoom || this.revision !== snapshot.mapRevision) {
      this.revision = snapshot.mapRevision;
      const before = changedRoom ? undefined : this.tiles;
      this.tiles = Uint8Array.from(atob(snapshot.walls), c => c.charCodeAt(0));
      if (changedRoom) this.drawGround();
      this.drawTiles(before);
    }
    this.terrain = { tiles: this.tiles, columns: snapshot.map.columns, rows: snapshot.map.rows, cell: snapshot.map.cell };
    // 살아 있는 적만 대원을 막는다. 스냅샷에는 시야 안의 적만 오므로, 숨은 적이나 그 사이 움직인 적과의 차이는 서버 위치로 보정된다.
    this.bodies = snapshot.enemies.filter(enemy => enemy.hp > 0)
      .map(enemy => ({ x: enemy.rawX, y: enemy.rawY, radius: fromDouble(enemy.radius) }));
    const me = snapshot.players.find(p => p.id === snapshot.you);
    this.base = me ? { x: me.rawX, y: me.rawY } : undefined;
    this.ack = me?.ack ?? -1;
    const reset = me !== undefined && (me.state !== this.oldState || changedRoom);
    if (me && reset) {
      this.predicted = { x: me.x, y: me.y };
      // 투입·사망·방 이동으로 위치가 새로 정해지면 그 전에 보낸 입력은 의미가 없다.
      this.pending = [];
      this.droppedSeq = -1;
      this.correction = { x: 0, y: 0 };
    }
    this.oldState = me?.state ?? '';
    // ack 이하의 입력은 서버가 이미 처리해 서버 위치에 반영되어 있다.
    if (me) this.pending = this.pending.filter(input => input.seq > me.ack);
    // 서버 위치와 막는 몸이 새로 왔으니 남은 입력 전체를 다시 걷는다.
    this.resimulate();
    // 서버 위치가 예측과 다르면 그리는 목표가 바뀐다. 그 차이를 보정 차이로 옮겨 그림이 튀지 않게 하고 천천히 줄인다.
    if (!reset) this.keepDrawn(before, now);
    this.light.clear();
    for (const polygon of snapshot.sight) this.light.poly(polygon).fill(colors.lit);
  }

  screenToWorld(clientX: number, clientY: number): Position {
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - this.root.x) / this.camera.zoom, y: (clientY - rect.top - this.root.y) / this.camera.zoom };
  }

  mePosition() { return this.predicted; }

  // 보낸 입력을 서버가 확인할 때까지 보관한다. 시각은 화면 계산에만 쓰며 서버로 보내지 않는다.
  recordInput(seq: number, x: number, y: number, at = performance.now()) {
    const before = this.target(at);
    const input = { seq, x, y, at, ticks: 1 };
    this.pending.push(input);
    if (this.pending.length > maxPending) {
      // 버리는 입력은 서버가 이미 처리했지만 아직 확인이 오지 않았을 수 있다. 빼고 다시 걸으면 그 틱만큼 뒤처지므로,
      // 서버가 버린 입력까지 확인해 줄 때까지 예측을 끄고 서버 위치를 그린다.
      this.droppedSeq = this.pending.shift()!.seq;
      this.resimulate();
    } else {
      // 새 입력은 마지막 예측 위치에서 한 틱만 더 걸으면 된다.
      this.advance(input, 1);
    }
    // 직전 입력이 한 틱을 다 채우기 전에 새 입력이 오면 목표가 앞으로 건너뛴다. 그 차이도 보정 차이로 옮긴다.
    this.keepDrawn(before, at);
  }

  // 타이머가 늦게 깨어 missed틱 동안 입력을 보내지 못했다. 서버는 그동안 마지막 입력을 계속 쓰므로 예측도 그만큼 더 쓴다.
  // 서버처럼 입력 하나는 inputHoldTicks틱까지만 쓴다. 그 뒤에는 서버도 대원을 멈춘다.
  holdLastInput(missed: number, at = performance.now()) {
    const last = this.pending[this.pending.length - 1];
    if (!last || missed <= 0) return;
    const extra = Math.min(missed, inputHoldTicks - last.ticks);
    if (extra <= 0) return;
    const before = this.target(at);
    last.ticks += extra;
    this.advance(last, extra);
    this.keepDrawn(before, at);
  }

  // 서버 재조정: 서버가 보낸 내 위치(Raw)에서 출발해, 서버가 아직 처리하지 않은 입력을 보낸 순서대로 다시 적용한다.
  // 입력 하나는 보통 한 틱이다. 계산은 서버와 같은 고정소수점이라, 서버가 입력을 같은 틱에 받고 막는 몸이 그대로면
  // 서버와 Raw까지 같은 곳에 이른다. 서버가 같은 틱에 입력 둘을 받거나(나중 것만 쓴다) 한 틱 동안 입력을 받지 못하면
  // (앞 입력을 한 틱 더 쓴다) 그만큼 어긋나고, 다음 스냅샷에서 서버 위치로 바로잡힌다.
  private resimulate() {
    if (!this.snapshot || !this.base || !this.terrain || this.droppedSeq > this.ack) { this.forecast = undefined; return; }
    this.forecast = { previous: this.base, tip: this.base };
    for (const input of this.pending) this.advance(input, input.ticks);
  }

  // 서버가 마지막 스냅샷 뒤로 ticks틱 동안 내 입력을 쓴 뒤의 내 자리(Raw)다. resimulate와 같은 계산을 앞부분만 한다.
  // 보낸 입력보다 더 걸어야 하면 서버처럼 마지막 입력을 inputHoldTicks틱이 될 때까지만 이어 쓴다.
  // 예측을 끈 동안(forecast가 없음)에는 없다. 서버가 입력을 한 틱에 하나씩 받으면 서버와 같은 자리다.
  private serverSpotAfter(ticks: number): FixedVector | undefined {
    const s = this.snapshot;
    if (!s || !this.base || !this.terrain || !this.forecast) return undefined;
    const radius = fromDouble(s.rules.playerRadius);
    let spot = this.base;
    let left = ticks;
    for (const input of this.pending) {
      if (left <= 0) return spot;
      const use = Math.min(left, input.ticks);
      for (let i = 0; i < use; i++) spot = stepPlayer(this.terrain, this.bodies, spot, input.x, input.y, s.rules.speed, radius);
      left -= use;
    }
    const last = this.pending[this.pending.length - 1];
    if (last && left > 0) {
      const extra = Math.min(left, inputHoldTicks - last.ticks);
      for (let i = 0; i < extra; i++) spot = stepPlayer(this.terrain, this.bodies, spot, last.x, last.y, s.rules.speed, radius);
    }
    return spot;
  }

  // 마지막 예측 위치(tip)에서 input을 ticks틱 더 쓴다. previous는 마지막 한 틱 전의 위치로, 그리기 보간에 쓴다.
  private advance(input: PendingInput, ticks: number) {
    const s = this.snapshot;
    if (!s || !this.terrain || !this.forecast) return;
    const radius = fromDouble(s.rules.playerRadius);
    let { previous, tip } = this.forecast;
    for (let i = 0; i < ticks; i++) {
      previous = tip;
      tip = stepPlayer(this.terrain, this.bodies, tip, input.x, input.y, s.rules.speed, radius);
    }
    this.forecast = { previous, tip };
  }

  // 목표가 바뀐 만큼을 보정 차이로 옮겨, 그리는 위치가 바뀌기 전 자리에서 이어지게 한다.
  private keepDrawn(before: Position | undefined, at: number) {
    const after = this.target(at);
    if (before && after) this.correct(before, after);
  }

  // 그릴 목표 위치(월드 단위)다. 마지막 입력은 보낸 뒤 한 틱 동안 나아가는 것으로 이어 그린다.
  // 예측하지 않을 때(살아 있지 않거나 스냅샷이 끊겼을 때)는 서버 위치다.
  private target(now: number): Position | undefined {
    if (!this.base) return undefined;
    if (!this.predicting || !this.forecast) return { x: toDouble(this.base.x), y: toDouble(this.base.y) };
    const { previous, tip } = this.forecast;
    const last = this.pending[this.pending.length - 1];
    const progress = last ? Math.min(1, Math.max(0, (now - last.at) / tickMilliseconds)) : 1;
    return { x: toDouble(previous.x + (tip.x - previous.x) * progress), y: toDouble(previous.y + (tip.y - previous.y) * progress) };
  }

  // 목표가 before에서 after로 바뀐 만큼을 보정 차이로 옮긴다. 차이가 아주 크면(순간 이동) 바로 따라간다.
  private correct(before: Position, after: Position) {
    this.correction = { x: this.correction.x + before.x - after.x, y: this.correction.y + before.y - after.y };
    if (Math.hypot(this.correction.x, this.correction.y) > 100) this.correction = { x: 0, y: 0 };
  }

  // 그 자리에 투입할 수 있는지 서버의 Deploy와 같은 계산(movement.ts의 deployable)과 대원 반지름으로 본다.
  // 분대가 본 칸이어야 하고(unseen), 본 칸의 벽만으로 몸이 들어가야 한다(blocked). 서버처럼 아주 먼 좌표는 바로 거절한다.
  deployCheck(p: Position, radius = this.snapshot?.rules.playerRadius ?? 13): 'ok' | 'unseen' | 'blocked' {
    if (!this.terrain || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6) return 'blocked';
    return deployable(this.terrain, { x: fromDouble(p.x), y: fromDouble(p.y) }, fromDouble(radius));
  }

  // 기술 하나를 그린다. 몸에 도는 기운과 범위에 깔리는 장판을 따로 그린다(protocol v6). radius는 그 몸의 반지름이다.
  // - 장판이 나가기 전: 몸에 기운이 돈다. 몸 둘레에 상성 색의 옅은 빛을 그리고, 장판이 깔릴 자리는 옅게 그린다.
  //   대원은 기운이 향한 쪽(둘레 기술은 고리, 그 밖에는 앞 120°의 호)과 기운이 남은 시간(바깥의 가는 호)도 그린다.
  //   적은 예고가 얼마나 지났는지를 고리로 그린다. 고리가 다 차면 장판이 나간다.
  // - 장판이 나간 뒤 걷히기 전: 진하게 그리고, 기운은 사라졌으므로 그리지 않는다.
  // 스냅샷의 시각은 서버가 지금 정해 둔 틱 그대로다. 대원이 버튼을 누르고 있어 기운이 이어지는 중(held)이면 contactAt은
  // 지금 놓았을 때의 시각이라 곧 지나가는데, 그때도 장판은 나가지 않는다. 그래서 held인 기운은 다음 스냅샷이 올 때까지,
  // 늦어도 장판이 나가는 시각(holdUntil)까지 기운으로 그린다. 그러지 않으면 스냅샷 사이에 장판을 그렸다가 기운으로 되돌린다.
  private drawAction(g: Graphics, p: Position, action: CombatAction, now: number, player: boolean, radius: number) {
    const wait = action.held && action.holdUntil !== undefined ? Math.max(0, action.holdUntil - action.contactAt) : 0;
    if (now >= action.activeUntil + wait) return;
    // 기술별 그림은 id가 아니라 서버가 보낸 기술 속성으로 정한다. 적의 행동에는 기술 정의가 없다.
    const definition = player ? this.snapshot!.rules.skills.find(d => d.id === action.skill) : undefined;
    const aura = now < action.contactAt + wait;
    // 기운의 색은 기술의 종류다. 스냅샷의 kind는 지금 단계의 종류라 받아치기의 반격 중에는 none이다. 화면 시계는 스냅샷보다
    // 앞서 가므로, 대원의 기술은 정의의 종류로 기운을 칠하고 상성 없는 장판(plainZone)은 none 색으로 칠한다.
    const auraKind: Affinity = definition?.kind ?? action.kind;
    const zoneKind: Affinity = definition?.plainZone ? 'none' : auraKind;
    if (!aura) { this.drawZone(g, p, action, definition, zoneKind, false); return; }
    const color = affinityColors[auraKind];
    // 장판이 깔릴 자리다. 상성 없는 장판(반격)과 장판이 없는 기술은 미리 그리지 않는다.
    if (!definition || (!definition.plainZone && definition.zoneSeconds > 0)) this.drawZone(g, p, action, definition, zoneKind, true);
    g.circle(p.x, p.y, radius + auraGlow).fill({ color, alpha: .25 });
    const span = Math.max(.001, action.contactAt - action.startedAt);
    if (!player) {
      const fraction = Math.max(0, Math.min(1, (now - action.startedAt) / span));
      arcOnNewPath(g, p.x, p.y, telegraphRing, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction).stroke({ color, width: 3 });
      return;
    }
    const aim = action.aim;
    if (definition?.around) {
      g.circle(p.x, p.y, auraRing).stroke({ color, width: 5 });
    } else {
      const half = this.snapshot!.rules.guardHalfAngle;
      arcOnNewPath(g, p.x, p.y, auraRing, aim - half, aim + half).stroke({ color, width: 5 });
      g.moveTo(p.x, p.y).lineTo(p.x + Math.cos(aim - half) * auraRing, p.y + Math.sin(aim - half) * auraRing)
        .moveTo(p.x, p.y).lineTo(p.x + Math.cos(aim + half) * auraRing, p.y + Math.sin(aim + half) * auraRing).stroke({ color, width: 1, alpha: .4 });
    }
    // 기운이 남은 시간이다. 늦어도 장판이 나가는 시각(holdUntil)까지를 한 바퀴로 그린다. 버튼을 누르고 있으면 호가 다 닳을 때
    // 장판이 나가고, 짧게 누른 기술은 호가 눈금(가장 짧은 기운 시간이 끝나는 자리)에 닿을 때 나간다.
    // 호의 길이는 held에 기대지 않는다. 짧게 누른 기술도 뗀 입력이 서버에 닿기 전의 스냅샷에서는 held라, 그 값으로 길이를
    // 정하면 호가 긴 값에서 짧은 값으로 튄다(PR #28 리뷰 9번).
    const limit = action.holdUntil ?? action.contactAt;
    const whole = Math.max(.001, limit - action.startedAt);
    const left = Math.max(0, Math.min(1, (limit - now) / whole));
    if (left > 0) arcOnNewPath(g, p.x, p.y, auraTimer, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left).stroke({ color, width: 2, alpha: .75 });
    // 눈금은 서버처럼 기운 시간을 틱으로 올려 구한다(Rules.ToTicks). 가장 짧은 기운 시간이 한 바퀴보다 짧을 때만 그린다.
    const shortest = definition ? Math.ceil(definition.auraSeconds * ticksPerSecond - .000001) / ticksPerSecond : whole;
    if (shortest < whole - .0005) {
      const mark = -Math.PI / 2 + Math.PI * 2 * (1 - shortest / whole);
      g.moveTo(p.x + Math.cos(mark) * (auraTimer - auraNotch), p.y + Math.sin(mark) * (auraTimer - auraNotch))
        .lineTo(p.x + Math.cos(mark) * (auraTimer + auraNotch), p.y + Math.sin(mark) * (auraTimer + auraNotch)).stroke({ color, width: 2, alpha: .9 });
    }
  }

  // 장판을 그린다. 둘레 기술은 대원 둘레의 원, 그 밖에는 조준 방향의 사각형이다. faint면 아직 나가지 않은 장판(깔릴 자리)이다.
  private drawZone(g: Graphics, p: Position, action: CombatAction, definition: SkillDefinition | undefined, kind: Affinity, faint: boolean) {
    const color = affinityColors[kind];
    const alpha = faint ? .08 : .28;
    if (definition?.around) {
      g.circle(p.x, p.y, action.range).fill({ color, alpha }).stroke({ color, width: 1.5, alpha: .8 });
      return;
    }
    const f = { x: Math.cos(action.aim), y: Math.sin(action.aim) };
    const width = action.halfWidth;
    const end = { x: p.x + f.x * action.range, y: p.y + f.y * action.range };
    g.poly([
      p.x - f.y * width, p.y + f.x * width, end.x - f.y * width, end.y + f.x * width,
      end.x + f.y * width, end.y - f.x * width, p.x + f.y * width, p.y - f.x * width,
    ]).fill({ color, alpha }).stroke({ color, width: action.tier === 2 ? 3 : 1.5, alpha: .8 });
    if (kind === 'channel') {
      for (const sign of [-1, 1]) {
        const x = end.x - f.y * width * sign, y = end.y + f.x * width * sign;
        g.circle(x, y, 5).fill(color).stroke(unitOutline);
      }
    }
  }

  private drawGround() {
    const s = this.snapshot!;
    const g = this.ground.clear();
    g.rect(0, 0, s.map.width, s.map.height).fill(colors.floor);
    for (let x = 0; x <= s.map.width; x += s.map.cell) g.moveTo(x, 0).lineTo(x, s.map.height);
    for (let y = 0; y <= s.map.height; y += s.map.cell) g.moveTo(0, y).lineTo(s.map.width, y);
    g.stroke({ color: colors.grid, width: 1, alpha: .28 });
  }

  // before는 직전에 그린 벽 배열이다. 없거나 크기가 다르면(방이 바뀜) 모든 구역을 새로 만들고, 아니면 칸 값이 바뀐 구역만 다시 그린다.
  private drawTiles(before?: Uint8Array) {
    const s = this.snapshot!;
    const { columns, rows, cell } = s.map;
    const size = World.chunkSize;
    const across = Math.ceil(columns / size), down = Math.ceil(rows / size);
    const rebuild = !before || before.length !== this.tiles.length || this.wallChunks.length !== across * down;
    if (rebuild) {
      for (const chunk of [...this.fogChunks, ...this.wallChunks]) chunk.destroy();
      this.fogChunks = Array.from({ length: across * down }, () => this.fog.addChild(new Graphics()));
      this.wallChunks = Array.from({ length: across * down }, () => this.walls.addChild(new Graphics()));
    }
    for (let cy = 0; cy < down; cy++) {
      for (let cx = 0; cx < across; cx++) {
        const x0 = cx * size, y0 = cy * size, x1 = Math.min(columns, x0 + size), y1 = Math.min(rows, y0 + size);
        let changed = rebuild;
        for (let y = y0; y < y1 && !changed; y++) {
          for (let x = x0; x < x1 && !changed; x++) changed = before![y * columns + x] !== this.tiles[y * columns + x];
        }
        if (!changed) continue;
        const f = this.fogChunks[cy * across + cx].clear();
        const w = this.wallChunks[cy * across + cx].clear();
        for (let y = y0; y < y1; y++) {
          // 보지 못한 칸은 가로로 이어진 칸을 한 사각형으로 묶어 어둡게 덮는다. 덮개는 시야 아래에 있어 지금 보이는 곳은 밝게 남는다.
          let run = -1;
          for (let x = x0; x <= x1; x++) {
            const unknown = x < x1 && this.tiles[y * columns + x] === unknownTile;
            if (unknown && run < 0) run = x;
            if (!unknown && run >= 0) { f.rect(run * cell, y * cell, (x - run) * cell, cell).fill(colors.unknown); run = -1; }
          }
          for (let x = x0; x < x1; x++) {
            const tile = this.tiles[y * columns + x];
            if (tile !== 1 && tile !== 2) continue;
            const px = x * cell, py = y * cell;
            w.rect(px + 3, py + 5, cell - 3, cell - 3).fill({ color: 0x000000, alpha: .3 });
            w.rect(px + 1, py + 1, cell - 2, cell - 2).fill(tile === 2 ? 0x303b3e : colors.wall);
            if (tile === 1) w.moveTo(px + 3, py + 2).lineTo(px + cell - 3, py + 2).stroke({ color: colors.edge, width: 2 });
          }
        }
      }
    }
  }

  private label(key: string, text: string, x: number, y: number, color: number, size = 12) {
    let label = this.labelsById.get(key);
    if (!label) {
      label = this.spareLabels.pop();
      if (!label) {
        label = new Text({ text, style: { fontFamily: 'sans-serif', fontSize: size, fontWeight: '600', fill: color } });
        label.anchor.set(.5, .5);
        this.labels.addChild(label);
      }
      this.labelsById.set(key, label);
    }
    label.text = text;
    label.style.fill = color;
    label.style.fontSize = size;
    label.position.set(x, y);
    label.visible = true;
  }

  private removeUnusedLabels() {
    // 이번 프레임에 쓰지 않은 라벨은 목록에서 뺀다. 적의 사망·시야 이탈과 방 전환으로 사라진 라벨도 여기서 정리된다.
    // 상한까지는 숨긴 채 모아 두었다가 다시 쓰고, 넘는 것은 Pixi에서 떼어 해제해 라벨 수가 끝없이 늘지 않게 한다.
    for (const [key, label] of this.labelsById) {
      if (label.visible) continue;
      this.labelsById.delete(key);
      if (this.spareLabels.length < World.spareLimit) {
        this.spareLabels.push(label);
        continue;
      }
      this.labels.removeChild(label);
      label.destroy({ style: true });
    }
  }

  private draw(dt: number) {
    const s = this.snapshot;
    if (!s) return;
    // Keep an unfocused companion window useful without rendering it at the foreground frame rate.
    const focused = document.hasFocus();
    this.app.ticker.maxFPS = focused ? 60 : 10;
    this.averageFrame += (this.app.ticker.deltaMS - this.averageFrame) * .02;
    this.fps = Math.round(1000 / this.averageFrame);
    if (focused && this.fps < 35 && s.enemies.length > 40) this.renderBudget = Math.max(30, this.shownEnemies - 1);
    if (focused && this.fps > 52) this.renderBudget = Math.min(10000, this.renderBudget + 1);
    const me = s.players.find(p => p.id === s.you);
    const overview = this.overview || me?.state !== 'alive' || s.phase === 'ended';
    // 마지막 스냅샷을 받은 뒤 지난 시간(ms)이다. 그리는 시각(elapsed)은 0.2초에서 자르지만, 보간 정도는 자르지 않은 값으로 구한다.
    // 함께 자르면 스냅샷 간격이 0.2초를 넘을 때 보간이 끝까지 가지 못하고 멈췄다가 다음 스냅샷에서 튄다.
    const since = performance.now() - this.received;
    const elapsed = Math.min(.2, since / 1000);
    if (me) {
      // 서버 위치는 왕복 지연만큼 과거 입력의 결과다. 그대로 따라가면 화면의 내 캐릭터가 입력보다 늦으므로
      // 확인받지 않은 입력을 다시 적용한 곳을 목표로 삼는다.
      const now = performance.now();
      const active = me.state === 'alive' && s.phase === 'active' && now - this.received < 500;
      if (active !== this.predicting) {
        // 예측을 켜거나 끄면 목표가 바뀐다. 그 차이도 보정 차이로 옮겨 그림이 튀지 않게 한다.
        const before = this.predicted;
        this.predicting = active;
        const after = this.target(now);
        if (before && after) { this.correction = { x: 0, y: 0 }; this.correct(before, after); }
      }
      const target = this.target(now);
      if (target) {
        const keep = Math.max(0, 1 - dt * 12);
        this.correction = { x: this.correction.x * keep, y: this.correction.y * keep };
        this.predicted = { x: target.x + this.correction.x, y: target.y + this.correction.y };
      }
    }
    const width = this.app.screen.width, height = this.app.screen.height;
    const zoom = overview ? Math.min((width - 70) / s.map.width, (height - 120) / s.map.height) : Math.min(1.15, Math.max(.65, Math.min(width / 1050, height / 740)));
    this.camera.zoom = zoom;
    // 카메라는 지도 끝에 붙잡지 않고 늘 대원을 가운데에 둔다. 붙잡으면 지도 끝 가까이에서 대원이 화면 구석으로 밀려
    // PC의 전투 HUD나 터치 화면의 기술 버튼 밑에 그려진다.
    this.camera.x = overview ? s.map.width / 2 : this.predicted?.x ?? s.map.campX;
    this.camera.y = overview ? s.map.height / 2 : this.predicted?.y ?? s.map.campY;
    this.root.scale.set(zoom);
    this.root.position.set(width / 2 - this.camera.x * zoom, height / 2 - this.camera.y * zoom);
    this.labelsById.forEach(label => { label.visible = false; });
    const g = this.props.clear();
    g.circle(s.map.campX, s.map.campY, 78).fill({ color: colors.teal, alpha: .06 }).stroke({ color: colors.teal, width: 1, alpha: .5 });
    g.rect(s.map.campX - 20, s.map.campY - 20, 40, 40).stroke({ color: colors.teal, width: 2 });
    g.moveTo(s.map.campX - 12, s.map.campY).lineTo(s.map.campX + 12, s.map.campY).moveTo(s.map.campX, s.map.campY - 12).lineTo(s.map.campX, s.map.campY + 12).stroke({ color: colors.teal, width: 2 });
    this.label('camp', 'CAMP · 권장 투입', s.map.campX, s.map.campY + 105, colors.teal, 15);
    // 탈출 지점은 분대가 그 칸을 본 뒤에야 온다.
    const ext = s.extraction;
    if (ext) {
      g.circle(ext.x, ext.y, extractionRadius).fill({ color: colors.teal, alpha: ext.unlocked ? .12 : .025 }).stroke({ color: colors.teal, alpha: ext.unlocked ? .9 : .25, width: 2 });
      if (ext.progress > 0) arcOnNewPath(g, ext.x, ext.y, extractionRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ext.progress / ext.duration).stroke({ color: colors.lime, width: 7 });
      this.label('extract', ext.unlocked ? '↑ 탈출 · 구역 확보' : '↑ 탈출 지점', ext.x, ext.y + 102, colors.teal, 15);
    }
    for (const f of s.facilities) {
      const color = facilityColor(f);
      g.rect(f.x - 27, f.y - 27, 54, 54).fill(0x1a2325).stroke({ color, width: 3 });
      g.moveTo(f.x - 18, f.y - 18).lineTo(f.x + 18, f.y + 18).moveTo(f.x + 18, f.y - 18).lineTo(f.x - 18, f.y + 18).stroke({ color, width: 3 });
      if (f.hp > 0) g.rect(f.x - 27, f.y - 39, 54 * f.hp / f.maxHp, 4).fill(color);
      this.label(`facility-${f.id}`, f.hp > 0 ? `0${f.id} · 적 시설` : `0${f.id} · 파괴 완료`, f.x, f.y + 47, color, 14);
    }
    for (const supply of s.supplies) {
      // 그리는 상자와 색은 미니맵과 같은 규칙이다(palette.ts). 회수한 부목표 상자와 다 쓴 상자는 그리지 않는다.
      if (!supplyShown(supply)) continue;
      const color = supplyColor(supply);
      g.roundRect(supply.x - 12, supply.y - 12, 24, 24, 3).fill(0x1a2325).stroke({ color, width: 2 });
      g.moveTo(supply.x - 6, supply.y).lineTo(supply.x + 6, supply.y).moveTo(supply.x, supply.y - 6).lineTo(supply.x, supply.y + 6).stroke({ color, width: 2 });
      // 남은 횟수는 늘 보인다. 내 대기 시간은 대원마다 따로 세므로, 대기 중에도 횟수를 가리지 않고 함께 보인다.
      const name = supply.kind === 'camp' ? '캠프 보급' : '보급';
      const text = supply.objective ? '보급품 회수'
        : supply.cooldown > 0 ? `${name} · ${supply.uses}회 · ${Math.ceil(supply.cooldown)}s` : `${name} · ${supply.uses}회`;
      this.label(`supply-${supply.id}`, text, supply.x, supply.y + 30, color, 12);
    }
    const landing = me?.state === 'deploying' ? { x: me.landingX, y: me.landingY } : me?.state === 'waiting' ? this.landing : undefined;
    if (landing && s.phase !== 'ended') {
      g.circle(landing.x, landing.y, 30 + Math.sin(performance.now() / 240) * 3).stroke({ color: colors.lime, width: 2 });
      g.moveTo(landing.x - 40, landing.y).lineTo(landing.x + 40, landing.y).moveTo(landing.x, landing.y - 40).lineTo(landing.x, landing.y + 40).stroke({ color: colors.lime, alpha: .5, width: 1 });
      this.label('landing', me?.state === 'deploying' ? `${me.deploy.toFixed(1)}s` : '선택한 투입 위치', landing.x, landing.y - 55, colors.lime, 16);
    }
    const u = this.units.clear();
    const alpha = Math.min(1, since / this.interval);
    const interpolate = (p: Position, old?: Position) => old ? { x: old.x + (p.x - old.x) * alpha, y: old.y + (p.y - old.y) * alpha } : p;
    const oldEnemies = new Map(this.previous?.enemies.map(e => [e.id, e]));
    let enemies = s.enemies;
    if (enemies.length > this.renderBudget) {
      const at = this.predicted ?? { x: s.map.campX, y: s.map.campY };
      enemies = [...enemies].sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y)).slice(0, this.renderBudget);
    }
    this.shownEnemies = enemies.length;
    // 현재 공개된 적만 그린다. 시야에서 빠진 적과 기술 예고는 즉시 제거한다.
    const now = s.now + elapsed;
    // 적의 행동 방향이다. 서버는 예고하는 동안 노린 대원 쪽으로 돌고, 공격 창부터 방향을 고정한다.
    // - 나를 노린 예고는 내 예측 위치 쪽으로 그린다. 서버는 내가 보낸 입력을 받으면 그 자리 쪽으로 돈다. 보간한 방향은 내 몸보다
    //   뒤처져서, 걸어서 비켜 선 것처럼 보이지만 서버에서는 맞는다.
    //   서버가 마지막으로 도는 틱(공격 창이 열리기 한 틱 전)이 화면 시계로 지나면 더 따라 돌지 않는다. 서버는 그 틱에 본 내 자리 쪽으로
    //   방향을 굳혔으므로, 그 자리를 서버와 같은 계산(serverSpotAfter)으로 구해 그쪽으로 그린다. 진하게 칠한 범위가 서버가 친 자리와
    //   같아야 하기 때문이다. 그 자리는 화면 속 내 몸보다 왕복 지연만큼 뒤에 있다. 서버가 공격 창을 연 스냅샷이 오면 그 방향을 그린다.
    // - 공격 창이 열린 뒤에는 서버가 보낸 방향을 그대로 그린다. 진하게 칠한 범위가 판정 범위와 같아야 한다.
    // - 그 밖의 예고는 위치처럼 이전 스냅샷과 이어 그린다. 그러지 않으면 0.1초마다 뚝뚝 돈다. 차이는 -π~π로 맞춰 짧은 쪽으로 돈다.
    const facing = (action: CombatAction | null, old: CombatAction | null | undefined, at: Position) => {
      if (!action) return action;
      if (action.target === s.you && me?.state === 'alive' && s.now < action.contactAt) {
        const lastTurn = Math.round(action.contactAt * ticksPerSecond) - 1;
        if (now >= lastTurn / ticksPerSecond) {
          const spot = this.serverSpotAfter(lastTurn - Math.round(s.now * ticksPerSecond));
          return spot ? { ...action, aim: Math.atan2(toDouble(spot.y) - at.y, toDouble(spot.x) - at.x) } : action;
        }
        if (this.predicted) return { ...action, aim: Math.atan2(this.predicted.y - at.y, this.predicted.x - at.x) };
      }
      if (now >= action.contactAt || !old || old.id !== action.id) return action;
      const turn = Math.atan2(Math.sin(action.aim - old.aim), Math.cos(action.aim - old.aim));
      return { ...action, aim: old.aim + turn * alpha };
    };
    for (const enemy of enemies) {
      const old = oldEnemies.get(enemy.id);
      const p = interpolate(enemy, old);
      const r = enemy.radius;
      const action = facing(enemy.action, old?.action, p);
      if (action) this.drawAction(u, p, action, now, false, r);
      const color = bodyColor(enemy.tiers);
      if (enemy.kind === 'warden') {
        u.poly([p.x, p.y - r, p.x + r, p.y - r * .4, p.x + r * .8, p.y + r * .7,
          p.x, p.y + r, p.x - r * .8, p.y + r * .7, p.x - r, p.y - r * .4]).fill(color).stroke(unitOutline);
        u.rect(p.x - 10, p.y - 10, 20, 20).stroke({ color: 0x172222, width: 3 });
      } else if (enemy.kind === 'breaker') {
        u.poly([p.x - r, p.y - r, p.x, p.y - r * .6, p.x + r, p.y - r,
          p.x + r, p.y + r * .6, p.x, p.y + r, p.x - r, p.y + r * .6]).fill(color).stroke(unitOutline);
      } else {
        u.circle(p.x, p.y, r).fill(color).stroke(unitOutline);
      }
      const aim = action?.aim ?? Math.atan2((me?.y ?? p.y) - p.y, (me?.x ?? p.x) - p.x);
      u.circle(p.x + Math.cos(aim) * r * .7, p.y + Math.sin(aim) * r * .7, 3).fill(0x172222);
      if (enemy.maxHp > 1) {
        this.label(`enemy-type-${enemy.id}`, `${enemy.name} · 타${enemy.tiers[0]} 방${enemy.tiers[1]} 잡${enemy.tiers[2]}`, p.x, p.y + r + 17, color, 11);
        for (let i = 0; i < enemy.maxHp; i++) {
          u.rect(p.x - enemy.maxHp * 5 + i * 10, p.y - r - 10, 7, 4).fill(i < enemy.hp ? color : 0x394342);
        }
      }
      if (action && now < action.activeUntil) {
        const suffix = action.tier === 2 ? 'Ⅱ · 대응 2' : 'Ⅰ';
        this.label(`enemy-action-${enemy.id}`, `${affinityNames[action.kind]} ${suffix}`, p.x, p.y - r - 26, affinityColors[action.kind], 13);
      }
    }
    const minimapPlayers: MinimapScene['players'] = [];
    s.players.forEach((player, index) => {
      if (player.state !== 'alive') return;
      const isMe = player.id === s.you;
      const p = isMe ? this.predicted! : interpolate(player, this.previous?.players.find(old => old.id === player.id));
      const color = team[index % team.length];
      minimapPlayers.push({ x: p.x, y: p.y, color, me: isMe });
      const aim = isMe ? this.control.aim : player.aim;
      for (const action of player.actions) this.drawAction(u, p, { ...action, aim }, now, true, s.rules.playerRadius);
      // 면과 테두리, 두 손만으로 몸체와 방향을 표시한다.
      for (const sign of [-1, 1]) {
        const x = p.x + Math.cos(aim) * 16 - Math.sin(aim) * 8 * sign;
        const y = p.y + Math.sin(aim) * 16 + Math.cos(aim) * 8 * sign;
        u.circle(x, y, 5).fill(color).stroke(unitOutline);
      }
      u.circle(p.x, p.y, s.rules.playerRadius).fill(color).stroke(unitOutline);
      u.rect(p.x - 16, p.y - 24, 32, 3).fill(0x172222).rect(p.x - 16, p.y - 24, 32 * player.hp / player.maxHp, 3).fill(color);
      this.label(`player-${player.id}`, `${isMe ? '▼ ' : ''}${player.name}${player.connected ? '' : ' · 연결 끊김'}`, p.x, p.y - 42, color, 13);
    });
    for (const effect of s.effects) {
      const remain = Math.max(0, effect.until - (s.now + elapsed));
      if (!remain) continue;
      const text: Record<string, string> = { break: '완벽 대응', partial: '부분 대응', draw: '비김', guard: '방어', hit: '−1', hurt: '피격', heal: '보급 완료', deploy: '투입' };
      const color = effectColors[effect.kind] ?? colors.teal;
      u.circle(effect.x, effect.y, Math.max(3, 30 * (1 - remain / .65))).stroke({ color, alpha: Math.min(1, remain * 2), width: 2 });
      this.label(`effect-${effect.id}`, text[effect.kind] ?? '', effect.x, effect.y - 48 - (1 - remain / .65) * 15, color, 13);

    }
    this.removeUnusedLabels();
    if (this.minimap) {
      const shown = !overview && !this.menuOpen;
      this.minimap.show(shown);
      if (shown) {
        // 미니맵에도 메인 화면이 그리는 위치를 넘긴다. 적은 그리기 상한(renderBudget)과 관계없이 보이는 적을 모두 넘긴다. 점 하나라 가볍다.
        const minimapEnemies = s.enemies.map(enemy => {
          const p = interpolate(enemy, oldEnemies.get(enemy.id));
          return { x: p.x, y: p.y, color: bodyColor(enemy.tiers) };
        });
        const view = { left: this.camera.x - width / 2 / zoom, top: this.camera.y - height / 2 / zoom, right: this.camera.x + width / 2 / zoom, bottom: this.camera.y + height / 2 / zoom };
        this.minimap.draw(s, this.tiles, { players: minimapPlayers, enemies: minimapEnemies, view });
      }
    }
  }
}
