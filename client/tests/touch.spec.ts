import { test, expect, type CDPSession, type Page } from '@playwright/test';
import type { Player, Snapshot } from '../src/types';

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
// 누르고 움직일 때는 지금 화면에 닿아 있는 손가락을 모두 적는다. 뗄 때는 뗄 손가락만 담은 touchEnd를 보낸다.
// touchMove에서 빼기만 한 손가락은 떼어지지 않고 그대로 남는다.
class Fingers {
  private readonly points = new Map<number, { x: number; y: number }>();
  constructor(private readonly cdp: CDPSession) { }
  async down(id: number, x: number, y: number) { this.points.set(id, { x, y }); await this.send('touchStart'); }
  async move(id: number, x: number, y: number) { this.points.set(id, { x, y }); await this.send('touchMove'); }
  async up(id: number) {
    const point = this.points.get(id)!;
    this.points.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, ...point }] });
  }
  private send(type: 'touchStart' | 'touchMove') {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...this.points].map(([id, point]) => ({ id, ...point })) });
  }
}

// 페이지와 서버 사이의 WebSocket을 가운데서 잇는다. 보낸 입력을 모으고, 서버가 보낸 스냅샷을 바꾸거나 화면에 넘기지 않고 잡아 둔다.
// 연결을 끊어 재접속 장면도 만든다.
async function relay(page: Page) {
  const wire = {
    inputs: [] as { slot: number; press: number; aim: number; moveX: number; moveY: number }[],
    player: undefined as Player | undefined,
    change: (data: Snapshot): Snapshot => data,
    holding: false,
    held: [] as string[],
    forward: (_message: string) => { },
    drop: () => { },
    release() {
      wire.holding = false;
      for (const message of wire.held.splice(0)) wire.forward(message);
    },
  };
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    wire.drop = () => { void ws.close(); };
    wire.forward = message => ws.send(message);
    ws.onMessage(message => {
      if (typeof message === 'string' && message.includes('"input"')) wire.inputs.push(JSON.parse(message));
      server.send(message);
    });
    server.onMessage(message => {
      if (typeof message === 'string') {
        const data = JSON.parse(message);
        if (data.type === 'snapshot') {
          wire.player = (data as Snapshot).players.find(p => p.id === data.you);
          message = JSON.stringify(wire.change(data));
          if (wire.holding) { wire.held.push(message); return; }
        }
      }
      ws.send(message);
    });
  });
  return wire;
}

// 터치 화면에서 새 작전 시작을 누르면 전체 화면이 켜진다. 전체 화면에서는 검사 브라우저가 창 크기를 바꾸지 못하므로 끈다.
// 전체 화면은 작전 화면이 보인 뒤에 켜지기도 하므로, 켜질 때까지 기다린 뒤 끈다.
async function leaveFullscreen(page: Page) {
  await page.waitForFunction(() => document.fullscreenElement !== null);
  await page.evaluate(() => document.exitFullscreen());
}

// 캠프에 투입하고, 터치 조작이 뜰 때까지 기다린다. 첫 스냅샷이 오기 전의 캠프 선택은 아무 일도 하지 않으므로 될 때까지 누른다.
async function deployAtCamp(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: '캠프 선택' }).tap();
    await expect(page.locator('#deploy')).toBeEnabled({ timeout: 500 });
  }).toPass();
  await page.locator('#deploy').tap();
  await expect(page.locator('#touch-controls')).toBeVisible({ timeout: 8000 });
}

// 그 버튼의 가운데를 누르면 그 버튼이 받는지 본다.
const onTop = (page: Page, selector: string) => page.evaluate(selector => {
  const button = document.querySelector(selector)!;
  const area = button.getBoundingClientRect();
  const hit = document.elementFromPoint(area.left + area.width / 2, area.top + area.height / 2);
  return hit !== null && button.contains(hit);
}, selector);

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
    // 터치 화면에서는 숨은 기술 막대를 만들지 않는다. 보이는 기술 버튼만 갱신한다.
    await expect(page.locator('#skill-bar .skill-slot')).toHaveCount(0);

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
    await expect(skillButton).toHaveClass(/\bactive\b/);
    const casting = me.player!;
    await expect.poll(() => me.player?.x).toBeLessThan(casting.x - 15);
    // 기술 버튼의 손가락만 뗀다. 조이스틱을 민 손가락은 그대로라 대원은 계속 걷는다.
    await fingers.up(1);
    await expect(skillButton).not.toHaveClass(/\bheld\b/);
    await expect(page.locator('#touch-base')).toBeVisible();
    const released = me.player!;
    await expect.poll(() => me.player?.x).toBeLessThan(released.x - 15);
    await fingers.up(0);
    await expect(page.locator('#touch-base')).toBeHidden();
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

type Box = { left: number; top: number; right: number; bottom: number } | null;
// 두 상자가 겹치지 않는다. 숨은 요소(null)는 겹치지 않는 것으로 본다.
const apart = (a: Box, b: Box) => !a || !b || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

test('the top row, notices and deploy buttons stay on screen and apart on short and narrow phones', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  // 지도 위쪽 줄(메뉴 버튼·체력과 마나·경과 시간)과 알림, 기술 버튼의 자리다. 숨은 요소는 null이다.
  // 알림은 글이 몇 줄로 그려졌는지도 센다. 폭이 모자라면 짧은 알림도 여러 줄로 꺾인다.
  const layout = () => page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    const line = document.querySelector('#toast div');
    const range = document.createRange();
    if (line) range.selectNodeContents(line);
    return {
      parts: { menu: box('.touch-top'), hud: box('#combat-hud'), timers: box('.map-top'), toast: box('#toast') },
      skills: [1, 2, 3, 4].map(slot => box(`.touch-skill[data-slot="${slot}"]`)),
      stick: box('#touch-move'),
      noticeLines: line ? range.getClientRects().length : 0,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  const menu = page.getByRole('button', { name: '☰ 메뉴' });
  // 초대 코드를 복사해 알림을 띄운다. 복사 버튼은 옆 패널(☰ 메뉴) 안에 있다.
  // 패널은 위쪽 줄과 알림 아래에서 시작한다. 체력과 마나, 알림이 패널 머리와 초대 코드 버튼을 덮지 않는다.
  const showNotice = async (name: string) => {
    await menu.tap();
    await page.getByRole('button', { name: /초대 코드/ }).tap();
    await expect(page.locator('#toast')).toContainText('초대 코드');
    const gap = () => page.evaluate(() => document.querySelector('.sidebar')!.getBoundingClientRect().top - document.querySelector('.top-stack')!.getBoundingClientRect().bottom);
    await expect.poll(gap, name).toBeGreaterThanOrEqual(0);
    await menu.tap();
  };
  // 위쪽 줄의 요소와 알림, 기술 버튼, 조이스틱 자리가 서로 겹치지 않고 화면 안에 있다. 알림은 한두 줄로 읽힌다.
  const expectApart = async (name: string) => {
    const at = await layout();
    const parts = Object.entries(at.parts);
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) expect(apart(parts[i][1], parts[j][1]), `${name}: ${parts[i][0]}·${parts[j][0]}`).toBe(true);
    }
    at.skills.forEach((skill, index) => {
      expect(apart(skill, at.parts.toast), `${name}: 기술 ${index + 1}·알림`).toBe(true);
      expect(apart(skill, at.parts.hud), `${name}: 기술 ${index + 1}·체력과 마나`).toBe(true);
      // 조이스틱을 시작하는 자리는 기술 버튼 밑으로 들어가지 않는다.
      expect(apart(skill, at.stick), `${name}: 기술 ${index + 1}·조이스틱 자리`).toBe(true);
    });
    for (const [part, area] of [...parts, ...at.skills.map((skill, index) => [`기술 ${index + 1}`, skill] as const)]) {
      expect(area, `${name}: ${part}`).not.toBeNull();
      expect(area!.left >= 0 && area!.top >= 0 && area!.right <= at.viewport.width && area!.bottom <= at.viewport.height, `${name}: ${part} 화면 안`).toBe(true);
    }
    expect(at.noticeLines, `${name}: 알림 줄 수`).toBeGreaterThan(0);
    expect(at.noticeLines, `${name}: 알림 줄 수`).toBeLessThanOrEqual(2);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await leaveFullscreen(page);
    // 투입 안내의 버튼은 좁은 세로 화면과 낮은 가로 화면에서도 화면 안에 있다. 자리가 모자라면 글 아래 줄로 내려간다.
    for (const size of [{ width: 360, height: 740 }, { width: 320, height: 568 }, { width: 568, height: 320 }, { width: 802, height: 293 }]) {
      await page.setViewportSize(size);
      for (const button of ['#camp', '#deploy']) await expect(page.locator(button), `${size.width}x${size.height} ${button}`).toBeInViewport({ ratio: 1 });
    }
    await page.setViewportSize(phone.viewport);
    await page.getByRole('button', { name: '캠프 선택' }).tap();
    await page.locator('#deploy').tap();
    await expect(page.locator('#touch-controls')).toBeVisible({ timeout: 8000 });
    // 전체 화면을 다시 켠다. 휴대폰에서 싸울 때의 모습이며, 버튼 글이 "전체 화면 끄기"로 길어져 메뉴 버튼 줄이 넓어진다.
    await page.locator('#touch-full').tap();
    await expect(page.locator('#touch-full')).toHaveText('전체 화면 끄기');
    await showNotice('844x390 전체 화면');
    await expectApart('844x390 전체 화면');
    await page.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : undefined);
    for (const size of [{ width: 802, height: 293 }, { width: 568, height: 320 }, { width: 390, height: 664 }, { width: 360, height: 740 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(size);
      await showNotice(`${size.width}x${size.height}`);
      await expectApart(`${size.width}x${size.height}`);
    }
    await page.screenshot({ path: 'test-results/argus-touch-narrow.png' });
  } finally { await context.close(); }
});

test('the end-of-mission card fits a short phone screen below the menu buttons', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  // 작전을 실제로 끝내려면 오래 걸리므로, 서버가 보낸 스냅샷을 작전 종료로 바꿔 화면에 넘긴다. 화면이 그리는 것만 본다.
  let ending = false;
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    server.onMessage(message => {
      if (ending && typeof message === 'string') {
        const data = JSON.parse(message);
        // 작전이 끝나는 순간의 안내도 함께 보낸다.
        if (data.type === 'snapshot') message = JSON.stringify({ ...data, phase: 'ended', result: 'failure', notices: [...data.notices, { id: 9999, at: data.now, text: '대원 사망 · 증원 위치를 선택하세요' }, { id: 10000, at: data.now, text: '전원 사망 · 작전 실패' }] });
      }
      ws.send(message);
    });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await leaveFullscreen(page);
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await expect(page.locator('body')).toHaveClass(/\bmenu-open\b/);
    ending = true;
    const again = page.getByRole('button', { name: '다음 작전 준비' });
    await expect(again).toBeVisible();
    // 서랍을 연 채 작전이 끝나도 서랍이 다음 작전 버튼을 덮지 않는다.
    await expect(page.locator('body')).not.toHaveClass(/\bmenu-open\b/);
    // 높이 320px 휴대폰 가로 화면에서도 카드 전체가 화면 안에 있다. 위쪽 메뉴 버튼 줄은 카드를 덮지 않고,
    // 다음 작전 버튼의 가운데를 누르면 그 버튼이 받는다.
    for (const size of [phone.viewport, { width: 740, height: 320 }, { width: 568, height: 320 }]) {
      const name = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      await expect(page.locator('.result-card'), name).toBeInViewport({ ratio: 1 });
      const layout = await page.evaluate(() => {
        const card = document.querySelector('.result-card')!.getBoundingClientRect();
        const menu = document.querySelector('.touch-top')!.getBoundingClientRect();
        const button = document.getElementById('again')!;
        const area = button.getBoundingClientRect();
        const hit = document.elementFromPoint(area.left + area.width / 2, area.top + area.height / 2);
        const menuOverCard = menu.right > card.left && menu.left < card.right && menu.bottom > card.top && menu.top < card.bottom;
        return { menuOverCard, buttonOnTop: hit !== null && button.contains(hit) };
      });
      expect(layout, name).toEqual({ menuOverCard: false, buttonOnTop: true });
      // 작전이 끝날 때의 알림은 카드를 가리지 않는다. 같은 말이 카드에 적혀 있다.
      await expect(page.locator('#toast'), name).toBeHidden();
    }
    await page.screenshot({ path: 'test-results/argus-touch-result.png' });
    await again.tap();
    await expect(page.getByRole('button', { name: '새 작전 시작' })).toBeInViewport();
  } finally { await context.close(); }
});

test('a new operation fills the screen after the phone turned in the lobby', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  // 아이폰처럼 전체 화면이 없는 경우다. 전체 화면이 켜지면 창 크기가 바뀌어 이 장면이 가려진다.
  await page.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }));
  const canvasSize = () => page.evaluate(() => {
    // 캔버스는 작전 화면이 보인 뒤에 만들어진다.
    const area = document.querySelector('canvas')?.getBoundingClientRect();
    return { width: area?.width, height: area?.height };
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await expect.poll(canvasSize).toEqual({ width: 844, height: 390 });
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await page.getByRole('button', { name: '작전에서 나가기 ↗' }).tap();
    await expect(page.getByRole('button', { name: '새 작전 시작' })).toBeVisible();
    // 작전 화면이 숨어 있는 로비에서 화면을 돌린다. 다음 작전의 지도는 돌린 화면에 맞아야 한다.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await expect.poll(canvasSize).toEqual({ width: 390, height: 844 });
  } finally { await context.close(); }
});

test('fingers that stay on the joystick and skill buttons keep working through lost focus and a reconnect', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const last = () => wire.inputs.at(-1);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await deployAtCamp(page);
    const fingers = new Fingers(await context.newCDPSession(page));
    const stick = (await page.locator('#touch-move').boundingBox())!;
    const center = { x: stick.x + stick.width * .45, y: stick.y + stick.height * .6 };
    const skillButton = page.locator('.touch-skill[data-slot="1"]');
    const button = (await skillButton.boundingBox())!;
    const onButton = { x: button.x + button.width / 2, y: button.y + button.height / 2 };

    // 왼쪽으로 민 엄지를 움직이지 않고 그대로 둔다. 다른 손가락은 기술 버튼을 쥐고 있다.
    await fingers.down(0, center.x, center.y);
    await fingers.move(0, center.x - 50, center.y);
    await fingers.down(1, onButton.x, onButton.y);
    await expect.poll(() => last()?.moveX).toBe(-1);
    await expect.poll(() => last()?.slot).toBe(1);

    // 창이 초점을 잃었다가 돌아와도 손가락은 그대로다. 곧바로 다시 걷고 기술을 쥐고 있다.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(150);
    expect(last()).toMatchObject({ moveX: -1, slot: 1 });
    await expect(page.locator('#touch-base')).toBeVisible();
    await expect(skillButton).toHaveClass(/\bheld\b/);

    // 연결이 끊겼다가 다시 이어져도 같다.
    const beforeDrop = wire.inputs.length;
    wire.drop();
    await expect(page.locator('#connection')).toContainText('재접속 중');
    await expect.poll(() => wire.inputs.length, { timeout: 8000 }).toBeGreaterThan(beforeDrop + 3);
    expect(last()).toMatchObject({ moveX: -1, slot: 1 });
    await expect(page.locator('#touch-base')).toBeVisible();

    // 뗄 때는 곧바로 멈춘다.
    await fingers.up(1);
    await expect.poll(() => last()?.slot).toBe(0);
    await fingers.up(0);
    await expect.poll(() => last()?.moveX).toBe(0);
    await expect(page.locator('#touch-base')).toBeHidden();

    // 한 기술 버튼을 두 손가락으로 누르다 하나를 떼도, 남은 손가락이 쥐고 있으면 기술을 쥐고 있는 것이다.
    await fingers.down(1, onButton.x, onButton.y);
    await fingers.down(2, onButton.x + 12, onButton.y);
    await expect.poll(() => last()?.slot).toBe(1);
    await fingers.up(2);
    await page.waitForTimeout(150);
    expect(last()?.slot).toBe(1);
    await expect(skillButton).toHaveClass(/\bheld\b/);
    await fingers.up(1);
    await expect.poll(() => last()?.slot).toBe(0);
    await expect(skillButton).not.toHaveClass(/\bheld\b/);

    // 잡아 둔 포인터를 놓치면 조이스틱을 비운다. 비우지 않으면 다음 손가락의 누름을 받지 못해 걸을 수 없다.
    await page.evaluate(() => {
      const area = document.getElementById('touch-move')!;
      area.addEventListener('pointerdown', event => { area.dataset.pointer = String(event.pointerId); });
    });
    await fingers.down(0, center.x, center.y);
    await expect(page.locator('#touch-base')).toBeVisible();
    await page.evaluate(() => {
      const area = document.getElementById('touch-move')!;
      area.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: Number(area.dataset.pointer) }));
    });
    await expect(page.locator('#touch-base')).toBeHidden();
    await fingers.up(0);
    await fingers.down(0, center.x, center.y);
    await fingers.move(0, center.x - 50, center.y);
    await expect.poll(() => last()?.moveX).toBe(-1);
    await fingers.up(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('a skill button pressed between two operations does not cast in the next one', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await deployAtCamp(page);
    // 조이스틱과 기술 버튼을 쥔 채 나가도 손가락 상태가 다음 작전으로 넘어가지 않는다.
    const fingers = new Fingers(await context.newCDPSession(page));
    const stick = (await page.locator('#touch-move').boundingBox())!;
    const button = (await page.locator('.touch-skill[data-slot="1"]').boundingBox())!;
    await fingers.down(0, stick.x + stick.width * .45, stick.y + stick.height * .6);
    await fingers.down(1, button.x + button.width / 2, button.y + button.height / 2);
    await expect(page.locator('#touch-base')).toBeVisible();
    await expect(page.locator('.touch-skill.held')).toHaveCount(1);
    await page.evaluate(() => document.getElementById('leave')!.click());
    await expect(page.getByRole('button', { name: '새 작전 시작' })).toBeVisible();
    expect(await page.evaluate(() => ({ base: document.getElementById('touch-base')!.hidden, held: document.querySelectorAll('.touch-skill.held').length }))).toEqual({ base: true, held: 0 });
    await fingers.up(1);
    await fingers.up(0);
    // 새 방의 첫 스냅샷이 오기 전이다. 지난 작전의 기술 버튼이 남아 있지 않다.
    wire.holding = true;
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#operation')).toBeVisible();
    await expect(page.locator('#touch-controls')).toBeHidden();
    // 그래도 버튼에 누름이 닿으면 키보드·마우스처럼 살아 있을 때의 누름만 받는다.
    await page.evaluate(() => {
      const button = document.querySelector('.touch-skill[data-slot="1"]')!;
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77 }));
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77 }));
    });
    wire.release();
    const mark = wire.inputs.length;
    await deployAtCamp(page);
    await expect.poll(() => wire.inputs.length).toBeGreaterThan(mark + 3);
    expect(wire.inputs.slice(mark).filter(input => input.press > 0 || input.slot > 0)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('on a touch screen a pen is like a finger: the map casts nothing and the aim stays', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await deployAtCamp(page);
    await expect.poll(() => wire.inputs.length).toBeGreaterThan(0);
    const aim = wire.inputs.at(-1)!.aim;
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const pen = (type: string, button: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: 5, button, buttons, clientX: 600, clientY: 120 }));
      pen('pointerdown', 0, 1);
      pen('pointermove', -1, 1);
      pen('pointerup', 0, 0);
    });
    const mark = wire.inputs.length;
    await expect.poll(() => wire.inputs.length).toBeGreaterThan(mark + 3);
    expect(wire.inputs.filter(input => input.press > 0 || input.slot > 0)).toEqual([]);
    expect(wire.inputs.at(-1)!.aim).toBe(aim);
  } finally { await context.close(); }
});

test('the touch operation screen stays the same across the widths of the PC rules', async ({ browser }) => {
  const context = await browser.newContext({ ...phone, viewport: { width: 1200, height: 360 } });
  const page = await context.newPage();
  // 보이는 요소의 계산된 값이다. 자리를 나타내는 값(left 등)은 폭에 따라 달라지므로 보지 않는다.
  const styles = () => page.evaluate(() => {
    const names = ['display', 'flexGrow', 'flexBasis', 'justifyContent', 'columnGap', 'fontSize', 'paddingTop', 'paddingLeft', 'minWidth'] as const;
    const shown = [...document.querySelectorAll('#operation, #operation *')].filter(element => element.tagName !== 'CANVAS' && element.getClientRects().length > 0);
    return shown.map(element => {
      const style = getComputedStyle(element);
      return `${element.tagName}#${element.id}.${element.classList[0] ?? ''} ${names.map(name => style[name]).join(' ')}`;
    });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await leaveFullscreen(page);
    await expect(page.locator('#deploy')).toBeVisible();
    const compare = async (name: string) => {
      for (const [wide, narrow] of [[1101, 1100], [761, 760]]) {
        await page.setViewportSize({ width: wide, height: 360 });
        const before = await styles();
        await page.setViewportSize({ width: narrow, height: 360 });
        expect(await styles(), `${name} ${wide}→${narrow}`).toEqual(before);
      }
    };
    await compare('투입 대기');
    await deployAtCamp(page);
    await expect(page.locator('#toast')).toBeHidden();
    await compare('작전');
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await compare('서랍');
  } finally { await context.close(); }
});

test('the page leaves no room for the phone to zoom, reload or go back in the middle of an operation', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const fontSize = (selector: string) => page.evaluate(selector => getComputedStyle(document.querySelector(selector)!).fontSize, selector);
  const overscroll = (selector: string) => page.evaluate(selector => getComputedStyle(document.querySelector(selector)!).overscrollBehaviorY, selector);
  try {
    await page.goto('/');
    // 아이폰 Safari는 글자가 16px보다 작은 입력란에 초점이 가면 화면을 확대하고 되돌리지 않는다.
    expect(await fontSize('#callsign')).toBe('16px');
    expect(await fontSize('#room-input')).toBe('16px');
    expect(await fontSize('#report-text')).toBe('16px');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await deployAtCamp(page);
    // 당겨서 새로고침은 뷰포트의 값을 따르고 Chromium은 이 값을 html에서만 읽는다. 서랍과 결과 화면의 스크롤이 페이지로 넘치지 않아야 한다.
    expect(await overscroll('html')).toBe('none');
    expect(await overscroll('.sidebar')).toBe('contain');
    expect(await overscroll('.result-overlay')).toBe('contain');
    // 왼쪽 끝은 OS의 뒤로 가기 제스처 자리다. 조이스틱 자리는 그 안쪽에서 시작한다.
    const stick = (await page.locator('#touch-move').boundingBox())!;
    expect(stick.x).toBeGreaterThanOrEqual(24);
  } finally { await context.close(); }
});

test('on a PC screen a finger still aims and casts like the mouse', async ({ page }) => {
  const wire = await relay(page);
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#room-code')).not.toHaveText('------');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect(page.locator('#combat-hud')).toBeVisible({ timeout: 8000 });
  await expect.poll(() => wire.inputs.length).toBeGreaterThan(0);
  // PC 화면에서는 숨은 터치 기술 버튼을 채우지 않는다. 보이는 기술 막대만 갱신한다.
  await expect(page.locator('#skill-bar .skill-slot')).toHaveCount(4);
  await expect(page.locator('.touch-skill b').first()).toHaveText('');
  const before = wire.inputs.at(-1)!.aim;
  const finger = (type: string, button: number, buttons: number) => page.evaluate(([type, button, buttons]) => {
    document.querySelector('canvas')!.dispatchEvent(new PointerEvent(type as string, { bubbles: true, pointerType: 'touch', pointerId: 5, button: button as number, buttons: buttons as number, clientX: 300, clientY: 150 }));
  }, [type, button, buttons]);
  // 터치스크린 노트북의 PC 화면에는 터치 조작이 없다. 손가락이 마우스 구실을 하지 않으면 공격할 길이 없다.
  await finger('pointerdown', 0, 1);
  await expect.poll(() => wire.inputs.filter(input => input.press === 1).length).toBe(1);
  await expect.poll(() => wire.inputs.at(-1)?.aim).not.toBe(before);
  expect(wire.inputs.at(-1)!.slot).toBe(1);
  await finger('pointerup', 0, 0);
  await expect.poll(() => wire.inputs.at(-1)?.slot).toBe(0);
  // 손가락을 끌면 브라우저가 화면 밀기로 받아 pointerup 대신 pointercancel을 보낸다. 이때도 뗀 것이다.
  await finger('pointerdown', 0, 1);
  await expect.poll(() => wire.inputs.at(-1)?.slot).toBe(1);
  await finger('pointercancel', 0, 0);
  await expect.poll(() => wire.inputs.at(-1)?.slot).toBe(0);
});

test('the drawer closes when the player falls, so it does not cover the deploy buttons', async ({ browser }) => {
  const context = await browser.newContext({ ...phone, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const wire = await relay(page);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await deployAtCamp(page);
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await expect(page.locator('body')).toHaveClass(/\bmenu-open\b/);
    // 서버가 대원이 쓰러졌다고 알린다.
    wire.change = data => ({ ...data, players: data.players.map(p => p.id === data.you ? { ...p, state: 'waiting', hasDeployed: true } : p) });
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/\bmenu-open\b/);
    expect(await onTop(page, '#camp')).toBe(true);
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
