import { test, expect, type Browser, type CDPSession, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { affinityColors, colors, team } from '../src/palette';
import type { Snapshot } from '../src/types';

// 미니맵이다(2026-11-09 사용자 결정). 맵 전체를 북쪽이 위인 채로 줄여 그린다. 그리는 것은 분대가 본 칸의 지형과 대원, 본 목표
// (캠프·시설·보급 상자·탈출 지점), 지금 보이는 적, 메인 화면이 보고 있는 범위다. 자리는 PC는 지도 오른쪽 위(경과 시간 아래),
// 터치 화면은 메뉴 버튼 줄 아래 왼쪽이다.

declare global {
  interface Window {
    testWorld: { update(snapshot: Snapshot): void; draw(dt: number): void; overview: boolean };
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
    type: 'snapshot', version: 5, room: 'ROOM01', you: 'pilot', now: 10, elapsed: 5, phase: 'active', result: null,
    walls: Buffer.from(walls).toString('base64'), mapRevision: 0,
    extraction: { x: 1080, y: 1130, progress: 0, duration: 20, unlocked: false },
    map: { width: 1920, height: 1440, cell: 48, columns: 40, rows: 30, campX: 300, campY: 730 },
    rules: { deploy: 5, speed: 180, playerRadius: 13, guardHalfAngle: Math.PI / 3, parryFollowupSeconds: .18, skills: [] },
    players: [player('pilot', 400, 730, 'alive'), player('mate', 1500, 300, 'alive'), player('waiting', 700, 250, 'waiting')],
    enemies: [enemy(901, 'grunt', 1000, 1000, [1, 1, 1]), enemy(902, 'breaker', 600, 1200, [2, 1, 1])],
    facilities: [{ id: 1, x: 900, y: 400, hp: 3, maxHp: 3 }, { id: 2, x: 1200, y: 820, hp: 0, maxHp: 3 }],
    supplies: [
      { id: 1, x: 500, y: 1100, kind: 'objective', objective: true, collected: false, uses: 1, cooldown: 0 },
      { id: 2, x: 800, y: 200, kind: 'field', objective: false, collected: false, uses: 2, cooldown: 0 },
      { id: 3, x: 1000, y: 200, kind: 'field', objective: false, collected: false, uses: 0, cooldown: 0 },
    ],
    effects: [], sight: [], notices: [],
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
    // 대원은 명단 차례의 대원 색이고, 대기 중인 대원은 그리지 않는다(메인 화면과 같다).
    const [me, mate, waiting] = await pixels(page, [[400, 730], [1500, 300], [700, 250]]);
    expect(me, '나').toEqual(rgba(team[0]));
    expect(mate, '동료').toEqual(rgba(team[1]));
    expect(waiting, '대기 중인 대원 자리').toEqual(floor);
    // 보이는 적은 메인 화면과 같은 몸 색이다. 병사는 병사 색, 분쇄자는 타격 2티어라 타격 빨강이다.
    const [grunt, breaker] = await pixels(page, [[1000, 1000], [600, 1200]]);
    expect(grunt, '병사').toEqual(rgba(0xd2b49b));
    expect(breaker, '분쇄자').toEqual(rgba(affinityColors.strike));
    // 목표: 남은 시설은 빨강, 부순 시설은 회색, 부목표 보급은 금색, 일반 보급은 청록이다. 다 쓴 상자는 그리지 않는다.
    const [facility, destroyed, objective, field, usedUp] = await pixels(page, [[900, 400], [1200, 820], [500, 1100], [800, 200], [1000, 200]]);
    expect(near(facility, colors.red), `시설 ${facility}`).toBe(true);
    expect(near(destroyed, 0x64706a), `부순 시설 ${destroyed}`).toBe(true);
    expect(objective, '부목표 보급').toEqual(rgba(colors.gold));
    expect(field, '일반 보급').toEqual(rgba(colors.teal));
    expect(usedUp, '다 쓴 상자 자리').toEqual(floor);
    // 캠프(네모 테두리)와 탈출 지점(고리)은 청록이다. 테두리 위의 화소를 읽는다. 탈출 지점은 열리기 전이라 고리를 70%로 옅게 그린다.
    const scale = await page.evaluate(() => (document.getElementById('minimap') as HTMLCanvasElement).width / 1920);
    const [camp, extraction] = await pixels(page, [[300 + 3.5 / scale, 730], [1080 + Math.max(80, 4 / scale), 1130]]);
    expect(near(camp, colors.teal), `캠프 ${camp}`).toBe(true);
    expect(near(extraction, blend(colors.teal, floor, .7), 25), `탈출 지점 ${extraction}`).toBe(true);
    // 화면 범위: 카메라는 나(400, 730)를 가운데 두고 1000×800px 화면을 0.95배로 본다. 위 테두리(월드 y 310 안팎)는 빈 땅보다 밝다.
    const [edge] = await pixels(page, [[576, 310]]);
    expect(light(edge), `화면 범위 테두리 ${edge}`).toBeGreaterThan(light(floor) + 40);
  });

  test('the minimap redraws the terrain when the squad sees new tiles or a wall breaks', async ({ page }) => {
    const state = snapshot();
    await page.evaluate(state => { window.testWorld.update(state); window.testWorld.draw(1 / 60); }, state);
    const [floor] = await pixels(page, [[5.5 * 48, 5.5 * 48]]);
    // 새 칸을 보고(35,15) 벽이 부서지면(10,10) 판 번호가 바뀐다.
    const walls = Uint8Array.from(Buffer.from(state.walls, 'base64'));
    walls[15 * 40 + 35] = 0;
    walls[10 * 40 + 10] = 0;
    const next = { ...state, walls: Buffer.from(walls).toString('base64'), mapRevision: 1, now: 10.1 };
    await page.evaluate(state => { window.testWorld.update(state); window.testWorld.draw(1 / 60); }, next);
    expect(await pixels(page, [[35.5 * 48, 15.5 * 48], [10.5 * 48, 10.5 * 48]])).toEqual([floor, floor]);
  });

  test('the minimap hides while the whole map is on the screen and shows again', async ({ page }) => {
    const state = snapshot();
    const shown = (change: (state: Snapshot) => void, overview = false) => page.evaluate(({ state, overview }) => {
      window.testWorld.overview = overview;
      window.testWorld.update(state);
      window.testWorld.draw(1 / 60);
      return { minimap: !document.getElementById('minimap')!.hidden, bodyClass: document.body.classList.contains('minimap-on') };
    }, { state: (() => { const copy = structuredClone(state); change(copy); return copy; })(), overview });
    // 메인 화면이 맵 전체를 보이는 동안(M 키·지도 버튼, 투입 전, 작전이 끝난 뒤)에는 미니맵이 필요 없다.
    expect(await shown(() => { }, true), '전체 지도 보기').toEqual({ minimap: false, bodyClass: false });
    expect(await shown(() => { }), '싸우는 중').toEqual({ minimap: true, bodyClass: true });
    expect(await shown(copy => { copy.players[0].state = 'waiting'; copy.now = 10.2; }), '투입 전').toEqual({ minimap: false, bodyClass: false });
    expect(await shown(copy => { copy.now = 10.3; }), '다시 싸우는 중').toEqual({ minimap: true, bodyClass: true });
    expect(await shown(copy => { copy.phase = 'ended'; copy.now = 10.4; }), '작전 종료').toEqual({ minimap: false, bodyClass: false });
  });

  test('the minimap keeps the proportions of the map inside the size the page allows', async ({ page }) => {
    // 맵 크기는 작전마다 다르다(가로 50~70칸, 세로 38~52칸). 상자는 최대 크기(PC 넓은 창은 200×160px) 안에서 맵의 비율을 따른다.
    // 크기는 CSS가 정하고 JS는 비율(--minimap-ratio)만 알린다. 상자 폭은 테두리(1px씩)를 포함하고, 테두리를 뺀 그림 칸이 맵과 같은
    // 비율이다. 캔버스의 화소 수는 그림 칸의 크기와 같다(이 브라우저의 화소 밀도는 1).
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
        await fingers.down(x, y);
        await expect(page.locator('#touch-base'), `${width}×${height} 조이스틱`).toBeVisible();
        await fingers.up(x, y);
        await expect(page.locator('#touch-base')).toBeHidden();
      }
    }
    // 가로 화면에서는 미니맵이 조이스틱 자리와 겹친다. 위의 누름 확인이 적어도 한 번은 돈다.
    await page.setViewportSize(phone.viewport);
    const [minimap] = await boxes(page, ['#minimap']);
    const [stick] = await boxes(page, ['#touch-move']);
    expect(apart(minimap, stick), '가로 화면에서 미니맵과 조이스틱 자리가 겹침').toBe(false);
    // 미니맵은 위쪽 줄 묶음 안이라 서랍보다 위에 그려진다. 서랍을 연 동안에는 숨고, 닫으면 다시 보인다.
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('#minimap')).toBeHidden();
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
