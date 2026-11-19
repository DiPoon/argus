import { expect, test, type Page } from '@playwright/test';
import { copiedNotices, inviteLink, linkReach, normalizeRoomCode, readInvite, withoutInvite } from '../src/invite';
import { quietRoom } from './rooms';

// 검사 서버 주소로 만든 초대 링크다. 화면은 주소의 출처와 경로(/)로 링크를 만든다. ARGUS_URL 끝에 빗금이 붙어 있어도 같은 값이 된다(PR #31 리뷰 7).
const linkTo = (baseURL: string | undefined, code: string) => new URL(`/?room=${code}`, baseURL).href;
// 검사 서버 주소로 연 화면에서 초대 링크를 복사했을 때의 알림이다. 127.0.0.1이면 이 PC에서만 열린다는 알림이고, 사설 주소나 터널이면 다르다.
const copiedNotice = (baseURL: string | undefined) => copiedNotices[linkReach(new URL(baseURL!).hostname)];

// act가 방 요청(방 만들기·참가, /api/rooms…)을 몇 번 보냈는지 센다. 참가는 누른 그 자리에서 요청을 보내므로(enter가 무엇을 기다리기 전에
// fetch를 부른다) 키를 누르는 동작이 끝난 뒤에 바로 세면 된다. 시간을 두고 기다렸다가 로비가 보이는지로 보면, 요청이 그 시간보다 늦게
// 끝나는 판에서 잘못 보낸 참가를 놓친다(PR #31 리뷰 8). 보낸 요청을 세는지는 같은 도우미로 실제 참가를 세어 확인한다.
async function roomRequests(page: Page, act: () => Promise<void>) {
  await page.evaluate(() => {
    const state = window as unknown as { roomRequests: number; plainFetch?: typeof fetch };
    state.roomRequests = 0;
    state.plainFetch ??= window.fetch;
    const plain = state.plainFetch;
    window.fetch = (input, init) => {
      if (String(input).startsWith('/api/rooms')) state.roomRequests += 1;
      return plain(input, init);
    };
  });
  await act();
  return page.evaluate(() => (window as unknown as { roomRequests: number }).roomRequests);
}

// 장비 칸의 마지막 선택지에서 Tab을 누르면 가는 버튼이다. 화면에서 위에 있는 주된 버튼이어야 한다(PR #31 리뷰 6).
async function expectTabTo(page: Page, id: string) {
  await page.locator('input[name="free-slot"]:checked').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(`#${id}`)).toBeFocused();
}

// 두 요소의 DOM 차례다. 화면의 차례(아래 견주는 자리)와 같아야 Tab과 화면 읽기 프로그램이 화면의 차례대로 간다.
const comesBefore = (page: Page, first: string, second: string) =>
  page.evaluate(([a, b]) => Boolean(document.querySelector(a)!.compareDocumentPosition(document.querySelector(b)!) & Node.DOCUMENT_POSITION_FOLLOWING), [first, second]);

// 초대 링크다(2026-11-17 사용자 요청). 방 코드만 복사해 보내면 받은 사람이 코드를 복사하고, 게임 주소를 열고, 코드를 붙여 넣어야 했다.
// 옆 패널의 버튼이 방 코드를 실은 주소(?room=방 코드)를 복사하고, 그 주소를 연 로비는 그 방의 참가를 앞세운다.

// 조용한 방을 만들고 방 코드를 돌려준다.
async function openRoom(page: Page, name: string) {
  await page.goto(quietRoom);
  await page.getByLabel('호출명').fill(name);
  await page.getByRole('button', { name: '새 작전 시작' }).click();
  await expect(page.locator('#room-code')).not.toHaveText('------');
  return page.locator('#room-code').innerText();
}

// 초대받은 로비다. 참가 버튼이 주된 버튼이 되어 방 코드를 보이고 새 작전 시작 위에 온다. 방 코드 입력란은 숨기고 값만 채워 둔다.
async function expectInvited(page: Page, code: string) {
  await expect(page.locator('#lobby')).toHaveClass(/\binvited\b/);
  await expect(page.locator('#join')).toHaveText(`${code} 방에 참가 ↗`);
  await expect(page.locator('#join')).toHaveClass('primary');
  await expect(page.locator('#create')).toHaveClass('secondary');
  await expect(page.locator('#room-input')).toBeHidden();
  await expect(page.locator('#room-input')).toHaveValue(code);
  const join = (await page.locator('#join').boundingBox())!, create = (await page.locator('#create').boundingBox())!;
  expect(join.y + join.height).toBeLessThanOrEqual(create.y);
  expect(await comesBefore(page, '#join', '#create'), 'DOM에서도 참가 버튼이 앞').toBe(true);
  // 두 버튼 모두 줄의 폭을 다 쓴다.
  expect(Math.abs(join.width - create.width)).toBeLessThanOrEqual(1);
  // PC 로비의 구분선("또는")은 두 버튼 사이에 있다. 터치 로비에는 구분선이 없다.
  const divider = await dividerBox(page);
  if (divider) expect([join.y + join.height <= divider.y, divider.y + divider.height <= create.y]).toEqual([true, true]);
}

// PC 로비에서 새 작전 시작과 참가 줄 사이에 있는 구분선의 자리다. 터치 로비에는 없다.
async function dividerBox(page: Page) {
  const divider = page.locator('.or');
  return await divider.count() > 0 ? divider.boundingBox() : null;
}

// 평소 로비다. 새 작전 시작이 주된 버튼이고 방 코드 입력란이 보인다.
async function expectOrdinary(page: Page) {
  await expect(page.locator('#lobby')).not.toHaveClass(/\binvited\b/);
  await expect(page.locator('#join')).toHaveText('참가');
  await expect(page.locator('#join')).toHaveClass('secondary');
  await expect(page.locator('#create')).toHaveClass('primary');
  await expect(page.locator('#room-input')).toBeVisible();
  const join = (await page.locator('#join').boundingBox())!, create = (await page.locator('#create').boundingBox())!;
  expect(create.y + create.height).toBeLessThanOrEqual(join.y);
  expect(await comesBefore(page, '#create', '#join'), 'DOM에서도 새 작전 시작이 앞').toBe(true);
  const divider = await dividerBox(page);
  if (divider) expect([create.y + create.height <= divider.y, divider.y + divider.height <= join.y]).toEqual([true, true]);
}

test('an invite link carries only the room code, and the address gives it back', () => {
  expect(inviteLink('https://argus.example', '/', 'ABC234')).toBe('https://argus.example/?room=ABC234');
  expect(readInvite('?room=ABC234')).toEqual({ room: 'ABC234', malformed: false });
  // 다른 인자와 섞여 있어도, 소문자로 적혀 있어도, 앞뒤에 빈칸이 붙어 있어도 읽는다.
  expect(readInvite('?touch&room=abc234')).toEqual({ room: 'ABC234', malformed: false });
  expect(readInvite('?room=%20ABC234%20&layout=quiet')).toEqual({ room: 'ABC234', malformed: false });
  // 초대가 없는 주소다.
  expect(readInvite('')).toEqual({ malformed: false });
  expect(readInvite('?layout=quiet&touch')).toEqual({ malformed: false });
  // 방 코드의 모양이 아니면 초대로 치지 않는다. I·O·0·1은 서버가 방 코드에 쓰지 않는 글자다(RoomHost.NewCode, PR #31 리뷰 9).
  for (const bad of ['?room=', '?room=ABC23', '?room=ABC2345', '?room=ABC01A', '?room=ABCIOZ', '?room=abc2i4', '?room=O23456', '?room=%3Cb%3Ex', '?room=AB%20C234']) {
    expect(readInvite(bad), bad).toEqual({ malformed: true });
  }
  // 서버가 쓰는 글자는 모두 받는다. 입력란에 친 코드도 같은 함수로 맞춘다.
  expect(readInvite('?room=ABCDEF')).toEqual({ room: 'ABCDEF', malformed: false });
  expect(readInvite('?room=HJKLMN')).toEqual({ room: 'HJKLMN', malformed: false });
  expect(readInvite('?room=PQRSTU')).toEqual({ room: 'PQRSTU', malformed: false });
  expect(readInvite('?room=VWXYZ9')).toEqual({ room: 'VWXYZ9', malformed: false });
  expect(readInvite('?room=G23456')).toEqual({ room: 'G23456', malformed: false });
  expect(normalizeRoomCode(' hjk234 ')).toBe('HJK234');
  expect(normalizeRoomCode('HJKI34')).toBeUndefined();
  // 초대를 쓰고 난 뒤의 주소다. 다른 인자와 # 뒤는 남긴다.
  expect(withoutInvite('https://argus.example/?room=ABC234')).toBe('/');
  expect(withoutInvite('https://argus.example/?layout=quiet&room=ABC234#top')).toBe('/?layout=quiet#top');
  expect(withoutInvite('https://argus.example/?layout=quiet')).toBe('/?layout=quiet');
  // 남은 인자를 읽는 쪽(has('touch'))에는 차이가 없다.
  expect(new URLSearchParams(withoutInvite('https://argus.example/?touch&room=ABC234').split('?')[1]).has('touch')).toBe(true);
});

test('the copied link is told to open on this device alone, on the same network, or anywhere', () => {
  // 이 기기에서만 열린다. 0.0.0.0과 ::는 서버를 모든 주소에서 받게 띄웠을 때 콘솔에 찍히는 주소다(PR #31 리뷰 4).
  // IPv4 매핑 루프백은 주소창이 [::ffff:7f00:1]처럼 적는다.
  for (const host of ['localhost', 'LOCALHOST', 'argus.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', '0.0.0.0', '[::]', '[::ffff:7f00:1]', '[::ffff:7fff:ffff]', '::ffff:127.0.0.1']) {
    expect(linkReach(host), host).toBe('device');
  }
  // 같은 망(공유기)의 기기에서만 열린다. 망 밖의 친구에게는 열리지 않는다(PR #31 리뷰 14).
  for (const host of ['192.168.0.7', '10.0.0.2', '172.16.0.1', '172.31.255.1', '172.17.0.1', '169.254.3.4', '[fe80::1]', '[febf::1]', '[fd12:3456::1]', '[fc00::1]', 'argus-pc.local', 'argus-pc']) {
    expect(linkReach(host), host).toBe('network');
  }
  // 그 밖은 어디서나 열린다고 본다. 사설 대역의 바로 바깥과, 앞의 0을 뺀 묶음(fd1은 0fd1이다)도 여기다.
  for (const host of ['argus.example', 'abc.trycloudflare.com', '1270.0.0.1', 'localhost.example', '172.15.0.1', '172.32.0.1', '8.8.8.8', '[2001:db8::1]', '[fd1::1]', '[fe7f::1]', '[::ffff:808:808]']) {
    expect(linkReach(host), host).toBe('anywhere');
  }
});

test('the side panel button copies an invite link, and the link opens a lobby that puts joining that room first', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  try {
    // 클립보드에 쓴 글을 붙잡는다.
    await host.addInitScript(() => {
      const copied: string[] = [];
      Object.assign(window, { copied });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } } });
    });
    const code = await openRoom(host, 'Host');
    await host.getByRole('button', { name: /초대 링크 복사/ }).click();
    // 방 코드만이 아니라 주소째로 복사한다. 방을 만들 때 쓴 인자(?layout=quiet)는 싣지 않는다.
    const link = linkTo(baseURL, code);
    await expect.poll(() => host.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([link]);
    // 검사 서버의 주소가 127.0.0.1이면 그 링크는 다른 사람의 기기에서 열리지 않으므로 함께 알린다. 다른 주소로 돌리면 그 주소에 맞는 알림이다.
    // 알림 상자에는 방에 들어올 때의 안내("Host 합류")가 함께 떠 있을 수 있어, 복사 알림의 줄만 본다.
    await expect(host.locator('#toast div').filter({ hasText: '초대 링크' })).toHaveText(copiedNotice(baseURL));

    // 받은 사람이 링크를 연다. 같은 브라우저의 새 탭이라 별도 게스트다.
    const guest = await context.newPage();
    await guest.goto(link);
    await expectInvited(guest, code);
    // 패널 머리의 안내와 구분선의 글도 초대받은 쪽이 보인다. 평소의 글은 숨는다.
    await expect(guest.locator('.loadout-panel .muted .if-invited')).toBeVisible();
    await expect(guest.locator('.loadout-panel .muted')).toHaveText(new RegExp(`^${code} 방에 초대받았습니다`), { useInnerText: true });
    await expect(guest.locator('.or')).toHaveText('또는', { useInnerText: true });
    // 호출명 입력란에 커서가 있고 글이 골라져 있다. 이름을 적고 Enter를 누르면 그 방에 들어간다.
    await expect(guest.locator('#callsign')).toBeFocused();
    await guest.keyboard.type('Invited');
    // 골라져 있던 기본 이름("대원")이 적은 글로 바뀐다. 커서만 있고 글이 골라져 있지 않으면 기본 이름에 덧붙는다.
    await expect(guest.locator('#callsign')).toHaveValue('Invited');
    // 한글을 조합하는 중의 Enter는 글자를 확정하는 것이라 참가로 치지 않는다. 조합을 마친 Enter는 참가 요청을 한 번 보낸다.
    expect(await roomRequests(guest, () => guest.locator('#callsign').dispatchEvent('keydown', { key: 'Enter', isComposing: true })), '조합 중의 Enter').toBe(0);
    expect(await roomRequests(guest, () => guest.keyboard.press('Enter')), '조합을 마친 Enter').toBe(1);
    await expect(guest.locator('#room-code')).toHaveText(code);
    await expect(guest.locator('#team-count')).toHaveText('2 / 4');
    await expect(guest.locator('#roster')).toContainText('Invited');
    await expect(host.locator('#team-count')).toHaveText('2 / 4');
    // 들어간 뒤에는 주소에서 초대가 빠진다. 방에서 나오면 평소 로비가 보이고, 그 방의 코드는 입력란에 남아 있다.
    expect(new URL(guest.url()).search).toBe('');
    await guest.getByRole('button', { name: /작전에서 나가기/ }).click();
    await expectOrdinary(guest);
    await expect(guest.locator('.or')).toHaveText('초대받았다면', { useInnerText: true });
    await expect(guest.locator('.loadout-panel .muted')).toHaveText('혼자 시작해도, 작전 중 함께해도 됩니다.', { useInnerText: true });
    await expect(guest.locator('#room-input')).toHaveValue(code);
    // 평소 로비에서는 호출명 입력란의 Enter가 아무 일도 하지 않는다. 새 작전을 시작할지 참가할지 알 수 없다.
    expect(await roomRequests(guest, () => guest.locator('#callsign').press('Enter')), '평소 로비의 Enter').toBe(0);
    await expect(guest.locator('#lobby')).toBeVisible();
    // Tab 차례도 화면의 차례다. 장비 칸 다음은 위에 있는 새 작전 시작이다.
    await expectTabTo(guest, 'create');
  } finally { await context.close(); }
});

test('the invited lobby also joins with its button, and starting a new operation instead uses the invite up', async ({ browser }) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  try {
    const code = await openRoom(host, 'Host');
    const guest = await context.newPage();
    await guest.goto(`/?room=${code}`);
    await expectInvited(guest, code);
    // Tab 차례도 화면의 차례다. 장비 칸 다음은 위에 있는 참가 버튼이다. 아래의 새 작전 시작에 먼저 가면, Tab 한 번 뒤 Enter로
    // 참가하려던 사람이 새 방을 만든다(PR #31 리뷰 6).
    await expectTabTo(guest, 'join');
    await guest.locator('#join').click();
    await expect(guest.locator('#room-code')).toHaveText(code);
    expect(new URL(guest.url()).search).toBe('');

    // 초대받았지만 새 작전을 시작하면 새 방에 들어가고, 초대는 다 쓴 것이 된다. 다른 인자(?layout=quiet)는 주소에 남는다.
    const other = await context.newPage();
    await other.goto(`/?layout=quiet&room=${code}`);
    await expectInvited(other, code);
    await other.locator('#create').click();
    await expect(other.locator('#room-code')).not.toHaveText('------');
    expect(await other.locator('#room-code').innerText()).not.toBe(code);
    expect(new URL(other.url()).search).toBe('?layout=quiet');
    await other.getByRole('button', { name: /작전에서 나가기/ }).click();
    await expectOrdinary(other);
  } finally { await context.close(); }
});

test('an invite is kept until that room is actually entered, so a connection refused right after joining still offers that room', async ({ browser }) => {
  const context = await browser.newContext();
  const host = await context.newPage(), guest = await context.newPage();
  try {
    const code = await openRoom(host, 'Host');
    // 참가 답(HTTP)은 받았지만 접속이 1008로 닫힌다. 서버에 닿지 않고 가운데서 닫아, 들어가지 못한 장면을 만든다.
    // 초대를 참가 답을 받은 때 치우면 이때 로비가 평소 로비가 되어, 받은 링크로 그 방에 다시 들어갈 길이 없다(PR #31 리뷰 13).
    let refuse = true;
    await guest.routeWebSocket(/\/ws$/, ws => {
      if (refuse) ws.close({ code: 1008, reason: '참가 정보가 만료되었습니다' });
      else ws.connectToServer();
    });
    await guest.goto(`/?room=${code}`);
    await guest.locator('#join').click();
    await expect(guest.locator('#lobby-error')).toHaveText('참가 정보가 만료되었습니다. 다시 참가해 주세요.');
    await expectInvited(guest, code);
    expect(new URL(guest.url()).search).toBe(`?room=${code}`);
    // 다시 참가를 누르면 그 방에 들어간다. 그 방의 첫 스냅샷을 받은 뒤에야 초대가 빠진다.
    refuse = false;
    await guest.locator('#join').click();
    await expect(guest.locator('#room-code')).toHaveText(code);
    expect(new URL(guest.url()).search).toBe('');
  } finally { await context.close(); }
});

test('an invite to a room that cannot be entered gives the ordinary lobby back with the reason', async ({ page }) => {
  // 방 코드의 모양은 맞지만 없는 방이다(끝난 방의 옛 링크를 다시 연 경우).
  await page.goto('/?room=ZZZZZ2');
  await expectInvited(page, 'ZZZZZ2');
  await page.locator('#join').click();
  await expect(page.locator('#lobby-error')).toHaveText('방이 없거나, 가득 찼거나, 종료된 작전입니다.');
  // 초대를 치워 새 작전 시작이 다시 주된 버튼이다. 방 코드는 입력란에 남는다.
  await expectOrdinary(page);
  await expect(page.locator('#room-input')).toHaveValue('ZZZZZ2');
  expect(new URL(page.url()).search).toBe('');
  // 새로 고쳐도 끝난 초대가 다시 나오지 않는다.
  await page.reload();
  await expectOrdinary(page);
});

test('a malformed invite is dropped with a note, and a lower-case code still counts', async ({ page }) => {
  await page.goto('/?room=abc');
  await expectOrdinary(page);
  await expect(page.locator('#lobby-error')).toContainText('초대 링크의 방 코드가 올바르지 않습니다');
  expect(new URL(page.url()).search).toBe('');
  await page.goto('/?room=abc234');
  await expectInvited(page, 'ABC234');
  await expect(page.locator('#lobby-error')).toBeEmpty();
  // 입력란에 친 코드도 같은 함수로 맞춘다(PR #31 리뷰 10). 서버가 쓰지 않는 글자(I·O)가 있으면 보내지 않고 바로 알린다.
  // 소문자는 맞춰서 보낸다(없는 방이라 들어가지는 못한다). 입력란은 여섯 자까지만 받아 앞뒤 빈칸은 주소로 받은 코드에서만 본다.
  await page.goto('/');
  await page.locator('#room-input').fill('abcio2');
  expect(await roomRequests(page, () => page.locator('#join').click()), '서버가 쓰지 않는 글자').toBe(0);
  await expect(page.locator('#lobby-error')).toHaveText('방 코드 6자리를 확인해 주세요.');
  await page.locator('#room-input').fill('zzzzz2');
  expect(await roomRequests(page, () => page.locator('#join').click()), '소문자').toBe(1);
  await expect(page.locator('#lobby-error')).toHaveText('방이 없거나, 가득 찼거나, 종료된 작전입니다.');
});

test('an invite to another room is shown instead of going back to the saved room, and an invite to my own room just goes back', async ({ browser }) => {
  const context = await browser.newContext();
  const mine = await context.newPage(), theirs = await context.newPage();
  try {
    const myRoom = await openRoom(mine, 'Mine');
    const theirRoom = await openRoom(theirs, 'Theirs');
    expect(theirRoom).not.toBe(myRoom);
    // 내 방의 초대 링크를 같은 탭에서 열면, 이미 그 방의 대원이므로 새로 참가하지 않고 그대로 돌아간다.
    await mine.goto(`/?room=${myRoom}`);
    await expect(mine.locator('#room-code')).toHaveText(myRoom);
    await expect(mine.locator('#team-count')).toHaveText('1 / 4');
    expect(new URL(mine.url()).search).toBe('');
    // 다른 방의 초대 링크를 같은 탭에서 열면, 있던 방으로 돌아가지 않고 그 방의 참가를 보인다.
    await mine.goto(`/?room=${theirRoom}`);
    await expectInvited(mine, theirRoom);
    await expect(mine.locator('#operation')).toBeHidden();
    // 참가하지 않고 뒤로 가면 있던 방으로 돌아간다. 복구 정보를 지우지 않았기 때문이다.
    await mine.goBack();
    await expect(mine.locator('#room-code')).toHaveText(myRoom);
    await expect(mine.locator('#team-count')).toHaveText('1 / 4');
    // 다시 그 링크를 열어 참가하면 그 방의 둘째 대원이 된다.
    await mine.goto(`/?room=${theirRoom}`);
    await mine.locator('#join').click();
    await expect(mine.locator('#room-code')).toHaveText(theirRoom);
    await expect(mine.locator('#team-count')).toHaveText('2 / 4');
    // 들어갈 수 없는 방(없는 방)의 링크를 같은 탭에서 열어 참가를 누르면, 로비에 남지 않고 있던 방으로 돌아간다.
    // 로비에 남기면 돌아갈 방이 없는 것처럼 보이는데, 새로 고치면 아무 조작 없이 그 방에 들어간다(PR #31 리뷰 5).
    await mine.goto('/?room=ZZZZZ2');
    await expectInvited(mine, 'ZZZZZ2');
    await mine.locator('#join').click();
    await expect(mine.locator('#operation')).toBeVisible();
    await expect(mine.locator('#toast')).toContainText('ZZZZZ2 방에는 들어갈 수 없어 있던 방으로 돌아왔습니다.');
    await expect(mine.locator('#room-code')).toHaveText(theirRoom);
    // 새로 참가하지 않고 그 대원으로 돌아갔다. 끝난 초대는 주소에서 빠지고, 방에서 나오면 평소 로비다.
    await expect(mine.locator('#team-count')).toHaveText('2 / 4');
    expect(new URL(mine.url()).search).toBe('');
    await mine.getByRole('button', { name: /작전에서 나가기/ }).click();
    await expectOrdinary(mine);
  } finally { await context.close(); }
});

test('an invite to my own room survives an expired saved entry, so the lobby still offers to join that room', async ({ browser }) => {
  const context = await browser.newContext();
  const host = await context.newPage(), page = await context.newPage();
  try {
    const code = await openRoom(host, 'Host');
    // 이 탭이 그 방에 있었는데 대원이 빠진 경우다(끊긴 채 2분이 지남). 복구 정보는 남아 있지만 서버는 그 토큰을 모른다.
    await page.goto('/?layout=quiet');
    await page.evaluate(room => sessionStorage.setItem('argus-guest', JSON.stringify({ room, id: 'gone', token: 'expired' })), code);
    // 같은 방의 초대 링크를 그 탭에서 연다. 복구를 먼저 해 보고, 서버가 만료된 토큰을 닫으면(1008) 그 방의 참가를 보인다.
    // 복구를 해 보기 전에 초대를 치우면, 들어오라고 받은 링크로 그 방에 들어갈 길이 없다(PR #31 리뷰 1).
    await page.goto(`/?room=${code}`);
    await expect(page.locator('#lobby-error')).toHaveText('참가 정보가 만료되었습니다. 다시 참가해 주세요.');
    await expectInvited(page, code);
    expect(new URL(page.url()).search).toBe(`?room=${code}`);
    await page.locator('#join').click();
    await expect(page.locator('#room-code')).toHaveText(code);
    await expect(page.locator('#team-count')).toHaveText('2 / 4');
    expect(new URL(page.url()).search).toBe('');
  } finally { await context.close(); }
});

test('without the clipboard API the link is copied through a selection, and a copy that fails shows the room code', async ({ page, baseURL }) => {
  // 사설 주소(http)로 연 화면에는 navigator.clipboard가 없다. 그때는 화면 밖의 입력란을 골라 복사한다.
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { copied, copyWorks: true, clipboardRejects: false });
    const state = window as unknown as { copyWorks: boolean; clipboardRejects: boolean };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => state.clipboardRejects ? { writeText: () => Promise.reject(new Error('denied')) } : undefined,
    });
    // 고른 범위를 정하는 호출을 적는다. 이 브라우저(Chromium)는 select()만으로도 글을 고르지만, 아이폰 Safari는 읽기 전용 입력란에서
    // select()만으로는 고르지 않아 범위를 따로 정해야 한다(PR #31 리뷰 2). 아이폰은 검사로 흉내 낼 수 없어 그 호출을 본다.
    const ranges: string[] = [];
    Object.assign(window, { ranges });
    const setRange = HTMLTextAreaElement.prototype.setSelectionRange;
    HTMLTextAreaElement.prototype.setSelectionRange = function (start, end, direction) {
      ranges.push(`${start}-${end}`);
      return setRange.call(this, start, end, direction);
    };
    // 복사하는 순간의 입력란을 적는다. 읽기 전용이라 휴대폰에서 자판이 뜨지 않고, 글자가 16px이라 아이폰이 화면을 확대하지 않는다(리뷰 3).
    document.execCommand = (command: string) => {
      const field = document.activeElement as HTMLTextAreaElement | null;
      if (command === 'copy' && field && state.copyWorks) {
        copied.push(`${field.readOnly ? '읽기 전용' : '쓰기 가능'}:${getComputedStyle(field).fontSize}:${field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)}`);
      }
      return state.copyWorks;
    };
  });
  const code = await openRoom(page, 'Host');
  const link = linkTo(baseURL, code);
  const copied = () => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  const button = page.getByRole('button', { name: /초대 링크 복사/ });
  await button.click();
  // 주소 전체를 골라 복사했다. 입력란은 읽기 전용이고 글자가 16px이다. 고른 범위도 주소 전체로 정했다.
  const entry = `읽기 전용:16px:${link}`;
  await expect.poll(copied).toEqual([entry]);
  expect(await page.evaluate(() => (window as unknown as { ranges: string[] }).ranges)).toEqual([`0-${link.length}`]);
  await expect(page.locator('#toast')).toContainText('초대 링크를 복사했습니다');
  // 쓰고 난 입력란은 남지 않고, 커서는 누른 버튼으로 돌아온다.
  expect(await page.locator('textarea').count()).toBe(0);
  await expect(button).toBeFocused();
  // 클립보드에 쓸 권한이 없어 실패했을 때도 같은 방법으로 복사한다.
  await page.evaluate(() => { (window as unknown as { clipboardRejects: boolean }).clipboardRejects = true; });
  await button.click();
  await expect.poll(copied).toEqual([entry, entry]);
  // 그것도 안 되면 방 코드를 보인다. 긴 주소는 알림에 띄워도 옮겨 적을 수 없다.
  await page.evaluate(() => { (window as unknown as { copyWorks: boolean }).copyWorks = false; });
  await button.click();
  await expect(page.locator('#toast')).toContainText(`복사하지 못했습니다. 초대 코드: ${code}`);
  expect(await page.locator('textarea').count()).toBe(0);
});

test('on a phone the invited lobby still fits one screen, and a tap on the first button joins', async ({ browser }) => {
  const host = await browser.newContext();
  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  try {
    const code = await openRoom(await host.newPage(), 'Host');
    const page = await phone.newPage();
    await page.goto(`/?room=${code}`);
    await expect(page.locator('body')).toHaveClass(/\btouch\b/);
    await expectInvited(page, code);
    // 터치 화면에서는 호출명 입력란에 커서를 두지 않는다. 자판이 로비를 덮는다.
    await expect(page.locator('#callsign')).not.toBeFocused();
    // 초대받은 로비도 휴대폰 가로 화면 한 장에 들어온다. 가장 낮고 좁은 가로 화면(568×320, 533×320)도 본다.
    // 참가 버튼과 새 작전 시작의 크기를 평소의 두 버튼과 같게 두었으므로 줄이 늘지 않는다.
    for (const size of [{ width: 844, height: 390 }, { width: 740, height: 320 }, { width: 568, height: 320 }, { width: 533, height: 320 }]) {
      await page.setViewportSize(size);
      const overflow = await page.evaluate(() => {
        const panel = document.querySelector('.loadout-panel')!;
        return {
          page: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
          panel: panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1,
        };
      });
      expect(overflow, `${size.width}x${size.height}`).toEqual({ page: false, panel: false });
      for (const target of [page.locator('#join'), page.locator('#create'), page.locator('#lobby-full'), page.locator('.touch-gear label').last()]) {
        await expect(target, `${size.width}x${size.height}`).toBeInViewport({ ratio: 1 });
      }
      // 참가 버튼의 글이 한 줄이다. 두 줄로 꺾이면 버튼이 높아진다.
      const lines = await page.locator('#join').evaluate(button => {
        const range = document.createRange();
        range.selectNodeContents(button.firstChild!);
        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
      });
      expect(lines, `${size.width}x${size.height} 참가 버튼의 줄 수`).toBe(1);
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.screenshot({ path: 'test-results/argus-touch-invited-lobby.png' });
    await page.locator('#join').tap();
    await expect(page.locator('#room-code')).toHaveText(code);
    await expect(page.locator('#team-count')).toHaveText('2 / 4');
  } finally { await host.close(); await phone.close(); }
});
