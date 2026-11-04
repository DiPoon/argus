import { test, expect, type CDPSession, type Page } from '@playwright/test';
import type { Snapshot } from '../src/types';

// 휴대폰 가로 화면이다. hasTouch를 켜면 브라우저가 손가락 기기((pointer: coarse))로 알리므로 클라이언트가 터치 화면을 띄운다.
const phone = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true };

function observe(page: Page) {
  let snapshot: Snapshot | undefined;
  // 규칙(rules)은 연결마다 처음 스냅샷에만 담긴다. 로비의 선택지와 견주려고 따로 받아 둔다.
  let rules: Snapshot['rules'] | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framereceived', frame => {
    try {
      const data = JSON.parse(frame.payload.toString());
      if (data.type !== 'snapshot') return;
      snapshot = data;
      if (data.rules) rules = data.rules;
    } catch { }
  }));
  return {
    get player() { return snapshot?.players.find(p => p.id === snapshot?.you); },
    get rules() { return rules; },
    errors,
  };
}

// 손가락 여러 개를 함께 누르고 움직인다. Playwright의 touchscreen은 한 번 누르기(tap)만 하므로 CDP로 터치 이벤트를 보낸다.
// 보낼 때마다 지금 화면에 닿아 있는 손가락을 모두 적는다. 앞의 이벤트에 있었는데 빠진 손가락은 뗀 것이 된다.
class Fingers {
  private readonly points = new Map<number, { x: number; y: number }>();
  constructor(private readonly cdp: CDPSession) { }
  async down(id: number, x: number, y: number) { this.points.set(id, { x, y }); await this.send('touchStart'); }
  async move(id: number, x: number, y: number) { this.points.set(id, { x, y }); await this.send('touchMove'); }
  async up(id: number) { this.points.delete(id); await this.send(this.points.size > 0 ? 'touchMove' : 'touchEnd'); }
  private send(type: 'touchStart' | 'touchMove' | 'touchEnd') {
    const touchPoints = type === 'touchEnd' ? [] : [...this.points].map(([id, point]) => ({ id, ...point }));
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }
}

// 그 자리를 누르면 지도(캔버스)가 받는지 본다. 알림이나 버튼이 덮고 있으면 누름이 지도에 닿지 않는다.
const canvasAt = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => document.elementFromPoint(x, y) instanceof HTMLCanvasElement, [x, y]);

// 로비의 장비 칸 선택지다. 칸 이름마다 고를 수 있는 기술 id를 차례대로 모은다.
const lobbyChoices = (page: Page) => page.evaluate(() => Object.fromEntries(['slot-1', 'slot-2', 'slot-3', 'free-slot'].map(name =>
  [name, [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map(input => input.value)])));

test('a phone picks only around skills in a one-screen lobby and fights with the joystick and skill buttons', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const me = observe(page);
  try {
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/\btouch\b/);
    // 로비는 휴대폰 가로 화면 한 장에 들어온다. 페이지도 장비 칸도 스크롤하지 않고 모든 버튼과 선택지가 보인다.
    for (const size of [{ width: 844, height: 390 }, { width: 740, height: 320 }]) {
      await page.setViewportSize(size);
      const overflow = await page.evaluate(() => {
        const panel = document.querySelector('.loadout-panel')!;
        return {
          page: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
          panel: panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1,
        };
      });
      expect(overflow, `${size.width}x${size.height}`).toEqual({ page: false, panel: false });
      for (const target of [page.getByRole('button', { name: '새 작전 시작' }), page.getByRole('button', { name: '참가', exact: true }), page.locator('.touch-gear label').last()]) {
        await expect(target).toBeInViewport({ ratio: 1 });
      }
    }
    await page.setViewportSize(phone.viewport);
    await page.screenshot({ path: 'test-results/argus-touch-lobby.png' });
    // 터치 로비는 둘레 기술만 고르게 한다. 종류 칸은 그 종류의 둘레 기술 하나뿐이라 처음부터 골라 두고, 자유 칸에서 셋 가운데 하나를 고른다.
    const choices = await lobbyChoices(page);
    await page.locator('label:has(input[name="free-slot"][value="spingrab"])').tap();
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect.poll(() => me.player?.slots).toEqual(['spin', 'spinblock', 'spingrab', 'spingrab']);
    // 선택지는 서버의 기술 정의 가운데 둘레 기술(around)과 같아야 한다. 서버에 둘레 기술을 더하거나 종류를 바꾸면 여기서 잡힌다.
    const around = me.rules!.skills.filter(skill => skill.around);
    expect(around.length).toBeGreaterThan(0);
    ['strike', 'block', 'channel'].forEach((kind, index) =>
      expect(choices[`slot-${index + 1}`], kind).toEqual(around.filter(skill => skill.kind === kind).map(skill => skill.id)));
    expect(choices['free-slot']).toEqual(around.map(skill => skill.id));

    // 투입을 기다리는 동안 지도를 누르면 그 자리를 투입 위치로 고른다. 시작할 때 지도 가운데는 분대가 아직 보지 못한 곳이다.
    await expect(page.locator('#room-code')).not.toHaveText('------');
    await expect(page.locator('#touch-controls')).toBeHidden();
    await expect(page.locator('#deploy-description')).toContainText('빈 지면을 누르세요');
    expect(await canvasAt(page, 422, 195)).toBe(true);
    await page.touchscreen.tap(422, 195);
    await expect(page.locator('#toast')).toContainText('아직 보지 못한 곳에는 투입할 수 없습니다.');
    await page.getByRole('button', { name: '캠프 선택' }).tap();
    await page.locator('#deploy').tap();
    await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
    await expect(page.locator('#touch-controls')).toBeVisible();
    await expect(page.locator('.touch-skill b')).toHaveText(['회전 베기', '회전 방어', '회전 잡기', '회전 잡기']);
    await expect(page.locator('.touch-skill small')).toHaveText(['마나 1', '마나 1', '마나 1', '마나 1']);

    const fingers = new Fingers(await context.newCDPSession(page));
    const stick = (await page.locator('#touch-move').boundingBox())!;
    const center = { x: stick.x + stick.width * .45, y: stick.y + stick.height * .6 };
    // 캠프 보급 상자는 캠프에서 (70, 40) 쪽에 있다. 조이스틱을 그쪽으로 밀고 있으면 상자까지 걸어가 마나를 채운다.
    const start = me.player!;
    await fingers.down(0, center.x, center.y);
    await fingers.move(0, center.x + 44, center.y + 25);
    await expect(page.locator('#touch-base')).toBeVisible();
    await expect.poll(() => me.player?.mana, { timeout: 10000 }).toBe(24);
    await fingers.up(0);
    await expect(page.locator('#touch-base')).toBeHidden();
    expect(me.player!.x).toBeGreaterThan(start.x + 20);
    expect(me.player!.y).toBeGreaterThan(start.y + 10);
    await page.waitForTimeout(200);
    const stopped = me.player!;
    await page.waitForTimeout(300);
    expect(me.player!.x).toBe(stopped.x);

    // 살아 있을 때 지도를 누르는 것은 기술이 아니다. 기술은 기술 버튼으로만 쓴다.
    expect(await canvasAt(page, 560, 180)).toBe(true);
    await page.touchscreen.tap(560, 180);
    await page.waitForTimeout(400);
    expect(me.player!.mana).toBe(24);
    expect(me.player!.actions).toEqual([]);

    // 한 손가락으로 조이스틱을 밀며 다른 손가락으로 기술 버튼을 누른다. 버튼을 누른 채로 걸으면서 회전 베기가 나간다.
    const skillButton = page.locator('.touch-skill[data-slot="1"]');
    const button = (await skillButton.boundingBox())!;
    await fingers.down(0, center.x, center.y);
    await fingers.move(0, center.x - 50, center.y);
    await fingers.down(1, button.x + button.width / 2, button.y + button.height / 2);
    await expect.poll(() => me.player?.actions.at(-1)?.slot).toBe(1);
    expect(me.player!.actions.at(-1)!.skill).toBe('spin');
    await expect(skillButton).toHaveClass(/\bheld\b/);
    const casting = me.player!;
    await expect.poll(() => me.player?.x).toBeLessThan(casting.x - 15);
    await fingers.up(1);
    await fingers.up(0);
    await expect(skillButton).not.toHaveClass(/\bheld\b/);
    // 버튼을 떼면 기술이 더 나가지 않는다. 뗀 입력이 서버에 닿은 뒤의 마나를 기준으로 본다.
    await page.waitForTimeout(300);
    const left = me.player!.mana;
    expect(left).toBeLessThan(24);
    await page.waitForTimeout(900);
    expect(me.player!.mana).toBe(left);

    // 화면을 문질러도 페이지는 스크롤되지 않는다.
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY, wide: document.documentElement.scrollWidth > innerWidth }))).toEqual({ x: 0, y: 0, wide: false });
    // 메뉴 버튼이 옆 패널(임무·분대·나가기)을 열고 닫는다. 패널은 그 안에서 스크롤되어 맨 아래의 나가기 버튼까지 누를 수 있다.
    const menu = page.getByRole('button', { name: '☰ 메뉴' });
    const leave = page.getByRole('button', { name: '작전에서 나가기 ↗' });
    await menu.tap();
    await expect(leave).toBeVisible();
    await page.screenshot({ path: 'test-results/argus-touch-menu.png' });
    await menu.tap();
    await expect(leave).toBeHidden();
    await menu.tap();
    await leave.tap();
    await expect(page.getByRole('button', { name: '새 작전 시작' })).toBeInViewport();
    expect(await page.evaluate(() => [...document.body.classList].sort())).toEqual(['touch']);
    expect(me.errors).toEqual([]);
  } finally { await context.close(); }
});

test('?touch shows the touch screen on a PC and the PC lobby keeps aimed skills', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveClass(/\btouch\b/);
  expect((await lobbyChoices(page))['free-slot']).toEqual(['strike', 'parry', 'grab', 'spin', 'spinblock', 'spingrab']);
  await page.goto('/?touch');
  await expect(page.locator('body')).toHaveClass(/\btouch\b/);
  expect(await lobbyChoices(page)).toEqual({ 'slot-1': ['spin'], 'slot-2': ['spinblock'], 'slot-3': ['spingrab'], 'free-slot': ['spin', 'spinblock', 'spingrab'] });
});
