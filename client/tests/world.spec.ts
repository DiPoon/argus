import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { Container, Text } from 'pixi.js';
import type { CombatAction, Control, Position, Snapshot } from '../src/types';
import { affinityColors } from '../src/palette';

// 그린 도형의 경로를 읽는 형식이다. Pixi 내부 구조라 검사에서만 쓴다.
type Step = { action: string; data: number[] };
type Drawing = { context: { instructions: { data: { path?: { instructions: Step[] } } }[] } };
type DrawnWorld = { update(s: unknown): void; draw(dt: number): void; units: Drawing; props: Drawing };

// 실제 World와 Pixi 객체를 검사한다. 테스트용 접근점은 아래 임시 페이지에만 있다.
interface TestWorld {
  update(snapshot: Snapshot): void;
  draw(dt: number): void;
  deployCheck(position: Position, radius?: number): 'ok' | 'unseen' | 'blocked';
  control: Control;
  recordInput(seq: number, x: number, y: number, at?: number): void;
  holdLastInput(missed: number, at?: number): void;
  // 서버 위치(Raw)에 확인받지 않은 입력을 하나에 한 틱씩 적용한 예측 위치(Raw)다.
  forecast?: { previous: Position; tip: Position };
  pending: unknown[];
  mePosition(): Position | undefined;
  screenToWorld(clientX: number, clientY: number): Position;
  labelsById: Map<string, Text>;
  spareLabels: Text[];
  labels: Container;
}

declare global {
  interface Window {
    testWorld: TestWorld;
  }
}

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'world-test-page',
      configureServer(devServer) {
        devServer.middlewares.use('/__world_test', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(`<!doctype html><html><body>
            <div id="host" style="width:1000px;height:800px"></div>
            <script type="module">
              import { World } from '/src/world.ts';
              const world = new World();
              await world.init(document.getElementById('host'));
              world.app.ticker.stop();
              window.testWorld = world;
            </script>
          </body></html>`);
        });
      },
    }],
  });
  await server.listen();
  url = server.resolvedUrls!.local[0] + '__world_test';
});

test.afterAll(async () => {
  await server.close();
});

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.waitForFunction(() => window.testWorld !== undefined);
});

function snapshot(): Snapshot {
  const walls = new Uint8Array(40 * 30);
  walls[10 * 40 + 10] = 1;
  return {
    type: 'snapshot', version: 6, room: 'ROOM01', you: 'pilot', now: 10, elapsed: 5,
    phase: 'active', result: null,
    walls: Buffer.from(walls).toString('base64'), mapRevision: 0,
    extraction: { x: 1080, y: 1130, progress: 0, duration: 20, unlocked: false },
    map: { width: 1920, height: 1440, cell: 48, columns: 40, rows: 30, campX: 300, campY: 730 },
    rules: { deploy: 5, speed: 180, playerRadius: 13, guardHalfAngle: Math.PI / 3, maxAuraSeconds: 1, skills: [] },
    players: [{
      id: 'pilot', name: 'Pilot', x: 400, y: 730, rawX: 400 * 4096, rawY: 730 * 4096, slots: ['strike', 'parry', 'grab', 'strike'],
      state: 'alive', connected: true, hasDeployed: true, aim: 0, hp: 6, maxHp: 6,
      mana: 12, maxMana: 24, busy: 0, actions: [], deploy: 0, kills: 0, deaths: 0,
      ack: 0, landingX: 400, landingY: 730,
    }],
    enemies: [], facilities: [], supplies: [], effects: [], sight: [], notices: [],
  };
}

function elite(id: number): Snapshot['enemies'][number] {
  return { id, kind: 'breaker', name: '분쇄자', x: 460, y: 730, rawX: 460 * 4096, rawY: 730 * 4096, hp: 2, maxHp: 2, radius: 22,
    tiers: [2, 1, 1], action: null };
}

test('120 enemy replacements reuse labels and keep a bounded spare pool, including when changing rooms', async ({ page }) => {
  const state = snapshot();
  const result = await page.evaluate(({ state, enemy }) => {
    const world = window.testWorld;
    world.update(structuredClone(state)); world.draw(1 / 60);
    const baseline = world.labelsById.size;
    const used = new Set<Text>();
    let maximum = baseline;
    for (let i = 0; i < 120; i++) {
      state.enemies = [{ ...enemy, id: 1000 + i }];
      world.update(structuredClone(state)); world.draw(1 / 60);
      used.add(world.labelsById.get(`enemy-type-${1000 + i}`)!);
      maximum = Math.max(maximum, world.labelsById.size);
    }
    state.enemies = [];
    world.update(structuredClone(state)); world.draw(1 / 60);
    const afterRemoval = world.labelsById.size;
    state.room = 'ROOM02'; state.you = 'new-pilot'; state.players[0].id = state.you;
    world.update(structuredClone(state)); world.draw(1 / 60);
    const afterRoomChange = world.labelsById.size;
    // 한꺼번에 많은 라벨이 생겼다 사라져도 숨겨 두는 라벨은 상한까지만 남는다.
    state.effects = Array.from({ length: 200 }, (_, i) => ({ id: 5000 + i, x: 400, y: 700, kind: 'hit', until: state.now + 1 }));
    world.update(structuredClone(state)); world.draw(1 / 60);
    const burst = world.labelsById.size;
    state.effects = [];
    world.update(structuredClone(state)); world.draw(1 / 60);
    return { baseline, maximum, afterRemoval, afterRoomChange, distinct: used.size, burst,
      spares: world.spareLabels.length, children: world.labels.children.length,
      visible: world.labels.children.filter(child => child.visible).length };
  }, { state, enemy: elite(1000) });
  expect(result.maximum).toBe(result.baseline + 1);
  expect(result.afterRemoval).toBe(result.baseline);
  expect(result.afterRoomChange).toBe(result.baseline);
  // 120번 바꾸는 동안 라벨 객체를 새로 만들지 않고 숨겨 둔 것을 다시 쓴다.
  expect(result.distinct).toBeLessThanOrEqual(2);
  expect(result.burst).toBe(result.baseline + 200);
  // 숨겨 둔 라벨은 상한(64)까지만 남고 나머지는 해제된다. 화면에 보이는 것은 지금 쓰는 라벨뿐이다.
  expect(result.spares).toBe(64);
  expect(result.children).toBe(result.baseline + 64);
  expect(result.visible).toBe(result.baseline);
});

test('enemy tells refresh color and disappear immediately with lost visibility', async ({ page }) => {
  const state = snapshot();
  state.enemies = [elite(900)];
  state.enemies[0].action = { id: 901, skill: 'strike', kind: 'strike', slot: 0, tier: 2, phase: 'telegraph',
    aim: Math.PI, startedAt: 9.5, contactAt: 11, activeUntil: 11.25, endsAt: 12, range: 82, halfWidth: 24 };
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state)); world.draw(1 / 60);
    const label = world.labelsById.get('enemy-action-900')!;
    const first = { text: label.text, color: label.style.fill };
    state.enemies[0].action!.kind = 'channel';
    state.enemies[0].action!.tier = 1;
    world.update(structuredClone(state)); world.draw(1 / 60);
    const changed = { text: label.text, color: label.style.fill };
    state.enemies = [];
    world.update(structuredClone(state)); world.draw(1 / 60);
    // 라벨은 재사용을 위해 파괴하지 않고 숨겨 둔다. 사라진 적의 예고가 화면에 남지 않으면 된다.
    return { first, changed, removed: !world.labelsById.has('enemy-action-900'), hidden: !label.visible };
  }, state);
  expect(result.first).toEqual({ text: '타격 Ⅱ · 대응 2', color: 0xff6b61 });
  expect(result.changed).toEqual({ text: '잡기 Ⅰ', color: 0xa6f9ba });
  expect(result.removed).toBe(true); expect(result.hidden).toBe(true);
});

test('an elite body takes the color of the kind of its tier 2 action', async ({ page }) => {
  const state = snapshot();
  state.enemies = [elite(900), { ...elite(901), tiers: [1, 2, 1] }, { ...elite(902), tiers: [1, 1, 2] }];
  const colorsOf = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(state); world.draw(1 / 60);
    return [900, 901, 902].map(id => world.labelsById.get(`enemy-type-${id}`)!.style.fill);
  }, state);
  // 예고 라벨이 쓰는 상성 색과 같아야 한다. 이 색을 바꾸면 몸 색도 함께 바뀐다. 분쇄자 빨강, 철위병 파랑이다.
  expect(colorsOf).toEqual([0xff6b61, 0x4785ff, 0xa6f9ba]);
});

test('a guard effect wears the block color and the effects without an affinity keep away from the affinity colors', async ({ page }) => {
  const state = snapshot();
  const kinds = ['guard', 'hurt', 'draw', 'break', 'partial', 'hit', 'heal', 'deploy'];
  state.effects = kinds.map((kind, index) => ({ id: 7000 + index, x: 400 + index * 10, y: 700, kind, until: state.now + .5 }));
  const colors = await page.evaluate(({ state, kinds }) => {
    const world = window.testWorld;
    world.update(state); world.draw(1 / 60);
    return Object.fromEntries(kinds.map((kind, index) => [kind, world.labelsById.get(`effect-${7000 + index}`)!.style.fill]));
  }, { state, kinds });
  // 방어 성공은 방어 상성 색이다. 피격·비김은 상성 색과 겹치지 않는 분홍이다(2026-11-08 사용자 결정).
  // 예전 피격·비김 색(연어 빨강)은 새 타격 빨강과 거의 같아, 적 옆에 뜬 피격이 타격 예고로 읽혔다.
  expect(colors.guard).toBe(0x4785ff);
  expect(colors.hurt).toBe(0xff8fd6);
  expect(colors.draw).toBe(0xff8fd6);
  const affinity = [0xff6b61, 0x4785ff, 0xa6f9ba];
  for (const kind of kinds.filter(kind => kind !== 'guard')) expect(affinity, kind).not.toContain(colors[kind]);
});

test('the canvas and the page draw each affinity in the same color', () => {
  // 캔버스가 쓰는 상성 색(palette.ts의 affinityColors)은 CSS 변수를 읽지 못해 같은 값을 따로 둔다. 한쪽만 바꾸면 기술 버튼과
  // 예고 범위의 색이 달라진다. palette.ts는 pixi를 불러오지 않으므로 값을 그대로 가져온다. CSS는 공백과 대소문자가 달라도 같은 색으로 읽는다.
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  for (const kind of ['strike', 'block', 'channel'] as const) {
    const page = css.match(new RegExp(`--${kind}\\s*:\\s*#([0-9a-f]{6})`, 'i'));
    expect(page, `style.css의 --${kind}`).not.toBeNull();
    expect(affinityColors[kind].toString(16).padStart(6, '0'), kind).toBe(page![1].toLowerCase());
  }
});

test('enemy telegraphs turn smoothly, point at me when I am the target and stop turning once the attack window opens', async ({ page }) => {
  // 적은 예고하는 동안 노린 대원 쪽으로 돌고 공격 창부터 방향을 고정한다. 적의 눈(반지름 3의 점)이 적 가운데에서 어느 쪽에
  // 있는지로 그린 방향을 잰다. 화면 시계(performance.now)를 고정해, 브라우저가 잠깐 멈춰도 결과가 같게 한다.
  const action = (id: number, aim: number, extra: Partial<CombatAction> = {}): CombatAction => ({ id, skill: 'strike', kind: 'strike',
    slot: 0, tier: 1, phase: 'telegraph', aim, startedAt: 9.5, contactAt: 11, activeUntil: 11.25, endsAt: 12,
    range: 82, halfWidth: 24, ...extra });
  const scene = (now: number, telegraph: CombatAction): Snapshot => ({ ...snapshot(), now, enemies: [{ ...elite(920), action: telegraph }] });
  // [먼저 받은 스냅샷, 나중에 받은 스냅샷, 두 스냅샷 사이(ms), 나중 것을 받고 그리기까지(ms)]
  const cases: [Snapshot, Snapshot, number, number][] = [
    // 같은 행동이면 위치처럼 이어 그린다. 받은 직후에는 이전 방향에 있고, 간격의 절반이 지나면 절반쯤 돈다.
    [scene(10.1, action(921, 0)), scene(10.2, action(921, Math.PI / 2)), 100, 0],
    [scene(10.1, action(921, 0)), scene(10.2, action(921, Math.PI / 2)), 100, 50],
    // 새 행동이면 이어 그리지 않는다.
    [scene(10.1, action(921, 0)), scene(10.2, action(922, Math.PI / 2)), 100, 0],
    // 3에서 -3으로 돌면 0을 지나는 먼 쪽이 아니라 π를 지나는 짧은 쪽으로 돈다.
    [scene(10.1, action(921, 3)), scene(10.2, action(921, -3)), 100, 50],
    // 공격 창이 열린 뒤에는 서버가 고정한 방향을 그대로 그린다. 진하게 칠한 범위가 판정 범위와 같아야 한다.
    [scene(10.9, action(921, 0)), scene(11.05, action(921, Math.PI / 2, { phase: 'active' })), 100, 50],
    // 나를 노린 예고는 내 예측 위치(400, 730) 쪽으로 그린다. 서버가 보낸 방향(π/2)은 내 몸보다 뒤처져 있다.
    [scene(10.1, action(921, Math.PI / 2, { target: 'pilot' })), scene(10.2, action(921, Math.PI / 2, { target: 'pilot' })), 100, 0],
    // 스냅샷이 0.25초 간격으로 와도 보간이 끝까지 간다. 0.24초 뒤에는 거의 다 돌았다.
    [scene(10.1, action(921, 0)), scene(10.35, action(921, 1)), 250, 240],
    // 나를 노린 공격이다. 마지막 스냅샷은 공격 두 틱 전(10.9초, 327틱)이고, 서버가 마지막으로 도는 틱은 329틱(10.967초)이다.
    // 화면 시계(10.98초)가 그 틱은 지났지만 공격 시각(11초) 전이다. 그 틱에 서버가 본 내 자리는 마지막 스냅샷의 내 자리(400, 730)에서
    // 아래로 걷는 확인받지 않은 입력 넷 가운데 앞의 둘만 쓴 (400, 742)다. 화면은 그쪽으로 굳힌다.
    // 내 몸(입력 넷을 다 쓴 754 쪽)이나 마지막 서버 방향(π), 한 틱 더(748)·덜(736) 걸은 자리 쪽이 아니다.
    [scene(10.8, action(921, Math.PI, { target: 'pilot' })), scene(10.9, action(921, Math.PI, { target: 'pilot' })), 100, 80],
  ];
  // 마지막 장면만 스냅샷을 받은 뒤 확인받지 않은 내 입력(아래로 걷기) 넷을 보낸다.
  const downInputs = cases.length - 1;
  const drawn = await page.evaluate(([cases, downInputs]) => {
    const world = window.testWorld as unknown as DrawnWorld & { recordInput(seq: number, x: number, y: number, at?: number): void };
    let clock = 0;
    performance.now = () => clock;
    return cases.map(([first, second, gap, wait], index) => {
      clock += 1000;
      world.update(first);
      clock += gap;
      world.update(second);
      if (index === downInputs) {
        for (let seq = 1; seq <= 4; seq++) world.recordInput(seq, 0, 1, clock);
      }
      clock += wait;
      world.draw(1 / 60);
      const eye = world.units.context.instructions.flatMap(i => i.data.path?.instructions ?? [])
        .find(step => step.action === 'circle' && step.data[2] === 3)!;
      return Math.atan2(eye.data[1] - 730, eye.data[0] - 460);
    });
  }, [cases, downInputs] as const);
  expect(drawn[0]).toBeCloseTo(0, 2);
  expect(drawn[1]).toBeCloseTo(Math.PI / 4, 2);
  expect(drawn[2]).toBeCloseTo(Math.PI / 2, 2);
  expect(Math.abs(drawn[3])).toBeGreaterThan(3.1);
  expect(drawn[4]).toBeCloseTo(Math.PI / 2, 2);
  expect(Math.abs(drawn[5])).toBeCloseTo(Math.PI, 2);
  expect(drawn[6]).toBeGreaterThan(0.95);
  expect(drawn[7]).toBeCloseTo(Math.atan2(12, -60), 2);
});

// 받아치기의 기술 정의다. 방어의 기운 0.55초 뒤 상성 없는 반격 장판이 0.18초 나간다.
const parrySkill = { id: 'parry' as const, kind: 'block' as const, mana: 1, auraSeconds: .55, zoneSeconds: .18, duration: .98,
  range: 54, halfWidth: 10, plainZone: true, singleTarget: false, breaksStructures: true, around: false };

test('gauges and aura arcs start their own path instead of a line from an earlier point', async ({ page }) => {
  const state = snapshot();
  // 적의 예고 게이지, 대원의 기운이 향한 쪽(앞 120°의 호)과 기운이 남은 시간, 탈출 진행도는 모두 원호로 그린다.
  state.enemies = [elite(910)];
  state.enemies[0].action = { id: 911, skill: 'block', kind: 'block', slot: 0, tier: 1, phase: 'telegraph',
    aim: Math.PI, startedAt: 9.5, contactAt: 11, activeUntil: 11.25, endsAt: 12, range: 62, halfWidth: 15 };
  state.rules.skills = [parrySkill];
  state.players[0].actions = [{ id: 912, skill: 'parry', kind: 'block', slot: 2, tier: 1, phase: 'aura', aim: 0,
    startedAt: 9.8, contactAt: 10.35, activeUntil: 10.53, endsAt: 10.78, range: 54, halfWidth: 10 }];
  state.extraction = { ...state.extraction!, progress: 6, unlocked: true };
  const arcs = await page.evaluate(state => {
    const world = window.testWorld as unknown as DrawnWorld;
    world.update(structuredClone(state)); world.draw(1 / 60);
    const found: { x: number; y: number; radius: number; stray: string | null }[] = [];
    for (const drawing of [world.units, world.props]) {
      for (const instruction of drawing.context.instructions) {
        const steps = instruction.data.path?.instructions ?? [];
        steps.forEach((step, index) => {
          if (step.action !== 'arc') return;
          const [x, y, radius, start] = step.data;
          // 원호 앞에 다른 점이 있으면 그 점에서 원호 시작점까지 직선이 그어진다.
          let stray: string | null = null;
          const sx = x + radius * Math.cos(start), sy = y + radius * Math.sin(start);
          const previous = steps[index - 1];
          if (previous && (previous.action !== 'moveTo' || Math.hypot(previous.data[0] - sx, previous.data[1] - sy) > 1)) {
            stray = `${previous.action} ${previous.data.slice(0, 2).join(',')} → ${sx.toFixed(0)},${sy.toFixed(0)}`;
          }
          found.push({ x, y, radius, stray });
        });
      }
    }
    return found;
  }, state);
  // 기대하는 원호를 반지름과 중심으로 하나씩 찾는다. 찾지 못하면 Pixi의 내부 구조가 바뀌어
  // 이 검사가 아무것도 보지 못하는 것이므로, 조용히 통과하지 않고 실패한다.
  const expected = [
    { name: '적 예고 게이지', x: 460, y: 730, radius: 32 },
    { name: '받아치기의 기운이 향한 쪽', x: 400, y: 730, radius: 28 },
    { name: '기운이 남은 시간', x: 400, y: 730, radius: 34 },
    { name: '탈출 진행도', x: 1080, y: 1130, radius: 80 },
  ];
  for (const arc of expected) {
    const matches = arcs.filter(found => found.radius === arc.radius && Math.hypot(found.x - arc.x, found.y - arc.y) < 1);
    expect(matches.length, arc.name).toBeGreaterThan(0);
  }
  expect(arcs.flatMap(found => found.stray === null ? [] : [found.stray])).toEqual([]);
});

test('a parry counter zone is drawn from the contactAt to the activeUntil the server sent, not from times added up on its own', async ({ page }) => {
  // 서버는 기운과 장판을 합친 초를 시작부터 한 번에 틱으로 올려 장판이 걷히는 틱을 정한다.
  // 300틱(10초)에 시작한 받아치기는 317틱(10.57)에 반격 장판이 나가고 322틱(10.73)에 걷힌다.
  // contactAt에 장판 시간 0.18초를 더하면 10.75라 반격이 서버보다 오래 보인다.
  const state = snapshot();
  state.rules.skills = [parrySkill];
  state.players[0].actions = [{ id: 920, skill: 'parry', kind: 'block', slot: 2, tier: 1, phase: 'aura', aim: 0,
    startedAt: 10, contactAt: 10.57, activeUntil: 10.73, endsAt: 11, range: 54, halfWidth: 10 }];
  const fills = await page.evaluate(state => {
    type Drawing = { context: { instructions: { action: string; data: { style?: { color?: number } } }[] } };
    const world = window.testWorld as unknown as { update(s: unknown): void; draw(dt: number): void; units: Drawing };
    // 반격 색(상성 없음)으로 채운 도형을 센다. 이 장면에서 그 색을 쓰는 것은 반격 장판뿐이다.
    const counterFills = (now: number) => {
      world.update(structuredClone({ ...state, now })); world.draw(1 / 60);
      return world.units.context.instructions.filter(i => i.action === 'fill' && i.data.style?.color === 0xeabd73).length;
    };
    return { aura: counterFills(10.5), zone: counterFills(10.65), after: counterFills(10.735) };
  }, state);
  // 기운이 도는 동안에는 반격을 미리 그리지 않으므로, 반격 색이 다른 그림에 섞이지 않았는지도 함께 확인한다.
  // 스냅샷의 단계가 아직 aura여도 화면 시계가 contactAt을 지나면 반격을 그린다. 화면은 스냅샷 사이에서 시각으로 단계를 정한다.
  expect(fills.aura).toBe(0);
  expect(fills.zone).toBeGreaterThan(0);
  expect(fills.after).toBe(0);
});

test('an aura glows on the body while it lasts and gives way to the zone, for players and enemies', async ({ page }) => {
  // 기운은 몸 둘레의 옅은 빛(몸 반지름 + 8의 원을 상성 색으로 채움)이다. 대원은 그 바깥에 기운이 향한 쪽(반지름 28의 호나 고리)과
  // 기운이 남은 시간(반지름 34의 호)을 그린다. 장판이 나가면 기운은 사라지고 장판만 진하게 그린다(docs/combat.md "기운과 장판").
  const state = snapshot();
  const strike = { id: 'strike' as const, kind: 'strike' as const, mana: 1, auraSeconds: .18, zoneSeconds: .24, duration: .66,
    range: 54, halfWidth: 10, plainZone: false, singleTarget: false, breaksStructures: true, around: false };
  state.rules.skills = [strike, parrySkill];
  // 대원은 (400, 730), 분쇄자(반지름 22)는 (460, 730)에 있다. 둘 다 10.2초에 장판이 나간다.
  state.enemies = [elite(940)];
  state.enemies[0].action = { id: 941, skill: 'channel', kind: 'channel', slot: 0, tier: 1, phase: 'telegraph',
    aim: Math.PI, startedAt: 9.4, contactAt: 10.2, activeUntil: 10.45, endsAt: 11.1, range: 68, halfWidth: 18 };
  state.players[0].actions = [{ id: 942, skill: 'strike', kind: 'strike', slot: 1, tier: 1, phase: 'aura', aim: 0,
    startedAt: 10, contactAt: 10.2, activeUntil: 10.43, endsAt: 10.67, range: 54, halfWidth: 10 }];
  const drawn = await page.evaluate(state => {
    type Style = { color?: number; alpha?: number };
    type Painted = { action: string; data: { style?: Style; path?: { instructions: { action: string; data: number[] }[] } } };
    const world = window.testWorld as unknown as { update(s: unknown): void; draw(dt: number): void; units: { context: { instructions: Painted[] } } };
    const scene = (now: number, parry = false) => {
      const copy = structuredClone({ ...state, now });
      if (parry) Object.assign(copy.players[0].actions[0], { skill: 'parry', kind: 'block', slot: 2, contactAt: 10.57, activeUntil: 10.73, endsAt: 11 });
      world.update(copy); world.draw(1 / 60);
      const painted = world.units.context.instructions;
      // 채운 원을 [x, y, 반지름, 색, 투명도]로, 원호를 [x, y, 반지름]으로 모은다.
      const glows = painted.filter(i => i.action === 'fill').flatMap(i => (i.data.path?.instructions ?? [])
        .filter(step => step.action === 'circle').map(step => [...step.data.slice(0, 3), i.data.style?.color ?? -1, i.data.style?.alpha ?? 1]));
      const arcs = painted.flatMap(i => i.data.path?.instructions ?? []).filter(step => step.action === 'arc').map(step => step.data.slice(0, 3));
      // 장판은 반투명하게 채운 다각형이다. 분쇄자의 몸도 다각형이지만 불투명하다.
      const zones = painted.filter(i => i.action === 'fill' && (i.data.path?.instructions ?? []).some(step => step.action === 'poly'))
        .map(i => [i.data.style?.color ?? -1, i.data.style?.alpha ?? 1]).filter(zone => zone[1] < 1);
      return { glows, arcs, zones };
    };
    return { aura: scene(10.1), zone: scene(10.3), parry: scene(10.1, true) };
  }, state);
  const glowAt = (shapes: number[][], x: number, radius: number) => shapes.filter(shape => Math.hypot(shape[0] - x, shape[1] - 730) < 1 && shape[2] === radius);
  const arcAt = (shapes: number[][], x: number, radius: number) => shapes.filter(shape => Math.hypot(shape[0] - x, shape[1] - 730) < 1 && shape[2] === radius).length;
  // 기운이 도는 동안: 대원 몸 둘레(13 + 8)에 타격 색 빛, 분쇄자 몸 둘레(22 + 8)에 잡기 색 빛이 있다.
  expect(glowAt(drawn.aura.glows, 400, 21).map(shape => shape[3])).toEqual([affinityColors.strike]);
  expect(glowAt(drawn.aura.glows, 460, 30).map(shape => shape[3])).toEqual([affinityColors.channel]);
  expect(glowAt(drawn.aura.glows, 400, 21)[0][4]).toBeLessThan(.5);
  // 대원의 기운이 향한 쪽(앞 120°의 호)과 남은 시간, 적의 예고 게이지가 있다.
  expect(arcAt(drawn.aura.arcs, 400, 28)).toBe(1);
  expect(arcAt(drawn.aura.arcs, 400, 34)).toBe(1);
  expect(arcAt(drawn.aura.arcs, 460, 32)).toBe(1);
  // 장판이 깔릴 자리는 옅게 그린다(대원의 타격 장판과 적의 잡기 장판).
  expect(drawn.aura.zones.map(zone => zone[1])).toEqual([.08, .08]);
  // 장판이 나간 뒤: 빛과 호는 사라지고 장판만 진하게 그린다. 색은 그대로 상성 색이다.
  expect(glowAt(drawn.zone.glows, 400, 21)).toEqual([]);
  expect(glowAt(drawn.zone.glows, 460, 30)).toEqual([]);
  expect(arcAt(drawn.zone.arcs, 400, 28) + arcAt(drawn.zone.arcs, 400, 34) + arcAt(drawn.zone.arcs, 460, 32)).toBe(0);
  expect(drawn.zone.zones.map(zone => zone[1])).toEqual([.28, .28]);
  expect(drawn.zone.zones.map(zone => zone[0]).sort()).toEqual([affinityColors.channel, affinityColors.strike].sort());
  // 받아치기의 기운은 방어 색이다. 반격 장판에는 상성이 없으므로 깔릴 자리를 미리 그리지 않는다(적의 잡기 장판 자리만 있다).
  expect(glowAt(drawn.parry.glows, 400, 21).map(shape => shape[3])).toEqual([affinityColors.block]);
  expect(drawn.parry.zones).toEqual([[affinityColors.channel, .08]]);
});

test('skills around the player draw a circle of their reach, and their aura draws a full ring', async ({ page }) => {
  const state = snapshot();
  const around = { mana: 1, auraSeconds: .18, zoneSeconds: .24, duration: .66, range: 48, halfWidth: 0,
    plainZone: false, singleTarget: false, breaksStructures: true, around: true };
  // 회전 베기와 회전 방어는 상성 종류만 다르다. ring은 이 검사에만 있는, 장판 없이 기운만 있는 둘레 방어다.
  // 지금 그런 기술은 없지만 속성의 뜻대로 그리는지 본다.
  state.rules.skills = [
    { id: 'spin', kind: 'strike', ...around },
    { id: 'spinblock', kind: 'block', ...around },
    { id: 'ring' as 'spin', kind: 'block', ...around, auraSeconds: .55, zoneSeconds: 0, range: 0, breaksStructures: false },
  ];
  const shapes = await page.evaluate(state => {
    const world = window.testWorld as unknown as DrawnWorld;
    // 대원이 그 기술을 쓰는 중인 장면을 그리고, 그린 원과 원호를 [x, y, 반지름]으로 모은다. now(10초)는 contactAt이 9.98이면 장판 중,
    // 10.35이면 기운 중이다.
    const drawn = (skill: string, contactAt: number) => {
      const definition = state.rules.skills.find(d => d.id === skill)!;
      const scene = structuredClone(state);
      scene.players[0].actions = [{ id: 930, skill, kind: definition.kind, slot: 1, tier: 1, phase: contactAt > state.now ? 'aura' : 'zone', aim: 0,
        startedAt: 9.8, contactAt, activeUntil: contactAt + definition.zoneSeconds, endsAt: 10.46,
        range: definition.range, halfWidth: 0 }];
      world.update(scene); world.draw(1 / 60);
      const steps = [world.units, world.props].flatMap(drawing => drawing.context.instructions.flatMap(i => i.data.path?.instructions ?? []));
      const pick = (action: string) => steps.filter(step => step.action === action).map(step => step.data.slice(0, 3));
      return { circles: pick('circle'), arcs: pick('arc') };
    };
    return { spin: drawn('spin', 9.98), spinblock: drawn('spinblock', 9.98), spinAura: drawn('spin', 10.35), ring: drawn('ring', 10.35) };
  }, state);
  // 대원(400, 730)을 중심으로 그 반지름의 도형이 몇 개인지 센다. 채우기와 테두리가 같은 경로를 쓰면 두 번 셀 수 있다.
  const at = (shapes: number[][], radius: number) => shapes.filter(([x, y, r]) => r === radius && Math.hypot(x - 400, y - 730) < 1).length;
  // 둘레 기술의 장판은 조준 방향의 사각형이 아니라 대원 둘레 반지름 48의 원이다. 상성 종류와 관계없다. 장판이 나가면 기운의 고리는 없다.
  expect(at(shapes.spin.circles, 48)).toBeGreaterThan(0);
  expect(at(shapes.spinblock.circles, 48)).toBeGreaterThan(0);
  expect(at(shapes.spin.circles, 28)).toBe(0);
  // 둘레 기술의 기운은 모든 방향으로 돌므로 반지름 28의 고리다. 앞만 향하는 기술의 호(같은 반지름의 원호)는 그리지 않는다.
  // 기운이 도는 동안에는 장판이 깔릴 자리(반지름 48의 원)도 옅게 보인다.
  expect(at(shapes.spinAura.circles, 28)).toBeGreaterThan(0);
  expect(at(shapes.spinAura.arcs, 28)).toBe(0);
  expect(at(shapes.spinAura.circles, 48)).toBeGreaterThan(0);
  // 장판이 없는 둘레 방어는 고리만 그린다. 깔릴 장판이 없으므로 반지름 0의 원도 그리지 않는다.
  expect(at(shapes.ring.circles, 28)).toBeGreaterThan(0);
  expect(at(shapes.ring.arcs, 28)).toBe(0);
  expect(at(shapes.ring.circles, 0)).toBe(0);
});

test('a held aura stays an aura past its contactAt, and its time arc is the same whether or not the server still counts the button as held', async ({ page }) => {
  // 스냅샷의 시각은 서버가 지금 정해 둔 틱 그대로다(PR #28 리뷰 9번). 버튼을 누르고 있어 기운이 이어지는 중(held)이면 contactAt은
  // 지금 놓았을 때 장판이 나가는 시각이라 스냅샷 사이에 지나간다. 그때도 장판은 나가지 않으므로, 화면은 held인 기운을
  // 늦어도 장판이 나가는 시각(holdUntil)까지 기운으로 그린다. held가 아니면 contactAt부터 장판이다.
  const state = snapshot();
  const strike = { id: 'strike' as const, kind: 'strike' as const, mana: 1, auraSeconds: .18, zoneSeconds: .24, duration: .66,
    range: 54, halfWidth: 10, plainZone: false, singleTarget: false, breaksStructures: true, around: false };
  state.rules.skills = [strike, parrySkill];
  // 10초에 시작한 타격이다. 스냅샷(10.4초)은 장판이 나갈 틱을 다음 틱(10.43)으로, 늦어도 나가는 시각을 11초로 알린다.
  const drawn = await page.evaluate(([state]) => {
    type Style = { color?: number; alpha?: number };
    type Step = { action: string; data: number[] };
    type Painted = { action: string; data: { style?: Style; path?: { instructions: Step[] } } };
    const world = window.testWorld as unknown as { update(s: unknown): void; draw(dt: number): void; received: number; units: { context: { instructions: Painted[] } } };
    // later초 뒤의 화면이다. 스냅샷을 받은 시각을 그만큼 앞당겨, 다음 스냅샷이 오기 전에 화면 시계만 흐른 장면을 만든다.
    // 그리는 동안에는 시계를 멈춘다. 받은 시각을 적고 그리기까지 흐른 실제 시간(1ms 안팎)이 화면 시계에 섞이면,
    // 같은 장면의 호가 그릴 때마다 조금씩 달라져 두 장면의 호를 비교할 수 없다.
    const realNow = performance.now.bind(performance);
    const scene = (action: object, later: number) => {
      const copy = structuredClone({ ...state, now: 10.4 });
      copy.players[0].actions = [{ id: 950, skill: 'strike', kind: 'strike', slot: 1, tier: 1, phase: 'aura', aim: 0,
        startedAt: 10, contactAt: 10.43, activeUntil: 10.67, endsAt: 10.9, range: 54, halfWidth: 10, ...action }];
      const frozen = realNow();
      performance.now = () => frozen;
      try {
        world.update(copy);
        world.received = frozen - later * 1000;
        world.draw(1 / 60);
      } finally { performance.now = realNow; }
      const painted = world.units.context.instructions;
      const steps = painted.flatMap(i => i.data.path?.instructions ?? []);
      // 기운의 빛(몸 13 + 8의 원), 남은 시간 호(반지름 34)의 끝 각도, 눈금(호를 가로지르는 짧은 선의 두 끝)을 모은다.
      const glow = steps.filter(step => step.action === 'circle' && step.data[2] === 21).length;
      const arcs = steps.filter(step => step.action === 'arc' && step.data[2] === 34).map(step => step.data[4]);
      const notches: number[][] = [];
      steps.forEach((step, index) => {
        const next = steps[index + 1];
        if (step.action !== 'moveTo' || next?.action !== 'lineTo') return;
        const from = Math.hypot(step.data[0] - 400, step.data[1] - 730), to = Math.hypot(next.data[0] - 400, next.data[1] - 730);
        if (Math.abs(from - 31) < .01 && Math.abs(to - 37) < .01) notches.push([Math.atan2(step.data[1] - 730, step.data[0] - 400)]);
      });
      const zones = painted.filter(i => i.action === 'fill' && (i.data.path?.instructions ?? []).some(step => step.action === 'poly'))
        .map(i => i.data.style?.alpha ?? 1).filter(alpha => alpha < 1);
      return { glow, arcs, notches, zones };
    };
    return {
      // 누르고 있는 기운: 화면 시계가 contactAt(10.43)을 지난 10.5초에도 기운이다.
      heldPast: scene({ held: true, holdUntil: 11 }, .1),
      // 놓은 기술: 같은 시각에 장판이 나가 있다.
      releasedPast: scene({ held: false, holdUntil: 11 }, .1),
      // 짧게 누른 기술의 두 스냅샷이다. 뗀 입력이 서버에 닿기 전(held)과 닿은 뒤(held 아님)의 장판 시각은 같다(10.2초).
      tapBefore: scene({ startedAt: 10.3, contactAt: 10.5, activeUntil: 10.73, endsAt: 10.97, held: true, holdUntil: 11.3 }, 0),
      tapAfter: scene({ startedAt: 10.3, contactAt: 10.5, activeUntil: 10.73, endsAt: 10.97, held: false, holdUntil: 11.3 }, 0),
      // 받아치기는 가장 짧은 기운 시간이 0.55초(17틱, 0.57초)라 눈금이 다른 자리에 있다.
      parry: scene({ skill: 'parry', kind: 'block', startedAt: 10.3, contactAt: 10.87, activeUntil: 11.03, endsAt: 11.3, held: false, holdUntil: 11.3 }, 0),
      // 늦어도 나가는 시각이 없는 스냅샷(적의 행동처럼)에는 눈금이 없다.
      bare: scene({ startedAt: 10.3, contactAt: 10.5, activeUntil: 10.73, endsAt: 10.97 }, 0),
    };
  }, [state] as const);
  // 누르고 있는 기운은 contactAt이 지나도 빛과 남은 시간 호가 있고, 장판은 깔릴 자리(옅음)만 있다.
  expect(drawn.heldPast.glow).toBeGreaterThan(0);
  expect(drawn.heldPast.arcs).toHaveLength(1);
  expect(drawn.heldPast.zones).toEqual([.08]);
  // 놓은 기술은 같은 시각에 빛과 호가 없고 장판이 진하다.
  expect(drawn.releasedPast.glow).toBe(0);
  expect(drawn.releasedPast.arcs).toHaveLength(0);
  expect(drawn.releasedPast.zones).toEqual([.28]);
  // 남은 시간 호는 늦어도 나가는 시각까지를 한 바퀴로 그린다. 10.5초면 11초까지 절반이 남았다(시작 10초, 끝 11초).
  expect(drawn.heldPast.arcs[0]).toBeCloseTo(-Math.PI / 2 + Math.PI * 2 * .5, 1);
  // 호의 길이는 held에 기대지 않는다. 짧게 누른 기술의 두 스냅샷에서 호가 같아, 뗀 입력이 닿는 순간 호가 튀지 않는다.
  // 10.4초에 남은 시간은 시작(10.3)부터 늦어도 나가는 시각(11.3)까지의 90%다.
  expect(drawn.tapBefore.arcs).toHaveLength(1);
  expect(drawn.tapAfter.arcs[0]).toBeCloseTo(drawn.tapBefore.arcs[0], 6);
  expect(drawn.tapBefore.arcs[0]).toBeCloseTo(-Math.PI / 2 + Math.PI * 2 * .9, 2);
  // 눈금은 가장 짧은 기운 시간이 끝나는 자리다. 타격은 6틱(0.2초)이라 한 바퀴의 80%가 남는 자리, 받아치기는 17틱이라 약 43%가 남는 자리다.
  const mark = (left: number) => Math.atan2(Math.sin(-Math.PI / 2 + Math.PI * 2 * left), Math.cos(-Math.PI / 2 + Math.PI * 2 * left));
  expect(drawn.tapBefore.notches).toHaveLength(1);
  expect(drawn.tapBefore.notches[0][0]).toBeCloseTo(mark(.8), 3);
  expect(drawn.tapAfter.notches[0][0]).toBeCloseTo(mark(.8), 3);
  expect(drawn.parry.notches).toHaveLength(1);
  expect(drawn.parry.notches[0][0]).toBeCloseTo(mark(1 - 17 / 30), 3);
  expect(drawn.bare.notches).toHaveLength(0);
  expect(drawn.bare.arcs).toHaveLength(1);
});

test('the camera keeps the player in the middle at the edge of the map', async ({ page }) => {
  const state = snapshot();
  // 맵(가로 1920, 세로 1440)의 오른쪽 아래 구석 가까이에 선 대원이다.
  Object.assign(state.players[0], { x: 1890, y: 1410, rawX: 1890 * 4096, rawY: 1410 * 4096, landingX: 1890, landingY: 1410 });
  const middle = await page.evaluate(state => {
    const world = window.testWorld;
    const host = document.getElementById('host')!.getBoundingClientRect();
    world.update(state); world.draw(1 / 60);
    return world.screenToWorld(host.left + host.width / 2, host.top + host.height / 2);
  }, state);
  // 지도 끝에 붙잡으면 대원이 화면 구석으로 밀려 PC의 전투 HUD나 터치 화면의 기술 버튼 밑에 그려진다.
  expect(middle.x).toBeCloseTo(1890, 0);
  expect(middle.y).toBeCloseTo(1410, 0);
});

test('prediction blocks enemy bodies while allowing teammate overlap', async ({ page }) => {
  const state = snapshot();
  state.enemies = [elite(900)];
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    // 오른쪽 입력 20개(한 틱에 6씩, 120)를 보냈고 서버는 아직 하나도 처리하지 않았다.
    world.update(structuredClone(state));
    for (let seq = 1; seq <= 20; seq++) world.recordInput(seq, 1, 0);
    const blocked = world.forecast!.tip;
    state.enemies = [];
    state.players.push({ ...state.players[0], id: 'ally', x: 430, rawX: 430 * 4096 });
    world.update(structuredClone(state));
    const through = world.forecast!.tip;
    return { blocked, through };
  }, state);
  // 반지름 22인 분쇄자(x = 460)와 대원(반지름 13)은 35보다 가까워질 수 없다. 3씩 걸어 424에서 멈춘다.
  expect(result.blocked.x).toBe(424 * 4096);
  // 동료는 통과하므로 입력 20개를 모두 간다.
  expect(result.through.x).toBe(520 * 4096);
});

test('reconciliation replays unacknowledged input on top of the server position', async ({ page }) => {
  const state = snapshot();
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    // 오른쪽 입력 6개를 보냈고 서버는 아직 하나도 처리하지 않았다.
    for (let seq = 1; seq <= 6; seq++) world.recordInput(seq, 1, 0);
    const ahead = world.forecast!.tip;
    // 서버가 입력 4까지 처리했다는 스냅샷이 오면 그 이하는 버리고 새 서버 위치에서 다시 계산한다.
    state.players[0] = { ...state.players[0], x: 424, rawX: 424 * 4096, ack: 4 };
    world.update(structuredClone(state));
    const left = world.pending.length;
    const after = world.forecast!.tip;
    return { ahead, left, after };
  }, state);
  // 입력 하나가 한 틱(180 / 30 = 6단위)이라 확인받지 않은 입력 6개만큼(36단위) 서버 위치 400보다 앞이다.
  expect(result.ahead.x).toBe(436 * 4096);
  expect(result.left).toBe(2);
  // 서버가 예측과 같은 곳에 있으면 확인이 와도 예측 위치가 Raw까지 그대로다.
  expect(result.after.x).toBe(436 * 4096);
});

test('ticks missed by a late timer keep the last input going, but only as long as the server does', async ({ page }) => {
  const state = snapshot();
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    world.recordInput(1, 1, 0);
    // 타이머가 늦어 세 틱 동안 입력을 보내지 못했다. 서버는 그동안 마지막 입력을 계속 쓴다.
    world.holdLastInput(3);
    const held = world.forecast!.tip.x;
    // 아주 오래 늦어도 서버는 받은 틱부터 10틱만 쓰고 멈춘다.
    world.holdLastInput(100);
    return { held, capped: world.forecast!.tip.x };
  }, state);
  expect(result.held).toBe((400 + 4 * 6) * 4096);
  expect(result.capped).toBe((400 + 10 * 6) * 4096);
});

test('prediction pauses after dropping an unconfirmed input until the server confirms it', async ({ page }) => {
  const state = snapshot();
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    // 확인이 오지 않은 채 61개를 보내 가장 오래된 입력(1)을 버렸다. 서버가 그 입력을 이미 썼는지 모르므로 예측을 끈다.
    for (let seq = 1; seq <= 61; seq++) world.recordInput(seq, 1, 0);
    const paused = world.forecast === undefined;
    // 서버가 입력 1까지 처리했다고 알려 오면 그 위치에서 남은 입력으로 다시 예측한다.
    state.players[0] = { ...state.players[0], x: 406, rawX: 406 * 4096, ack: 1 };
    world.update(structuredClone(state));
    return { paused, resumed: world.forecast?.tip.x, left: world.pending.length };
  }, state);
  expect(result.paused).toBe(true);
  expect(result.left).toBe(60);
  expect(result.resumed).toBe((406 + 60 * 6) * 4096);
});

test('a new input sent before the last tick finished does not make the drawn position jump', async ({ page }) => {
  const state = snapshot();
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    world.draw(1 / 60);
    const now = performance.now();
    // 입력 1을 보낸 지 반 틱만 지났을 때 입력 2를 보낸다. 그리는 목표는 입력 1의 한 틱 중간(약 403)이다.
    world.recordInput(1, 1, 0, now - 1000 / 60);
    world.draw(0);
    const before = world.mePosition()!.x;
    world.recordInput(2, 1, 0, now);
    world.draw(0);
    return { before, after: world.mePosition()!.x };
  }, state);
  expect(result.before).toBeGreaterThan(402);
  expect(result.before).toBeLessThan(404);
  // 목표는 입력 1의 끝(406)으로 건너뛰지만, 그 차이를 보정 차이로 옮겨 그리는 위치는 이어진다.
  expect(Math.abs(result.after - result.before)).toBeLessThan(.5);
});

test('a correction from the server eases in instead of jumping', async ({ page }) => {
  const state = snapshot();
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    world.draw(1 / 60);
    const before = world.mePosition()!.x;
    // 서버가 숨은 적에 막혀 예측(400)보다 12 뒤(388)에 있다고 알려 온다.
    state.players[0] = { ...state.players[0], x: 388, rawX: 388 * 4096 };
    world.update(structuredClone(state));
    world.draw(1 / 60);
    const next = world.mePosition()!.x;
    for (let frame = 0; frame < 60; frame++) world.draw(1 / 60);
    return { before, next, settled: world.mePosition()!.x };
  }, state);
  expect(result.before).toBe(400);
  // 바로 388로 튀지 않고 조금만 다가간 뒤, 1초 안에 서버 위치에 닿는다.
  expect(result.next).toBeGreaterThan(395);
  expect(result.settled).toBeCloseTo(388, 1);
});

test('the drawn position follows the reconciled position instead of the lagging server position', async ({ page }) => {
  const state = snapshot();
  const drawn = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    const now = performance.now();
    // 0.2초 동안 오른쪽으로 보낸 입력을 서버가 아직 처리하지 않은 상태다.
    for (let i = 0; i < 6; i++) world.recordInput(i + 1, 1, 0, now - 200 + i * 1000 / 30);
    // 현재 입력을 0으로 두어 프레임마다의 이동을 빼고 보정 목표만 본다.
    world.control = { x: 0, y: 0, aim: 0 };
    for (let frame = 0; frame < 30; frame++) world.draw(1 / 60);
    return world.mePosition()!;
  }, state);
  // 예전 방식은 서버 위치 400에 머물렀다. 재조정하면 입력 0.2초 분량인 436 근처로 간다.
  expect(drawn.x).toBeGreaterThan(430);
  expect(drawn.x).toBeLessThan(445);
});

test('deploy placement uses the server player radius', async ({ page }) => {
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    // 벽 타일 (10, 10)의 왼쪽 면(x = 480)에서 14 떨어진 자리다. 서버 반지름 13이면 설 수 있고, 15면 벽에 걸린다.
    return [world.deployCheck({ x: 466, y: 504 }), world.deployCheck({ x: 466, y: 504 }, 15)];
  }, snapshot());
  expect(result).toEqual(['ok', 'blocked']);
});

test('deploy placement needs a tile the squad has seen and counts only the walls it has seen', async ({ page }) => {
  const state = snapshot();
  const walls = Buffer.from(state.walls, 'base64');
  // 벽 (10, 10)의 오른쪽 칸 (11, 10)과 그 오른쪽 칸들을 아직 보지 못한 칸(3)으로 둔다.
  for (let x = 11; x < 40; x++) walls[10 * 40 + x] = 3;
  state.walls = walls.toString('base64');
  const result = await page.evaluate(state => {
    const world = window.testWorld;
    world.update(structuredClone(state));
    return {
      // 본 빈 땅이다.
      open: world.deployCheck({ x: 466, y: 504 }),
      // 본 벽 칸이다.
      wall: world.deployCheck({ x: 504, y: 504 }),
      // 보지 못한 칸이다. 그 칸이 실제로 빈 땅이어도 투입할 수 없다.
      unseen: world.deployCheck({ x: 560, y: 504 }),
      // 본 칸 (11, 9)이지만 몸이 아래의 보지 못한 칸 (11, 10)에 걸친다. 서버처럼 보지 못한 칸은 빈 땅으로 본다.
      edge: world.deployCheck({ x: 560, y: 470 }),
    };
  }, state);
  expect(result).toEqual({ open: 'ok', wall: 'blocked', unseen: 'unseen', edge: 'ok' });
});

test('newly seen tiles redraw only their own map chunk under the light, and an unseen extraction is not drawn', async ({ page }) => {
  const state = snapshot();
  const walls = Buffer.from(state.walls, 'base64');
  walls.fill(3);
  walls[10 * 40 + 10] = 1;
  state.walls = walls.toString('base64');
  state.extraction = null;
  const result = await page.evaluate(state => {
    type Chunk = { context: { instructions: object[] } };
    type Layers = { root: { children: object[] }; fog: object; light: object; walls: object };
    const world = window.testWorld as unknown as TestWorld & Layers & { fogChunks: Chunk[]; wallChunks: Chunk[]; draw(dt: number): void };
    world.update(structuredClone(state)); world.draw(1 / 60);
    // 보지 못한 칸의 덮개는 시야(밝은 면) 아래, 벽은 시야 위에 그린다.
    const order = [world.fog, world.light, world.walls].map(layer => world.root.children.indexOf(layer));
    const chunks = world.fogChunks.length;
    const first = world.fogChunks.map(chunk => chunk.context.instructions[0]);
    const extractionLabel = world.labelsById.has('extract');
    // 맨 오른쪽 아래 칸 (39, 29)을 본다. 그 칸이 든 구역만 다시 그린다.
    const seen = Uint8Array.from(atob(state.walls), c => c.charCodeAt(0));
    seen[29 * 40 + 39] = 0;
    state.walls = btoa(String.fromCharCode(...seen));
    state.mapRevision = 1;
    world.update(structuredClone(state)); world.draw(1 / 60);
    const redrawn = world.fogChunks.map((chunk, index) => chunk.context.instructions[0] !== first[index]);
    return { chunks, after: world.fogChunks.length, walls: world.wallChunks.length, redrawn: redrawn.filter(Boolean).length,
      last: redrawn[redrawn.length - 1], extractionLabel, order };
  }, state);
  // 40×30칸을 8×8칸 구역으로 나누면 5×4 = 20개다.
  expect(result.chunks).toBe(20);
  expect(result.after).toBe(20);
  expect(result.walls).toBe(20);
  expect(result.order[0]).toBeLessThan(result.order[1]);
  expect(result.order[1]).toBeLessThan(result.order[2]);
  expect(result.redrawn).toBe(1);
  expect(result.last).toBe(true);
  expect(result.extractionLabel).toBe(false);
});
