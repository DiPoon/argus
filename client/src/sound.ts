import type { Affinity } from './types';
import { personal, type Cue, type CueKind } from './cues';

// 게임 소리다(이슈 #35, 2026-11-24). 소리 파일 없이 Web Audio로 그때그때 합성한다. 파일을 쓰면 출처와 이용 조건을 따로 챙겨야 하고
// 내려받을 것이 늘어난다. 무엇을 울릴지는 cues.ts가 스냅샷으로 정하고, 여기서는 소리를 만들기만 한다.
// 브라우저는 사용자의 누름 안에서만 소리를 켤 수 있다(자동 재생 정책). 그래서 첫 누름이나 키에서 unlock을 부른다(main.ts).
// 켬·끔과 크기는 이 브라우저의 localStorage(argus-sound)에 둔다. 읽거나 쓸 수 없으면 기본값으로 쓰고 이번 방문에만 바꾼다.

type Wave = OscillatorType;
// 사건 하나의 소리가 만든 발진기·소음의 수(pending)와 가장 늦게 끝나는 시각(end)이다. 모두 끝나면(onended) finish를 부른다.
interface Voice { pending: number; end: number; finish: () => void }
// 한 번에 울리는 소리의 상한이다. 넘으면 새 소리를 버린다. 섞인 무리와 오래 싸워도 소리가 쌓여 끊기지 않게 한다.
// 소리의 수만 막고 크기의 합은 막지 못한다. 한 스냅샷의 같은 종류 효과는 cues.ts가 하나로 묶는다(PR #42 리뷰, ee96b62).
const maxVoices = 24;
// 상한이어도 내는 소리다. 나에게 일어난 일과 작전 종료(cues.ts의 personal), 내가 누른 기술의 확인음과 막힌 소리다. 섞인 무리와 싸우는 중에
// 내가 맞은 소리나 작전 실패 소리(PR #42 리뷰 3), 마나가 바닥난 줄 알려 줄 막힌 소리(PR #42 리뷰, c1d5077)가 버려졌다.
const pastLimit: CueKind[] = [...personal, 'press', 'empty'];
const settingsKey = 'argus-sound';
// 같은 소리(종류·상성·티어)를 이 시간(초) 안에 다시 내지 않는다. 밀렸던 스냅샷들이 한꺼번에 오면 장마다 바로 앞 장과 견준 소리를 연달아 내는데,
// 소리 장치의 시계는 성기게 나아가 그 소리들이 같은 순간에 시작한다. 같은 소리면 파형이 똑같이 겹쳐 그 수만큼 더해져, 1초 밀림에서도 1을
// 넘었다(PR #42 리뷰, 572ee03). 한 스냅샷 안의 같은 종류 효과는 cues.ts가 묶는다(여덟 개 상한이 여기 앞에서 자르므로 그대로 둔다).
const sameSoundGap = .05;
// 크기 막대 100이 소리 장치 전체의 크기 0.8이다. 서로 다른 큰 소리 여덟이 내 곁에서 한 스냅샷에 몰리면(받아침·부분 대응·비김·방어·타격·
// 2티어 예고·내가 맞음·쓰러짐) 크기 1에서 가장 큰 값이 1.1쯤으로 넘쳤다(PR #42 리뷰, 572ee03). 0.8이면 0.9 아래다.
const headroom = .8;

export class Sound {
  enabled = true;
  // 0~1이다(크기 막대). 소리 장치 전체의 크기(master)는 이 값에 headroom을 곱한 것이다. 가장 큰 크기(1)에서 소리 하나의 가장 큰 값은
  // 0.045(탈출 확보의 1초 소리)~0.28(내가 맞은 소리)이다(2026-11-28, 정해 둔 소음으로 메모리에 그려 잼. sound.spec.ts가 들리는지와 넘치지 않는지를 본다).
  volume = .6;
  private context?: AudioContext;
  private master?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private active = 0;
  // 울리고 있는 소리마다 끝내는 함수다. 소리를 끄거나 소리 장치가 멈추면 모두 그 자리에서 끝낸다.
  private live = new Set<() => void>();
  // 소리(종류·상성·티어)마다 마지막으로 낸 소리 장치의 시각이다.
  private lastStart = new Map<string, number>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(settingsKey) ?? 'null') as { on?: unknown; volume?: unknown } | null;
      if (typeof saved?.on === 'boolean') this.enabled = saved.on;
      if (typeof saved?.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) this.volume = saved.volume;
    } catch { /* 기본값을 쓴다. */ }
  }

  // 사용자의 누름이나 키 안에서 부른다. 소리 장치를 만들거나 멈춘 것을 다시 켠다. 꺼 두었으면 아무것도 하지 않는다.
  unlock() {
    if (!this.enabled) return;
    if (!this.context) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      try { this.context = new Context(); } catch { return; }
      this.master = this.context.createGain();
      this.master.gain.value = this.volume * headroom;
      // 소리 장치가 멈추면(소리 끔, 아이폰의 전화·알림으로 interrupted) 울리던 소리를 그 자리에서 끝낸다. 멈춘 장치는 발진기도 얼어 있다가,
      // 다시 켜면 멈춘 자리부터 이어 울리고 끝을 세는 타이머가 중간에 끊었다(PR #42 리뷰, 572ee03).
      const context = this.context;
      context.addEventListener('statechange', () => { if (context.state !== 'running') this.stopAll(); });
      // 끝에 압축기(DynamicsCompressorNode)를 두지 않는다. 스스로 크기를 키우는 보정이 있어(Web Audio 규격의 makeup gain) 긴 소리는 세 배 가까이
      // 커지고 짧은 타격 소리는 도리어 작아졌다(2026-11-24에 메모리에 그려 잼). 겹침은 한 번에 울리는 소리의 상한(maxVoices)과, 한 스냅샷의
      // 같은 종류 효과를 하나로 묶는 것(cues.ts)으로 막는다.
      this.master.connect(this.context.destination);
      // 흰 소음 1초다. 타격·바람 소리를 거르개로 깎아 만든다. 늘 같은 소음이 되도록 정해 둔 씨앗의 난수로 채운다. Math.random으로 채웠을 때는
      // 그릴 때마다 크기가 ±0.1쯤 달라 잰 값을 다시 얻을 수 없었다(PR #42 리뷰, 572ee03).
      const length = this.context.sampleRate;
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let seed = 0x2f6b4a1d;
      for (let i = 0; i < length; i++) {
        // xorshift32
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        data[i] = (seed >>> 0) / 0x80000000 - 1;
      }
    }
    // 멈춘 것(suspended)만이 아니라 아이폰이 전화·알림으로 끊어 둔 것(interrupted)도 다시 켠다. running·closed 말고는 모두 부른다(PR #42 리뷰 4).
    const state = this.context.state as string;
    if (state !== 'running' && state !== 'closed') void this.context.resume().catch(() => undefined);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.save({ on });
    if (!on) this.stopAll();
    if (on) this.unlock();
    // running일 때만 멈추면, 막 만들어 켜지는 중(suspended에서 비동기로 running이 됨)에 끈 장치가 곧이어 켜져 작전 내내 돌았다(PR #42 리뷰, c1d5077.
    // 실제 브라우저에서는 재지 않음). suspend는 앞의 resume 뒤로 줄을 서므로 마지막에 멈춘 상태가 된다.
    else if (this.context && this.context.state !== 'closed') void this.context.suspend().catch(() => undefined);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume * headroom;
    this.save({ volume: this.volume });
  }

  // 바꾼 항목만 저장한다. 쓰기 직전에 저장된 값을 다시 읽어 나머지는 그대로 둔다. 이 탭이 쥔 값으로 통째로 쓰면, 다른 탭에서 바꾼 항목이
  // 사라졌다(탭 A에서 크기를 낮춘 뒤 탭 B에서 끄면 크기가 되돌아감, PR #42 리뷰, 572ee03).
  private save(change: { on?: boolean; volume?: number }) {
    try {
      const saved = JSON.parse(localStorage.getItem(settingsKey) ?? 'null') as { on?: unknown; volume?: unknown } | null;
      const on = change.on ?? (typeof saved?.on === 'boolean' ? saved.on : this.enabled);
      const volume = change.volume ?? (typeof saved?.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : this.volume);
      localStorage.setItem(settingsKey, JSON.stringify({ on, volume }));
    } catch { /* 이번 방문에만 쓴다. */ }
  }

  // 울리고 있는 소리를 모두 그 자리에서 끝낸다.
  private stopAll() {
    for (const finish of [...this.live]) finish();
  }

  // 사건 하나의 소리를 낸다. 소리 장치가 아직 켜지지 않았거나(누름 전) 꺼 두었으면 내지 않는다.
  // 한 번에 울리는 소리가 상한이면 새 소리를 버리되, 나에게 일어난 일과 작전 종료(cues.ts의 personal)는 낸다. 섞인 무리와 싸우는 중에 내가 맞은
  // 소리나 작전 실패 소리가 버려졌다(PR #42 리뷰 3).
  // 소리를 만들다 예외가 나면 이 소리만 버린다. 부르는 쪽은 스냅샷 처리(안내)와 키·터치 누름(누르고 있는 버튼 적기)의 한가운데라, 예외가
  // 새어 나가면 그 뒤의 게임 처리가 멈췄다(PR #42 리뷰, ee96b62).
  play(cue: Cue) {
    const context = this.context;
    const master = this.master;
    if (!this.enabled || !context || !master || context.state !== 'running') return;
    if (this.active >= maxVoices && !pastLimit.includes(cue.kind)) return;
    const key = `${cue.kind}-${cue.affinity ?? ''}-${cue.tier ?? ''}`;
    const last = this.lastStart.get(key);
    if (last !== undefined && context.currentTime - last < sameSoundGap) return;
    const nodes: AudioNode[] = [];
    let counted = false;
    let finished = false;
    // 다 울린 소리의 노드를 끊고 한 번에 울리는 소리 수에서 뺀다. 한 번만 한다.
    const finish = () => {
      if (finished) return;
      finished = true;
      this.live.delete(finish);
      if (counted) this.active -= 1;
      for (const node of nodes) node.disconnect();
    };
    this.live.add(finish);
    try {
      const output = context.createGain();
      nodes.push(output);
      output.gain.value = cue.gain;
      let tail: AudioNode = output;
      // 좌우 자리는 StereoPannerNode가 없는 브라우저에서는 빼고 가운데에서 낸다.
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner();
        nodes.push(panner);
        panner.pan.value = cue.pan;
        output.connect(panner);
        tail = panner;
      }
      tail.connect(master);
      const now = context.currentTime;
      this.lastStart.set(key, now);
      const voice: Voice = { pending: 0, end: now, finish };
      this.compose(cue, output, now, voice);
      this.active += 1;
      counted = true;
      // 끝은 발진기·소음의 onended로 센다. 소리 장치의 시계를 따라 온다. setTimeout으로 셌을 때는 숨은 탭에서 타이머가 1초에 한 번으로 묶여
      // 그동안 울린 소리가 상한에 닿아 새 소리가 버려졌다(PR #42 리뷰, ee96b62). 소리 장치가 멈추면(소리 끔, 전화) onended가 오지 않으므로,
      // 가장 늦은 끝에서 1초 뒤에 타이머로도 한 번 센다.
      window.setTimeout(finish, (voice.end - now) * 1000 + 1000);
    } catch {
      finish();
    }
  }

  // 소리 하나를 만든다. 수치는 정해 둔 규칙이 아니라 만들며 고른 값이다. 크기는 메모리에 그려 잰 값으로 맞췄고(2026-11-24), 높이·길이·파형은
  // 사람이 들어 보고 맞춘 것이 아니다(검사 브라우저로는 들을 수 없다). 끝 시각은 voice가 모든 발진기·소음에서 가장 늦은 것을 모은다. 마지막으로 만든 소리의 끝을
  // 돌려줄 때는 짧은 소음으로 끝나는 소리(draw)의 정리가 두 음의 끝과 겹쳤다(PR #42 리뷰, ee96b62).
  private compose(cue: Cue, out: AudioNode, t: number, voice: Voice) {
    const tone = (wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) => this.tone(out, voice, wave, from, t + start, duration, peak, to);
    const noise = (filter: BiquadFilterType, frequency: number, start: number, duration: number, peak: number, to?: number) => this.noise(out, voice, filter, frequency, t + start, duration, peak, to);
    switch (cue.kind) {
      case 'press': this.press(cue.affinity ?? 'none', tone, noise); break;
      case 'empty': tone('square', 150, 0, .05, .12); tone('square', 150, .08, .05, .12); break;
      case 'break': tone('triangle', 880, 0, .09, .35); tone('triangle', 1320, .06, .16, .3); break;
      case 'partial': noise('bandpass', 1800, 0, .05, .12); tone('triangle', 740, 0, .14, .3); break;
      case 'draw': tone('square', 220, 0, .14, .12); tone('square', 233, 0, .14, .12); noise('bandpass', 2400, 0, .09, .2); break;
      case 'guard': noise('lowpass', 600, 0, .06, .2); tone('sine', 150, 0, .15, .4, 90); break;
      case 'hit': tone('sine', 320, 0, .07, .2, 200); noise('bandpass', 1400, 0, .07, .35); break;
      case 'hurt': tone('sine', 200, 0, .15, .25, 130); break;
      // 내가 맞은 소리는 놓치면 안 되므로 가장 크게 낸다.
      case 'myHurt': noise('lowpass', 900, 0, .14, .6); tone('sawtooth', 170, 0, .26, .55, 80); break;
      case 'heal': tone('sine', 523, 0, .1, .2); tone('sine', 659, .08, .1, .2); tone('sine', 784, .16, .16, .2); break;
      case 'deploy': tone('sine', 110, 0, .3, .25); noise('lowpass', 400, 0, .34, .25, 1600); break;
      case 'evade': noise('highpass', 1800, 0, .17, .2, 3600); break;
      case 'telegraph': this.telegraph(cue.affinity ?? 'none', cue.tier ?? 1, tone); break;
      case 'facility': tone('sine', 70, 0, .6, .45, 35); noise('lowpass', 300, 0, .7, .5); break;
      case 'pickup': tone('triangle', 784, 0, .09, .25); tone('triangle', 1046, .07, .15, .25); break;
      case 'extract': tone('sine', 1568, 0, .04, .08); break;
      case 'victory': tone('triangle', 523, 0, .2, .25); tone('triangle', 659, .12, .2, .25); tone('triangle', 784, .24, .2, .25); tone('triangle', 1046, .36, .5, .25); break;
      case 'defeat': tone('triangle', 392, 0, .3, .25); tone('triangle', 330, .2, .3, .25); tone('triangle', 262, .4, .7, .25); break;
      case 'down': tone('sine', 330, 0, .55, .3, 110); break;
    }
  }

  // 내가 누른 기술의 확인음이다. 서버의 결과를 기다리지 않고 누른 순간에 낸다. 상성마다 높이가 다르고 상성 없는 기술(대시)은 바람 소리다.
  private press(kind: Affinity, tone: (wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) => void,
    noise: (filter: BiquadFilterType, frequency: number, start: number, duration: number, peak: number, to?: number) => void) {
    if (kind === 'strike') tone('triangle', 900, 0, .035, .12);
    else if (kind === 'block') tone('triangle', 520, 0, .045, .14);
    else if (kind === 'channel') tone('triangle', 700, 0, .05, .12, 600);
    else noise('highpass', 2500, 0, .06, .1);
  }

  // 적이 예고를 시작한 소리다. 상성마다 모양이 다르다. 타격은 높은 두 번, 방어는 낮고 둔한 한 번, 잡기는 내려가는 한 번이다.
  // 2티어(엘리트의 대응 2)는 한 옥타브 아래 소리를 겹쳐 길고 무겁게 낸다.
  private telegraph(kind: Affinity, tier: number, tone: (wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) => void) {
    let base: number;
    if (kind === 'strike') { base = 1180; tone('square', base, 0, .05, .1); tone('square', base, .07, .05, .1); }
    else if (kind === 'block') { base = 300; tone('triangle', base, 0, .16, .3); }
    else { base = 560; tone('sine', base, 0, .18, .25, 480); }
    if (tier >= 2) tone('sine', base / 2, 0, .3, .25);
  }

  // 발진기·소음 하나가 끝나면 노드를 끊고, 그 소리의 마지막 것이면 소리 전체를 끝낸다.
  private track(voice: Voice, node: AudioScheduledSourceNode, stop: number, parts: AudioNode[]) {
    voice.pending += 1;
    voice.end = Math.max(voice.end, stop);
    node.onended = () => {
      for (const part of parts) part.disconnect();
      voice.pending -= 1;
      if (voice.pending === 0) voice.finish();
    };
  }

  // connect를 이어 부르지 않는다(a.connect(b).connect(c)). 옛 webkitAudioContext는 connect가 노드를 돌려주지 않는다고 알려져 있다(재지 않음).
  private tone(out: AudioNode, voice: Voice, wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, start);
    if (to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    this.shape(envelope.gain, start, duration, peak);
    oscillator.connect(envelope);
    envelope.connect(out);
    const stop = start + duration + .02;
    oscillator.start(start);
    oscillator.stop(stop);
    this.track(voice, oscillator, stop, [envelope]);
  }

  private noise(out: AudioNode, voice: Voice, filterType: BiquadFilterType, frequency: number, start: number, duration: number, peak: number, to?: number) {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer!;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    if (to !== undefined) filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    const envelope = context.createGain();
    this.shape(envelope.gain, start, duration, peak);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(out);
    const stop = start + duration + .02;
    source.start(start);
    source.stop(stop);
    this.track(voice, source, stop, [filter, envelope]);
  }

  // 짧게 올라갔다 내려오는 크기다. 0에서 곧바로 시작하면 딸깍 소리가 나서 5ms 동안 올린다.
  private shape(gain: AudioParam, start: number, duration: number, peak: number) {
    gain.setValueAtTime(0, start);
    gain.linearRampToValueAtTime(peak, start + .005);
    gain.exponentialRampToValueAtTime(.0001, start + duration);
  }
}
