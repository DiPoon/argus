import { readFileSync } from 'node:fs';
import { test, expect, type CDPSession, type Page } from '@playwright/test';
import type { Player, Snapshot } from '../src/types';
import { quietRoom } from './rooms';

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
    inputs: [] as { held: number[]; pressed: number[]; aim: number; moveX: number; moveY: number }[],
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
// 그 자리를 누르면 지도 캔버스가 받는지다. 작전 화면에는 미니맵 캔버스도 있으므로 #canvas-host 안의 캔버스인지 본다.
const canvasAt = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => document.elementFromPoint(x, y) === document.querySelector('#canvas-host canvas'), [x, y]);

// 로비의 장비 칸 선택지다. 칸 이름마다 고를 수 있는 기술 id를 차례대로 모은다.
const lobbyChoices = (page: Page) => page.evaluate(() => Object.fromEntries(['slot-1', 'slot-2', 'slot-3', 'free-slot'].map(name =>
  [name, [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map(input => input.value)])));

test('a phone picks only around skills in a one-screen lobby and fights with the joystick and skill buttons', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const me = observe(page);
  try {
    await page.goto(quietRoom);
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
    // 터치 화면에서는 숨은 기술 막대를 채우지 않는다. 보이는 기술 버튼만 갱신한다. 막대의 칸은 터치 버튼처럼 처음부터 있다.
    await expect(page.locator('#skill-bar .skill-slot .name')).toHaveText(['', '', '', '']);
    await expect(page.locator('#skill-bar svg.rps')).toHaveCount(0);

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
    // 버튼을 누르고 있는 동안에는 기운이 이어진다. 서버는 기운을 잇는 중(held)이라고 알리고, 늦어도 장판이 나가는 시각을
    // 최대 기운 시간(시작 1초 뒤)으로 알린다. 기술 버튼은 지금 단계를 적는다. 짧게 눌렀다면 장판은 시작 0.18초 뒤에 나간다.
    const aura = me.player!.actions.at(-1)!;
    expect(aura.phase).toBe('aura');
    expect(aura.held).toBe(true);
    expect(aura.holdUntil! - aura.startedAt).toBeCloseTo(1, 1);
    await expect(skillButton.locator('small')).toHaveText('기운');
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
    // 버튼을 뗀 뒤에 기술이 더 나가지 않는다. 뗀 입력이 서버에 닿은 뒤의 마나를 기준으로 본다.
    // 기술은 누를 때 한 번만 시전하므로 버튼이 눌린 채 남았는지는 마나로 알 수 없다. 그것은 아래의 검사가 보낸 입력의 held로 본다.
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
  let nextNotice = 9000;
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    server.onMessage(message => {
      if (ending && typeof message === 'string') {
        const data = JSON.parse(message);
        // 작전이 끝날 때의 안내도 함께 보낸다. 알림이 3.5초 뒤 저절로 사라져 검사가 통과하지 않게 스냅샷마다 새 안내를 보내 계속 띄운다.
        if (data.type === 'snapshot') message = JSON.stringify({ ...data, phase: 'ended', result: 'failure', notices: [...data.notices, { id: nextNotice++, at: data.now, text: '전원 사망 · 작전 실패' }] });
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
      // 작전 종료 카드에 작전 시간과 보급품 회수가 있으므로 임무 진행은 숨긴다.
      await expect(page.locator('#touch-mission'), name).toBeHidden();
      await expect(page.locator('#touch-extract'), name).toBeHidden();
      // 작전이 끝날 때의 알림은 카드를 가리지 않는다. 같은 말이 카드에 적혀 있다. 알림은 살아 있는데 보이지만 않는다.
      await expect(page.locator('#toast div').first(), name).toBeAttached();
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
    const area = document.querySelector('#canvas-host canvas')?.getBoundingClientRect();
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
    await page.goto(quietRoom);
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
    await expect.poll(() => last()?.held).toEqual([1]);

    // 창이 초점을 잃었다가 돌아와도 손가락은 그대로다. 곧바로 다시 걷고 기술을 쥐고 있다.
    // 초점을 잃을 때 보내는 멈춤 입력에도 누르고 있는 버튼이 실린다. 빈 것으로 보내면 서버가 그 버튼을 놓은 것으로 적어,
    // 손가락으로 잇던 기운이 그 입력 하나에 끝난다.
    const blurred = wire.inputs.length;
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(150);
    expect(wire.inputs.length).toBeGreaterThan(blurred + 2);
    expect(wire.inputs.slice(blurred).filter(input => !input.held.includes(1))).toEqual([]);
    expect(last()).toMatchObject({ moveX: -1, held: [1] });
    await expect(page.locator('#touch-base')).toBeVisible();
    await expect(skillButton).toHaveClass(/\bheld\b/);

    // 연결이 끊겼다가 다시 이어져도 같다.
    const beforeDrop = wire.inputs.length;
    wire.drop();
    await expect(page.locator('#connection')).toContainText('재접속 중');
    await expect.poll(() => wire.inputs.length, { timeout: 8000 }).toBeGreaterThan(beforeDrop + 3);
    expect(last()).toMatchObject({ moveX: -1, held: [1] });
    await expect(page.locator('#touch-base')).toBeVisible();

    // 뗄 때는 곧바로 멈춘다.
    await fingers.up(1);
    await expect.poll(() => last()?.held).toEqual([]);
    await fingers.up(0);
    await expect.poll(() => last()?.moveX).toBe(0);
    await expect(page.locator('#touch-base')).toBeHidden();

    // 한 기술 버튼을 두 손가락으로 누르다 하나를 떼도, 남은 손가락이 쥐고 있으면 기술을 쥐고 있는 것이다.
    await fingers.down(1, onButton.x, onButton.y);
    await fingers.down(2, onButton.x + 12, onButton.y);
    await expect.poll(() => last()?.held).toEqual([1]);
    await fingers.up(2);
    await page.waitForTimeout(150);
    expect(last()?.held).toEqual([1]);
    await expect(skillButton).toHaveClass(/\bheld\b/);
    await fingers.up(1);
    await expect.poll(() => last()?.held).toEqual([]);
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
    await page.goto(quietRoom);
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
    expect(wire.inputs.slice(mark).filter(input => input.pressed.length > 0 || input.held.length > 0)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('on a touch screen a pen is like a finger: the map casts nothing and the aim stays', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  try {
    await page.goto(quietRoom);
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await deployAtCamp(page);
    await expect.poll(() => wire.inputs.length).toBeGreaterThan(0);
    const aim = wire.inputs.at(-1)!.aim;
    await page.evaluate(() => {
      const canvas = document.querySelector('#canvas-host canvas')!;
      const pen = (type: string, button: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: 5, button, buttons, clientX: 600, clientY: 120 }));
      pen('pointerdown', 0, 1);
      pen('pointermove', -1, 1);
      pen('pointerup', 0, 0);
    });
    const mark = wire.inputs.length;
    await expect.poll(() => wire.inputs.length).toBeGreaterThan(mark + 3);
    expect(wire.inputs.filter(input => input.pressed.length > 0 || input.held.length > 0)).toEqual([]);
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
    // PC의 좁은 화면 규칙이 바뀌는 폭이다(style.css의 max-width 1100·760·440·360px). 기술 막대의 규칙(440·360)도 터치 화면에 새지 않는다.
    const compare = async (name: string) => {
      for (const [wide, narrow] of [[1101, 1100], [761, 760], [441, 440], [361, 360]]) {
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
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#room-code')).not.toHaveText('------');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect(page.locator('#combat-hud')).toBeVisible({ timeout: 8000 });
  await expect.poll(() => wire.inputs.length).toBeGreaterThan(0);
  // PC 화면에서는 숨은 터치 기술 버튼을 채우지 않는다. 보이는 기술 막대만 갱신한다. 기본 장비는 타격·받아치기·잡기·자유(타격)다.
  await expect(page.locator('#skill-bar .skill-slot .name')).toHaveText(['근접 타격', '받아치기', '잡기', '근접 타격']);
  await expect(page.locator('.touch-skill b').first()).toHaveText('');
  const before = wire.inputs.at(-1)!.aim;
  const finger = (type: string, button: number, buttons: number) => page.evaluate(([type, button, buttons]) => {
    document.querySelector('#canvas-host canvas')!.dispatchEvent(new PointerEvent(type as string, { bubbles: true, pointerType: 'touch', pointerId: 5, button: button as number, buttons: buttons as number, clientX: 300, clientY: 150 }));
  }, [type, button, buttons]);
  // 터치스크린 노트북의 PC 화면에는 터치 조작이 없다. 손가락이 마우스 구실을 하지 않으면 공격할 길이 없다.
  await finger('pointerdown', 0, 1);
  await expect.poll(() => wire.inputs.filter(input => input.pressed.includes(1)).length).toBe(1);
  await expect.poll(() => wire.inputs.at(-1)?.aim).not.toBe(before);
  expect(wire.inputs.at(-1)!.held).toEqual([1]);
  await finger('pointerup', 0, 0);
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([]);
  // 손가락을 끌면 브라우저가 화면 밀기로 받아 pointerup 대신 pointercancel을 보낸다. 이때도 뗀 것이다.
  await finger('pointerdown', 0, 1);
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([1]);
  await finger('pointercancel', 0, 0);
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([]);
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

// 임무 진행을 바꾼 스냅샷을 만든다. 시설은 부순 수만큼 체력 0, 부목표 보급품은 모은 수만큼 회수한 것으로 둔다.
// 탈출 지점은 extraction이 있으면 분대가 본 것이다.
function mission(data: Snapshot, destroyed: number, collected: number, extraction: Snapshot['extraction']): Snapshot {
  const facilities = [1, 2, 3].map(id => ({ id, x: 100 * id, y: 100, hp: id <= destroyed ? 0 : 5, maxHp: 5 }));
  const objectives = [1, 2].map(id => ({ id: 900 + id, x: 200, y: 100 * id, kind: 'objective' as const, objective: true, collected: id <= collected, uses: id <= collected ? 0 : 1, cooldown: 0 }));
  return { ...data, facilities, supplies: [...data.supplies.filter(supply => !supply.objective), ...objectives], extraction };
}

test('the mission progress shows on the map while the side panel is hidden, and the extraction only after the facilities fall', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  // 터치 화면은 시설·보급품을 메뉴 버튼 아래에, 탈출을 경과 시간 아래에 나눠 둔다.
  const objectives = page.locator('#touch-mission .mission-item');
  const extraction = page.locator('#touch-extract .mission-item');
  const found = { x: 900, y: 900, progress: 0, duration: 20, unlocked: false };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await leaveFullscreen(page);
    // 휴대폰은 옆 패널이 서랍에 숨어 있으므로 위쪽 줄에 임무 진행을 보인다. 처음에는 시설과 보급품뿐이다.
    // 숨은 요소도 글자는 그대로이므로 보이는지 함께 본다.
    await expect(objectives).toHaveText(['시설 0/3', '보급품 0/2']);
    await expect(page.locator('#touch-mission')).toBeVisible();
    await expect(page.locator('#touch-extract')).toBeHidden();
    // 시설을 다 부수기 전에는 탈출 지점을 찾았어도 보이지 않는다. 주목표를 이루기 전에는 찾았는지가 쓸모없다(2026-11-08 사용자).
    wire.change = data => mission(data, 2, 1, found);
    await expect(objectives).toHaveText(['시설 2/3', '보급품 1/2']);
    await expect(page.locator('#touch-extract')).toBeHidden();
    // 시설을 다 부쉈는데 아직 탈출 지점을 찾지 못했으면 찾으라고 알린다.
    wire.change = data => mission(data, 3, 1, null);
    await expect(objectives).toHaveText(['시설 3/3', '보급품 1/2']);
    await expect(extraction).toHaveText(['탈출 지점 찾기']);
    await expect(page.locator('#touch-extract')).toBeVisible();
    // 찾은 뒤에는 확보한 시간을 보인다. 이룬 항목은 표시가 바뀐다.
    wire.change = data => mission(data, 3, 2, { ...found, progress: 17.4, unlocked: true });
    await expect(objectives).toHaveText(['시설 3/3', '보급품 2/2']);
    await expect(extraction).toHaveText(['탈출 17/20초']);
    await expect(objectives.nth(0)).toHaveClass(/\bdone\b/);
    await expect(objectives.nth(1)).toHaveClass(/\bdone\b/);
    await expect(extraction).not.toHaveClass(/\bdone\b/);
  } finally { await context.close(); }
});

test('once the extraction is seen the small progress follows what the server says about it, with the same seconds as the side panel', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  const extraction = page.locator('#touch-extract .mission-item');
  const found = { x: 900, y: 900, progress: 0, duration: 20, unlocked: false };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    // 탈출 지점이 보이면 서버가 보낸 unlocked(주목표 완료)를 따른다. 옆 패널도 이 값을 쓴다.
    // 화면이 센 부순 시설 수가 서버와 다르면 서버가 맞다.
    wire.change = data => mission(data, 3, 1, found);
    await expect(page.locator('#touch-mission .mission-item')).toHaveText(['시설 3/3', '보급품 1/2']);
    await expect(page.locator('#extract-note')).toHaveText('주목표 완료 후 활성화');
    await expect(page.locator('#touch-extract')).toBeHidden();
    wire.change = data => mission(data, 2, 1, { ...found, progress: 3.2, unlocked: true });
    await expect(page.locator('#touch-mission .mission-item')).toHaveText(['시설 2/3', '보급품 1/2']);
    await expect(extraction).toHaveText(['탈출 3/20초']);
    // 확보한 시간은 옆 패널과 같은 값이다. 둘 다 정수로 내린다. 예전에는 19.97초가 작은 표시에서 19초, 옆 패널에서 20.0초였다.
    wire.change = data => mission(data, 3, 2, { ...found, progress: 19.97, unlocked: true });
    await expect(extraction).toHaveText(['탈출 19/20초']);
    await expect(page.locator('#extract-note')).toHaveText('구역 안에서 20초 확보 · 19초');
  } finally { await context.close(); }
});

test('the small progress keeps its elements while the snapshots bring the same progress', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  let snapshots = 0;
  wire.change = data => { snapshots++; return mission(data, 3, 1, { x: 900, y: 900, progress: 17.4, duration: 20, unlocked: true }); };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#touch-extract .mission-item')).toHaveText(['탈출 17/20초']);
    // 내용이 같으면 다시 쓰지 않는다. 스냅샷은 0.1초마다 오고, 다시 쓰면 요소를 지우고 새로 만들어 레이아웃을 다시 계산한다.
    // 지금 요소에 표시를 붙여 두고, 스냅샷이 몇 번 더 지난 뒤에도 같은 요소인지 본다. PC 좁은 창의 상자(#mission-mini)도 함께 본다.
    const items = '#mission-mini .mission-item, #touch-mission .mission-item, #touch-extract .mission-item';
    await page.evaluate(selector => { for (const node of document.querySelectorAll(selector)) Object.assign(node, { kept: true }); }, items);
    const before = snapshots;
    await expect.poll(() => snapshots).toBeGreaterThan(before + 3);
    const kept = await page.evaluate(selector => [...document.querySelectorAll(selector)].map(node => 'kept' in node), items);
    expect(kept).toEqual([true, true, true, true, true, true]);
  } finally { await context.close(); }
});

test('leaving an operation clears the small progress before the next operation sends its first snapshot', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  wire.change = data => mission(data, 3, 2, { x: 900, y: 900, progress: 17.4, duration: 20, unlocked: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#touch-extract .mission-item')).toHaveText(['탈출 17/20초']);
    await page.getByRole('button', { name: '☰ 메뉴' }).tap();
    await page.getByRole('button', { name: /작전에서 나가기/ }).tap();
    await expect(page.locator('#lobby')).toBeVisible();
    // 다음 방의 스냅샷을 붙잡아 둔다. 첫 스냅샷이 오기 전에는 updateUi가 돌지 않으므로, 나갈 때 비우지 않으면 지난 작전의 진행이 남는다.
    wire.change = data => data;
    wire.holding = true;
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#operation')).toBeVisible();
    await expect.poll(() => wire.held.length).toBeGreaterThan(0);
    for (const id of ['#mission-mini', '#touch-mission', '#touch-extract']) await expect(page.locator(id)).toBeEmpty();
    wire.release();
    await expect(page.locator('#touch-mission .mission-item')).toHaveText(['시설 0/3', '보급품 0/2']);
  } finally { await context.close(); }
});

test('the mission progress does not make the top row taller while fighting on a landscape phone, with or without the fullscreen button', async ({ browser }) => {
  // 아이폰 Safari는 전체 화면이 없어 메뉴 버튼 줄이 짧다. 메뉴 아래 상자를 버튼 줄 폭에 맞춰 꺾었을 때 두 줄이 되어 위쪽 줄이 높아졌다.
  for (const fullscreen of [true, false]) {
    const name = fullscreen ? '전체 화면 버튼 있음' : '전체 화면 버튼 없음';
    const context = await browser.newContext(phone);
    const page = await context.newPage();
    if (!fullscreen) await page.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }));
    const wire = await relay(page);
    // 시설을 다 부수고 보급품을 다 모아 두 상자가 가장 넓은 상태다.
    wire.change = data => mission(data, 3, 2, { x: 900, y: 900, progress: 17.4, duration: 20, unlocked: true });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: '새 작전 시작' }).tap();
      await expect(page.locator('#deploy-panel')).toBeVisible();
      if (fullscreen) await leaveFullscreen(page);
      await expect(page.locator('#touch-full'), name).toBeVisible({ visible: fullscreen });
      await deployAtCamp(page);
      // 메뉴 버튼과 그 아래 상자, 경과 시간과 그 아래 탈출 상자가 모두 체력·마나 상자보다 짧다. 숨겼을 때와 같은 순간에 비교한다.
      const growth = () => page.evaluate(() => {
        const bottom = () => document.querySelector('.top-row')!.getBoundingClientRect().bottom;
        const boxes = ['touch-mission', 'touch-extract'].map(id => document.getElementById(id)!);
        const shown = bottom();
        for (const box of boxes) box.style.display = 'none';
        const hidden = bottom();
        for (const box of boxes) box.style.display = '';
        return shown - hidden;
      });
      // 등록된 휴대폰 가운데 가장 좁은 가로 화면(533x320, 2013년 Nokia Lumia 520)은 보지 않는다. CI 실행기의 글꼴(WenQuanYi Zen Hei)에서는
      // 이 PR 전부터 위쪽 줄이 한 줄에 들어가지 않아(버튼 줄 189 + 체력·마나 224 + 경과 시간 100px > 517px), 꺾인 둘째 줄에 탈출 상자만큼
      // 높이가 더해진다. 한글 글꼴로 재는 크기 점검은 그 크기에서도 한 줄이다(검증 기록).
      for (const size of [{ width: 844, height: 390 }, { width: 802, height: 293 }, { width: 568, height: 320 }]) {
        await page.setViewportSize(size);
        await expect(page.locator('#touch-mission .mission-item'), name).toHaveText(['시설 3/3', '보급품 2/2']);
        await expect(page.locator('#touch-extract .mission-item'), name).toHaveText(['탈출 17/20초']);
        // 숨어 있으면 늘어난 높이가 0이라 통과하므로 보이는지 먼저 본다.
        for (const id of ['#touch-mission', '#touch-extract']) await expect(page.locator(id), name).toBeVisible();
        expect(await growth(), `${name} ${size.width}x${size.height}`).toBeLessThan(0.5);
        // 탈출 상자는 경과 시간 상자보다 넓지 않다. 넓으면 오른쪽 묶음이 넓어져 여유가 적은 화면에서 위쪽 줄이 꺾일 수 있다.
        // 단위 "초"를 숫자 안에 넣었을 때는 한글 글꼴에서 1px, CI 실행기의 글꼴에서 2px 넓었다.
        const widths = await page.evaluate(() => ({ timers: document.querySelector('.timers')!.getBoundingClientRect().width, extract: document.getElementById('touch-extract')!.getBoundingClientRect().width }));
        expect(widths.extract, `${name} ${size.width}x${size.height} 탈출 상자 폭`).toBeLessThanOrEqual(widths.timers);
      }
    } finally { await context.close(); }
  }
});

test('gaining mana does not widen the health and mana box: the idle hint is no wider than the out-of-mana hint', async ({ browser }) => {
  // 터치 화면의 체력·마나 상자는 내용만큼 넓고, 그 폭은 아래의 상태 글자가 정한다. 위쪽 줄 높이 검사와 휴대폰 크기 점검은 마나가 없는
  // 상태(투입 직후)로 잰다. 그래서 마나가 있을 때의 대기 문구가 더 넓으면 어디에도 걸리지 않은 채 상자가 넓어진다.
  // 2026-11-13에 대기 문구를 길게 고쳤을 때 한글 글꼴에서 상자가 211px에서 260px이 되어, 533x320 가로 화면의 위쪽 줄이 두 줄로 꺾이고
  // 세로 화면 열여덟 가지에서 한 줄 더 높아졌다. 글자 폭은 글꼴마다 다르므로 정해 둔 값이 아니라 두 문구의 폭을 같은 화면에서 비교한다.
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const wire = await relay(page);
  let mana = 0;
  wire.change = data => {
    const me = data.players.find(p => p.id === data.you);
    if (me) me.mana = mana;
    return data;
  };
  try {
    await page.goto(quietRoom);
    await page.getByRole('button', { name: '새 작전 시작' }).tap();
    await expect(page.locator('#deploy-panel')).toBeVisible();
    await leaveFullscreen(page);
    await deployAtCamp(page);
    const status = page.locator('#combat-status');
    await expect(status).toBeVisible();
    const measure = () => page.evaluate(() => ({
      hud: document.getElementById('combat-hud')!.getBoundingClientRect().width,
      row: document.querySelector('.top-row')!.getBoundingClientRect().height,
      text: document.getElementById('combat-status')!.textContent ?? '',
    }));
    // 넓은 가로 화면, 좁은 가로 화면, 세로 화면이다. 좁은 두 화면은 상자가 넓어지면 위쪽 줄이 한 줄 더 높아지는 크기다.
    for (const size of [{ width: 844, height: 390 }, { width: 568, height: 320 }, { width: 360, height: 640 }]) {
      const where = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      // 마나가 없으면 상태 글자에 empty가 붙는다. 기술을 쓰지 않으므로 마나가 있으면 대기 문구다.
      mana = 0;
      await expect(status, where).toHaveClass(/empty/);
      const empty = await measure();
      mana = 3;
      await expect(status, where).not.toHaveClass(/empty/);
      const idle = await measure();
      expect(idle.text, where).not.toBe(empty.text);
      expect(idle.text, where).not.toMatch(/초$/);
      expect(idle.hud, `${where} 체력·마나 상자 폭`).toBeLessThanOrEqual(empty.hud);
      expect(idle.row, `${where} 위쪽 줄 높이`).toBeLessThanOrEqual(empty.row + 0.5);
    }
  } finally { await context.close(); }
});

test('a PC screen shows the mission progress on the map only when its window is too narrow for the side panel', async ({ page }) => {
  const wire = await relay(page);
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#room-code')).not.toHaveText('------');
  // 넓은 화면은 옆 패널의 MISSION에 같은 정보가 있어 지도 위에 되풀이하지 않는다.
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#mission-mini')).toBeHidden();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator('.sidebar')).toBeHidden();
  // 좁은 창은 경과 시간 옆에 한 줄로 둔다. 탈출은 터치 화면처럼 시설을 다 부순 뒤에만 그 끝에 붙는다.
  const items = page.locator('#mission-mini .mission-item');
  await expect(page.locator('#mission-mini')).toBeVisible();
  await expect(items).toHaveText(['시설 0/3', '보급품 0/2']);
  wire.change = data => mission(data, 3, 0, null);
  await expect(items).toHaveText(['시설 3/3', '보급품 0/2', '탈출 지점 찾기']);
  await expect(page.locator('#touch-extract')).toBeHidden();
  // 화면을 크게 확대한 창은 CSS 폭이 아주 좁다(760px 창을 200%로 보면 380px). 그래도 항목이 화면 밖으로 나가지 않는다.
  // 자리가 모자라면 상자 안에서 줄을 바꾸고, 알림은 상자 아래로 내려간다. 알림은 스냅샷마다 새 안내를 보내 띄워 둔다.
  // 이 검사 브라우저는 한글을 좁게 그려, 한글 글꼴로는 넘치는 320px에서도 상자가 들어가고 두 줄이면 알림과 겹치지 않는다.
  // 그래서 세 줄로 접히는 260px(창을 300%로 확대한 정도)도 본다.
  let notice = 1_000_000;
  wire.change = data => ({ ...mission(data, 3, 2, { x: 900, y: 900, progress: 17.4, duration: 20, unlocked: true }), notices: [...data.notices, { id: notice++, at: data.now, text: '보급 상자를 열었습니다 · 마나 +8' }] });
  for (const width of [260, 320, 360, 420, 760]) {
    await page.setViewportSize({ width, height: 700 });
    await expect(items).toHaveText(['시설 3/3', '보급품 2/2', '탈출 17/20초']);
    await expect(page.locator('#toast')).toBeVisible();
    const layout = await page.evaluate(() => {
      const timers = document.querySelector('.timers')!.getBoundingClientRect();
      const toast = document.getElementById('toast')!.getBoundingClientRect();
      const parts = [...document.querySelectorAll('.timers .mission-item, #elapsed')].map(part => part.getBoundingClientRect());
      return { inside: parts.every(r => r.left >= 0 && r.right <= innerWidth), toastBelow: toast.top >= timers.bottom };
    });
    expect(layout, `${width}px`).toEqual({ inside: true, toastBelow: true });
  }
  // 작전이 끝나면 숨긴다. 종료 카드에 작전 시간과 보급품 회수가 있다. 터치 화면과 같다.
  wire.change = data => ({ ...mission(data, 3, 0, null), phase: 'ended', result: 'failure' });
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#mission-mini')).toBeHidden();
  // 종료 카드를 숨기며 나가면 그 상태 클래스도 뗀다. 클래스는 카드가 보이는 동안과 늘 같아야 한다.
  await expect(page.locator('body')).toHaveClass(/\bended\b/);
  await page.locator('#again').click();
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/\bended\b/);
});

test('the lobby slots and the legend wear the color of their own affinity', async ({ page }) => {
  await page.goto('/');
  // 상성 색은 CSS 변수(--strike·--block·--channel)에서 온다. 클래스가 다른 종류의 변수를 쓰거나 변수가 없어지면 기술 버튼과 장비 칸이
  // 엉뚱한 색이 된다. 변수가 없으면 글자가 body 색을 물려받으므로, 기대값은 CSS에서 읽지 않고 고른 색 그대로 둔다(2026-11-08 사용자 결정).
  // 기술 버튼과 기술 막대도 같은 .skill-* 규칙을 쓴다. 장비 칸 이름과 옆 패널의 상성 설명(작전 화면에 있어 숨어 있음)을 본다.
  const expected: Record<string, string> = { strike: 'rgb(255, 107, 97)', block: 'rgb(71, 133, 255)', channel: 'rgb(166, 249, 186)' };
  const actual = await page.evaluate(kinds => Object.fromEntries(kinds.map(kind =>
    [kind, [...document.querySelectorAll(`.kind-slot.skill-${kind} legend strong, .combat-legend .skill-${kind}`)].map(element => getComputedStyle(element).color)])), Object.keys(expected));
  for (const kind of Object.keys(expected)) expect(actual[kind], kind).toEqual([expected[kind], expected[kind]]);
});

test('the style sheet does not use :has(), so older browsers keep every rule', () => {
  // :has()를 모르는 브라우저(iOS Safari 15.4 전, 오래된 안드로이드 WebView)는 그 선택자가 든 규칙 줄을 통째로 버린다.
  // 화면 상태는 main.ts가 붙이는 클래스(body의 ended, html의 touch-operating)로 고른다. 주석 속 글은 보지 않는다.
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css).not.toContain(':has(');
});

test('?touch shows the touch screen on a PC and the PC lobby keeps aimed skills', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveClass(/\btouch\b/);
  expect((await lobbyChoices(page))['free-slot']).toEqual(['strike', 'parry', 'grab', 'spin', 'spinblock', 'spingrab']);
  await page.goto('/?touch');
  await expect(page.locator('body')).toHaveClass(/\btouch\b/);
  expect(await lobbyChoices(page)).toEqual({ 'slot-1': ['spin'], 'slot-2': ['spinblock'], 'slot-3': ['spingrab'], 'free-slot': ['spin', 'spinblock', 'spingrab'] });
});
