import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import crypto from 'node:crypto';
import type { Player, Snapshot } from '../src/types';
import { quietRoom } from './rooms';
import { relay } from './wire';

function observe(page: Page) {
  let snapshot: Snapshot | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framereceived', frame => {
    try { const data = JSON.parse(frame.payload.toString()); if (data.type === 'snapshot') snapshot = data; } catch { }
  }));
  return { get state() { return snapshot; }, get player() { return snapshot?.players.find(p => p.id === snapshot?.you); }, errors };
}

// 내가 보낸 입력을 모은다. held는 그 입력을 보내는 순간에 누르고 있는 슬롯 전부, pressed는 지난 입력 뒤에 누른 슬롯들(누른 차례대로)이다.
// 버튼이 눌린 채 남았는지는 마나로 알 수 없다. 기술은 누를 때 한 번만 시전하므로, 눌린 채 남아도 다시 나가지 않는다.
// 그래서 보낸 입력의 held로 확인한다(PR #28 리뷰 5번).
function sentInputs(page: Page) {
  const inputs: { held: number[]; pressed: number[] }[] = [];
  page.on('websocket', ws => ws.on('framesent', frame => {
    try { const data = JSON.parse(frame.payload.toString()); if (data.type === 'input') inputs.push(data); } catch { }
  }));
  return inputs;
}

// 받은 스냅샷마다 내 마지막 기술을 적어 둔다. 장판은 0.24초만 깔려 있어 스냅샷 한두 장에만 보이므로, 마지막 스냅샷만 보면 놓친다.
// aura는 기운이 도는 틱 수(장판이 나가는 틱 - 시작 틱)다. 스냅샷의 시각은 서버가 지금 정해 둔 틱 그대로라,
// 짧게 누른 기술은 처음부터 가장 짧은 기운 시간이고 버튼을 누르고 있는 기술은 스냅샷마다 늘어난다. limit은 늦어도 장판이 나가는 틱까지다.
// 시각은 초를 소수 둘째 자리로 반올림해 오므로 두 시각을 초로 빼면 0.01이 어긋날 수 있다. 30을 곱해 반올림한 틱 번호로 뺀다.
function seenActions(page: Page) {
  const tick = (seconds: number) => Math.round(seconds * 30);
  const seen: { id: number; slot: number; phase: string; aura: number; held: boolean; limit: number }[] = [];
  page.on('websocket', ws => ws.on('framereceived', frame => {
    try {
      const data = JSON.parse(frame.payload.toString());
      if (data.type !== 'snapshot') return;
      const action = data.players.find((p: { id: string }) => p.id === data.you)?.actions.at(-1);
      if (action) seen.push({ id: action.id, slot: action.slot, phase: action.phase, aura: tick(action.contactAt) - tick(action.startedAt),
        held: action.held, limit: tick(action.holdUntil) - tick(action.startedAt) });
    } catch { }
  }));
  return seen;
}

// 조용한 방을 만들어 캠프에 투입하고, 캠프 옆 보급 상자에서 마나를 가득 채운다. 마우스는 지도 위에 둔다.
// player는 내 대원의 지금 상태를 돌려주는 함수다. 스냅샷을 어떻게 받는지(observe, relay)는 검사마다 다르다.
async function landWithMana(page: Page, player: () => Player | undefined) {
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => player()?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => player()?.state, { timeout: 8000 }).toBe('alive');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => player()?.mana).toBe(24);
  const canvas = (await page.locator('#canvas-host canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .05, canvas.y + canvas.height / 2);
}

// 누름과 뗌을 한 작업 안에서 일으켜, 두 입력 사이에 눌렀다 뗀 짧은 누름을 만든다. 입력은 1/30초마다 보낸다.
const tapKey = (page: Page, code: string) => page.evaluate(code => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
}, code);

test('four guests deploy, collect mana, cast while moving and reconnect with the same resources', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const pages = await Promise.all(Array.from({ length: 4 }, () => context.newPage()));
  const observed = pages.map(observe);
  const page = pages[0], me = observed[0];
  try {
    // 첫 대원이 조용한 방을 만들고 나머지는 방 코드로 참가한다.
    await Promise.all(pages.map((p, index) => p.goto(index === 0 ? quietRoom : '/')));
    await page.screenshot({ path: 'test-results/argus-rps-lobby.png', fullPage: true });
    await page.getByLabel('호출명').fill('Alpha');
    await page.getByRole('button', { name: '새 작전 시작' }).click();
    await expect(page.locator('#room-code')).not.toHaveText('------');
    const code = await page.locator('#room-code').innerText();
    await expect.poll(() => me.player?.state).toBe('waiting');
    await expect(page.locator('#deploy')).toBeDisabled();
    for (let i = 1; i < 4; i++) {
      await pages[i].bringToFront();
      await pages[i].getByLabel('호출명').fill(`Pilot ${i + 1}`);
      await pages[i].getByLabel('방 코드').fill(code);
      await pages[i].getByRole('button', { name: '참가', exact: true }).click();
      await expect(pages[i].locator('#room-code')).toHaveText(code);
    }
    for (const p of pages) {
      await p.getByRole('button', { name: '캠프 선택' }).click();
    }
    const start = Date.now();
    await Promise.all(pages.map(p => p.locator('#deploy').click()));
    await expect.poll(() => me.state?.players.filter(p => p.state === 'alive').length, { timeout: 10000 }).toBe(4);
    expect(Date.now() - start).toBeGreaterThanOrEqual(4800);
    expect(me.player?.mana).toBe(0);
    expect(me.player?.slots).toEqual(['strike', 'parry', 'grab', 'strike']);
    await page.bringToFront();
    await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
    await page.waitForTimeout(470);
    await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
    await expect.poll(() => me.player?.mana).toBe(24);
    const canvas = (await page.locator('#canvas-host canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * .15, canvas.y + canvas.height / 2);
    const x = me.player!.x;
    await page.keyboard.down('KeyA');
    await page.mouse.down();
    await expect.poll(() => me.player?.mana).toBeLessThan(24);
    await expect.poll(() => me.player?.x).toBeLessThan(x - 15);
    await page.mouse.up(); await page.keyboard.up('KeyA');
    await expect(page.locator('#mana')).toHaveText(String(me.player!.mana));
    await page.waitForTimeout(150);
    const before = me.player!;
    await page.reload();
    await expect(page.locator('#room-code')).toHaveText(code);
    await expect.poll(() => me.player?.id).toBe(before.id);
    expect(me.player!.mana).toBe(before.mana);
    // 새로고침한 화면도 작전으로 돌아와 기술 막대를 채운다. 막대의 칸은 처음부터 있으므로 칸 수가 아니라 기술 이름을 본다.
    await expect(page.locator('#skill-bar .skill-slot .name')).toHaveText(['근접 타격', '받아치기', '잡기', '근접 타격']);
    await page.screenshot({ path: 'test-results/argus-rps-operation.png' });
    for (const result of observed) expect(result.errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally { await context.close(); }
});

test('the lobby sends the skill chosen for each kind slot and the free slot', async ({ page }) => {
  const me = observe(page);
  // 규칙(rules)은 연결마다 처음 스냅샷에만 담긴다. 로비의 선택지와 견주려고 따로 받아 둔다.
  let rules: Snapshot['rules'] | undefined;
  page.on('websocket', ws => ws.on('framereceived', frame => {
    try { const data = JSON.parse(frame.payload.toString()); if (data.type === 'snapshot' && data.rules) rules = data.rules; } catch { }
  }));
  await page.goto('/');
  // 종류 칸마다 둘레 기술을 고르고 자유 칸에는 받아치기를 고른다.
  await page.locator('input[name="slot-1"][value="spin"]').check();
  await page.locator('input[name="slot-2"][value="spinblock"]').check();
  await page.locator('input[name="slot-3"][value="spingrab"]').check();
  await page.locator('input[name="free-slot"][value="parry"]').check();
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.slots).toEqual(['spin', 'spinblock', 'spingrab', 'parry']);
  // 로비의 장비 칸 선택지는 서버의 기술 정의와 같아야 한다. 로비는 방에 들어가기 전이라 이 목록을 클라이언트에 따로 적어 두므로,
  // 서버에 기술을 더하거나 종류를 바꾸면 여기서 잡힌다. 앞의 세 칸은 차례로 타격·방어·잡기 종류다(서버의 Rules.ValidSlots).
  await expect.poll(() => rules?.skills.length ?? 0).toBeGreaterThan(0);
  const choices = await page.evaluate(() => Object.fromEntries(['slot-1', 'slot-2', 'slot-3', 'free-slot'].map(name =>
    [name, [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map(input => input.value)])));
  ['strike', 'block', 'channel'].forEach((kind, index) =>
    expect(choices[`slot-${index + 1}`], kind).toEqual(rules!.skills.filter(skill => skill.kind === kind).map(skill => skill.id)));
  expect(choices['free-slot']).toEqual(rules!.skills.map(skill => skill.id));
  // 명단에는 기본 기술과 다르게 고른 종류 칸과 자유 칸이 보인다.
  await expect(page.locator('.member.self .roster-loadout')).toContainText('회전 베기 · 회전 방어 · 회전 잡기 · 자유 받아치기');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  // 기술 막대도 칸 차례대로 고른 기술을 보인다.
  await expect(page.locator('#skill-bar .skill-slot b')).toHaveText(['회전 베기', '회전 방어', '회전 잡기', '받아치기']);
  expect(me.errors).toEqual([]);
});

test('all four input bindings use slots, consume mana on whiffs and keep the free slot after refresh', async ({ page, request }) => {
  const invalid = await request.post('/api/rooms', { data: { slots: ['strike', 'parry', 'grab', 'turret'] } });
  expect(invalid.status()).toBe(400);
  const me = observe(page);
  const sent: string[] = [];
  page.on('websocket', ws => ws.on('framesent', frame => sent.push(String(frame.payload))));
  await page.goto(quietRoom);
  await page.locator('input[name="free-slot"][value="grab"]').check();
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.slots[3]).toBe('grab');
  // 투입 전(대기 중)에는 서버가 입력을 받지 않는다. 창이 포커스를 잃어도 입력을 보내지 않아야 한다.
  sent.length = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(300);
  expect(sent.filter(text => text.includes('"input"'))).toEqual([]);
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  await expect(page.locator('#combat-status')).toContainText('마나가 없습니다');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => me.player?.mana).toBe(24);
  const canvas = (await page.locator('#canvas-host canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .05, canvas.y + canvas.height / 2);
  for (const [key, slot, skill] of [['Digit1', 1, 'strike'], ['Digit2', 2, 'parry'], ['Space', 3, 'grab'], ['KeyQ', 4, 'grab']] as const) {
    await expect.poll(() => me.player?.busy).toBe(0);
    const mana = me.player!.mana;
    await page.keyboard.down(key);
    await expect.poll(() => me.player?.actions.at(-1)?.slot).toBe(slot);
    await page.keyboard.up(key);
    expect(me.player!.actions.at(-1)!.skill).toBe(skill);
    expect(me.player!.mana).toBe(mana - 1);
  }
  const before = me.player!;
  await page.reload();
  await expect.poll(() => me.player?.id).toBe(before.id);
  expect(me.player!.slots[3]).toBe('grab');
  expect(me.player!.mana).toBe(before.mana);
  expect(me.errors).toEqual([]);
});

// 겹쳐 누르기와 자동 반복 확인은 위의 검사에서 떼어 따로 둔다. 한 검사가 길어지지 않게 하려는 것이다.
test('a key held through lost focus does not cast again, and a second mouse button pressed over the first casts after it', async ({ page }) => {
  const me = observe(page);
  const inputs = sentInputs(page);
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => me.player?.mana).toBe(24);
  const canvas = (await page.locator('#canvas-host canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .05, canvas.y + canvas.height / 2);
  // 키를 누른 채 창이 포커스를 잃었다가 돌아오면 그 키는 자동 반복(repeat)으로만 들어온다.
  // 자동 반복은 새로 누른 것이 아니므로 기술이 다시 나가면 안 된다. 떼었다 다시 눌러야 나간다.
  await expect.poll(() => me.player?.busy).toBe(0);
  const held = me.player!.mana;
  await page.keyboard.down('Digit1');
  await expect.poll(() => me.player?.mana).toBe(held - 1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => me.player?.busy).toBe(0);
  // 이미 눌린 키를 다시 누르면 Playwright는 repeat=true로 보낸다.
  await page.keyboard.down('Digit1');
  await page.waitForTimeout(450);
  expect(me.player!.mana).toBe(held - 1);
  await page.keyboard.up('Digit1');
  await page.keyboard.down('Digit1');
  await expect.poll(() => me.player?.mana).toBe(held - 2);
  await page.keyboard.up('Digit1');
  // 좌클릭을 누른 채 우클릭을 누르면 브라우저는 pointerdown 대신 pointermove로만 알린다.
  // 타격은 놓은 것이 되어 장판이 나가고, 나중에 누른 우클릭(받아치기)이 타격이 끝난 뒤 이어서 나가야 한다.
  await expect.poll(() => me.player?.busy).toBe(0);
  await page.mouse.down({ button: 'left' });
  await expect.poll(() => me.player?.actions.at(-1)?.slot).toBe(1);
  await expect.poll(() => inputs.at(-1)?.held).toEqual([1]);
  await page.mouse.down({ button: 'right' });
  await expect.poll(() => inputs.at(-1)?.held).toEqual([1, 2]);
  await expect.poll(() => me.player?.actions.at(-1)?.slot).toBe(2);
  // 좌클릭부터 떼는 것도 pointermove로만 알린다. 뗀 것을 놓치면 좌클릭이 눌린 채로 남아, 보내는 입력의 held에 1번 슬롯이 계속 실린다.
  // 눌린 채 남아도 기술은 다시 나가지 않으므로 마나로는 알 수 없다. 보낸 입력으로 확인한다.
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => inputs.at(-1)?.held).toEqual([2]);
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => me.player?.busy).toBe(0);
  const settled = me.player!.mana;
  const mark = inputs.length;
  await page.waitForTimeout(700);
  expect(me.player!.mana).toBe(settled);
  expect(inputs.length).toBeGreaterThan(mark + 5);
  expect(inputs.slice(mark).filter(input => input.held.length > 0 || input.pressed.length > 0)).toEqual([]);
  expect(me.player!.state).toBe('alive');
  expect(me.errors).toEqual([]);
});

test('a skill key still down after leaving the window does not hold the aura of a click on the same slot', async ({ page }) => {
  // PR #28 리뷰 4번의 장면이다. 1번 키를 누른 채 다른 창을 다녀온다. 돌아오면 자동 반복 keydown이 그 키를 되살린다.
  // 그 키를 누르고 있는 것으로 치면, 같은 슬롯의 좌클릭으로 짧게 낸 타격의 기운을 그 키가 최대 시간(1초)까지 이어 준다.
  const me = observe(page);
  const inputs = sentInputs(page);
  const seen = seenActions(page);
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => me.player?.mana).toBe(24);
  const canvas = (await page.locator('#canvas-host canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .05, canvas.y + canvas.height / 2);
  await page.keyboard.down('Digit1');
  await expect.poll(() => me.player?.mana).toBe(23);
  await expect.poll(() => inputs.at(-1)?.held).toEqual([1]);
  // 창을 떠나면 누르고 있던 키는 뗀 것이다.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => me.player?.busy).toBe(0);
  // 이미 눌린 키를 다시 누르면 Playwright는 repeat=true로 보낸다. 돌아온 창이 받는 자동 반복이다. 누르고 있는 것으로 치지 않는다.
  // 창 밖에서 누르기 시작해 처음부터 자동 반복으로만 들어오는 키(2번 키)도 같다.
  await page.keyboard.down('Digit1');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', repeat: true })));
  const mark = inputs.length;
  await expect.poll(() => inputs.length).toBeGreaterThan(mark + 3);
  expect(inputs.slice(mark).filter(input => input.held.length > 0 || input.pressed.length > 0)).toEqual([]);
  // 좌클릭을 짧게 누른다. 같은 1번 슬롯이다.
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => me.player?.mana).toBe(22);
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => me.player?.busy).toBe(0);
  // 그 타격의 기운은 가장 짧은 시간(6틱)만 돌았다. 어느 스냅샷에서도 그보다 길지 않고, 장판이 나갔다.
  const click = seen.filter(entry => entry.id === seen.at(-1)!.id);
  expect(click.some(entry => entry.phase === 'zone'), '장판이 나간 스냅샷').toBe(true);
  expect(Math.max(...click.map(entry => entry.aura))).toBe(6);
  // 1번 키를 떼었다가 다시 누르면 다시 누르고 있는 것으로 친다.
  await page.keyboard.up('Digit1');
  await page.keyboard.down('Digit1');
  await expect.poll(() => me.player?.mana).toBe(21);
  await expect.poll(() => inputs.at(-1)?.held).toEqual([1]);
  await page.keyboard.up('Digit1');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit2' })));
  expect(me.errors).toEqual([]);
});

test('a skill key held through deployment does not cast after landing until it is pressed again', async ({ page }) => {
  const me = observe(page);
  const inputs = sentInputs(page);
  const seen = seenActions(page);
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state).toBe('deploying');
  // 투입을 기다리며 잡기 키를 누르고 있는다. 살아 있지 않을 때 누른 기술 키는 다시 눌러야 나간다.
  await page.keyboard.down('Space');
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  // 착지 직후에는 마나가 0이다. 키를 쥔 채 보급 상자로 가서 마나를 채워도 잡기가 나가면 안 된다.
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => me.player?.mana).toBe(24);
  await page.waitForTimeout(600);
  expect(me.player!.mana).toBe(24);
  expect(me.player!.actions).toHaveLength(0);
  // 같은 슬롯의 다른 키(Digit3)를 짧게 누르면 잡기는 한 번 나가고, 그 기운은 가장 짧은 시간만 돈다.
  // 아직 누르고 있는 Space는 다시 눌러야 하는 키라 누르고 있는 것으로 치지 않는다. 누르고 있는 것으로 치면 Digit3으로 낸 잡기의
  // 기운을 Space가 최대 시간(1초)까지 잇는다. 기술은 누를 때 한 번만 시전하므로 마나로는 알 수 없다(PR #28 리뷰 5번).
  expect(inputs.at(-1)!.held).toEqual([]);
  await tapKey(page, 'Digit3');
  await expect.poll(() => me.player?.mana).toBe(23);
  await expect.poll(() => me.player?.busy).toBe(0);
  const grab = seen.filter(entry => entry.slot === 3);
  expect(grab.some(entry => entry.phase === 'zone'), '장판이 나간 스냅샷').toBe(true);
  // 잡기의 기운은 가장 짧게 0.12초(4틱)다.
  expect(Math.max(...grab.map(entry => entry.aura))).toBe(4);
  expect(inputs.filter(input => input.held.length > 0)).toEqual([]);
  expect(me.player!.mana).toBe(23);
  // Space를 떼었다가 다시 누르면 나간다.
  await expect.poll(() => me.player?.busy).toBe(0);
  await page.keyboard.up('Space');
  await page.keyboard.down('Space');
  await expect.poll(() => me.player?.mana).toBe(22);
  await page.keyboard.up('Space');
  expect(me.errors).toEqual([]);
});

test('a skill key pressed and released between two input sends still casts once', async ({ page }) => {
  const me = observe(page);
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => me.player?.mana).toBe(24);
  // 입력은 1/30초마다 보낸다. 누름과 뗌을 한 작업 안에서 일으켜, 두 입력 사이에 눌렀다 뗀 짧은 누름을 만든다.
  // 이런 누름도 다음 입력에 한 번 실려 기술이 나가야 한다. 2026-11-05 휴대폰 시험에서는 짧게 누른 회전 방어가 나가지 않았다.
  await tapKey(page, 'Digit1');
  await expect.poll(() => me.player?.mana).toBe(23);
  // 한 번만 나간다. 뗀 뒤에 다시 나가지 않는다.
  await page.waitForTimeout(1500);
  expect(me.player!.mana).toBe(23);
  expect(me.errors).toEqual([]);
});

test('a press goes out once in pressed, apart from the slots that stay held, and presses between two sends keep their order', async ({ page }) => {
  const me = observe(page);
  const inputs = sentInputs(page);
  const pressed = (slot: number) => inputs.filter(input => input.pressed.includes(slot));
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');

  // 누르고 있는 버튼은 held로 계속 보내고, 누른 순간의 입력 하나에만 pressed가 실린다.
  await page.keyboard.down('Digit1');
  await expect.poll(() => inputs.filter(input => input.held.includes(1)).length).toBeGreaterThan(3);
  expect(pressed(1).map(input => input.held)).toEqual([[1]]);
  // 누른 채 다른 버튼을 짧게 누른다. 짧은 누름은 pressed에만 실리고, held는 누르고 있는 버튼 그대로다.
  // 서버가 짧은 누름을 누르고 있는 것으로 여기지 않는다.
  await tapKey(page, 'Digit2');
  await expect.poll(() => pressed(2).length).toBe(1);
  expect(pressed(2)[0].held).toEqual([1]);
  await page.keyboard.up('Digit1');
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  // 아무것도 누르고 있지 않을 때 짧게 누르면 held는 비어 있다.
  await tapKey(page, 'Digit3');
  await expect.poll(() => pressed(3).length).toBe(1);
  expect(pressed(3)[0].held).toEqual([]);
  await page.waitForTimeout(200);
  expect(inputs.filter(input => input.pressed.length > 0)).toHaveLength(3);

  // 두 입력 사이에 두 버튼을 거의 함께 누르면 한 입력에 누른 차례대로 실린다(PR #28 리뷰 2번).
  // 한 자리에 적던 때에는 뒤에 누른 것만 실려, 앞의 버튼은 누르고 있어도 기술이 나가지 않았다.
  const both = (first: string, second: string) => page.evaluate(([first, second]) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: first }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: second }));
  }, [first, second]);
  const mark = inputs.length;
  await both('Digit2', 'Digit1');
  await expect.poll(() => inputs.slice(mark).filter(input => input.pressed.length > 0).map(input => input.pressed)).toEqual([[2, 1]]);
  // 누르고 있는 버튼은 슬롯 번호 순서로 모두 실린다.
  await expect.poll(() => inputs.at(-1)?.held).toEqual([1, 2]);
  await page.keyboard.up('Digit1');
  await expect.poll(() => inputs.at(-1)?.held).toEqual([2]);
  await page.keyboard.up('Digit2');
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  // 두 버튼을 짧게 눌렀다 뗀 것도 누른 차례대로 한 입력에 실린다. 그때 held는 비어 있다.
  const tapped = inputs.length;
  await page.evaluate(() => {
    for (const code of ['Digit3', 'Digit1']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    }
  });
  await expect.poll(() => inputs.slice(tapped).filter(input => input.pressed.length > 0).map(input => [input.pressed, input.held])).toEqual([[[3, 1], []]]);
  expect(me.errors).toEqual([]);
});

test('a second input pressed over a slot whose hold still does something is not a new press', async ({ page }) => {
  // 같은 슬롯에 묶인 두 입력(1번 키와 좌클릭, 3번 키와 스페이스)을 겹쳐 누른다. 서버에게 슬롯은 버튼 하나라, 같은 슬롯의 새 누름을
  // "뗐다 다시 눌렀다"로 읽어 누르고 있던 기운을 놓고 기술을 한 번 더 낸다. 그래서 그 슬롯을 누르고 있는 것이 아직 뜻이 있는 동안에는
  // 겹쳐 누른 것을 새 누름으로 보내지 않는다. 그렇게 치는 때는 넷이다. 둘은 앞의 누름이 어떻게 됐는지 화면이 아직 모르는 때(1·2)이고,
  // 둘은 서버가 알려 준 때(3·4)다. 화면이 넷을 따로 알아야 하므로 하나씩 본다.
  const wire = await relay(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const presses = (from: number) => wire.inputs.slice(from).filter(input => input.pressed.length > 0).map(input => input.pressed);
  // 서버가 알린 기다리는 누름과, 잡기(3번 슬롯)가 보인 스냅샷마다 그 기운을 잇는 중이었는지를 적어 둔다.
  const waited: number[][] = [];
  const grabHeld: boolean[] = [];
  wire.change = data => {
    if (data.waiting) waited.push(data.waiting);
    const last = data.players.find(p => p.id === data.you)?.actions.at(-1);
    if (last?.slot === 3) grabHeld.push(last.held === true);
    return data;
  };
  await landWithMana(page, () => wire.player);

  // 1. 앞의 누름을 아직 보내지 않았다. 입력은 1/30초마다 보내므로, 한 작업 안에서 키와 마우스 버튼을 잇달아 누르면 둘 다 보내기 전이다.
  let mark = wire.inputs.length;
  await page.evaluate(() => {
    const canvas = document.querySelector('#canvas-host canvas')!;
    const area = canvas.getBoundingClientRect();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: area.left + area.width * .05, clientY: area.top + area.height / 2 }));
  });
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([1]);
  await page.waitForTimeout(150);
  expect(presses(mark)).toEqual([[1]]);
  await page.evaluate(() => {
    document.querySelector('#canvas-host canvas')!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, buttons: 0 }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit1' }));
  });
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => wire.player?.busy).toBe(0);

  // 2. 앞의 누름을 보냈지만 서버가 확인한 스냅샷을 화면이 아직 받지 못했다. 스냅샷을 잡아 두어 그 사이를 길게 만든다.
  // 서버에서는 타격이 이미 시작해 기운을 잇고 있지만, 화면이 아는 것은 "누름을 보냈다"뿐이다.
  await expect(page.locator('#skill-bar .skill-slot.active')).toHaveCount(0);
  wire.holding = true;
  mark = wire.inputs.length;
  await page.keyboard.down('Digit1');
  await expect.poll(() => wire.player?.actions.at(-1)?.held).toBe(true);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(150);
  expect(presses(mark)).toEqual([[1]]);
  wire.release();
  await page.mouse.up({ button: 'left' });
  await page.keyboard.up('Digit1');
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => wire.player?.busy).toBe(0);

  // 3. 그 슬롯으로 쓴 기술의 기운을 잇는 중이다. 화면이 기운을 그렸다면 서버가 누름을 확인한 스냅샷을 받은 것이다.
  await expect(page.locator('#skill-bar .skill-slot.active')).toHaveCount(0);
  mark = wire.inputs.length;
  await page.keyboard.down('Digit1');
  await expect(page.locator('#skill-bar .skill-slot[data-slot="1"].active small')).toHaveText('기운');
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(150);
  expect(presses(mark)).toEqual([[1]]);
  // 키를 떼어도 좌클릭이 그 슬롯을 누르고 있다. 좌클릭까지 떼어야 뗀 것이다.
  await page.keyboard.up('Digit1');
  await page.waitForTimeout(150);
  expect(wire.inputs.at(-1)!.held).toEqual([1]);
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([]);
  expect(presses(mark)).toEqual([[1]]);
  await expect.poll(() => wire.player?.busy).toBe(0);

  // 4. 그 슬롯의 누름이 앞의 기술이 끝나기를 기다리는 중이다. 받아치기(2번 키)와 잡기(3번 키)를 잇달아 눌러 둘 다 누르고 있으면,
  // 받아치기가 먼저 나가고 잡기는 기다린다. 기다리는 누름은 서버가 스냅샷의 waiting으로 알린다. 이때 스페이스(같은 3번 슬롯)를
  // 겹쳐 눌렀다 떼어도 3번 키가 누르고 있으므로 잡기는 계속 기다린다. 스페이스를 새 누름으로 치면 3번 키가 다 쓴 입력이 되어,
  // 스페이스를 떼는 순간 서버가 잡기의 기다림을 버린다.
  await expect(page.locator('#skill-bar .skill-slot.active')).toHaveCount(0);
  mark = wire.inputs.length;
  const before = wire.player!.mana;
  await page.evaluate(() => { for (const code of ['Digit2', 'Digit3']) window.dispatchEvent(new KeyboardEvent('keydown', { code })); });
  // 화면이 받아치기를 쓰는 중으로 그렸다면, 두 누름을 확인한 스냅샷을 받은 것이다. 두 누름은 한 입력에 실려 갔다.
  await expect(page.locator('#skill-bar .skill-slot[data-slot="2"].active')).toHaveCount(1);
  expect(waited.at(-1)).toEqual([3]);
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);
  expect(presses(mark)).toEqual([[2, 3]]);
  await page.keyboard.up('Space');
  await page.waitForTimeout(120);
  expect(wire.inputs.at(-1)!.held).toEqual([2, 3]);
  // 받아치기가 끝나면 기다리던 잡기가 나간다. 3번 키를 누르고 있으므로 처음 보인 스냅샷부터 기운을 잇는 중이다.
  await expect.poll(() => grabHeld.length, { timeout: 4000 }).toBeGreaterThan(0);
  expect(grabHeld[0]).toBe(true);
  expect(wire.player!.mana).toBe(before - 2);
  expect(wire.snapshot?.waiting).toBeUndefined();
  // 서버가 알린 기다리는 누름은 처음부터 끝까지 잡기 하나였다.
  expect(waited.every(slots => slots.length === 1 && slots[0] === 3)).toBe(true);
  await page.keyboard.up('Digit3');
  await page.keyboard.up('Digit2');
  await expect.poll(() => wire.inputs.at(-1)?.held).toEqual([]);
  expect(presses(mark)).toEqual([[2, 3]]);
  expect(errors).toEqual([]);
});

test('a key still down after its skill is over neither blocks a click on the same slot nor holds that click\'s aura', async ({ page }) => {
  // PR #28 재리뷰 다의 장면이다. 1번 키로 타격을 쓰고, 타격이 끝난 뒤에도 그 키를 계속 누르고 있다. 누르고 있어도 다시 시전하지
  // 않으므로 아무 일도 없다. 이때 좌클릭(같은 1번 슬롯)을 하면 타격이 나가야 한다. 그 슬롯을 이미 누르고 있다는 이유만으로 누름을
  // 버리면, 키에 손가락을 얹고 있는 동안 좌클릭이 먹지 않는다.
  const me = observe(page);
  const inputs = sentInputs(page);
  const seen = seenActions(page);
  await landWithMana(page, () => me.player);
  await page.keyboard.down('Digit1');
  await expect.poll(() => me.player?.mana).toBe(23);
  // 끝까지 누르고 있는다. 최대 기운 시간(1초)에 장판이 나가고 기술이 끝난다. 키는 그 뒤에도 누르고 있다.
  await expect.poll(() => me.player?.actions.length, { timeout: 4000 }).toBe(0);
  await expect(page.locator('#skill-bar .skill-slot.active')).toHaveCount(0);
  const mark = inputs.length;
  // 좌클릭을 짧게 누른다. 새 누름으로 한 번 나간다.
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => me.player?.mana).toBe(22);
  expect(inputs.slice(mark).filter(input => input.pressed.length > 0).map(input => input.pressed)).toEqual([[1]]);
  // 1번 키는 앞의 타격에 다 쓴 입력이다. 좌클릭을 뗀 뒤로는 누르고 있는 슬롯이 없다. 그 키를 누르고 있는 것으로 계속 치면,
  // 짧게 클릭한 타격의 기운을 그 키가 최대 시간(1초)까지 잇는다(PR #28 리뷰 4번과 같은 결함).
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => me.player?.busy).toBe(0);
  const click = seen.filter(entry => entry.id === seen.at(-1)!.id);
  expect(click.some(entry => entry.phase === 'zone'), '장판이 나간 스냅샷').toBe(true);
  expect(Math.max(...click.map(entry => entry.aura))).toBe(6);
  const settled = inputs.length;
  await expect.poll(() => inputs.length).toBeGreaterThan(settled + 3);
  expect(inputs.slice(settled).filter(input => input.held.length > 0 || input.pressed.length > 0)).toEqual([]);
  // 1번 키를 떼었다가 다시 누르면 다시 쓸 수 있다.
  await page.keyboard.up('Digit1');
  await page.keyboard.down('Digit1');
  await expect.poll(() => me.player?.mana).toBe(21);
  await expect.poll(() => inputs.at(-1)?.held).toEqual([1]);
  await page.keyboard.up('Digit1');

  // 거꾸로도 같다. 좌클릭을 타격이 끝난 뒤까지 누르고 있다가 1번 키를 짧게 누른다. 좌클릭이 다 쓴 입력이 된다.
  await expect.poll(() => me.player?.busy).toBe(0);
  await page.mouse.down({ button: 'left' });
  await expect.poll(() => me.player?.mana).toBe(20);
  await expect.poll(() => me.player?.actions.length, { timeout: 4000 }).toBe(0);
  await expect(page.locator('#skill-bar .skill-slot.active')).toHaveCount(0);
  const again = inputs.length;
  await tapKey(page, 'Digit1');
  await expect.poll(() => me.player?.mana).toBe(19);
  expect(inputs.slice(again).filter(input => input.pressed.length > 0).map(input => input.pressed)).toEqual([[1]]);
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => me.player?.busy).toBe(0);
  const tapped = seen.filter(entry => entry.id === seen.at(-1)!.id);
  expect(tapped.some(entry => entry.phase === 'zone'), '장판이 나간 스냅샷').toBe(true);
  expect(Math.max(...tapped.map(entry => entry.aura))).toBe(6);
  await page.mouse.up({ button: 'left' });

  // 다 쓴 입력으로 돌리는 것은 그 슬롯의 입력뿐이다. 1번 키가 다 쓴 입력이 될 때, 다른 슬롯을 누르고 있는 우클릭(2번 슬롯)과
  // 3번 키는 그대로 누르고 있는 것이다.
  await expect.poll(() => me.player?.busy).toBe(0);
  await page.keyboard.down('Digit1');
  await expect.poll(() => me.player?.mana).toBe(18);
  await expect.poll(() => me.player?.actions.length, { timeout: 4000 }).toBe(0);
  await expect(page.locator('#skill-bar .skill-slot.active')).toHaveCount(0);
  await page.mouse.down({ button: 'right' });
  await page.keyboard.down('Digit3');
  await expect.poll(() => inputs.at(-1)?.held).toEqual([1, 2, 3]);
  const third = inputs.length;
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => inputs.slice(third).filter(input => input.pressed.length > 0).map(input => input.pressed)).toEqual([[1]]);
  await expect.poll(() => inputs.at(-1)?.held).toEqual([2, 3]);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Digit3');
  await page.keyboard.up('Digit1');
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  expect(me.errors).toEqual([]);
});

test('a second input pressed after the zone went out is a new press that waits its turn, and that input alone holds its aura', async ({ page }) => {
  // 3번 키(잡기)를 끝까지 누르고 있으면 최대 기운 시간에 장판이 나간다. 장판이 나간 뒤에는 그 키를 누르고 있어도 아무 일도 없다.
  // 한 번 나간 장판은 기운으로 돌아가지 않는다. 이때 스페이스(같은 3번 슬롯)를 누르고 있으면 새 누름이다. 한 입력으로 뗐다 다시
  // 누른 것과 같이, 앞의 잡기가 끝나기를 기다렸다가 나간다. "그 슬롯의 기술이 진행 중이면 버린다"로 하면 이 누름이 사라져,
  // 같은 조작이 키 하나로 할 때와 두 키로 할 때 달라진다.
  // 잡기를 쓰는 것은 장판이 나간 뒤 기술이 끝나기까지가 0.73초로 가장 길어서다. 그 사이에 둘째 키를 눌러야 한다.
  const me = observe(page);
  const inputs = sentInputs(page);
  const seen = seenActions(page);
  await landWithMana(page, () => me.player);
  const action = () => me.player?.actions.at(-1);
  // 시간에 매인 확인은 자주 본다. 기본 간격은 점점 늘어 1초까지 벌어진다.
  const often = { intervals: [50], timeout: 4000 };
  await page.keyboard.down('Digit3');
  await expect.poll(() => action()?.phase, often).toBe('aura');
  const first = action()!.id;
  // 화면이 장판이나 후딜레이를 그린 순간이다. 화면이 그 스냅샷을 받았으므로, 3번 키를 누르고 있는 것이 더는 뜻이 없음을 안다.
  await page.waitForFunction(() => {
    const phase = document.querySelector('#skill-bar .skill-slot[data-slot="3"].active small');
    return phase !== null && phase.textContent !== '기운';
  });
  const mark = inputs.length;
  await page.keyboard.down('Space');
  await expect.poll(() => action()?.id ?? first, often).not.toBe(first);
  const second = action()!.id;
  expect(action()!.slot).toBe(3);
  expect(inputs.slice(mark).filter(input => input.pressed.length > 0).map(input => input.pressed)).toEqual([[3]]);
  expect(me.player!.mana).toBe(22);
  // 3번 키는 앞의 잡기에 다 쓴 입력이다. 떼어도 달라지는 것이 없고, 스페이스가 새 잡기의 기운을 잇는다.
  await page.keyboard.up('Digit3');
  await page.waitForTimeout(150);
  expect(inputs.at(-1)!.held).toEqual([3]);
  expect(action()).toMatchObject({ id: second, phase: 'aura', held: true });
  // 스페이스를 떼면 장판이 나간다. 최대 기운 시간(30틱)까지 가지 않았다.
  await page.keyboard.up('Space');
  await expect.poll(() => inputs.at(-1)?.held).toEqual([]);
  await expect.poll(() => me.player?.busy).toBe(0);
  const released = seen.filter(entry => entry.id === second && entry.phase === 'zone');
  expect(released.length, '장판이 나간 스냅샷').toBeGreaterThan(0);
  expect(released[0].aura).toBeLessThan(30);
  expect(me.player!.mana).toBe(22);
  expect(me.errors).toEqual([]);
});

test('a held skill key keeps the aura going, the zone goes out on release, and holding on does not cast again', async ({ page }) => {
  const me = observe(page);
  const seen = seenActions(page);
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => me.player?.mana).toBe(24);
  const action = () => me.player?.actions.at(-1);
  // 최대 기운 시간이다(시험 수치 1초, rules.maxAuraSeconds). 규칙은 첫 스냅샷에만 실려 오므로 값을 적어 둔다.
  const maxAura = 1;
  // 타격 키를 누르고 있는다. 타격의 기운은 짧게 누르면 0.18초지만, 누르고 있는 동안에는 이어진다.
  // 서버는 기운을 잇는 중(held)이라고 알리고, 늦어도 장판이 나가는 시각(holdUntil)을 시작 1초 뒤로 알린다.
  // 장판이 나가는 시각(contactAt)은 "계속 누를 것"이라는 짐작이 아니라 지금 정해 둔 틱이라, 누르고 있는 동안 조금씩 늘어난다.
  // 여기서부터 자동 반복까지는 기운이 최대 시간(1초)에 닿기 전에 마쳐야 한다. 마지막 틱(0.97초)에는 더 이어지지 않으므로
  // held가 꺼진다. 기운이 보이는지를 자주 확인한다. 기본 간격(0.1초 뒤, 그다음은 0.35초 뒤)으로는 첫 스냅샷을 놓쳤을 때
  // 0.27초 늦게 알아채, 마지막 확인이 0.97초에 걸리는 일이 열 번에 한 번쯤 있었다.
  await page.keyboard.down('Digit1');
  await expect.poll(() => action()?.phase, { intervals: [50] }).toBe('aura');
  const first = action()!.id;
  await page.waitForTimeout(300);
  expect(action()!.id).toBe(first);
  expect(action()!.phase).toBe('aura');
  expect(action()!.held).toBe(true);
  expect(action()!.holdUntil! - action()!.startedAt).toBeCloseTo(maxAura, 1);
  // 가장 짧은 기운 시간(0.2초)보다 길고 최대 기운 시간(1초)보다 짧다.
  const during = action()!.contactAt - action()!.startedAt;
  expect(during).toBeGreaterThan(.25);
  expect(during).toBeLessThan(.9);
  // 남은 시간(busy)은 지금 놓았을 때 기술이 끝나기까지다. 누르고 있는 동안에는 줄지 않는다.
  expect(me.player!.busy).toBeGreaterThan(.4);
  expect(me.player!.busy).toBeLessThan(.6);
  // 기술 막대는 지금 단계를 적는다.
  await expect(page.locator('#skill-bar .skill-slot.active small')).toHaveText('기운');
  // 누르고 있는 키는 브라우저가 자동 반복 keydown을 거듭 보낸다(Playwright는 이미 눌린 키를 다시 누르면 repeat=true로 보낸다).
  // 자동 반복은 새 누름이 아니다. 누름으로 치면 같은 버튼을 새로 누른 것이 되어, 누르고 있던 기운이 끊기고 기술이 다시 나간다.
  await page.keyboard.down('Digit1');
  await page.waitForTimeout(150);
  expect(action()!.id).toBe(first);
  expect(action()!.phase).toBe('aura');
  expect(action()!.held).toBe(true);
  // 떼면 장판이 나간다. 장판이 나간 시각은 뗀 때라, 시작 0.18초 뒤도 최대 기운 시간도 아니다.
  await page.keyboard.up('Digit1');
  await expect.poll(() => me.player?.busy).toBe(0);
  const released = seen.filter(entry => entry.id === first && entry.phase === 'zone');
  expect(released.length, '장판이 나간 스냅샷').toBeGreaterThan(0);
  expect(released[0].aura).toBeGreaterThan(10);
  expect(released[0].aura).toBeLessThan(29);
  expect(released[0].held).toBe(false);
  // 기운이 도는 시간은 스냅샷마다 늘기만 했다. 긴 값에서 짧은 값으로 바뀐 적이 없다.
  const auras = seen.filter(entry => entry.id === first).map(entry => entry.aura);
  expect(auras.every((value, index) => index === 0 || value >= auras[index - 1])).toBe(true);
  expect(me.player!.mana).toBe(23);

  // 짧게 누른 기술은 뗀 입력이 서버에 닿기 전의 스냅샷에서도 장판 시각이 가장 짧은 기운 시간(6틱)이다.
  // "계속 누를 것"이라고 짐작해 1초로 알렸다가 0.2초로 고치지 않는다(PR #28 리뷰 9번).
  await page.keyboard.down('Digit1');
  await page.keyboard.up('Digit1');
  await expect.poll(() => me.player?.mana).toBe(22);
  await expect.poll(() => me.player?.busy).toBe(0);
  const tapId = seen.at(-1)!.id;
  expect(tapId).not.toBe(first);
  const tap = seen.filter(entry => entry.id === tapId);
  expect(tap.length).toBeGreaterThan(1);
  expect(tap.map(entry => entry.aura)).toEqual(tap.map(() => 6));
  expect(tap.map(entry => entry.limit)).toEqual(tap.map(() => maxAura * 30));

  // 끝까지 누르고 있으면 최대 기운 시간에 장판이 나가고, 기술이 끝나도 다시 나가지 않는다.
  await page.keyboard.down('Digit1');
  await expect.poll(() => action()?.phase).toBe('aura');
  const second = action()!.id;
  expect(second).not.toBe(tapId);
  await expect.poll(() => seen.some(entry => entry.id === second && entry.phase !== 'aura'), { timeout: 3000 }).toBe(true);
  const forced = seen.filter(entry => entry.id === second && entry.phase !== 'aura');
  expect(forced[0].aura).toBe(maxAura * 30);
  await expect.poll(() => me.player?.actions.length).toBe(0);
  await page.waitForTimeout(1200);
  expect(me.player!.actions).toHaveLength(0);
  expect(me.player!.mana).toBe(21);
  // 그동안 다른 기술이 시작되지 않았다.
  expect(new Set(seen.map(entry => entry.id)).size).toBe(3);
  await page.keyboard.up('Digit1');
  expect(me.errors).toEqual([]);
});

test('a mouse button held while the window loses focus is not a new press when it comes back', async ({ page }) => {
  const me = observe(page);
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  await expect.poll(() => me.player?.mana).toBe(24);
  const canvas = (await page.locator('#canvas-host canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .05, canvas.y + canvas.height / 2);
  // 좌클릭을 쥔 채 창이 포커스를 잃었다가 돌아온다. 돌아와서 마우스를 움직여도 새로 누른 것이 아니므로 타격이 나가면 안 된다.
  await page.mouse.down({ button: 'left' });
  await expect.poll(() => me.player?.mana).toBeLessThan(24);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => me.player?.busy).toBe(0);
  const kept = me.player!.mana;
  await page.mouse.move(canvas.x + canvas.width * .06, canvas.y + canvas.height / 2);
  await page.waitForTimeout(1200);
  expect(me.player!.mana).toBe(kept);
  // 떼었다가 다시 누르면 나간다.
  await page.mouse.up({ button: 'left' });
  await page.mouse.down({ button: 'left' });
  await expect.poll(() => me.player?.mana).toBe(kept - 1);
  await page.mouse.up({ button: 'left' });
  expect(me.player!.state).toBe('alive');
  expect(me.errors).toEqual([]);
});

test('the deploy button sends one request even when it is clicked twice quickly', async ({ page }) => {
  const me = observe(page);
  const sent: string[] = [];
  page.on('websocket', ws => ws.on('framesent', frame => sent.push(String(frame.payload))));
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  // 다음 스냅샷이 오기 전에 두 번 누른다. 첫 요청을 보내는 즉시 버튼을 막아야 한다.
  await page.locator('#deploy').dblclick();
  await expect.poll(() => me.player?.state).toBe('deploying');
  expect(sent.filter(text => text.includes('"deploy"'))).toHaveLength(1);
  await expect(page.locator('#toast')).toBeHidden();
  expect(me.errors).toEqual([]);
});

test('notices that arrive together are all shown, even two identical ones', async ({ page, request }) => {
  const me = observe(page);
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#room-code')).not.toHaveText('------');
  await expect.poll(() => me.player?.state).toBe('waiting');
  const code = await page.locator('#room-code').innerText();
  // 같은 이름의 두 대원이 거의 동시에 참가해 같은 문구의 안내가 두 번 나온다. 한 방송에 실리든 이어서 오든
  // 마지막 안내가 앞의 것을 지우거나 같은 문구라고 하나로 합치지 않고 두 줄 모두 보여야 한다.
  await Promise.all([
    request.post(`/api/rooms/${code}/join`, { data: { name: 'Twin' } }),
    request.post(`/api/rooms/${code}/join`, { data: { name: 'Twin' } })
  ]);
  await expect.poll(async () => ((await page.locator('#toast').innerText()).match(/Twin 합류/g) ?? []).length).toBe(2);
  expect(me.errors).toEqual([]);
});

test('the bug report button stamps the moment at once and takes a note without freezing the game', async ({ page }) => {
  const me = observe(page);
  await page.goto('/');
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#room-code')).not.toHaveText('------');
  await expect.poll(() => me.player?.state).toBe('waiting');
  const code = await page.locator('#room-code').innerText();
  // 살아 있는 동안 제보해야 내용을 적는 동안 게임 키가 대원을 움직이지 않는지 볼 수 있다.
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');
  await page.getByRole('button', { name: '버그 제보' }).click();
  // 누른 순간 서버가 기록에 남긴 틱을 방 코드와 함께 알려 주고, 내용을 적을 입력란을 연다.
  await expect(page.locator('#toast')).toContainText(new RegExp(`제보를 남겼습니다 · 방 ${code} · \\d+틱`));
  await expect(page.locator('#report-note')).toBeVisible();
  const before = { x: me.player!.x, y: me.player!.y };
  await page.locator('#report-text').click();
  // 입력란에서 W를 누르고 있어도 대원은 움직이지 않는다. 게임 키로 받으면 0.4초 동안 70 남짓 움직인다.
  // 눌렀다 바로 떼는 타자로는 33ms마다 입력을 읽는 쪽이 눌린 키를 거의 보지 못하므로 누르고 있는다.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  expect(Math.hypot(me.player!.x - before.x, me.player!.y - before.y)).toBeLessThan(1);
  await page.locator('#report-text').pressSequentially(' 적이 벽을 지나갔어요');
  await page.getByRole('button', { name: '덧붙이기' }).click();
  await expect(page.locator('#toast')).toContainText('제보에 내용을 덧붙였습니다');
  await expect(page.locator('#report-note')).toBeHidden();
  // 같은 대원은 5초 안에 다시 제보할 수 없다.
  await page.getByRole('button', { name: '버그 제보' }).click();
  await expect(page.locator('#toast')).toContainText('5초에 한 번');
  expect(me.errors).toEqual([]);
});

test('a client that closes first gets a clean close back', async ({ request }) => {
  const guest = await (await request.post('/api/rooms', { data: { name: 'Closer' } })).json();
  const url = (process.env.ARGUS_URL ?? 'http://127.0.0.1:5077').replace(/^http/, 'ws') + '/ws';
  const ws = new WebSocket(url);
  let snapshots = 0;
  ws.addEventListener('message', () => { snapshots++; });
  await new Promise<void>(resolve => ws.addEventListener('open', () => resolve()));
  ws.send(JSON.stringify({ type: 'hello', room: guest.room, token: guest.token }));
  await expect.poll(() => snapshots).toBeGreaterThan(1);
  // 클라이언트가 먼저 닫으면 서버가 종료 응답으로 닫기를 마쳐야 한다. 응답이 없으면 1006(비정상 종료)이 된다.
  const closed = new Promise<{ code: number; clean: boolean }>(resolve =>
    ws.addEventListener('close', event => resolve({ code: event.code, clean: event.wasClean })));
  ws.close(1000);
  expect(await closed).toEqual({ code: 1000, clean: true });
});

test('a connection with a wrong hello that never answers the close is dropped within a couple of seconds', async () => {
  // 종료 프레임에 답하지 않는 연결을 직접 만든다. 서버가 상대의 종료 응답을 무기한 기다리면 인증 없이 연결이 계속 남는다.
  const target = new URL(process.env.ARGUS_URL ?? 'http://127.0.0.1:5077');
  const socket = net.connect(Number(target.port), target.hostname);
  await new Promise<void>(resolve => socket.once('connect', () => resolve()));
  socket.write(`GET /ws HTTP/1.1\r\nHost: ${target.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await new Promise<void>(resolve => socket.once('data', () => resolve()));
  const closed = new Promise<number>(resolve => socket.once('close', () => resolve(Date.now())));
  socket.on('data', () => {});
  socket.on('error', () => {});
  // 클라이언트가 보내는 프레임은 마스크를 씌워야 한다.
  const payload = Buffer.from(JSON.stringify({ type: 'hello', room: 'NOPE23', token: 'wrong' }));
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(payload.map((value, index) => value ^ mask[index % 4]));
  const sentAt = Date.now();
  socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
  const seconds = (await Promise.race([closed, new Promise<number>(resolve => setTimeout(() => resolve(Number.NaN), 4000))]) - sentAt) / 1000;
  socket.destroy();
  expect(seconds).toBeLessThan(2.5);
});

test('wire protocol rejects forged state, invalid slots, replay and stolen identity; late join works', async ({ request }) => {
  const response = await request.post('/api/rooms', { data: { name: 'Wire test' } });
  const guest = await response.json();
  const url = (process.env.ARGUS_URL ?? 'http://127.0.0.1:5077').replace(/^http/, 'ws') + '/ws';
  const bad = new WebSocket(url);
  bad.addEventListener('open', () => bad.send(JSON.stringify({ type: 'hello', room: guest.room, token: 'wrong' })));
  expect(await new Promise<number>(resolve => bad.addEventListener('close', event => resolve(event.code)))).toBe(1008);
  const ws = new WebSocket(url);
  let snapshot: Snapshot | undefined;
  // 방마다 맵이 다르므로 첫 스냅샷의 맵 정보에서 캠프 자리를 얻어 그곳에 투입한다.
  let camp = { x: 0, y: 0 };
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.type !== 'snapshot') return;
    snapshot = message;
    if (message.map) camp = { x: message.map.campX, y: message.map.campY };
  });
  await new Promise<void>(resolve => ws.addEventListener('open', () => resolve()));
  const send = (value: object) => ws.send(JSON.stringify(value));
  let replacement: WebSocket | undefined;
  let newcomer: WebSocket | undefined;
  try {
    send({ type: 'hello', room: guest.room, token: guest.token });
    await expect.poll(() => snapshot?.phase).toBe('staging');
    expect(camp.x).toBeGreaterThan(0);
    send({ type: 'deploy', ...camp });
    const self = () => snapshot?.players.find(p => p.id === guest.id);
    await expect.poll(() => self()?.state, { timeout: 8000 }).toBe('alive');
    send({ type: 'input', seq: 0, moveX: 0, moveY: 0, aim: 0, held: [], pressed: [], x: 1300, y: 1200, hp: 999, mana: 999, damage: 999 });
    await expect.poll(() => self()?.ack).toBe(0);
    expect(self()!.x).toBe(camp.x); expect(self()!.mana).toBe(0); expect(self()!.hp).toBe(6);
    send({ type: 'input', seq: 1, moveX: 100, moveY: 0, aim: 0 });
    // 누르고 있는 슬롯(held)과 누른 슬롯(pressed)은 1~4의 정수 배열이다. 범위를 벗어난 값, 정수가 아닌 값, 배열이 아닌 값,
    // 겹친 held, 너무 긴 목록이 든 입력은 통째로 받지 않는다.
    for (const held of [[9], [0], [2.5], ['strike'], 'strike', 1, [1, 1], [1, 2, 3, 4, 1], { 0: 1 }, null]) {
      send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, held });
    }
    for (const pressed of [[9], [-1], [2.5], ['strike'], 'strike', 2, [1, 1, 1, 1, 1, 1, 1, 1, 1], null]) {
      send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, pressed });
    }
    send({ type: 'input', seq: 0, moveX: 1, moveY: 0, aim: 0 });
    // 앞의 입력은 모두 거절되므로 받은 순번이 그대로다. 잘못 받았다면 순번 1이 ack에 나타난다.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(self()!.ack).toBe(0);
    send({ type: 'loadout', slots: ['strike', 'parry', 'grab', 'grab'] });
    send({ type: 'deploy', x: 1000, y: 700 });
    // 마나가 0이라 눌러도 기술이 나가지 않는다.
    send({ type: 'input', seq: 2, moveX: 0, moveY: 0, aim: 0, held: [1], pressed: [1] });
    await expect.poll(() => self()?.ack).toBe(2);
    expect(self()!.x).toBe(camp.x); expect(self()!.slots[3]).toBe('strike'); expect(self()!.mana).toBe(0);
    expect(self()!.actions).toHaveLength(0);
    const joins = [];
    for (let i = 0; i < 4; i++) joins.push(await request.post(`/api/rooms/${guest.room}/join`, { data: { name: 'guest' } }));
    expect(joins.map(r => r.status())).toEqual([200, 200, 200, 409]);
    const late = await joins[0].json();
    newcomer = new WebSocket(url);
    newcomer.addEventListener('open', () => newcomer!.send(JSON.stringify({ type: 'hello', room: late.room, token: late.token })));
    await expect.poll(() => snapshot?.players.find(p => p.id === late.id)?.connected).toBe(true);
    newcomer.send(JSON.stringify({ type: 'deploy', ...camp }));
    await expect.poll(() => snapshot?.players.find(p => p.id === late.id)?.state, { timeout: 8000 }).toBe('alive');
    expect(snapshot!.players.find(p => p.id === late.id)!.mana).toBe(0);
    const replaced = new Promise<number>(resolve => ws.addEventListener('close', event => resolve(event.code)));
    replacement = new WebSocket(url);
    replacement.addEventListener('open', () => replacement!.send(JSON.stringify({ type: 'hello', room: guest.room, token: guest.token })));
    expect(await replaced).toBe(4001);
  } finally { ws.close(); replacement?.close(); newcomer?.close(); }
});
