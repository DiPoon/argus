import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { Heard, maxCuesPerSnapshot, myHitReach, place, snapshotCues, type Cue, type CueKind } from '../src/cues';
import type { Snapshot } from '../src/types';
import { quietRoom } from './rooms';
import { relay } from './wire';

// 게임 소리(이슈 #35, 2026-11-24)다. 무엇을 울릴지(cues.ts)는 브라우저 없이 만든 스냅샷으로 보고, 소리를 내는 흐름(main.ts·sound.ts)은
// 소리 장치(AudioContext)를 기록하는 가짜로 바꿔 게임 서버의 조용한 방에서 본다. 검사 브라우저로는 실제 소리를 들을 수 없다.

type Partial2 = { [key: string]: unknown };
// cues.ts가 읽는 값만 채운 스냅샷이다. 나(p)는 (500, 500)에 서 있다.
function state(extra: Partial2 = {}): Snapshot {
  return {
    room: 'ROOM01', you: 'p', phase: 'active', result: null, extraction: null,
    players: [{ id: 'p', x: 500, y: 500, state: 'alive', hp: 6 }, { id: 'q', x: 900, y: 500, state: 'alive', hp: 6 }],
    effects: [], enemies: [], facilities: [], supplies: [],
    ...extra,
  } as unknown as Snapshot;
}
const effect = (id: number, kind: string, x: number, y = 500) => ({ id, kind, x, y, until: 9 });
const telegraph = (id: number, action: number, kind: string, x: number, tier = 1) =>
  ({ id, x, y: 500, action: { id: action, kind, tier, phase: 'telegraph' } });
const kinds = (cues: Cue[]) => cues.map(cue => cue.kind).sort();

// 내 체력을 hp로 바꾼 스냅샷이다.
const myHp = (hp: number, extra: Partial2 = {}) => state({ players: [{ id: 'p', x: 500, y: 500, state: 'alive', hp }, { id: 'q', x: 900, y: 500, state: 'alive', hp: 6 }], ...extra });

test('a new effect sounds once, and my own hurt is told by my health, not by where the hit landed', () => {
  const before = state({ effects: [effect(10, 'hit', 520)] });
  const effects = [effect(10, 'hit', 520), effect(11, 'break', 520), effect(12, 'hurt', 503), effect(13, 'hurt', 900), effect(14, 'unknown', 500)];
  const after = myHp(5, { effects });
  // 접속 직후(이전 스냅샷 없음)와 방이 바뀐 때는 지난 일을 울리지 않는다.
  expect(snapshotCues(undefined, after)).toEqual([]);
  expect(snapshotCues(state({ room: 'OTHER1' }), after)).toEqual([]);
  // 이미 들은 효과(10)와 모르는 종류(14)는 울리지 않는다. 내 체력이 줄었으면 내게 가장 가까운 피격(12)은 myHurt, 나머지 피격은 hurt다.
  const cues = snapshotCues(before, after);
  expect(kinds(cues)).toEqual(['break', 'hurt', 'myHurt']);
  expect(cues.find(cue => cue.kind === 'myHurt')).toMatchObject({ pan: 0, gain: 1 });
  // 같은 효과는 다음 스냅샷에서 다시 울리지 않는다.
  expect(snapshotCues(after, after)).toEqual([]);
  // 겹쳐 선 동료가 맞았다. 피격이 내 자리에 났지만 내 체력은 그대로라 동료가 맞은 소리다(PR #42 리뷰 1).
  expect(kinds(snapshotCues(state(), state({ effects: [effect(20, 'hurt', 503)] })))).toEqual(['hurt']);
  // 맞은 뒤 대시로 빠졌다. 피격은 내 자리에서 멀지만 내 체력이 줄었으므로 내가 맞은 소리다.
  expect(kinds(snapshotCues(state(), myHp(5, { effects: [effect(21, 'hurt', 650)] })))).toEqual(['myHurt']);
  // 피격 효과를 못 봤어도(한 장 놓침) 체력이 줄었으면 내가 맞은 소리를 낸다.
  expect(kinds(snapshotCues(state(), myHp(5)))).toEqual(['myHurt']);
  // 내 피격은 시야 밖이고(혼자 떨어져 맞음) 같은 0.1초에 멀리서 동료가 맞았다. 동료의 피격까지 내 것으로 지우지 않는다(PR #42 리뷰, ee96b62).
  expect(kinds(snapshotCues(state(), myHp(5, { effects: [effect(22, 'hurt', 500 + myHitReach + 10)] })))).toEqual(['hurt', 'myHurt']);
  // 같은 0.1초에 두 적에게 맞았다. 내 자리의 피격 둘은 모두 내가 맞은 소리 하나다.
  expect(kinds(snapshotCues(state(), myHp(4, { effects: [effect(23, 'hurt', 500), effect(24, 'hurt', 505)] })))).toEqual(['myHurt']);
});

test('the same kind of effect in one snapshot sounds once from the nearest, so a crowd does not add up', () => {
  // 회전 베기로 내 둘레의 병사 다섯을 한꺼번에 받아쳤다. 받아친 소리 다섯은 같은 순간에 시작해 파형이 똑같이 겹치므로, 가장 가까운 하나만
  // 낸다(PR #42 리뷰, ee96b62). 종류가 다르면 따로 낸다.
  const effects = [...[560, 540, 470, 455, 530].map((x, i) => effect(30 + i, 'break', x)), effect(40, 'hit', 900), effect(41, 'hit', 300)];
  const cues = snapshotCues(state(), state({ effects }));
  expect(kinds(cues)).toEqual(['break', 'hit']);
  expect(cues.find(cue => cue.kind === 'break')!.gain).toBeCloseTo(place(530, 500, { x: 500, y: 500 }).gain);
  expect(cues.find(cue => cue.kind === 'hit')!.pan).toBeLessThan(0);
});

test('a telegraph or an effect that leaves the view for a snapshot and comes back does not sound again', () => {
  // 모퉁이 너머 엘리트의 예고가 시선이 끊겼다 이어질 때마다 새 예고 소리로 다시 났다(PR #42 리뷰, ee96b62). 들은 것은 끝날 때까지 기억한다.
  const heard = new Heard();
  const seen = state({ now: 10, enemies: [{ ...telegraph(1, 100, 'channel', 700), action: { id: 100, kind: 'channel', tier: 2, phase: 'telegraph', endsAt: 12 } }], effects: [{ ...effect(50, 'hit', 650), until: 10.5 }] });
  const gone = state({ now: 10.1 });
  const back = state({ now: 10.2, enemies: seen.enemies, effects: seen.effects });
  expect(kinds(snapshotCues(state({ now: 9.9 }), seen, heard))).toEqual(['hit', 'telegraph']);
  expect(snapshotCues(seen, gone, heard)).toEqual([]);
  expect(snapshotCues(gone, back, heard)).toEqual([]);
  // 끝난 것은 잊는다(기억이 작전 내내 늘지 않는다).
  snapshotCues(back, state({ now: 13 }), heard);
  expect([heard.actions.size, heard.effects.size]).toEqual([0, 0]);
});

test('a sound sits left or right of me and fades with distance down to a floor', () => {
  const me = { x: 500, y: 500 };
  expect(place(500, 500, me)).toEqual({ pan: 0, gain: 1 });
  expect(place(260, 500, me).pan).toBeCloseTo(-.5);
  expect(place(740, 500, me).pan).toBeCloseTo(.5);
  expect(place(2000, 500, me).pan).toBe(1);
  // 멀수록 작아지고, 아주 멀어도 가장 작은 값(0.25) 아래로는 줄지 않는다. 보이는 곳의 일이다.
  expect(place(760, 500, me).gain).toBeLessThan(place(600, 500, me).gain);
  expect(place(5000, 500, me).gain).toBeCloseTo(.25);
});

test('a telegraph sounds when it starts, by affinity and tier, once per affinity and tier for a crowd from the nearest', () => {
  const before = state({ enemies: [telegraph(1, 100, 'strike', 560)] });
  const after = state({ enemies: [
    telegraph(1, 100, 'strike', 560),
    telegraph(2, 101, 'strike', 620), telegraph(3, 102, 'strike', 900),
    telegraph(4, 103, 'block', 700), telegraph(5, 104, 'block', 600, 2),
    { id: 6, x: 520, y: 500, action: { id: 105, kind: 'channel', tier: 1, phase: 'active' } },
  ] });
  const cues = snapshotCues(before, after);
  // 이미 들은 예고(100)와 공격 창이 열린 행동(105)은 울리지 않는다. 타격 둘은 가까운 하나만, 방어는 1티어와 2티어를 따로 울린다.
  expect(cues.map(cue => `${cue.affinity}${cue.tier}`).sort()).toEqual(['block1', 'block2', 'strike1']);
  expect(cues.find(cue => cue.affinity === 'strike')!.gain).toBeCloseTo(place(620, 500, { x: 500, y: 500 }).gain);
  // 가장 가까운 것은 거리로 고른다. 둘 다 멀어 크기가 가장 작은 값(0.25)으로 같아도, 목록에서 먼저 온 먼 쪽(오른쪽 900 거리)이 아니라
  // 가까운 쪽(왼쪽 600 거리)의 자리에서 난다(PR #42 리뷰 9).
  const far = snapshotCues(state(), state({ enemies: [telegraph(7, 110, 'strike', 1400), telegraph(8, 111, 'strike', -100)] }));
  expect(far).toHaveLength(1);
  expect(far[0].pan).toBe(-1);
});

test('a destroyed facility, a picked objective, each second of extraction, my fall and the end of the operation sound', () => {
  const before = state({
    facilities: [{ id: 1, x: 600, y: 500, hp: 1 }],
    supplies: [{ id: 7, x: 520, y: 500, objective: true, collected: false }, { id: 8, x: 520, y: 500, objective: false, collected: false }],
    extraction: { x: 700, y: 500, progress: 3.9, duration: 20, unlocked: true },
  });
  const after = state({
    facilities: [{ id: 1, x: 600, y: 500, hp: 0 }, { id: 2, x: 650, y: 500, hp: 0 }],
    supplies: [{ id: 7, x: 520, y: 500, objective: true, collected: true }, { id: 8, x: 520, y: 500, objective: false, collected: true }],
    extraction: { x: 700, y: 500, progress: 4.1, duration: 20, unlocked: true },
  });
  // 처음 본 부서진 시설(2)과 부목표가 아닌 상자(8)는 울리지 않는다.
  expect(kinds(snapshotCues(before, after))).toEqual(['extract', 'facility', 'pickup']);
  // 확보 시간이 같은 초 안에서 늘면 울리지 않는다.
  const same = state({ extraction: { x: 700, y: 500, progress: 4.6, duration: 20, unlocked: true } });
  expect(snapshotCues(state({ extraction: { x: 700, y: 500, progress: 4.1, duration: 20, unlocked: true } }), same)).toEqual([]);

  // 내가 쓰러졌다. 그 순간 작전이 끝나면 작전 종료 소리만 낸다.
  const down = state({ players: [{ id: 'p', x: 500, y: 500, state: 'waiting' }] });
  expect(kinds(snapshotCues(state(), down))).toEqual(['down']);
  expect(kinds(snapshotCues(state(), state({ ...down, phase: 'ended', result: 'failure', players: down.players })))).toEqual(['defeat']);
  expect(kinds(snapshotCues(state(), state({ phase: 'ended', result: 'success' })))).toEqual(['victory']);
});

// 섞인 무리와 싸우는 한 스냅샷이다. 종류가 다른 효과 아홉과 예고 넷, 내가 맞음, 작전 종료로 상한(8)을 넘긴다.
const crowdKinds = ['break', 'partial', 'draw', 'guard', 'hit', 'heal', 'deploy', 'evade', 'hurt'];
const crowd = () => myHp(5, {
  phase: 'ended', result: 'success',
  effects: [...crowdKinds.map((kind, i) => effect(100 + i, kind, 500 + (i % 2 === 0 ? 1 : -1) * (i * 40 + (kind === 'hurt' ? myHitReach : 0)))), effect(300, 'hurt', 500)],
  enemies: ['strike', 'block', 'channel'].map((kind, i) => telegraph(10 + i, 200 + i, kind, 520 + i * 30)).concat([telegraph(13, 203, 'strike', 540, 2)]),
});

test('a crowded snapshot keeps the loudest sounds up to the limit, the end of the operation included', () => {
  // 내 자리 가까이의 소리(크기 1에 가까움)가 몰려도 작전 종료와 내가 맞은 소리를 먼저 낸다. 나머지는 큰 것부터다.
  const cues = snapshotCues(state(), crowd());
  expect(cues).toHaveLength(maxCuesPerSnapshot);
  expect(cues.slice(0, 2).map(cue => cue.kind)).toEqual(['myHurt', 'victory']);
  for (let i = 3; i < cues.length; i++) expect(cues[i].gain).toBeLessThanOrEqual(cues[i - 1].gain);
});

// 소리 장치를 기록하는 가짜다. 만든 장치 수, 시작한 소리(발진기의 처음 주파수, 소음), 크기 조절 노드의 값을 남긴다.
async function recordAudio(page: Page) {
  await page.addInitScript(() => {
    // broken이 참이면 발진기·소음을 만들 때마다 예외를 낸다(소리 코드의 예외가 게임 처리를 멈추지 않는지 본다).
    const log = { contexts: 0, resumes: 0, broken: false, sounds: [] as { type: string; frequency?: number }[], gains: [] as { value: number }[] };
    (window as unknown as { audioLog: typeof log }).audioLog = log;
    const param = (value = 0) => ({ value, setValueAtTime(v: number) { this.value = v; }, linearRampToValueAtTime() { }, exponentialRampToValueAtTime() { } });
    const node = () => ({ connect(next: unknown) { return next; }, disconnect() { } });
    const ended = (source: { onended: (() => void) | null }, when: number) => { setTimeout(() => source.onended?.(), Math.max(0, (when - performance.now() / 1000) * 1000)); };
    class FakeContext {
      state = 'suspended';
      sampleRate = 8000;
      destination = node();
      get currentTime() { return performance.now() / 1000; }
      constructor() { log.contexts += 1; (log as unknown as { context: unknown }).context = this; }
      resume() { log.resumes += 1; this.state = 'running'; return Promise.resolve(); }
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
      createGain() { const gain = { ...node(), gain: param(1) }; log.gains.push(gain.gain); return gain; }
      createStereoPanner() { return { ...node(), pan: param() }; }
      createBiquadFilter() { return { ...node(), type: 'lowpass', frequency: param() }; }
      createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
      // 멈추는 시각(stop)에 onended를 부른다. 실제 소리 장치처럼 끝난 소리를 한 번에 울리는 소리 수에서 뺀다.
      createOscillator() {
        if (log.broken) throw new Error('망가진 소리 장치');
        const oscillator = { ...node(), type: 'sine', frequency: param(), onended: null as (() => void) | null, start() { log.sounds.push({ type: 'tone', frequency: oscillator.frequency.value }); }, stop(when: number) { ended(oscillator, when); } };
        return oscillator;
      }
      createBufferSource() {
        if (log.broken) throw new Error('망가진 소리 장치');
        const source = { ...node(), buffer: null, onended: null as (() => void) | null, start() { log.sounds.push({ type: 'noise' }); }, stop(when: number) { ended(source, when); } };
        return source;
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: FakeContext, configurable: true });
  });
}
type AudioLog = { contexts: number; resumes: number; broken: boolean; sounds: { type: string; frequency?: number }[]; gains: { value: number }[] };
const audioLog = (page: Page) => page.evaluate(() => (window as unknown as { audioLog: AudioLog }).audioLog);

test('sound starts with the first press, plays the landing and a press, and keeps its switch and volume', async ({ page }) => {
  await recordAudio(page);
  const wire = await relay(page);
  await page.goto(quietRoom);
  // 누르기 전에는 소리 장치를 만들지 않는다(브라우저의 자동 재생 정책).
  expect((await audioLog(page)).contexts).toBe(0);
  await expect(page.locator('#sound-toggle')).toHaveText('소리 켬');
  await page.locator('#create').click();
  expect((await audioLog(page)).contexts).toBe(1);
  expect((await audioLog(page)).resumes).toBeGreaterThan(0);
  // 첫 스냅샷을 받은 뒤에 캠프를 고른다. 그 전에는 캠프 버튼이 아무것도 하지 않는다.
  await expect(page.locator('#mission-state')).toHaveText('투입 대기');
  await page.locator('#camp').click();
  await page.locator('#deploy').click();
  // 착지하면 투입 효과의 소리가 난다.
  await expect.poll(() => wire.player?.state, { timeout: 15000 }).toBe('alive');
  await expect.poll(async () => (await audioLog(page)).sounds.length).toBeGreaterThan(0);
  // 마나가 없을 때 누른 기술은 막힌 소리(150Hz 두 번)를 낸다. 서버는 그 누름을 버린다.
  const heard = (await audioLog(page)).sounds.length;
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await audioLog(page)).sounds.slice(heard).filter(sound => sound.frequency === 150).length).toBe(2);
  // 마나가 1일 때 거의 함께 누른 두 기술은 앞의 것만 확인음(타격 900Hz)을 내고 뒤의 것은 막힌 소리다. 앞의 누름이 마나를 쓸 것을 뺀다
  // (PR #42 리뷰 5). 스냅샷의 마나를 1로 바꿔 만든다.
  wire.change = data => { data.players.find(player => player.id === data.you)!.mana = 1; return data; };
  await page.waitForTimeout(400);
  const pair = (await audioLog(page)).sounds.length;
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (await audioLog(page)).sounds.slice(pair).map(sound => sound.frequency)).toEqual([900, 150, 150]);
  wire.change = data => data;

  // 끄면 소리를 내지 않는다. 다시 열어도 꺼져 있다.
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-toggle')).toHaveText('소리 끔');
  await expect(page.locator('#sound-side')).toHaveText('소리 끔');
  const muted = (await audioLog(page)).sounds.length;
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(300);
  expect((await audioLog(page)).sounds.length).toBe(muted);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('argus-sound')!))).toEqual({ on: false, volume: .6 });

  // PC 옆 패널에는 소리 조절이 없다(위쪽 줄에 있다). 크기는 위쪽 줄의 막대로 고친다. 소리 장치 전체의 크기(첫 크기 노드)가 막대 값이다.
  await expect(page.locator('.side-bottom .sound-controls')).toBeHidden();
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-toggle')).toHaveText('소리 켬');
  await page.locator('#sound-volume-top').fill('30');
  expect((await audioLog(page)).gains[0].value).toBeCloseTo(.3);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('argus-sound')!))).toEqual({ on: true, volume: .3 });

  // 크기 막대를 마우스로 눌러 고친 뒤에도 커서는 막대에 남는다. 그래도 게임 키는 먹는다. D도 →도 오른쪽으로 걷고 막대는 그대로다
  // (PR #42 재리뷰 가: 마우스로 고친 뒤 방향키가 크기만 바꿨다).
  const slider = page.locator('#sound-volume-top');
  await slider.click();
  await expect(slider).toBeFocused();
  const clicked = await slider.inputValue();
  for (const key of ['KeyD', 'ArrowRight']) {
    const sent = wire.inputs.length;
    await page.keyboard.down(key);
    await expect.poll(() => wire.inputs.slice(sent).some(input => input.moveX === 1)).toBe(true);
    await page.keyboard.up(key);
  }
  await expect(slider).toHaveValue(clicked);
  // 창을 다녀왔다(Alt+Tab). 커서가 있던 막대에 blur·focus가 온다. 그래도 →는 걷는다(PR #42 리뷰, ee96b62).
  await slider.evaluate(element => { element.dispatchEvent(new FocusEvent('blur')); element.dispatchEvent(new FocusEvent('focus')); });
  const returned = wire.inputs.length;
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => wire.inputs.slice(returned).some(input => input.moveX === 1)).toBe(true);
  await page.keyboard.up('ArrowRight');
  await expect(slider).toHaveValue(clicked);
  // 키보드로(Shift+Tab으로 소리 버튼에 갔다가 Tab으로) 막대에 다시 오면 방향키는 막대를 움직인다(PR #42 리뷰 6).
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#sound-toggle')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue(String(Number(clicked) + 5));
  // 누른 폼 요소에 커서를 주지 않는 브라우저(macOS Safari)다. 막대를 눌렀지만 커서는 오지 않았고, 그 뒤 Tab으로 막대에 왔다. 방향키는
  // 막대를 움직인다(PR #42 리뷰, ee96b62). 막대에 pointerdown만 보내 흉내 낸다.
  await page.locator('#sound-toggle').focus();
  await slider.dispatchEvent('pointerdown');
  await page.keyboard.press('Tab');
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue(String(Number(clicked) + 10));
  // Tab을 쓴 뒤라도 마우스로 막대를 다시 누르면 →는 걷는다. 지난 Tab이 아니라 막대에 커서가 온 때의 조작으로 가린다.
  await page.locator('.build-tag').click();
  await slider.click();
  const again = await slider.inputValue();
  const reclicked = wire.inputs.length;
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => wire.inputs.slice(reclicked).some(input => input.moveX === 1)).toBe(true);
  await page.keyboard.up('ArrowRight');
  await expect(slider).toHaveValue(again);
  await slider.fill('30');
  // 버튼의 이름은 "소리"이고 켬·끔은 눌림(aria-pressed)으로 알린다(PR #42 리뷰 7).
  // PC는 위쪽 줄의 버튼이 보이고, 옆 패널의 버튼은 숨어 있다(터치 화면의 서랍용). 숨은 버튼도 같은 상태다.
  await expect(page.getByRole('button', { name: '소리', exact: true, pressed: true })).toHaveCount(1);
  await expect(page.locator('#sound-side')).toHaveAttribute('aria-pressed', 'true');

  // 아이폰이 전화·알림으로 끊어 둔 소리 장치(interrupted)도 다음 누름에서 다시 켠다(PR #42 리뷰 4).
  const resumed = (await audioLog(page)).resumes;
  await page.evaluate(() => { ((window as unknown as { audioLog: { context: { state: string } } }).audioLog.context).state = 'interrupted'; });
  await page.locator('#canvas-host').click({ position: { x: 600, y: 300 } });
  await expect.poll(async () => (await audioLog(page)).resumes).toBeGreaterThan(resumed);
  expect(await page.evaluate(() => (window as unknown as { audioLog: { context: { state: string } } }).audioLog.context.state)).toBe('running');

  // 연결이 끊겼다 다시 붙으면, 다시 붙은 뒤 첫 스냅샷은 소리 없이 기준으로만 받는다. 끊긴 동안 시설이 부서져도 늦게 울리지 않는다
  // (PR #42 리뷰 8). 시설 소리는 70Hz로 시작한다. 끊기 전에는 서 있는 시설을, 끊은 뒤에는 부서진 시설을 보낸다.
  let broken = false;
  // 맵(map)은 첫 스냅샷에만 오므로 자리는 내 대원 옆으로 잡는다.
  wire.change = data => {
    const me = data.players.find(player => player.id === data.you)!;
    return { ...data, facilities: [...data.facilities, { id: 4242, x: me.x + 100, y: me.y, hp: broken ? 0 : 1, maxHp: 1 }] };
  };
  await page.waitForTimeout(400);
  const before = (await audioLog(page)).sounds.length;
  broken = true;
  wire.drop();
  await expect(page.locator('#connection')).toContainText('재접속 중');
  await expect(page.locator('#connection')).toContainText('분대 연결됨', { timeout: 10000 });
  await page.waitForTimeout(500);
  expect((await audioLog(page)).sounds.slice(before).filter(sound => sound.frequency === 70)).toEqual([]);
  wire.change = data => data;

  // 작전이 끝나면 서버가 누름을 받지 않으므로 확인음도 내지 않는다(PR #42 리뷰 5). 작전 종료 소리가 난 뒤에 센다.
  wire.change = data => ({ ...data, phase: 'ended', result: 'success' });
  await expect(page.locator('#result')).toBeVisible();
  await page.waitForTimeout(500);
  const ended = (await audioLog(page)).sounds.length;
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(300);
  expect((await audioLog(page)).sounds.length).toBe(ended);
  wire.change = data => data;

  await page.reload();
  await expect(page.locator('#sound-toggle')).toHaveText('소리 켬');
  await expect(page.locator('#sound-volume-top')).toHaveValue('30');
});

test('a sound that throws does not stop the notices or the skill being held', async ({ page }) => {
  // 소리를 만들다 예외가 나도 안내가 뜨고, 누른 기술 키는 누르고 있는 것으로 적힌다(PR #42 리뷰, ee96b62). 예외가 새어 나가면 스냅샷 처리의
  // 안내와 키 누름의 적기가 그 자리에서 멈췄다.
  await recordAudio(page);
  const wire = await relay(page);
  await page.goto(quietRoom);
  await page.locator('#create').click();
  await expect(page.locator('#mission-state')).toHaveText('투입 대기');
  await page.locator('#camp').click();
  await page.locator('#deploy').click();
  await expect.poll(() => wire.player?.state, { timeout: 15000 }).toBe('alive');
  await page.evaluate(() => { (window as unknown as { audioLog: AudioLog }).audioLog.broken = true; });
  // 소리가 나는 새 효과(타격)와 안내 하나를 함께 보낸다.
  wire.change = data => {
    const me = data.players.find(player => player.id === data.you)!;
    return { ...data, effects: [...data.effects, { id: 909090, kind: 'hit', x: me.x + 40, y: me.y, until: data.now + 5 }], notices: [...data.notices, { id: 1_000_000, at: data.now, text: '검사 안내: 소리가 망가져도 뜬다' }] };
  };
  await expect(page.getByText('검사 안내: 소리가 망가져도 뜬다')).toBeVisible();
  wire.change = data => data;
  // 마나가 없어 막힌 소리를 내려다 예외가 난다. 그래도 누르고 있는 동안 보낸 입력의 held에 1번이 있다.
  const sent = wire.inputs.length;
  await page.keyboard.down('Digit1');
  await expect.poll(() => wire.inputs.slice(sent).some(input => input.held.includes(1))).toBe(true);
  await page.keyboard.up('Digit1');
});

test('a phone keeps the sound switch and volume in the menu drawer', async ({ browser }) => {
  // 터치 화면은 위쪽 줄(PC의 소리 조절)이 없다. ☰ 서랍의 아래쪽에서 끄고 켜고 크기를 고친다.
  const context = await browser.newContext({ viewport: { width: 533, height: 320 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await recordAudio(page);
  await page.goto(quietRoom);
  await expect(page.locator('#sound-toggle')).toBeHidden();
  await page.locator('#create').click();
  await expect(page.locator('#mission-state')).toHaveText('투입 대기');
  await page.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : undefined);
  await page.locator('#touch-menu').click();
  await page.locator('#sound-side').scrollIntoViewIfNeeded();
  await expect(page.locator('#sound-side')).toBeVisible();
  await page.locator('#sound-side').click();
  await expect(page.locator('#sound-side')).toHaveText('소리 끔');
  await page.locator('#sound-volume').fill('80');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('argus-sound')!))).toEqual({ on: false, volume: .8 });
  await context.close();
});

test.describe('on a real audio device', () => {
  // 실제 소리 장치(검사 브라우저의 Web Audio)로 모든 소리를 한 번씩 낸다. 가짜 장치는 잘못된 값(0으로 가는 지수 곡선 등)을 거르지 않는다.
  // 게임 서버 없이 Vite 서버가 sound.ts만 올린 쪽을 연다.
  let server: ViteDevServer;
  let url: string;
  test.beforeAll(async () => {
    server = await createServer({
      configFile: false,
      // 실행한 폴더와 관계없이 client 폴더를 root로 둔다(/src/sound.ts). 저장소 루트에서 -c client/playwright.config.ts로 돌리면 찾지 못했다.
      root: fileURLToPath(new URL('..', import.meta.url)),
      server: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'sound-test-page',
        configureServer(devServer) {
          devServer.middlewares.use('/__sound_test', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><html><body><button id="go">소리</button><script type="module">
              import { Sound } from '/src/sound.ts';
              window.testSound = new Sound();
              window.soundErrors = [];
              window.addEventListener('error', event => window.soundErrors.push(String(event.message)));
              window.addEventListener('unhandledrejection', event => window.soundErrors.push(String(event.reason)));
              document.getElementById('go').addEventListener('click', () => window.testSound.unlock());
              // 소리 하나를 소리 장치 대신 메모리에 그려(OfflineAudioContext) 가장 큰 값, 실효값, 마지막으로 소리가 있는 때(초)를 잰다.
              class Offline extends OfflineAudioContext {
                constructor() { super(2, 44100 * 2, 44100); }
                get state() { return 'running'; }
                resume() { return Promise.resolve(); }
              }
              // 여러 소리를 같은 순간에 내어 함께 그린다(한 스냅샷의 소리).
              window.renderCues = async cues => {
                const live = window.AudioContext;
                window.AudioContext = Offline;
                const sound = new Sound();
                sound.unlock();
                window.AudioContext = live;
                for (const cue of cues) sound.play(cue);
                const buffer = await sound.context.startRendering();
                let peak = 0, sum = 0, last = 0;
                for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                  const data = buffer.getChannelData(channel);
                  for (let i = 0; i < data.length; i++) {
                    const value = Math.abs(data[i]);
                    peak = Math.max(peak, value); sum += value * value;
                    if (value > .001) last = Math.max(last, i / buffer.sampleRate);
                  }
                }
                return { peak, rms: Math.sqrt(sum / (buffer.length * buffer.numberOfChannels)), last };
              };
              window.renderCue = cue => window.renderCues([cue]);
              window.soundReady = true;
            </script></body></html>`);
          });
        },
      }],
    });
    await server.listen();
    url = server.resolvedUrls!.local[0] + '__sound_test';
  });
  test.afterAll(async () => { await server.close(); });

  test('every sound plays on a real audio device without an error and lets its voices go', async ({ page }) => {
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { soundReady?: boolean }).soundReady === true);
    await page.locator('#go').click();
    await page.waitForFunction(() => (window as unknown as { testSound: { context?: { state: string } } }).testSound.context?.state === 'running');
    const kinds: CueKind[] = ['press', 'empty', 'break', 'partial', 'draw', 'guard', 'hit', 'hurt', 'myHurt', 'heal', 'deploy', 'evade',
      'telegraph', 'facility', 'pickup', 'extract', 'victory', 'defeat', 'down'];
    const result = await page.evaluate(async kinds => {
      type Played = { play(cue: unknown): void; active: number };
      const sound = (window as unknown as { testSound: Played }).testSound;
      const cues = [...kinds.map(kind => ({ kind, pan: -.5, gain: .8, affinity: 'strike', tier: 1 })),
        ...['strike', 'block', 'channel', 'none'].flatMap(affinity => [1, 2].map(tier => ({ kind: 'telegraph', pan: .5, gain: .6, affinity, tier }))),
        ...['block', 'channel', 'none'].map(affinity => ({ kind: 'press', pan: 0, gain: 1, affinity }))];
      // 한 번에 울리는 소리의 상한(24)을 넘지 않게 여덟씩 나눠 낸다.
      let most = 0;
      for (let i = 0; i < cues.length; i += 8) {
        for (const cue of cues.slice(i, i + 8)) sound.play(cue);
        most = Math.max(most, sound.active);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      return { most, left: sound.active, errors: (window as unknown as { soundErrors: string[] }).soundErrors };
    }, kinds);
    expect(result.errors).toEqual([]);
    expect(result.most).toBe(8);
    // 다 울린 소리의 노드는 끊고 센 수를 돌린다.
    expect(result.left).toBe(0);
  });

  test('a full set of voices still lets my own hurt and the end of the operation through', async ({ page }) => {
    // 한 번에 울리는 소리가 상한(24)이면 새 소리를 버리되, 나에게 일어난 일과 작전 종료는 낸다(PR #42 리뷰 3).
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { soundReady?: boolean }).soundReady === true);
    await page.locator('#go').click();
    await page.waitForFunction(() => (window as unknown as { testSound: { context?: { state: string } } }).testSound.context?.state === 'running');
    const counts = await page.evaluate(() => {
      type Played = { play(cue: unknown): void; active: number };
      const sound = (window as unknown as { testSound: Played }).testSound;
      for (let i = 0; i < 24; i++) sound.play({ kind: 'defeat', pan: 0, gain: .2 });
      const full = sound.active;
      sound.play({ kind: 'hit', pan: 0, gain: 1 });
      const afterHit = sound.active;
      sound.play({ kind: 'myHurt', pan: 0, gain: 1 });
      sound.play({ kind: 'victory', pan: 0, gain: 1 });
      return { full, afterHit, afterMine: sound.active };
    });
    expect(counts).toEqual({ full: 24, afterHit: 24, afterMine: 26 });
  });

  test('a crowded snapshot stays below clipping at full volume', async ({ page }) => {
    // 한 스냅샷의 소리는 같은 순간에 함께 시작한다. 같은 종류가 여럿이면 파형이 똑같이 겹쳐 크기가 그 수만큼 더해졌다(PR #42 리뷰, ee96b62).
    // 회전 베기로 내 둘레의 병사 다섯을 받아치며 맞은 스냅샷과, 상한(8)까지 찬 섞인 무리의 스냅샷을 가장 큰 크기(1)로 함께 그린다.
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { soundReady?: boolean }).soundReady === true);
    const spin = snapshotCues(state(), myHp(5, { effects: [...[505, 495, 510, 490, 500].map((x, i) => effect(30 + i, 'break', x)), effect(40, 'hit', 500), effect(41, 'hurt', 500)] }));
    const mixed = snapshotCues(state(), crowd());
    expect(mixed).toHaveLength(maxCuesPerSnapshot);
    const peaks = await page.evaluate(async groups => {
      type Render = (cues: unknown[]) => Promise<{ peak: number }>;
      const render = (window as unknown as { renderCues: Render }).renderCues;
      localStorage.setItem('argus-sound', JSON.stringify({ on: true, volume: 1 }));
      const results: number[] = [];
      for (const cues of groups) results.push((await render(cues)).peak);
      return results;
    }, [spin, mixed]);
    for (const peak of peaks) expect(peak).toBeLessThan(.95);
  });

  test('every sound is audible, stays below clipping at full volume and ends within a second and a half', async ({ page }) => {
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { soundReady?: boolean }).soundReady === true);
    const kinds: CueKind[] = ['press', 'empty', 'break', 'partial', 'draw', 'guard', 'hit', 'hurt', 'myHurt', 'heal', 'deploy', 'evade',
      'telegraph', 'facility', 'pickup', 'extract', 'victory', 'defeat', 'down'];
    const measured = await page.evaluate(async kinds => {
      type Render = (cue: unknown) => Promise<{ peak: number; rms: number; last: number }>;
      const render = (window as unknown as { renderCue: Render }).renderCue;
      localStorage.setItem('argus-sound', JSON.stringify({ on: true, volume: 1 }));
      const results: Record<string, { peak: number; rms: number; last: number }> = {};
      for (const kind of kinds) results[kind] = await render({ kind, pan: 0, gain: 1, affinity: 'strike', tier: 2 });
      for (const affinity of ['block', 'channel', 'none']) results[`press-${affinity}`] = await render({ kind: 'press', pan: 0, gain: 1, affinity });
      for (const affinity of ['block', 'channel']) results[`telegraph-${affinity}`] = await render({ kind: 'telegraph', pan: 0, gain: 1, affinity, tier: 1 });
      return results;
    }, kinds);
    for (const [kind, sound] of Object.entries(measured)) {
      // 가장 작은 소리(탈출 확보의 1초 소리)도 들리고, 가장 큰 크기(1)에서도 넘치지(1 이상) 않는다.
      expect(sound.peak, kind).toBeGreaterThan(.02);
      expect(sound.peak, kind).toBeLessThan(.95);
      expect(sound.last, kind).toBeLessThan(1.5);
    }
  });
});
