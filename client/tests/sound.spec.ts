import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { maxCuesPerSnapshot, place, snapshotCues, type Cue, type CueKind } from '../src/cues';
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
    players: [{ id: 'p', x: 500, y: 500, state: 'alive' }, { id: 'q', x: 900, y: 500, state: 'alive' }],
    effects: [], enemies: [], facilities: [], supplies: [],
    ...extra,
  } as unknown as Snapshot;
}
const effect = (id: number, kind: string, x: number, y = 500) => ({ id, kind, x, y, until: 9 });
const telegraph = (id: number, action: number, kind: string, x: number, tier = 1) =>
  ({ id, x, y: 500, action: { id: action, kind, tier, phase: 'telegraph' } });
const kinds = (cues: Cue[]) => cues.map(cue => cue.kind).sort();

test('a new effect sounds once, and a hit at my own spot is my own hurt', () => {
  const before = state({ effects: [effect(10, 'hit', 520)] });
  const after = state({ effects: [effect(10, 'hit', 520), effect(11, 'break', 520), effect(12, 'hurt', 503), effect(13, 'hurt', 900), effect(14, 'unknown', 500)] });
  // 접속 직후(이전 스냅샷 없음)와 방이 바뀐 때는 지난 일을 울리지 않는다.
  expect(snapshotCues(undefined, after)).toEqual([]);
  expect(snapshotCues(state({ room: 'OTHER1' }), after)).toEqual([]);
  // 이미 들은 효과(10)와 모르는 종류(14)는 울리지 않는다. 내 자리의 피격은 myHurt, 동료의 피격은 hurt다.
  const cues = snapshotCues(before, after);
  expect(kinds(cues)).toEqual(['break', 'hurt', 'myHurt']);
  expect(cues.find(cue => cue.kind === 'myHurt')).toMatchObject({ pan: 0, gain: 1 });
  // 같은 효과는 다음 스냅샷에서 다시 울리지 않는다.
  expect(snapshotCues(after, after)).toEqual([]);
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

test('a telegraph sounds when it starts, by affinity and tier, once per affinity for a crowd', () => {
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

test('a crowded snapshot keeps the loudest sounds up to the limit, the end of the operation included', () => {
  // 내 자리의 타격 열(크기 1)과 먼 타격이 함께 몰려도 작전 종료와 내가 맞은 소리를 먼저 낸다. 나머지는 큰 것부터다.
  const effects = [...Array.from({ length: 10 }, (_, i) => effect(100 + i, 'hit', 500)), ...Array.from({ length: 10 }, (_, i) => effect(200 + i, 'hit', 600 + i * 40)), effect(300, 'hurt', 500)];
  const cues = snapshotCues(state(), state({ effects, phase: 'ended', result: 'success' }));
  expect(cues).toHaveLength(maxCuesPerSnapshot);
  expect(cues.slice(0, 2).map(cue => cue.kind)).toEqual(['myHurt', 'victory']);
  for (let i = 3; i < cues.length; i++) expect(cues[i].gain).toBeLessThanOrEqual(cues[i - 1].gain);
});

// 소리 장치를 기록하는 가짜다. 만든 장치 수, 시작한 소리(발진기의 처음 주파수, 소음), 크기 조절 노드의 값을 남긴다.
async function recordAudio(page: Page) {
  await page.addInitScript(() => {
    const log = { contexts: 0, resumes: 0, sounds: [] as { type: string; frequency?: number }[], gains: [] as { value: number }[] };
    (window as unknown as { audioLog: typeof log }).audioLog = log;
    const param = (value = 0) => ({ value, setValueAtTime(v: number) { this.value = v; }, linearRampToValueAtTime() { }, exponentialRampToValueAtTime() { } });
    const node = () => ({ connect(next: unknown) { return next; }, disconnect() { } });
    class FakeContext {
      state = 'suspended';
      sampleRate = 8000;
      destination = node();
      get currentTime() { return performance.now() / 1000; }
      constructor() { log.contexts += 1; }
      resume() { log.resumes += 1; this.state = 'running'; return Promise.resolve(); }
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
      createGain() { const gain = { ...node(), gain: param(1) }; log.gains.push(gain.gain); return gain; }
      createStereoPanner() { return { ...node(), pan: param() }; }
      createBiquadFilter() { return { ...node(), type: 'lowpass', frequency: param() }; }
      createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
      createOscillator() {
        const oscillator = { ...node(), type: 'sine', frequency: param(), onended: null, start() { log.sounds.push({ type: 'tone', frequency: oscillator.frequency.value }); }, stop() { } };
        return oscillator;
      }
      createBufferSource() { return { ...node(), buffer: null, onended: null, start() { log.sounds.push({ type: 'noise' }); }, stop() { } }; }
    }
    Object.defineProperty(window, 'AudioContext', { value: FakeContext, configurable: true });
  });
}
type AudioLog = { contexts: number; resumes: number; sounds: { type: string; frequency?: number }[]; gains: { value: number }[] };
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

  // 크기 막대에 커서가 있어도 게임 키는 먹는다(D로 오른쪽으로 걷는다).
  await page.locator('#sound-volume-top').focus();
  const sent = wire.inputs.length;
  await page.keyboard.down('KeyD');
  await expect.poll(() => wire.inputs.slice(sent).some(input => input.moveX === 1)).toBe(true);
  await page.keyboard.up('KeyD');

  await page.reload();
  await expect(page.locator('#sound-toggle')).toHaveText('소리 켬');
  await expect(page.locator('#sound-volume-top')).toHaveValue('30');
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
              window.renderCue = async cue => {
                const live = window.AudioContext;
                window.AudioContext = Offline;
                const sound = new Sound();
                sound.unlock();
                window.AudioContext = live;
                sound.play(cue);
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
