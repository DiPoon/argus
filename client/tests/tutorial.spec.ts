import { expect, test, type Page } from '@playwright/test';
import { relay } from './wire';

// 튜토리얼(이슈 #36, 2026-11-24)이다. 처음 온 사람은 로비 대신 첫 방문 화면을 보고(초대 링크로 온 사람만 예외), 훈련은 서버의
// 튜토리얼 방(layout "tutorial")에서 투입 → 이동과 보급 → 병사 셋 받아치기 → 탈출 차례로 지도 위의 안내를 따라간다.
// 다른 검사는 모두 훈련을 마친 브라우저로 돈다(playwright.config.ts의 storageState). 여기서는 처음 온 사람의 빈 저장소로 시작한다.
const firstVisit = { cookies: [], origins: [] };
test.use({ storageState: firstVisit });

type Wire = Awaited<ReturnType<typeof relay>>;

// 내 대원을 키보드로 (x, y)까지 걷게 한다. 위치는 서버가 보낸 스냅샷으로 본다. 스냅샷은 0.1초마다 오고 화면보다 늦으므로,
// 멀면 키를 누르고 있고 가까우면 짧게 눌렀다 떼며 다가간다.
async function walkTo(page: Page, wire: Wire, x: number, y: number, within: number) {
  const held = new Set<string>();
  const hold = async (key: string, on: boolean) => {
    if (on && !held.has(key)) { held.add(key); await page.keyboard.down(key); }
    if (!on && held.has(key)) { held.delete(key); await page.keyboard.up(key); }
  };
  const release = async () => { for (const key of [...held]) await hold(key, false); };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const me = wire.player!;
    const dx = x - me.x, dy = y - me.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= within) break;
    const keys = { KeyD: dx > 4, KeyA: dx < -4, KeyS: dy > 4, KeyW: dy < -4 };
    if (distance > 70) {
      for (const [key, on] of Object.entries(keys)) await hold(key, on);
      await page.waitForTimeout(30);
    } else {
      await release();
      for (const [key, on] of Object.entries(keys)) if (on) await page.keyboard.down(key);
      await page.waitForTimeout(60);
      for (const [key, on] of Object.entries(keys)) if (on) await page.keyboard.up(key);
      await page.waitForTimeout(250);
    }
  }
  await release();
  await page.waitForTimeout(250);
  expect(Math.hypot(x - wire.player!.x, y - wire.player!.y)).toBeLessThan(within + 20);
}

// 첫 방문 화면에서 훈련을 시작하고 캠프로 투입해 착지할 때까지다. 튜토리얼 방을 만드는 요청을 돌려준다.
async function startTutorial(page: Page) {
  await expect(page.locator('#welcome')).toBeVisible();
  const created = page.waitForRequest(request => request.url().endsWith('/api/rooms') && request.method() === 'POST');
  await page.locator('#tutorial-start').click();
  const request = await created;
  await expect(page.locator('#tutorial-guide')).toContainText('훈련 1 / 4');
  // 터치 화면에서 훈련을 시작하면 전체 화면이 켜진다. 크기를 바꾸기 전에 끈다.
  await page.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : undefined);
  await page.locator('#camp').click();
  await page.locator('#deploy').click();
  await expect(page.locator('#tutorial-guide')).toContainText('훈련 2 / 4', { timeout: 15000 });
  return request;
}

test('a first visit on a PC goes from the welcome screen through the four tutorial steps and back to the lobby', async ({ page }) => {
  test.setTimeout(150000);
  const wire = await relay(page);
  await page.goto('/');
  // 첫 방문 화면이 로비 자리에 있다. 조작 안내는 키보드와 마우스다.
  await expect(page.locator('#lobby')).toBeHidden();
  await expect(page.locator('#welcome')).toContainText('키보드(WASD)');
  // Enter로 바로 시작하게 훈련 시작 버튼에 커서가 있다.
  await expect(page.locator('#tutorial-start')).toBeFocused();
  const request = await startTutorial(page);
  expect(request.postDataJSON().layout).toBe('tutorial');
  // 훈련을 시작하면 마친 것으로 적는다. 다음 방문은 로비다.
  expect(await page.evaluate(() => localStorage.getItem('argus-tutorial'))).toBe('done');
  // 임무 HUD 대신 훈련이다. 옆 패널의 제목이 바뀌고, 시설 목록과 초대 링크가 숨는다. PC에서는 미니맵이 그대로 있다.
  await expect(page.locator('#op-title')).toHaveText('훈련장');
  await expect(page.locator('.mission-section')).toBeHidden();
  await expect(page.locator('#copy-code')).toBeHidden();
  await expect(page.locator('#minimap')).toBeVisible();
  const guide = page.locator('#tutorial-guide');
  await expect(guide).toContainText('로 걷습니다');
  await expect(guide).toContainText('보급 상자');

  // 이동과 보급: 캠프 보급 상자로 걸어 가면 마나가 차고 받아치기 단계가 된다. 조준은 오른쪽(병사 쪽)에 둔다.
  const map = (await page.locator('#canvas-host').boundingBox())!;
  await page.mouse.move(map.x + map.width - 40, map.y + map.height / 2);
  const box = wire.snapshot!.supplies[0];
  await walkTo(page, wire, box.x, box.y, 15);
  await expect(guide).toContainText('훈련 3 / 4');
  await expect(guide).toContainText('0/3');
  await expect(guide).toContainText('지면 나만, 비기면 서로 체력 1을 잃습니다');

  // 병사 셋은 왼쪽부터 타격·방어·잡기만 예고한다. 안내가 예고한 손과 이기는 내 칸(이름과 키)을 알리고, 그 키를 누르면 쓰러진다.
  const drills = [
    { kind: '타격', answer: '받아치기', label: '우클릭 / 2', key: 'Digit2' },
    { kind: '방어', answer: '잡기', label: 'Space / 3', key: 'Space' },
    { kind: '잡기', answer: '근접 타격', label: '좌클릭 / 1', key: 'Digit1' },
  ];
  for (const [index, drill] of drills.entries()) {
    const ahead = () => wire.snapshot!.enemies.filter(enemy => enemy.x > wire.player!.x).sort((a, b) => a.x - b.x)[0];
    // 다음 병사가 시야에 들어올 때까지 오른쪽으로 걷는다.
    while (!ahead()) await walkTo(page, wire, wire.player!.x + 120, wire.player!.y, 20);
    const target = ahead();
    await walkTo(page, wire, target.x - 45, target.y, 12);
    let attempts = 0;
    while (wire.player!.kills === index) {
      attempts += 1;
      expect(attempts, `${drill.kind} 병사를 네 번 안에 쓰러뜨리지 못했습니다`).toBeLessThanOrEqual(4);
      await expect.poll(() => wire.snapshot!.enemies.find(enemy => enemy.id === target.id)?.action?.phase, { timeout: 15000, intervals: [20] }).toBe('telegraph');
      await expect(guide).toContainText(`${drill.kind} 예고 → ${drill.answer} ${drill.label}`);
      await page.keyboard.down(drill.key);
      await page.waitForTimeout(150);
      await page.keyboard.up(drill.key);
      await expect.poll(() => wire.player!.kills === index + 1 || wire.snapshot!.enemies.find(enemy => enemy.id === target.id)?.action?.phase !== 'telegraph',
        { timeout: 5000 }).toBe(true);
    }
    if (index < 2) await expect(guide).toContainText(`${index + 1}/3`);
  }

  // 탈출: 병사 셋을 쓰러뜨리면 마지막 단계다. 오른쪽 끝의 탈출 지점에서 버티면 훈련이 끝난다.
  await expect(guide).toContainText('훈련 4 / 4');
  while (!wire.snapshot!.extraction) await walkTo(page, wire, wire.player!.x + 120, wire.player!.y, 20);
  const exit = wire.snapshot!.extraction!;
  await walkTo(page, wire, exit.x, exit.y, 20);
  await expect(guide).toContainText('버티면 훈련이 끝납니다');
  await expect(page.locator('#result')).toBeVisible({ timeout: 30000 });
  await expect(guide).toBeHidden();
  await expect(page.locator('#result-kicker')).toHaveText('TRAINING');
  await expect(page.locator('#result-title')).toHaveText('훈련 완료.');
  await expect(page.locator('#result-stats')).toContainText('3/3');
  await expect(page.locator('#again')).toContainText('작전 로비로');

  // 로비로 돌아오면 평소 HUD의 글로 되돌린다. 다음 방문도 로비다.
  await page.locator('#again').click();
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  expect(await page.evaluate(() => document.body.classList.contains('tutorial'))).toBe(false);
  await expect(page.locator('#op-title')).toHaveText('침묵의 전초기지');
  await expect(page.locator('#again')).toContainText('다음 작전 준비');
  await page.reload();
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
});

test('skipping the welcome shows the lobby for good, and the lobby can start the tutorial again', async ({ page }) => {
  const wire = await relay(page);
  await page.goto('/');
  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#callsign')).toBeFocused();
  await page.reload();
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#welcome')).toBeHidden();

  // 로비의 훈련 버튼으로 다시 한다. 새로 고쳐도 같은 탭은 훈련 방의 HUD로 돌아온다.
  const created = page.waitForRequest(request => request.url().endsWith('/api/rooms') && request.method() === 'POST');
  await page.locator('#lobby-tutorial').click();
  expect((await created).postDataJSON().layout).toBe('tutorial');
  await expect(page.locator('#tutorial-guide')).toContainText('훈련 1 / 4');
  await page.reload();
  await expect(page.locator('#tutorial-guide')).toContainText('훈련 1 / 4');
  await expect(page.locator('#op-title')).toHaveText('훈련장');

  // 훈련에서 나와 새 작전을 시작하면 평소 HUD다. 새 방의 첫 스냅샷이 오기 전에도 지난 훈련의 안내 상자가 남지 않는다(스냅샷을 잡아 둔다).
  await page.locator('#leave').click();
  await expect(page.locator('#lobby')).toBeVisible();
  wire.holding = true;
  const normal = page.waitForRequest(request => request.url().endsWith('/api/rooms') && request.method() === 'POST');
  await page.locator('#create').click();
  expect((await normal).postDataJSON().layout).toBeUndefined();
  await expect(page.locator('#operation')).toBeVisible();
  await expect.poll(() => wire.held.length).toBeGreaterThan(0);
  await expect(page.locator('#tutorial-guide')).toBeHidden();
  wire.release();
  await expect(page.locator('#mission-state')).toHaveText('투입 대기');
  await expect(page.locator('#op-title')).toHaveText('침묵의 전초기지');
  await expect(page.locator('.mission-section')).toBeVisible();
  await expect(page.locator('#copy-code')).toBeVisible();
  await expect(page.locator('#tutorial-guide')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('argus-tutorial-room'))).toBeNull();
});

test('an invite link skips the welcome screen, and a browser that cannot keep the flag goes straight to the lobby', async ({ page, browser }) => {
  // 초대 링크로 처음 온 사람은 그 방의 참가 로비를 바로 본다(2026-11-24 사용자 결정). 모양이 틀린 초대도 로비가 알린다.
  await page.goto('/?room=ABCDEF');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#lobby')).toHaveClass(/invited/);
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#lobby-tutorial')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('argus-tutorial'))).toBeNull();
  await page.goto('/?room=AB');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#lobby-error')).toContainText('초대 링크의 방 코드');
  await expect(page.locator('#welcome')).toBeHidden();
  // 초대 없이 다시 오면 아직 훈련을 하지 않았으므로 첫 방문 화면이다.
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();

  // 저장소를 읽을 수 없는 브라우저는 들를 때마다 첫 방문 화면을 보이지 않고 로비로 간다.
  const context = await browser.newContext({ storageState: firstVisit });
  const blocked = await context.newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }));
  await blocked.goto('/');
  await expect(blocked.locator('#lobby')).toBeVisible();
  await expect(blocked.locator('#welcome')).toBeHidden();
  await context.close();
});

test('on a phone the welcome fits one screen, and the guide takes the minimap spot clear of the top row, the skill buttons and the player', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ storageState: firstVisit, viewport: { width: 533, height: 320 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const wire = await relay(page);
  await page.goto('/');
  // 가장 낮은 가로 화면에서도 첫 방문 화면이 한 장에 들어온다. 조작 안내는 조이스틱과 버튼이다.
  await expect(page.locator('#welcome')).toContainText('왼쪽 아래를 끌어');
  // 화면 전체가 스크롤되지 않고, 첫 방문 화면 안도 넘치지 않는다.
  const fits = await page.evaluate(() => {
    const welcome = document.getElementById('welcome')!;
    return { page: document.documentElement.scrollHeight <= innerHeight + 1, inside: welcome.scrollHeight <= welcome.clientHeight + 1 };
  });
  expect(fits).toEqual({ page: true, inside: true });
  const start = await page.locator('#tutorial-start').boundingBox();
  expect(start!.y + start!.height).toBeLessThanOrEqual(320);
  await startTutorial(page);
  const guide = page.locator('#tutorial-guide');
  await expect(guide).toContainText('누른 채 끌면 걷습니다');

  // 안내가 가장 긴 두 단계에서 잰다. 보급 단계(착지 직후)와, 가까운 병사가 타격을 예고하는 받아치기 단계(스냅샷을 바꿔 만든다).
  const now = () => wire.snapshot!.now;
  const drillCue = () => {
    wire.change = state => {
      const me = state.players.find(player => player.id === state.you)!;
      me.mana = 24;
      const drill = state.enemies[0];
      if (drill) drill.action = { id: 990001, skill: 'strike', kind: 'strike', slot: 0, tier: 1, phase: 'telegraph', aim: Math.PI,
        startedAt: now(), contactAt: now() + 2, activeUntil: now() + 2.25, endsAt: now() + 3, range: 60, halfWidth: 30 };
      return state;
    };
  };
  // 짧은 세로 화면(390×400·360×360, 분할 화면·작은 창)도 본다. 대원이 위쪽 줄 가까이에 있어 넓은 안내가 대원을 덮었다(PR #40을 합친 뒤).
  const sizes = [{ width: 533, height: 320 }, { width: 568, height: 320 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 320, height: 568 },
    { width: 390, height: 400 }, { width: 360, height: 360 }];
  for (const stage of ['보급', '받아치기']) {
    if (stage === '받아치기') {
      drillCue();
      await expect(guide).toContainText('타격 예고 → 회전 방어 버튼');
    }
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      const layout = await page.evaluate(() => {
        const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
        const guide = rect(document.getElementById('tutorial-guide')!);
        const skills = [...document.querySelectorAll('.touch-skill')].map(rect);
        const top = ['.touch-top', '#combat-hud', '.map-top'].map(selector => rect(document.querySelector(selector)!));
        return { guide, skills, top, minimapHidden: (document.getElementById('minimap') as HTMLCanvasElement).hidden, width: innerWidth, height: innerHeight };
      });
      const overlaps = (a: typeof layout.guide, b: typeof layout.guide) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const where = `${stage} ${size.width}×${size.height}`;
      expect(layout.minimapHidden, where).toBe(true);
      expect(layout.guide.right, where).toBeLessThanOrEqual(layout.width);
      expect(layout.guide.bottom, where).toBeLessThanOrEqual(layout.height);
      for (const box of [...layout.skills, ...layout.top]) expect(overlaps(layout.guide, box), `${where}: 안내가 ${JSON.stringify(box)}를 덮습니다`).toBe(false);
      // 카메라는 대원을 화면 가운데에 둔다. 대원의 몸(반지름 13에 화면 배율)과 그 위의 이름표 자리를 덮지 않는다.
      const player = { left: layout.width / 2 - 22, right: layout.width / 2 + 22, top: layout.height / 2 - 45, bottom: layout.height / 2 + 22 };
      expect(overlaps(layout.guide, player), `${where}: 안내가 대원을 덮습니다`).toBe(false);
    }
  }
  // 서랍을 여는 동안은 안내가 숨어 서랍이 위쪽 줄 바로 아래에서 시작한다.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#touch-menu').click();
  await expect(guide).toBeHidden();
  await page.locator('#touch-menu').click();
  await expect(guide).toBeVisible();
  await context.close();
});

test('the touch lobby starts the tutorial from its tools row', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 533, height: 320 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  // 이 파일의 test.use(빈 저장소)는 손으로 연 문맥에도 들어가므로, 훈련을 마친 브라우저로 따로 만든다.
  await page.addInitScript(() => localStorage.setItem('argus-tutorial', 'done'));
  await page.goto('/');
  await expect(page.locator('#lobby')).toBeVisible();
  const tutorial = (await page.locator('#lobby-tutorial').boundingBox())!;
  expect(tutorial.y + tutorial.height).toBeLessThanOrEqual(320);
  const created = page.waitForRequest(request => request.url().endsWith('/api/rooms') && request.method() === 'POST');
  await page.locator('#lobby-tutorial').click();
  expect((await created).postDataJSON().layout).toBe('tutorial');
  await expect(page.locator('#tutorial-guide')).toContainText('훈련 1 / 4');
  await context.close();
});
