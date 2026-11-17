import { expect, test, type Page } from '@playwright/test';
import { inviteLink, localOnly, readInvite, withoutInvite } from '../src/invite';
import { quietRoom } from './rooms';

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
  // 두 버튼 모두 줄의 폭을 다 쓴다.
  expect(Math.abs(join.width - create.width)).toBeLessThanOrEqual(1);
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
  // 방 코드의 모양이 아니면 초대로 치지 않는다. 0과 1은 방 코드에 쓰지 않는 글자다.
  for (const bad of ['?room=', '?room=ABC23', '?room=ABC2345', '?room=ABC01A', '?room=%3Cb%3Ex', '?room=AB%20C234']) {
    expect(readInvite(bad), bad).toEqual({ malformed: true });
  }
  // 초대를 쓰고 난 뒤의 주소다. 다른 인자와 # 뒤는 남긴다.
  expect(withoutInvite('https://argus.example/?room=ABC234')).toBe('/');
  expect(withoutInvite('https://argus.example/?layout=quiet&room=ABC234#top')).toBe('/?layout=quiet#top');
  expect(withoutInvite('https://argus.example/?layout=quiet')).toBe('/?layout=quiet');
  // 남은 인자를 읽는 쪽(has('touch'))에는 차이가 없다.
  expect(new URLSearchParams(withoutInvite('https://argus.example/?touch&room=ABC234').split('?')[1]).has('touch')).toBe(true);
});

test('only an address that opens on this device alone counts as local', () => {
  for (const host of ['localhost', 'LOCALHOST', 'argus.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1']) expect(localOnly(host), host).toBe(true);
  // 같은 공유기의 사설 주소는 같은 망의 사람이 열 수 있다. 공개 주소와 터널 주소도 물론 열린다.
  for (const host of ['192.168.0.7', '10.0.0.2', '172.17.0.1', 'argus.example', 'abc.trycloudflare.com', '1270.0.0.1', 'localhost.example', '[fe80::1]']) {
    expect(localOnly(host), host).toBe(false);
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
    const link = `${baseURL}/?room=${code}`;
    await expect.poll(() => host.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([link]);
    // 검사 서버의 주소는 127.0.0.1이다. 그 링크는 다른 사람의 기기에서 열리지 않으므로 함께 알린다.
    // 알림 상자에는 방에 들어올 때의 안내("Host 합류")가 함께 떠 있을 수 있어, 복사 알림의 줄만 본다.
    await expect(host.locator('#toast div').filter({ hasText: '초대 링크' })).toHaveText('초대 링크를 복사했습니다. 단, 이 주소는 이 PC에서만 열립니다.');

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
    // 한글을 조합하는 중의 Enter는 글자를 확정하는 것이라 참가로 치지 않는다.
    await guest.locator('#callsign').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await guest.waitForTimeout(300);
    await expect(guest.locator('#lobby')).toBeVisible();
    await guest.keyboard.press('Enter');
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
    await guest.locator('#callsign').press('Enter');
    await guest.waitForTimeout(300);
    await expect(guest.locator('#lobby')).toBeVisible();
  } finally { await context.close(); }
});

test('the invited lobby also joins with its button, and starting a new operation instead uses the invite up', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  try {
    const code = await openRoom(host, 'Host');
    const guest = await context.newPage();
    await guest.goto(`${baseURL}/?room=${code}`);
    await expectInvited(guest, code);
    await guest.locator('#join').click();
    await expect(guest.locator('#room-code')).toHaveText(code);
    expect(new URL(guest.url()).search).toBe('');

    // 초대받았지만 새 작전을 시작하면 새 방에 들어가고, 초대는 다 쓴 것이 된다. 다른 인자(?layout=quiet)는 주소에 남는다.
    const other = await context.newPage();
    await other.goto(`${baseURL}/?layout=quiet&room=${code}`);
    await expectInvited(other, code);
    await other.locator('#create').click();
    await expect(other.locator('#room-code')).not.toHaveText('------');
    expect(await other.locator('#room-code').innerText()).not.toBe(code);
    expect(new URL(other.url()).search).toBe('?layout=quiet');
    await other.getByRole('button', { name: /작전에서 나가기/ }).click();
    await expectOrdinary(other);
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
});

test('an invite to another room is shown instead of going back to the saved room, and an invite to my own room just goes back', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const mine = await context.newPage(), theirs = await context.newPage();
  try {
    const myRoom = await openRoom(mine, 'Mine');
    const theirRoom = await openRoom(theirs, 'Theirs');
    expect(theirRoom).not.toBe(myRoom);
    // 내 방의 초대 링크를 같은 탭에서 열면, 이미 그 방의 대원이므로 새로 참가하지 않고 그대로 돌아간다.
    await mine.goto(`${baseURL}/?room=${myRoom}`);
    await expect(mine.locator('#room-code')).toHaveText(myRoom);
    await expect(mine.locator('#team-count')).toHaveText('1 / 4');
    expect(new URL(mine.url()).search).toBe('');
    // 다른 방의 초대 링크를 같은 탭에서 열면, 있던 방으로 돌아가지 않고 그 방의 참가를 보인다.
    await mine.goto(`${baseURL}/?room=${theirRoom}`);
    await expectInvited(mine, theirRoom);
    await expect(mine.locator('#operation')).toBeHidden();
    // 참가하지 않고 뒤로 가면 있던 방으로 돌아간다. 복구 정보를 지우지 않았기 때문이다.
    await mine.goBack();
    await expect(mine.locator('#room-code')).toHaveText(myRoom);
    await expect(mine.locator('#team-count')).toHaveText('1 / 4');
    // 다시 그 링크를 열어 참가하면 그 방의 둘째 대원이 된다.
    await mine.goto(`${baseURL}/?room=${theirRoom}`);
    await mine.locator('#join').click();
    await expect(mine.locator('#room-code')).toHaveText(theirRoom);
    await expect(mine.locator('#team-count')).toHaveText('2 / 4');
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
    document.execCommand = (command: string) => {
      const field = document.activeElement as HTMLTextAreaElement | null;
      if (command === 'copy' && field && state.copyWorks) copied.push(`${field.readOnly ? '읽기 전용' : '쓰기 가능'}:${field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)}`);
      return state.copyWorks;
    };
  });
  const code = await openRoom(page, 'Host');
  const link = `${baseURL}/?room=${code}`;
  const copied = () => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  const button = page.getByRole('button', { name: /초대 링크 복사/ });
  await button.click();
  // 주소 전체를 골라 복사했다. 입력란은 읽기 전용이라 휴대폰에서 자판이 뜨지 않는다.
  await expect.poll(copied).toEqual([`읽기 전용:${link}`]);
  await expect(page.locator('#toast')).toContainText('초대 링크를 복사했습니다');
  // 쓰고 난 입력란은 남지 않고, 커서는 누른 버튼으로 돌아온다.
  expect(await page.locator('textarea').count()).toBe(0);
  await expect(button).toBeFocused();
  // 클립보드에 쓸 권한이 없어 실패했을 때도 같은 방법으로 복사한다.
  await page.evaluate(() => { (window as unknown as { clipboardRejects: boolean }).clipboardRejects = true; });
  await button.click();
  await expect.poll(copied).toEqual([`읽기 전용:${link}`, `읽기 전용:${link}`]);
  // 그것도 안 되면 방 코드를 보인다. 긴 주소는 알림에 띄워도 옮겨 적을 수 없다.
  await page.evaluate(() => { (window as unknown as { copyWorks: boolean }).copyWorks = false; });
  await button.click();
  await expect(page.locator('#toast')).toContainText(`복사하지 못했습니다. 초대 코드: ${code}`);
  expect(await page.locator('textarea').count()).toBe(0);
});

test('on a phone the invited lobby still fits one screen, and a tap on the first button joins', async ({ browser, baseURL }) => {
  const host = await browser.newContext();
  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  try {
    const code = await openRoom(await host.newPage(), 'Host');
    const page = await phone.newPage();
    await page.goto(`${baseURL}/?room=${code}`);
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
