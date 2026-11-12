import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import crypto from 'node:crypto';
import type { Snapshot } from '../src/types';

// 조작을 보는 검사는 적이 없는 조용한 방에서 돈다. 주소에 ?layout=quiet를 붙여 방을 만들면 서버가 손으로 만든 맵에 처음 적도 증원도
// 없는 방을 준다(서버 설정 Argus:Missions:AllowHandmade가 켜져 있어야 하고, 꺼져 있으면 방 만들기가 HTTP 403이다).
// 생성 작전에서는 처음 적들이 캠프로 와서 대원을 친다. 캠프에 서 있기만 하는 대원은 가장 이르면 4초에 처음 맞고 9초에 쓰러진다
// (2026-11-13에 시드 300개로 잰 값). 맞거나 받아친 기술은 그 순간 기술 목록에서 빠지므로, 기술이 스냅샷에 보이는지로 확인하는
// 검사가 근처에 온 적 하나에 흔들린다.
const quietRoom = '/?layout=quiet';

function observe(page: Page) {
  let snapshot: Snapshot | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framereceived', frame => {
    try { const data = JSON.parse(frame.payload.toString()); if (data.type === 'snapshot') snapshot = data; } catch { }
  }));
  return { get state() { return snapshot; }, get player() { return snapshot?.players.find(p => p.id === snapshot?.you); }, errors };
}

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
  // 타격은 뗀 것이 되어 장판이 나가고, 나중에 누른 우클릭(받아치기)이 타격이 끝난 뒤 이어서 나가야 한다.
  await expect.poll(() => me.player?.busy).toBe(0);
  await page.mouse.down({ button: 'left' });
  await expect.poll(() => me.player?.actions.at(-1)?.slot).toBe(1);
  await page.mouse.down({ button: 'right' });
  await expect.poll(() => me.player?.actions.at(-1)?.slot).toBe(2);
  // 좌클릭부터 떼는 것도 pointermove로만 알린다. 뗀 것을 놓치면 받아치기의 기운이 최대 시간까지 이어진다.
  await page.mouse.up({ button: 'left' });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => me.player?.busy).toBe(0);
  const settled = me.player!.mana;
  await page.waitForTimeout(700);
  expect(me.player!.mana).toBe(settled);
  expect(me.player!.state).toBe('alive');
  expect(me.errors).toEqual([]);
});

test('a skill key held through deployment does not cast after landing until it is pressed again', async ({ page }) => {
  const me = observe(page);
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
  // 같은 슬롯의 다른 키(Digit3)를 새로 눌렀다 떼면 잡기는 한 번만 나간다. 아직 쥐고 있는 Space로 이어지면 안 된다.
  await page.keyboard.down('Digit3');
  await expect.poll(() => me.player?.mana).toBe(23);
  await page.keyboard.up('Digit3');
  await page.waitForTimeout(1500);
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
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit1' }));
  });
  await expect.poll(() => me.player?.mana).toBe(23);
  // 한 번만 나간다. 뗀 뒤에 다시 나가지 않는다.
  await page.waitForTimeout(1500);
  expect(me.player!.mana).toBe(23);
  expect(me.errors).toEqual([]);
});

test('a press goes out once in press, apart from the slot that stays held', async ({ page }) => {
  const me = observe(page);
  const inputs: { slot: number; press: number }[] = [];
  page.on('websocket', ws => ws.on('framesent', frame => {
    try { const data = JSON.parse(frame.payload.toString()); if (data.type === 'input') inputs.push(data); } catch { }
  }));
  // 누름과 뗌을 한 작업 안에서 일으켜, 두 입력 사이에 눌렀다 뗀 짧은 누름을 만든다.
  const tap = (code: string) => page.evaluate(code => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }, code);
  const pressed = (slot: number) => inputs.filter(input => input.press === slot);
  await page.goto(quietRoom);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect.poll(() => me.player?.state).toBe('waiting');
  await page.getByRole('button', { name: '캠프 선택' }).click();
  await page.locator('#deploy').click();
  await expect.poll(() => me.player?.state, { timeout: 8000 }).toBe('alive');

  // 쥐고 있는 기술은 slot으로 계속 보내고, 누른 순간의 입력 하나에만 press가 실린다.
  await page.keyboard.down('Digit1');
  await expect.poll(() => inputs.filter(input => input.slot === 1).length).toBeGreaterThan(3);
  expect(pressed(1).map(input => input.slot)).toEqual([1]);
  // 쥔 채 다른 기술을 짧게 누른다. 서버가 짧은 누름을 쥐고 있음으로 여기지 않게 slot은 쥐고 있는 기술 그대로다.
  await tap('Digit2');
  await expect.poll(() => pressed(2).length).toBe(1);
  expect(pressed(2)[0].slot).toBe(1);
  await page.keyboard.up('Digit1');
  await expect.poll(() => inputs.at(-1)?.slot).toBe(0);
  // 아무것도 쥐지 않고 짧게 누르면 slot은 0이다. 기술을 쓰는 중이어서 서버가 버려도, 뒤늦게 나갈 쥐고 있음이 남지 않는다.
  await tap('Digit3');
  await expect.poll(() => pressed(3).length).toBe(1);
  expect(pressed(3)[0].slot).toBe(0);
  await page.waitForTimeout(200);
  expect(inputs.filter(input => input.press > 0)).toHaveLength(3);
  expect(me.errors).toEqual([]);
});

test('a held skill key keeps the aura going, the zone goes out on release, and holding on does not cast again', async ({ page }) => {
  const me = observe(page);
  // 장판은 0.24초만 깔려 있어 스냅샷 한두 장에만 보인다. 마지막 스냅샷만 보면 놓치므로, 받은 스냅샷마다 내 기술을 적어 둔다.
  const seen: { id: number; phase: string; held: number }[] = [];
  page.on('websocket', ws => ws.on('framereceived', frame => {
    try {
      const data = JSON.parse(frame.payload.toString());
      if (data.type !== 'snapshot') return;
      const action = data.players.find((p: { id: string }) => p.id === data.you)?.actions.at(-1);
      if (action) seen.push({ id: action.id, phase: action.phase, held: action.contactAt - action.startedAt });
    } catch { }
  }));
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
  // 서버는 계속 누른다고 보고 장판이 나갈 시각을 최대 기운 시간(시작 1초 뒤)으로 알린다.
  await page.keyboard.down('Digit1');
  await expect.poll(() => action()?.phase).toBe('aura');
  const first = action()!.id;
  await page.waitForTimeout(500);
  expect(action()!.id).toBe(first);
  expect(action()!.phase).toBe('aura');
  expect(action()!.contactAt - action()!.startedAt).toBeCloseTo(maxAura, 1);
  // 기술 막대는 지금 단계를 적는다.
  await expect(page.locator('#skill-bar .skill-slot.active small')).toHaveText('기운');
  // 떼면 장판이 나간다. 장판이 나간 시각은 뗀 때라, 시작 0.18초 뒤도 최대 기운 시간도 아니다.
  await page.keyboard.up('Digit1');
  await expect.poll(() => me.player?.busy).toBe(0);
  const released = seen.filter(entry => entry.id === first && entry.phase === 'zone');
  expect(released.length, '장판이 나간 스냅샷').toBeGreaterThan(0);
  expect(released[0].held).toBeGreaterThan(.45);
  expect(released[0].held).toBeLessThan(.95);
  expect(me.player!.mana).toBe(23);

  // 끝까지 누르고 있으면 최대 기운 시간에 장판이 나가고, 기술이 끝나도 다시 나가지 않는다.
  await page.keyboard.down('Digit1');
  await expect.poll(() => action()?.phase).toBe('aura');
  const second = action()!.id;
  expect(second).not.toBe(first);
  await expect.poll(() => seen.some(entry => entry.id === second && entry.phase !== 'aura'), { timeout: 3000 }).toBe(true);
  const forced = seen.filter(entry => entry.id === second && entry.phase !== 'aura');
  expect(forced[0].held).toBeCloseTo(maxAura, 1);
  await expect.poll(() => me.player?.actions.length).toBe(0);
  await page.waitForTimeout(1200);
  expect(me.player!.actions).toHaveLength(0);
  expect(me.player!.mana).toBe(22);
  // 그동안 다른 기술이 시작되지 않았다.
  expect(new Set(seen.map(entry => entry.id)).size).toBe(2);
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
    send({ type: 'input', seq: 0, moveX: 0, moveY: 0, aim: 0, slot: 0, x: 1300, y: 1200, hp: 999, mana: 999, damage: 999 });
    await expect.poll(() => self()?.ack).toBe(0);
    expect(self()!.x).toBe(camp.x); expect(self()!.mana).toBe(0); expect(self()!.hp).toBe(6);
    send({ type: 'input', seq: 1, moveX: 100, moveY: 0, aim: 0, slot: 0 });
    send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, slot: 9 });
    send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, slot: 2.5 });
    send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, slot: 'strike' });
    send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, slot: 0, press: 9 });
    send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, slot: 0, press: -1 });
    send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, slot: 0, press: 2.5 });
    send({ type: 'input', seq: 1, moveX: 0, moveY: 0, aim: 0, slot: 0, press: 'strike' });
    send({ type: 'input', seq: 0, moveX: 1, moveY: 0, aim: 0, slot: 0 });
    // 앞의 입력은 모두 거절되므로 받은 순번이 그대로다. 잘못 받았다면 순번 1이 ack에 나타난다.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(self()!.ack).toBe(0);
    send({ type: 'loadout', slots: ['strike', 'parry', 'grab', 'grab'] });
    send({ type: 'deploy', x: 1000, y: 700 });
    // 마나가 0이라 눌러도 기술이 나가지 않는다.
    send({ type: 'input', seq: 2, moveX: 0, moveY: 0, aim: 0, slot: 1, press: 1 });
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
