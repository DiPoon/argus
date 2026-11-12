import { test, expect, type Browser, type CDPSession, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { affinityColors, bodyColor, colors, extractionRadius, team } from '../src/palette';
import type { Snapshot } from '../src/types';

// 미니맵이다(2026-11-09 사용자 결정). 맵 전체를 북쪽이 위인 채로 줄여 그린다. 그리는 것은 분대가 본 칸의 지형과 지금 시야, 대원, 본 목표
// (캠프·시설·보급 상자·탈출 지점), 지금 보이는 적, 메인 화면이 보고 있는 범위다. 자리는 PC는 지도 오른쪽 위(경과 시간 아래),
// 터치 화면은 메뉴 버튼 줄 아래 왼쪽이다.

declare global {
  interface Window {
    testWorld: { update(snapshot: Snapshot): void; draw(dt: number): void; reset(): void; overview: boolean; menuOpen: boolean };
  }
}

const phone = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true };
type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const apart = (a: Box, b: Box) => a.right <= b.left + .5 || b.right <= a.left + .5 || a.bottom <= b.top + .5 || b.bottom <= a.top + .5;

// 실제 World에 미니맵을 붙인 임시 페이지다. 앱의 style.css를 불러 미니맵 크기를 실제 규칙(PC 넓은 창: 최대 200×160px)으로 정한다.
let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'minimap-test-page',
      configureServer(devServer) {
        devServer.middlewares.use('/__minimap_test', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(`<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body style="margin:0">
            <div id="host" style="width:1000px;height:800px"></div>
            <canvas id="minimap" class="minimap" hidden></canvas>
            <script type="module">
              import { World } from '/src/world.ts';
              import { Minimap } from '/src/minimap.ts';
              const world = new World();
              await world.init(document.getElementById('host'));
              world.app.ticker.stop();
              world.minimap = new Minimap(document.getElementById('minimap'));
              window.testWorld = world;
            </script>
          </body></html>`);
        });
      },
    }],
  });
  await server.listen();
  url = server.resolvedUrls!.local[0] + '__minimap_test';
});

test.afterAll(async () => {
  await server.close();
});

// 40×30칸(1920×1440) 맵이다. (10,10)은 부술 수 있는 벽, (12,10)은 부술 수 없는 벽이고, x가 30 이상인 칸은 분대가 아직 보지 못했다.
// 지금 시야는 나와 캠프 둘레의 네모(x 200~700, y 300~930) 하나다. 두 벽은 그 안에 있고, 동료와 적, 다른 목표는 밖에 있다.
function snapshot(): Snapshot {
  const walls = new Uint8Array(40 * 30);
  walls[10 * 40 + 10] = 1;
  walls[10 * 40 + 12] = 2;
  for (let y = 0; y < 30; y++) for (let x = 30; x < 40; x++) walls[y * 40 + x] = 3;
  const player = (id: string, x: number, y: number, state: 'alive' | 'waiting') => ({
    id, name: id, x, y, rawX: x * 4096, rawY: y * 4096, slots: ['strike', 'parry', 'grab', 'strike'] as Snapshot['players'][number]['slots'],
    state, connected: true, hasDeployed: true, aim: 0, hp: 6, maxHp: 6, mana: 12, maxMana: 24, busy: 0, actions: [], deploy: 0,
    kills: 0, deaths: 0, ack: 0, landingX: x, landingY: y,
  });
  const enemy = (id: number, kind: 'grunt' | 'breaker', x: number, y: number, tiers: number[]) => ({
    id, kind, name: kind, x, y, rawX: x * 4096, rawY: y * 4096, hp: 1, maxHp: 1, radius: 16, tiers, action: null,
  });
  return {
    type: 'snapshot', version: 6, room: 'ROOM01', you: 'pilot', now: 10, elapsed: 5, phase: 'active', result: null,
    walls: Buffer.from(walls).toString('base64'), mapRevision: 0,
    extraction: { x: 1080, y: 1130, progress: 0, duration: 20, unlocked: false },
    map: { width: 1920, height: 1440, cell: 48, columns: 40, rows: 30, campX: 300, campY: 730 },
    rules: { deploy: 5, speed: 180, playerRadius: 13, guardHalfAngle: Math.PI / 3, maxAuraSeconds: 1, skills: [] },
    players: [player('pilot', 400, 730, 'alive'), player('mate', 1500, 300, 'alive'), player('waiting', 700, 250, 'waiting')],
    enemies: [enemy(901, 'grunt', 1000, 1000, [1, 1, 1]), enemy(902, 'breaker', 600, 1200, [2, 1, 1])],
    facilities: [{ id: 1, x: 900, y: 400, hp: 3, maxHp: 3 }, { id: 2, x: 1200, y: 820, hp: 0, maxHp: 3 }],
    supplies: [
      { id: 1, x: 500, y: 1100, kind: 'objective', objective: true, collected: false, uses: 1, cooldown: 0 },
      { id: 2, x: 800, y: 200, kind: 'field', objective: false, collected: false, uses: 2, cooldown: 0 },
      { id: 3, x: 1000, y: 200, kind: 'field', objective: false, collected: false, uses: 0, cooldown: 0 },
    ],
    effects: [], sight: [[200, 300, 700, 300, 700, 930, 200, 930]], notices: [],
  };
}

// 미니맵 캔버스에서 월드 좌표 자리의 화소를 읽는다. 투명한 화소는 알파가 0이다(상자 바탕은 CSS가 칠한다).
const pixels = (page: Page, points: number[][]) => page.evaluate(points => {
  const canvas = document.getElementById('minimap') as HTMLCanvasElement;
  const context = canvas.getContext('2d')!;
  const sx = canvas.width / 1920, sy = canvas.height / 1440;
  return points.map(([x, y]) => [...context.getImageData(Math.floor(x * sx), Math.floor(y * sy), 1, 1).data]);
}, points);
const rgba = (color: number) => [color >> 16, (color >> 8) & 255, color & 255, 255];
// 둥근 도형의 가장자리처럼 섞인 화소는 색 거리로 본다.
const near = (actual: number[], color: number, tolerance = 60) => {
  const [r, g, b] = rgba(color);
  return actual[3] > 0 && Math.hypot(actual[0] - r, actual[1] - g, actual[2] - b) <= tolerance;
};
// 반투명하게 칠한 색이 아래 화소 위에 섞인 색이다.
const blend = (color: number, under: number[], alpha: number) => {
  const [r, g, b] = rgba(color);
  return (Math.round(r * alpha + under[0] * (1 - alpha)) << 16) | (Math.round(g * alpha + under[1] * (1 - alpha)) << 8) | Math.round(b * alpha + under[2] * (1 - alpha));
};

test.describe('drawing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(url);
    await page.waitForFunction(() => window.testWorld !== undefined);
  });

  test('the minimap draws the seen terrain, the squad, the seen objectives, the visible enemies and the screen area, and leaves unseen tiles empty', async ({ page }) => {
    await page.evaluate(state => { window.testWorld.update(state); window.testWorld.draw(1 / 60); }, snapshot());
    await expect(page.locator('#minimap')).toBeVisible();
    // 지형: 칸 가운데를 읽는다. 빈 땅, 부술 수 있는 벽, 부술 수 없는 벽은 서로 다른 색이고, 보지 못한 칸은 비어 있다.
    const [floor, breakable, solid, unseen] = await pixels(page, [[5.5 * 48, 5.5 * 48], [10.5 * 48, 10.5 * 48], [12.5 * 48, 10.5 * 48], [35.5 * 48, 15.5 * 48]]);
    expect(unseen[3], '보지 못한 칸').toBe(0);
    expect(floor[3]).toBe(255);
    expect(new Set([floor, breakable, solid].map(color => color.join()))).toHaveProperty('size', 3);
    // 벽은 빈 땅보다 밝고, 부술 수 없는 벽은 메인 화면처럼 부술 수 있는 벽보다 어둡다.
    const light = (color: number[]) => color[0] + color[1] + color[2];
    expect(light(breakable)).toBeGreaterThan(light(solid));
    expect(light(solid)).toBeGreaterThan(light(floor));
    // 지금 시야 안의 땅은 시야 밖의 본 땅보다 한 단계 밝다(2026-11-11 사용자 결정). 시야 밖의 본 땅은 그대로라, 지금 보이지 않는 곳이
    // 지켜보는 곳처럼 읽히지 않는다. 벽은 시야 위에 그려 시야 안에서도 제 색이다(위의 두 벽이 시야 안에 있다).
    const [watched, alsoSeen] = await pixels(page, [[250, 580], [25.5 * 48, 5.5 * 48]]);
    expect(watched[3]).toBe(255);
    expect(light(watched), `시야 안의 땅 ${watched}`).toBeGreaterThan(light(floor) + 30);
    expect(light(watched)).toBeLessThan(light(breakable));
    expect(alsoSeen, '시야 밖의 본 땅').toEqual(floor);
    // 대원은 명단 차례의 대원 색이고, 대기 중인 대원은 그리지 않는다(메인 화면과 같다).
    const [me, mate, waiting] = await pixels(page, [[400, 730], [1500, 300], [700, 250]]);
    expect(me, '나').toEqual(rgba(team[0]));
    expect(mate, '동료').toEqual(rgba(team[1]));
    expect(waiting, '대기 중인 대원 자리').toEqual(floor);
    // 대원 점에는 밝은 고리를 두르고 적 점에는 두르지 않는다(2026-11-11 사용자 결정). 4번 대원의 색이 병사의 몸 색과 비슷해, 고리가
    // 없으면 대원이 적으로 보인다. 고리 자리(대원은 가운데에서 3.5px, 나는 4.3px)의 화소를 읽는다. 동료는 보지 못한 칸 위에 있어 바탕이 비어 있다.
    const dot = await page.evaluate(() => 1920 / (document.getElementById('minimap') as HTMLCanvasElement).width);
    const [myRing, mateRing, gruntEdge] = await pixels(page, [[400 + 4.3 * dot, 730], [1500 + 3.5 * dot, 300], [1000 + 3.5 * dot, 1000]]);
    expect(Math.min(myRing[0], myRing[1], myRing[2]), `내 고리 ${myRing}`).toBeGreaterThan(200);
    // 동료의 고리는 1px 굵기라 가장자리가 옅게 섞인다. 바탕이 비어 있으므로 흰색이 조금이라도 칠해졌는지 본다.
    expect(Math.min(mateRing[0], mateRing[1], mateRing[2]) > 200 && mateRing[3] > 40, `동료의 고리 ${mateRing}`).toBe(true);
    expect(gruntEdge, '병사 점 둘레에는 고리가 없다').toEqual(floor);
    // 보이는 적은 메인 화면과 같은 몸 색이다. 병사는 병사 색, 분쇄자는 타격 2티어라 타격 빨강이다.
    const [grunt, breaker] = await pixels(page, [[1000, 1000], [600, 1200]]);
    expect(grunt, '병사').toEqual(rgba(bodyColor([1, 1, 1])));
    expect(breaker, '분쇄자').toEqual(rgba(affinityColors.strike));
    // 목표: 남은 시설은 빨강, 부순 시설은 회색, 부목표 보급은 금색, 일반 보급은 청록이다. 다 쓴 상자는 그리지 않는다.
    const [facility, destroyed, objective, field, usedUp] = await pixels(page, [[900, 400], [1200, 820], [500, 1100], [800, 200], [1000, 200]]);
    expect(near(facility, colors.red), `시설 ${facility}`).toBe(true);
    expect(near(destroyed, colors.spent), `부순 시설 ${destroyed}`).toBe(true);
    expect(objective, '부목표 보급').toEqual(rgba(colors.gold));
    expect(field, '일반 보급').toEqual(rgba(colors.teal));
    expect(usedUp, '다 쓴 상자 자리').toEqual(floor);
    // 캠프(네모 테두리)와 탈출 지점(고리)은 청록이다. 테두리 위의 화소를 읽는다. 탈출 지점은 열리기 전이라 고리를 70%로 옅게 그린다.
    const scale = await page.evaluate(() => (document.getElementById('minimap') as HTMLCanvasElement).width / 1920);
    const [camp, extraction] = await pixels(page, [[300 + 3.5 / scale, 730], [1080 + Math.max(extractionRadius, 4 / scale), 1130]]);
    expect(near(camp, colors.teal), `캠프 ${camp}`).toBe(true);
    expect(near(extraction, blend(colors.teal, floor, .7), 25), `탈출 지점 ${extraction}`).toBe(true);
    // 화면 범위: 카메라는 나(400, 730)를 가운데 두고 1000×800px 화면을 0.95배로 본다. 위 테두리(월드 y 310 안팎)는 그 자리의 땅(시야 안)보다 밝다.
    const [edge] = await pixels(page, [[576, 310]]);
    expect(light(edge), `화면 범위 테두리 ${edge}`).toBeGreaterThan(light(watched) + 40);
  });

  test('the minimap redraws the terrain when the squad sees new tiles or a wall breaks', async ({ page }) => {
    const state = snapshot();
    await page.evaluate(state => { window.testWorld.update(state); window.testWorld.draw(1 / 60); }, state);
    // 시야 밖의 본 땅(5,5)과 시야 안의 땅(250, 580)의 색이다.
    const [floor, watched] = await pixels(page, [[5.5 * 48, 5.5 * 48], [250, 580]]);
    // 새 칸을 보고(35,15) 벽이 부서지면(10,10) 판 번호가 바뀐다. 새로 본 칸은 시야 밖이고, 부서진 벽 자리는 시야 안이다.
    const walls = Uint8Array.from(Buffer.from(state.walls, 'base64'));
    walls[15 * 40 + 35] = 0;
    walls[10 * 40 + 10] = 0;
    const next = { ...state, walls: Buffer.from(walls).toString('base64'), mapRevision: 1, now: 10.1 };
    await page.evaluate(state => { window.testWorld.update(state); window.testWorld.draw(1 / 60); }, next);
    expect(await pixels(page, [[35.5 * 48, 15.5 * 48], [10.5 * 48, 10.5 * 48]])).toEqual([floor, watched]);
  });

  test('the minimap hides while the whole map is on the screen and shows again', async ({ page }) => {
    const state = snapshot();
    const shown = (change: (state: Snapshot) => void, overview = false, menuOpen = false) => page.evaluate(({ state, overview, menuOpen }) => {
      window.testWorld.overview = overview;
      window.testWorld.menuOpen = menuOpen;
      window.testWorld.update(state);
      window.testWorld.draw(1 / 60);
      return { minimap: !document.getElementById('minimap')!.hidden, bodyClass: document.body.classList.contains('minimap-on') };
    }, { state: (() => { const copy = structuredClone(state); change(copy); return copy; })(), overview, menuOpen });
    // 메인 화면이 맵 전체를 보이는 동안(M 키·지도 버튼, 투입 전, 작전이 끝난 뒤)에는 미니맵이 필요 없다.
    expect(await shown(() => { }, true), '전체 지도 보기').toEqual({ minimap: false, bodyClass: false });
    expect(await shown(() => { }), '싸우는 중').toEqual({ minimap: true, bodyClass: true });
    expect(await shown(copy => { copy.players[0].state = 'waiting'; copy.now = 10.2; }), '투입 전').toEqual({ minimap: false, bodyClass: false });
    expect(await shown(copy => { copy.now = 10.3; }), '다시 싸우는 중').toEqual({ minimap: true, bodyClass: true });
    expect(await shown(copy => { copy.phase = 'ended'; copy.now = 10.4; }), '작전 종료').toEqual({ minimap: false, bodyClass: false });
    // 터치 화면의 서랍이 열린 동안에도 숨는다. 숨는 때는 이 한 곳(World)에서 정하고 CSS로 따로 숨기지 않는다. 그래서 minimap-on은
    // 늘 "미니맵이 화면에 있다"는 뜻이다.
    expect(await shown(copy => { copy.now = 10.5; }, false, true), '서랍이 열림').toEqual({ minimap: false, bodyClass: false });
    expect(await shown(copy => { copy.now = 10.6; }), '서랍을 닫음').toEqual({ minimap: true, bodyClass: true });
  });

  test('a minimap measured while it is off the screen is measured again instead of keeping a one-pixel picture', async ({ page }) => {
    // 상자가 화면에 없는 동안(크기 0) 잰 값을 굳히면, 다시 보였을 때 1×1 그림이 상자만큼 늘어나 한 덩어리 색으로 뭉개진다.
    // 예전에는 서랍을 연 채 착지하면 그랬다. 화면에 없으면 재지 않고, 다시 그릴 때 잰다.
    const sizes = await page.evaluate(state => {
      const canvas = document.getElementById('minimap') as HTMLCanvasElement;
      window.testWorld.update(state);
      window.testWorld.draw(1 / 60);
      const first = [canvas.width, canvas.height], firstBox = [canvas.clientWidth, canvas.clientHeight];
      // 다른 방(다른 맵 비율)으로 바뀌어 다시 재야 하는 때에, 상자가 다른 이유로 화면에 없다.
      canvas.style.display = 'none';
      const wide = { ...state, room: 'ROOM02', map: { ...state.map, columns: 60, rows: 30, width: 2880, height: 1440 }, walls: btoa(String.fromCharCode(...new Uint8Array(60 * 30))) };
      window.testWorld.update(wide);
      window.testWorld.draw(1 / 60);
      const hidden = [canvas.width, canvas.height];
      canvas.style.display = '';
      window.testWorld.draw(1 / 60);
      return { first, firstBox, hidden, shown: [canvas.width, canvas.height], box: [canvas.clientWidth, canvas.clientHeight] };
    }, snapshot());
    expect(sizes.first).toEqual(sizes.firstBox);
    // 화면에 없는 동안에는 그림 크기를 바꾸지 않는다.
    expect(sizes.hidden).toEqual(sizes.first);
    // 다시 보이면 새 맵 비율(2:1)의 상자에 맞춘다.
    expect(sizes.shown).toEqual(sizes.box);
    expect(sizes.shown).toEqual([198, 99]);
  });

  test('leaving a room clears the map and the minimap so the next room does not start with the last one', async ({ page }) => {
    // 방을 나가면 World.reset이 지난 방의 스냅샷과 그림을 비운다. 다음 방의 첫 스냅샷이 오기 전에 그려도 지난 방이 나오지 않는다.
    const state = snapshot();
    await page.evaluate(state => { window.testWorld.update(state); window.testWorld.draw(1 / 60); }, state);
    await expect(page.locator('#minimap')).toBeVisible();
    const after = await page.evaluate(() => {
      window.testWorld.reset();
      // 다음 작전에서 ticker가 다시 돌 때다. 새 방의 스냅샷은 아직 오지 않았다.
      window.testWorld.draw(1 / 60);
      const main = document.querySelector<HTMLCanvasElement>('#host canvas')!;
      const context = main.getContext('2d')!;
      const data = context.getImageData(0, 0, main.width, main.height).data;
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 4 * 97) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return { minimap: !document.getElementById('minimap')!.hidden, bodyClass: document.body.classList.contains('minimap-on'), colors: [...colors] };
    });
    expect(after.minimap, '미니맵').toBe(false);
    expect(after.bodyClass).toBe(false);
    // 메인 화면에는 바탕색(#10191b)만 남는다.
    expect(after.colors, '메인 화면').toEqual(['16,25,27']);
    // 새 방의 스냅샷이 오면 그 방을 그린다.
    await page.evaluate(state => { window.testWorld.update({ ...state, room: 'ROOM02' }); window.testWorld.draw(1 / 60); }, state);
    await expect(page.locator('#minimap')).toBeVisible();
    expect((await pixels(page, [[5.5 * 48, 5.5 * 48]]))[0][3]).toBe(255);
  });

  test('the minimap keeps the proportions of the map inside the size the page allows', async ({ page }) => {
    // 맵 크기는 작전마다 다르다(가로 50~70칸, 세로 38~52칸). 상자는 최대 크기(PC 넓은 창은 200×160px) 안에서 맵의 비율을 따른다.
    // 크기는 CSS가 정하고 JS는 비율(--minimap-ratio)만 알린다. 상자 폭은 테두리(1px씩)를 포함하고, 테두리 안쪽이 맵과 같은
    // 비율이다. 캔버스의 화소 수는 테두리 안쪽의 크기와 같다(이 브라우저의 화소 밀도는 1).
    const fit = (columns: number, rows: number) => page.evaluate(({ state, columns, rows }) => {
      state.map = { ...state.map, columns, rows, width: columns * 48, height: rows * 48 };
      state.walls = btoa(String.fromCharCode(...new Uint8Array(columns * rows)));
      state.room = `ROOM-${columns}x${rows}`;
      window.testWorld.update(state);
      window.testWorld.draw(1 / 60);
      const canvas = document.getElementById('minimap') as HTMLCanvasElement;
      return { width: canvas.clientWidth, height: canvas.clientHeight, buffer: [canvas.width, canvas.height], ratio: document.body.style.getPropertyValue('--minimap-ratio') };
    }, { state: snapshot(), columns, rows });
    expect(await fit(70, 38)).toEqual({ width: 198, height: 107, buffer: [198, 107], ratio: '1.8421' });
    expect(await fit(50, 52)).toEqual({ width: 152, height: 158, buffer: [152, 158], ratio: '0.9615' });
  });
});

// 그림의 화소 수다. 상자 크기는 소수 CSS px일 수 있고(맵 비율로 나눈 높이 등) 브라우저는 상자의 끝과 테두리를 화소 경계에 맞춘다.
// 그래서 정수로 반올림한 CSS 크기에 화소 밀도를 곱하면 브라우저가 실제로 쓰는 화소 수와 어긋나고, 그림 전체가 다시 표본화되어 번진다.
// 여러 맵 비율로 본다. 돌려주는 것은 그림의 화소 수, 브라우저가 알려 준 상자 안쪽의 실제 화소 수, 상자 안쪽의 CSS 크기다.
const mapSizes = [[70, 38], [64, 44], [60, 48], [56, 50], [50, 52]];
const pictureSizes = async (page: Page) => {
  await page.goto(url);
  await page.waitForFunction(() => window.testWorld !== undefined);
  const results = [];
  for (const [columns, rows] of mapSizes) {
    results.push(await page.evaluate(async ({ state, columns, rows }) => {
      state.map = { ...state.map, columns, rows, width: columns * 48, height: rows * 48 };
      state.walls = btoa(String.fromCharCode(...new Uint8Array(columns * rows)));
      state.room = `ROOM-${columns}x${rows}`;
      window.testWorld.update(state);
      window.testWorld.draw(1 / 60);
      // 브라우저가 상자의 실제 화소 수를 알려 줄 때까지(다음 프레임) 기다렸다가 다시 그린다.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.testWorld.draw(1 / 60);
      const canvas = document.getElementById('minimap') as HTMLCanvasElement;
      const device = await new Promise<number[]>(resolve => {
        const observer = new ResizeObserver(entries => {
          const box = entries[0].devicePixelContentBoxSize[0];
          observer.disconnect();
          resolve([box.inlineSize, box.blockSize]);
        });
        observer.observe(canvas, { box: 'device-pixel-content-box' });
      });
      const rect = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
      const css = [rect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth), rect.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)];
      return { map: `${columns}x${rows}`, density: devicePixelRatio, picture: [canvas.width, canvas.height], device, css, rounded: [canvas.clientWidth, canvas.clientHeight] };
    }, { state: snapshot(), columns, rows }));
  }
  return results;
};

test('the minimap picture has exactly the pixels of its box on a screen with a fractional scale', async ({ playwright }) => {
  // Windows의 150%·125% 배율 같은 화면이다. 그림의 화소 수가 상자의 실제 화소 수와 같아야 번지지 않는다.
  // 검사 브라우저의 화소 밀도 흉내(deviceScaleFactor)는 브라우저가 알려 주는 실제 화소 수까지 바꾸지 못하므로, 배율을 실제로 준 브라우저를 따로 띄운다.
  let differs = 0;
  for (const scale of ['1.5', '1.25']) {
    const browser = await playwright.chromium.launch({ args: [`--force-device-scale-factor=${scale}`, '--window-size=1280,900', '--disable-webgl'] });
    try {
      const page = await browser.newPage({ viewport: null });
      for (const result of await pictureSizes(page)) {
        expect(result.density, '화소 밀도').toBe(Number(scale));
        expect(result.picture, `배율 ${scale}, 맵 ${result.map}`).toEqual(result.device);
        // 예전 방식(정수로 반올림한 CSS 크기 × 화소 밀도)이 실제 화소 수와 다른 경우를 센다.
        if (Math.round(result.rounded[0] * result.density) !== result.device[0] || Math.round(result.rounded[1] * result.density) !== result.device[1]) differs++;
      }
    } finally { await browser.close(); }
  }
  // 이 검사가 예전 방식을 잡아내려면 둘이 다른 경우가 있어야 한다.
  expect(differs, '예전 방식과 다른 경우').toBeGreaterThan(0);
});

test('the minimap picture uses a pixel density of at most two, like the main view', async ({ browser }) => {
  // 화소 밀도가 3인 휴대폰에서도 그림은 CSS 크기의 두 배까지만 만든다. 2~4px 점에서는 그보다 촘촘해도 보이지 않는다.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 3 });
  try {
    for (const result of await pictureSizes(await context.newPage())) {
      expect(result.density).toBe(3);
      expect(result.picture, `맵 ${result.map}`).toEqual([Math.round(result.css[0] * 2), Math.round(result.css[1] * 2)]);
    }
  } finally { await context.close(); }
});

// 실제 서버로 작전을 시작해 캠프에 투입한다. 첫 스냅샷이 오기 전의 캠프 선택은 아무 일도 하지 않으므로 투입 버튼이 풀릴 때까지 누른다.
async function deployAtCamp(page: Page, tap: boolean) {
  const press = (locator: ReturnType<Page['locator']>) => tap ? locator.tap() : locator.click();
  await expect(async () => {
    await press(page.getByRole('button', { name: '캠프 선택' }));
    await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
  }).toPass();
  await press(page.locator('#deploy'));
}

// 스냅샷마다 안내를 하나씩 더해 알림을 계속 띄운다. 알림은 3.5초 뒤 저절로 사라지므로 새 안내로 살려 둔다. 안내는 실제로 가장 긴 두
// 문장(투입 거절, 연결 복구)을 번갈아 보내 넓고 여러 줄인 알림을 만든다.
async function keepNotice(page: Page) {
  let notice = 1_000_000;
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    server.onMessage(message => {
      if (typeof message === 'string') {
        const data = JSON.parse(message);
        const text = notice % 2 ? '아직 보지 못한 곳에는 투입할 수 없습니다.' : '연결을 복구하고 있습니다. 캐릭터와 임무는 계속 진행됩니다.';
        if (data.type === 'snapshot') message = JSON.stringify({ ...data, notices: [...data.notices, { id: notice++, at: data.now, text }] });
      }
      ws.send(message);
    });
  });
}

// 알림이 쓸 수 있는 폭이다. 알림은 글자만큼만 넓어지므로, 이 브라우저처럼 한글을 좁게 그리면 실제보다 좁게 잰다. 아주 긴 줄을 잠시
// 넣어 배치가 허락하는 최대 폭까지 넓힌 뒤 재고 되돌린다(휴대폰 크기 점검도 이렇게 잰다).
const toastRoom = (page: Page) => page.evaluate(() => {
  const toast = document.getElementById('toast')!;
  const saved = toast.innerHTML;
  toast.innerHTML = `<div>${'가'.repeat(200)}</div>`;
  const width = toast.getBoundingClientRect().width;
  toast.innerHTML = saved;
  return width;
});

// 알림이 가장 넓어졌을 때의 오른쪽 끝이다. toastRoom처럼 아주 긴 줄을 잠시 넣어 잰다.
const toastReach = (page: Page) => page.evaluate(() => {
  const toast = document.getElementById('toast')!;
  const saved = toast.innerHTML;
  toast.innerHTML = `<div>${'가'.repeat(200)}</div>`;
  const right = toast.getBoundingClientRect().right;
  toast.innerHTML = saved;
  return right;
});

// 화면의 상자들이다. 숨은 요소는 크기가 0이라 빼고 본다.
const boxes = (page: Page, selectors: string[]) => page.evaluate(selectors => selectors.flatMap(selector =>
  [...document.querySelectorAll<HTMLElement>(selector)].filter(element => element.getClientRects().length > 0).map(element => {
    const r = element.getBoundingClientRect();
    return { name: selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  })), selectors);

test('on a PC the minimap sits at the top right under the timers and keeps clear of the notices and the combat HUD', async ({ page }) => {
  await keepNotice(page);
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await deployAtCamp(page, false);
  await expect(page.locator('#combat-hud')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#minimap')).toBeVisible();
  await expect(page.locator('#toast')).toBeVisible();
  // 옆 패널이 있는 넓은 창부터, 옆 패널이 숨는 760px 이하, 화면을 크게 확대한 좁은 창까지 본다. 규칙이 바뀌는 폭의 양쪽이다.
  for (const width of [1440, 1101, 1100, 761, 760, 600, 441, 440, 360]) {
    await page.setViewportSize({ width, height: 800 });
    // 미니맵과 알림의 위 끝은 main.ts가 재는 경과 시간 상자의 아래 끝(--map-top)을 따른다. 그 값이 바뀌는 다음 프레임까지 기다린다.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const [minimap] = await boxes(page, ['#minimap']);
    const [field] = await boxes(page, ['#battlefield']);
    const [timers] = await boxes(page, ['.timers']);
    const others = await boxes(page, ['.timers', '.map-title', '#toast', '#combat-hud']);
    expect(minimap, `${width}px 미니맵`).toBeDefined();
    // 지도 안의 오른쪽 위다. 경과 시간 상자 아래에 있고, 오른쪽 끝을 경과 시간 상자와 맞춘다.
    expect(minimap.left >= field.left && minimap.right <= field.right + .5, `${width}px 지도 안`).toBe(true);
    expect(minimap.top, `${width}px 경과 시간 아래`).toBeGreaterThanOrEqual(timers.bottom);
    expect(Math.abs(minimap.right - timers.right), `${width}px 오른쪽 끝`).toBeLessThanOrEqual(1);
    for (const other of others) expect(apart(minimap, other), `${width}px 미니맵과 ${other.name}`).toBe(true);
    // 알림은 비켜 가도 쓸 수 있는 폭이 200px 이상이다. 옆 자리가 그보다 좁은 아주 좁은 창(440px 이하)에서는 미니맵 아래로 간다.
    expect(await toastRoom(page), `${width}px 알림 폭`).toBeGreaterThanOrEqual(200);
  }
  // M 키로 맵 전체를 보이는 동안에는 숨고, 다시 누르면 보인다.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('KeyM');
  await expect(page.locator('#minimap')).toBeHidden();
  await page.keyboard.press('KeyM');
  await expect(page.locator('#minimap')).toBeVisible();
});

// 메인 화면(Pixi 캔버스)에 그려진 색들이다. 듬성듬성 읽는다. 검사 브라우저는 WebGL을 꺼 두어 2D 캔버스다.
const mainColors = (page: Page) => page.evaluate(() => {
  const main = document.querySelector<HTMLCanvasElement>('#canvas-host canvas')!;
  const data = main.getContext('2d')!.getImageData(0, 0, main.width, main.height).data;
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += 4 * 97) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return [...colors];
});

test('leaving an operation does not carry its map, minimap or waiting deploy button into the next one', async ({ page }) => {
  // 서버가 보내는 메시지를 붙잡아 둘 수 있게 웹소켓을 거친다. 붙잡은 동안에는 스냅샷도 투입 답도 오지 않는다. 풀면 차례대로 보낸다.
  let hold = false;
  let release = () => { };
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    const held: (string | Buffer)[] = [];
    server.onMessage(message => { if (hold) held.push(message); else ws.send(message); });
    release = () => { hold = false; for (const message of held.splice(0)) ws.send(message); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await deployAtCamp(page, false);
  await expect(page.locator('#combat-hud')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#minimap')).toBeVisible();
  const firstRoom = await page.locator('#room-code').innerText();
  expect(firstRoom).toMatch(/^[A-Z0-9]{6}$/);
  await expect(page.locator('#roster .member')).toHaveCount(1);
  // 살아 있는 채로 나가, 첫 스냅샷이 오지 않는 다음 작전에 들어간다(연결이 느린 휴대폰에서는 이 사이가 길다).
  await page.getByRole('button', { name: /작전에서 나가기/ }).click();
  await expect(page.locator('#lobby')).toBeVisible();
  hold = true;
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#operation')).toBeVisible();
  // 그리기가 몇 프레임 돌아도 지난 방은 보이지 않는다. 예전에는 지난 방의 마지막 스냅샷으로 지도와 미니맵을 다시 그렸다.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  await expect(page.locator('#minimap')).toBeHidden();
  expect(await page.evaluate(() => document.body.classList.contains('minimap-on'))).toBe(false);
  expect(await mainColors(page), '메인 화면에는 바탕색만').toEqual(['16,25,27']);
  // 지도 위의 체력·마나 상자와 투입 안내도 첫 스냅샷이 올 때까지 숨는다.
  await expect(page.locator('#combat-hud')).toBeHidden();
  await expect(page.locator('#deploy-panel')).toBeHidden();
  // 옆 패널과 지도 위쪽 줄의 글자도 지난 방의 것이 아니라 처음 값이다(초대 코드, 명단, 임무 수, 경과 시간).
  await expect(page.locator('#room-code')).toHaveText('------');
  expect(await page.evaluate(() => ['roster', 'facility-list', 'primary-count', 'team-count', 'elapsed', 'extract-progress'].map(id => {
    const element = document.getElementById(id)!;
    return id === 'extract-progress' ? element.style.width : element.innerHTML;
  }))).toEqual(['', '', '0/3', '1 / 4', '00:00', '0%']);
  // 스냅샷이 오면 새 방을 그린다.
  release();
  await expect(page.locator('#deploy-panel')).toBeVisible();
  await expect(page.locator('#room-code')).not.toHaveText('------');
  expect(await page.locator('#room-code').innerText()).not.toBe(firstRoom);
  await expect(async () => {
    await page.getByRole('button', { name: '캠프 선택' }).click();
    await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
  }).toPass();
  // 투입을 누르고 서버의 답이 오기 전에(망이 멈춤) 나간다.
  hold = true;
  await page.locator('#deploy').click();
  await expect(page.locator('#deploy')).toHaveText('투입 준비 중…');
  await expect(page.locator('#deploy')).toBeDisabled();
  await page.getByRole('button', { name: /작전에서 나가기/ }).click();
  // 이번에는 투입 안내가 보이는 채로 나갔다. 다음 작전의 첫 스냅샷이 오기 전에는 지난 방의 투입 안내("투입 준비 중…")도 보이지 않는다.
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#operation')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  await expect(page.locator('#deploy-panel')).toBeHidden();
  release();
  await expect(page.locator('#deploy-panel')).toBeVisible();
  // 다음 작전에서는 투입 버튼이 잠겨 있지 않다. 예전에는 답을 기다리던 표시가 남아, 캠프를 골라도 "투입 준비 중…"인 채 눌리지 않았다.
  await expect(async () => {
    await page.getByRole('button', { name: '캠프 선택' }).click();
    await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
  }).toPass();
  await expect(page.locator('#deploy')).toHaveText('5초 후 투입 ↗');
  await page.locator('#deploy').click();
  await expect(page.locator('#combat-hud')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#minimap')).toBeVisible();
});

class Fingers {
  constructor(private readonly cdp: CDPSession) { }
  down(x: number, y: number) { return this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] }); }
  up(x: number, y: number) { return this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, x, y }] }); }
}

async function phonePage(browser: Browser) {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  await keepNotice(page);
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).tap();
  // 터치 화면에서 작전을 시작하면 전체 화면이 켜진다. 전체 화면에서는 화면 크기를 바꿀 수 없으므로 끈다.
  await page.waitForFunction(() => document.fullscreenElement !== null);
  await page.evaluate(() => document.exitFullscreen());
  await deployAtCamp(page, true);
  await expect(page.locator('#touch-controls')).toBeVisible({ timeout: 8000 });
  return { context, page };
}

test('on a phone the minimap sits at the left under the top row, keeps clear of the notices and the skill buttons and lets the joystick start on it', async ({ browser }) => {
  const { context, page } = await phonePage(browser);
  try {
    await expect(page.locator('#minimap')).toBeVisible();
    await expect(page.locator('#toast')).toBeVisible();
    const fingers = new Fingers(await context.newCDPSession(page));
    // 가로 화면(넓은 것부터 높이 320px까지)과 세로 화면이다. 크기를 바꾸자마자 잰다. 자리와 크기는 CSS가 정하므로 프레임을 기다리지 않는다.
    for (const [width, height] of [[844, 390], [740, 360], [667, 375], [640, 360], [658, 320], [568, 320], [533, 320], [390, 844], [390, 664], [320, 568], [320, 533]]) {
      await page.setViewportSize({ width, height });
      const [minimap] = await boxes(page, ['#minimap']);
      const [row] = await boxes(page, ['.top-row']);
      const [toast] = await boxes(page, ['#toast']);
      const skills = await boxes(page, ['.touch-skill']);
      const others = await boxes(page, ['.touch-top', '.combat-hud', '.map-top']);
      expect(minimap, `${width}×${height} 미니맵`).toBeDefined();
      // 메뉴 버튼 줄 아래의 왼쪽이고 화면 안이다. 왼쪽 끝은 메뉴 버튼 줄과 같다.
      expect(minimap.top, `${width}×${height} 위쪽 줄 아래`).toBeGreaterThanOrEqual(row.bottom);
      expect(minimap.left >= 0 && minimap.right <= width && minimap.bottom <= height, `${width}×${height} 화면 안`).toBe(true);
      expect(Math.abs(minimap.left - row.left), `${width}×${height} 왼쪽 끝`).toBeLessThanOrEqual(1);
      for (const other of [...others, ...skills]) expect(apart(minimap, other), `${width}×${height} 미니맵과 ${other.name}`).toBe(true);
      // 알림은 어느 크기에서도 기술 버튼을 덮지 않는다. 가로 화면은 미니맵과 기술 버튼 무리 사이에 둔다. 폭 600px 이하(좁은 가로 화면과
      // 세로 화면)는 미니맵 옆에 자리가 없어 알림이 미니맵을 잠시 덮는다. 그때는 알림이 미니맵 위에 그려진다.
      for (const skill of skills) expect(apart(toast, skill), `${width}×${height} 알림과 기술 버튼`).toBe(true);
      expect(await toastRoom(page), `${width}×${height} 알림 폭`).toBeGreaterThanOrEqual(200);
      // 가로 화면(521px 이상)에서는 알림이 아무리 넓어져도 기술 버튼 무리의 왼쪽에서 끝난다. 폭 600px 이하에서 알림이 미니맵을 덮을 때도
      // 기술 버튼 쪽은 그대로 비운다. 위의 겹침 확인만으로는 알림이 버튼보다 위에 있을 때 버튼 쪽으로 넘어온 것을 잡지 못한다.
      if (width > 520) expect(await toastReach(page), `${width}×${height} 알림의 오른쪽 끝`).toBeLessThanOrEqual(Math.min(...skills.map(skill => skill.left)) + .5);
      // 비킬지는 화면 폭으로 정한다. 미니맵 폭이 맵 비율(방마다 다름)에 따라 달라, 가로로 긴 맵이면 폭 600px 이하에서 옆 자리가 150px 안팎이다.
      const shifted = await page.locator('#toast').evaluate(toast => parseFloat(getComputedStyle(toast).marginLeft) > 0);
      expect(shifted, `${width}×${height} 알림이 미니맵 옆으로 비킴`).toBe(width > 600);
      if (width > 600) expect(apart(minimap, toast), `${width}×${height} 미니맵과 알림`).toBe(true);
      else expect(await page.evaluate(() => [getComputedStyle(document.getElementById('toast')!).zIndex, getComputedStyle(document.getElementById('minimap')!).zIndex])).toEqual(['1', '0']);
      // 미니맵은 누름을 받지 않는다. 조이스틱 자리(왼쪽 아래)와 겹치는 곳을 누르면 조이스틱이 생긴다. 세로 화면처럼 겹치지 않으면
      // 누를 곳이 없으므로 계산값만 본다.
      expect(await page.locator('#minimap').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
      const [stick] = await boxes(page, ['#touch-move']);
      const shared = { left: Math.max(minimap.left, stick.left), top: Math.max(minimap.top, stick.top), right: Math.min(minimap.right, stick.right), bottom: Math.min(minimap.bottom, stick.bottom) };
      if (shared.right - shared.left > 4 && shared.bottom - shared.top > 4) {
        const x = (shared.left + shared.right) / 2, y = (shared.top + shared.bottom) / 2;
        const opacity = () => page.locator('#minimap').evaluate(element => getComputedStyle(element).opacity);
        await fingers.down(x, y);
        await expect(page.locator('#touch-base'), `${width}×${height} 조이스틱`).toBeVisible();
        // 미니맵은 조이스틱보다 위에 그려진다. 겹치는 동안에는 미니맵이 옅어져 받침과 손잡이가 비쳐 보인다(2026-11-11 사용자 결정).
        // toBeVisible은 다른 요소에 가려진 것을 잡지 못하므로 미니맵의 투명도를 본다.
        await expect(page.locator('body'), `${width}×${height} 겹침 표시`).toHaveClass(/stick-on-minimap/);
        await expect.poll(opacity, `${width}×${height} 미니맵이 옅어짐`).toBe('0.3');
        await fingers.up(x, y);
        await expect(page.locator('#touch-base')).toBeHidden();
        await expect(page.locator('body')).not.toHaveClass(/stick-on-minimap/);
        await expect.poll(opacity, `${width}×${height} 미니맵이 돌아옴`).toBe('1');
      }
      // 미니맵에서 먼 곳(조이스틱 자리의 왼쪽 아래)에서 쓰는 조이스틱은 미니맵을 옅게 하지 않는다. 받침과 손잡이는 누른 자리에서 80px까지 간다.
      const far = { x: stick.left + 40, y: stick.bottom - 30 };
      if (far.y - 80 > minimap.bottom || far.x - 80 > minimap.right) {
        await fingers.down(far.x, far.y);
        await expect(page.locator('#touch-base'), `${width}×${height} 먼 조이스틱`).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/stick-on-minimap/);
        await fingers.up(far.x, far.y);
        await expect(page.locator('#touch-base')).toBeHidden();
      }
    }
    // 가로 화면에서는 미니맵이 조이스틱 자리와 겹친다. 위의 누름 확인이 적어도 한 번은 돈다.
    await page.setViewportSize(phone.viewport);
    const [minimap] = await boxes(page, ['#minimap']);
    const [stick] = await boxes(page, ['#touch-move']);
    expect(apart(minimap, stick), '가로 화면에서 미니맵과 조이스틱 자리가 겹침').toBe(false);
    // 미니맵은 위쪽 줄 묶음 안이라 서랍보다 위에 그려진다. 서랍을 연 동안에는 숨고, 닫으면 다시 보인다.
    // 숨기는 것은 CSS가 아니라 World다. 그래서 minimap-on도 함께 빠진다(이 클래스는 늘 "미니맵이 화면에 있다"는 뜻이다).
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('#minimap')).toBeHidden();
    expect(await page.evaluate(() => [document.getElementById('minimap')!.hidden, document.body.classList.contains('minimap-on')])).toEqual([true, false]);
    // 그동안 알림도 비키지 않는다. 서랍은 위쪽 줄과 알림 아래에서 시작하므로 알림 자리가 바뀌면 서랍 높이도 바뀐다.
    expect(await page.locator('#toast').evaluate(toast => [getComputedStyle(toast).marginLeft, getComputedStyle(toast).marginRight])).toEqual(['0px', '0px']);
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await expect(page.locator('#minimap')).toBeVisible();
    // 지도 버튼으로 맵 전체를 보이는 동안에는 숨고, 다시 누르면 보인다.
    await page.getByRole('button', { name: '지도' }).tap();
    await expect(page.locator('#minimap')).toBeHidden();
    await page.getByRole('button', { name: '지도' }).tap();
    await expect(page.locator('#minimap')).toBeVisible();
  } finally { await context.close(); }
});

test('on a phone the minimap is drawn at its size after landing with the drawer open', async ({ browser }) => {
  // 휴대폰(화소 밀도 3)에서 투입을 누르고 5초를 기다리는 동안 ☰ 서랍을 열고, 연 채로 착지한다(착지는 서랍을 닫지 않는다).
  // 예전에는 서랍이 CSS로만 미니맵을 숨겨, 착지하는 순간 숨은 상자를 0으로 재고 3×1 그림을 굳혔다. 서랍을 닫으면 그 그림이 상자만큼
  // 늘어나 한 덩어리 색으로 보였다.
  const context = await browser.newContext({ ...phone, deviceScaleFactor: 3 });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await page.waitForFunction(() => document.fullscreenElement !== null);
    await page.evaluate(() => document.exitFullscreen());
    await deployAtCamp(page, true);
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await expect(page.locator('.sidebar')).toBeVisible();
    // 착지하면 터치 조작이 켜진다(서랍 밑이다).
    await expect.poll(() => page.evaluate(() => !document.getElementById('touch-controls')!.hidden), { timeout: 8000 }).toBe(true);
    // 서랍이 열린 동안에는 착지한 뒤에도 미니맵이 숨어 있다.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => [document.getElementById('minimap')!.hidden, document.body.classList.contains('minimap-on')])).toEqual([true, false]);
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await expect(page.locator('#minimap')).toBeVisible();
    // 그림의 화소 수가 상자에 맞는다(화소 밀도는 2까지 쓴다).
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const size = await page.locator('#minimap').evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return { picture: [canvas.width, canvas.height], css: [rect.width - 2, rect.height - 2] };
    });
    expect(size.picture).toEqual([Math.round(size.css[0] * 2), Math.round(size.css[1] * 2)]);
    expect(size.picture[0]).toBeGreaterThan(200);
  } finally { await context.close(); }
});
