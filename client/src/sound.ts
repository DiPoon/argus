import type { Affinity } from './types';
import { personal, type Cue } from './cues';

// 게임 소리다(이슈 #35, 2026-11-24). 소리 파일 없이 Web Audio로 그때그때 합성한다. 파일을 쓰면 출처와 이용 조건을 따로 챙겨야 하고
// 내려받을 것이 늘어난다. 무엇을 울릴지는 cues.ts가 스냅샷으로 정하고, 여기서는 소리를 만들기만 한다.
// 브라우저는 사용자의 누름 안에서만 소리를 켤 수 있다(자동 재생 정책). 그래서 첫 누름이나 키에서 unlock을 부른다(main.ts).
// 켬·끔과 크기는 이 브라우저의 localStorage(argus-sound)에 둔다. 읽거나 쓸 수 없으면 기본값으로 쓰고 이번 방문에만 바꾼다.

type Wave = OscillatorType;
// 한 번에 울리는 소리의 상한이다. 넘으면 새 소리를 버린다. 섞인 무리와 오래 싸워도 소리가 쌓여 끊기지 않게 한다.
const maxVoices = 24;
const settingsKey = 'argus-sound';

export class Sound {
  enabled = true;
  // 0~1이다. 소리 장치 전체의 크기(master)가 이 값이다. 가장 큰 크기(1)에서 소리 하나의 가장 큰 값이 0.06(탈출 확보의 1초 소리)~0.42(내가 맞은 소리)다(2026-11-24에 메모리에 그려 잼, sound.spec.ts가 들리는지와 넘치지 않는지를 본다).
  volume = .6;
  private context?: AudioContext;
  private master?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private active = 0;

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
      this.master.gain.value = this.volume;
      // 끝에 압축기(DynamicsCompressorNode)를 두지 않는다. 스스로 크기를 키우는 보정이 있어(Web Audio 규격의 makeup gain) 긴 소리는 세 배 가까이
      // 커지고 짧은 타격 소리는 도리어 작아졌다(2026-11-24에 메모리에 그려 잼). 겹침은 한 번에 울리는 소리의 상한(maxVoices)으로 막는다.
      this.master.connect(this.context.destination);
      // 흰 소음 1초다. 타격·바람 소리를 거르개로 깎아 만든다.
      const length = this.context.sampleRate;
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    // 멈춘 것(suspended)만이 아니라 아이폰이 전화·알림으로 끊어 둔 것(interrupted)도 다시 켠다. running·closed 말고는 모두 부른다(PR #42 리뷰 4).
    const state = this.context.state as string;
    if (state !== 'running' && state !== 'closed') void this.context.resume().catch(() => undefined);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.save();
    if (on) this.unlock();
    else if (this.context?.state === 'running') void this.context.suspend().catch(() => undefined);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
    this.save();
  }

  private save() {
    try { localStorage.setItem(settingsKey, JSON.stringify({ on: this.enabled, volume: this.volume })); } catch { /* 이번 방문에만 쓴다. */ }
  }

  // 사건 하나의 소리를 낸다. 소리 장치가 아직 켜지지 않았거나(누름 전) 꺼 두었으면 내지 않는다.
  // 한 번에 울리는 소리가 상한이면 새 소리를 버리되, 나에게 일어난 일과 작전 종료(cues.ts의 personal)는 낸다. 섞인 무리와 싸우는 중에 내가 맞은
  // 소리나 작전 실패 소리가 버려졌다(PR #42 리뷰 3).
  play(cue: Cue) {
    const context = this.context;
    if (!this.enabled || !context || !this.master || context.state !== 'running') return;
    if (this.active >= maxVoices && !personal.includes(cue.kind)) return;
    const output = context.createGain();
    output.gain.value = cue.gain;
    let last: AudioNode = output;
    // 좌우 자리는 StereoPannerNode가 없는 브라우저에서는 빼고 가운데에서 낸다.
    if (typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = cue.pan;
      output.connect(panner);
      last = panner;
    }
    last.connect(this.master);
    const now = context.currentTime;
    const end = this.compose(cue, output, now);
    this.active += 1;
    // 다 울린 소리의 노드를 끊는다. 소리마다 끝 시각이 정해져 있어 그 뒤에 한 번 센다.
    window.setTimeout(() => { this.active -= 1; output.disconnect(); last.disconnect(); }, (end - now) * 1000 + 50);
  }

  // 소리 하나를 만들고 끝 시각을 돌려준다. 수치는 듣고 맞춘 값이다.
  private compose(cue: Cue, out: AudioNode, t: number): number {
    const tone = (wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) => this.tone(out, wave, from, t + start, duration, peak, to);
    const noise = (filter: BiquadFilterType, frequency: number, start: number, duration: number, peak: number, to?: number) => this.noise(out, filter, frequency, t + start, duration, peak, to);
    switch (cue.kind) {
      case 'press': return this.press(cue.affinity ?? 'none', tone, noise);
      case 'empty': tone('square', 150, 0, .05, .12); return tone('square', 150, .08, .05, .12);
      case 'break': tone('triangle', 880, 0, .09, .35); return tone('triangle', 1320, .06, .16, .3);
      case 'partial': noise('bandpass', 1800, 0, .05, .12); return tone('triangle', 740, 0, .14, .3);
      case 'draw': tone('square', 220, 0, .14, .12); tone('square', 233, 0, .14, .12); return noise('bandpass', 2400, 0, .09, .2);
      case 'guard': noise('lowpass', 600, 0, .06, .2); return tone('sine', 150, 0, .15, .4, 90);
      case 'hit': tone('sine', 320, 0, .07, .2, 200); return noise('bandpass', 1400, 0, .07, .35);
      case 'hurt': return tone('sine', 200, 0, .15, .25, 130);
      // 내가 맞은 소리는 놓치면 안 되므로 가장 크게 낸다.
      case 'myHurt': noise('lowpass', 900, 0, .14, .6); return tone('sawtooth', 170, 0, .26, .55, 80);
      case 'heal': tone('sine', 523, 0, .1, .2); tone('sine', 659, .08, .1, .2); return tone('sine', 784, .16, .16, .2);
      case 'deploy': tone('sine', 110, 0, .3, .25); return noise('lowpass', 400, 0, .34, .25, 1600);
      case 'evade': return noise('highpass', 1800, 0, .17, .2, 3600);
      case 'telegraph': return this.telegraph(cue.affinity ?? 'none', cue.tier ?? 1, tone);
      case 'facility': tone('sine', 70, 0, .6, .45, 35); return noise('lowpass', 300, 0, .7, .5);
      case 'pickup': tone('triangle', 784, 0, .09, .25); return tone('triangle', 1046, .07, .15, .25);
      case 'extract': return tone('sine', 1568, 0, .04, .08);
      case 'victory': tone('triangle', 523, 0, .2, .25); tone('triangle', 659, .12, .2, .25); tone('triangle', 784, .24, .2, .25); return tone('triangle', 1046, .36, .5, .25);
      case 'defeat': tone('triangle', 392, 0, .3, .25); tone('triangle', 330, .2, .3, .25); return tone('triangle', 262, .4, .7, .25);
      case 'down': return tone('sine', 330, 0, .55, .3, 110);
    }
  }

  // 내가 누른 기술의 확인음이다. 서버의 결과를 기다리지 않고 누른 순간에 낸다. 상성마다 높이가 다르고 상성 없는 기술(대시)은 바람 소리다.
  private press(kind: Affinity, tone: (wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) => number,
    noise: (filter: BiquadFilterType, frequency: number, start: number, duration: number, peak: number, to?: number) => number) {
    if (kind === 'strike') return tone('triangle', 900, 0, .035, .12);
    if (kind === 'block') return tone('triangle', 520, 0, .045, .14);
    if (kind === 'channel') return tone('triangle', 700, 0, .05, .12, 600);
    return noise('highpass', 2500, 0, .06, .1);
  }

  // 적이 예고를 시작한 소리다. 상성마다 모양이 다르다. 타격은 높은 두 번, 방어는 낮고 둔한 한 번, 잡기는 내려가는 한 번이다.
  // 2티어(엘리트의 대응 2)는 한 옥타브 아래 소리를 겹쳐 길고 무겁게 낸다.
  private telegraph(kind: Affinity, tier: number, tone: (wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) => number) {
    let end: number;
    let base: number;
    if (kind === 'strike') { base = 1180; tone('square', base, 0, .05, .1); end = tone('square', base, .07, .05, .1); }
    else if (kind === 'block') { base = 300; end = tone('triangle', base, 0, .16, .3); }
    else { base = 560; end = tone('sine', base, 0, .18, .25, 480); }
    if (tier >= 2) end = Math.max(end, tone('sine', base / 2, 0, .3, .25));
    return end;
  }

  private tone(out: AudioNode, wave: Wave, from: number, start: number, duration: number, peak: number, to?: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, start);
    if (to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    this.shape(envelope.gain, start, duration, peak);
    oscillator.connect(envelope).connect(out);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
    oscillator.onended = () => envelope.disconnect();
    return start + duration + .02;
  }

  private noise(out: AudioNode, filterType: BiquadFilterType, frequency: number, start: number, duration: number, peak: number, to?: number) {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer!;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    if (to !== undefined) filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    const envelope = context.createGain();
    this.shape(envelope.gain, start, duration, peak);
    source.connect(filter).connect(envelope).connect(out);
    source.start(start);
    source.stop(start + duration + .02);
    source.onended = () => { filter.disconnect(); envelope.disconnect(); };
    return start + duration + .02;
  }

  // 짧게 올라갔다 내려오는 크기다. 0에서 곧바로 시작하면 딸깍 소리가 나서 5ms 동안 올린다.
  private shape(gain: AudioParam, start: number, duration: number, peak: number) {
    gain.setValueAtTime(0, start);
    gain.linearRampToValueAtTime(peak, start + .005);
    gain.exponentialRampToValueAtTime(.0001, start + duration);
  }
}
