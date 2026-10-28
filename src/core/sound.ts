/**
 * Wilderlands · 声音系统（change sound-system）
 * WebAudio 实时合成音效 + 昼夜环境床。**纯表现层**：模块顶层零副作用，
 * 解锁前 sfx 只进记录不出声；headless sim 永不导入本模块（红线）。
 */
import { SOUND } from '../config';

export type SfxName =
  | 'chop' | 'mine' | 'pick' | 'pickup' | 'hurt' | 'bite' | 'down' | 'thud'
  | 'build' | 'repair' | 'win' | 'coin' | 'ref' | 'yes' | 'no' | 'bird' | 'cricket' | 'howl';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
/** 风床：noise → lowpass → gain（昼夜仅改截止与增益） */
let windSrc: AudioBufferSourceNode | null = null;
let windFilter: BiquadFilterNode | null = null;
let windGain: GainNode | null = null;

let unlocked = false;
let muted = false;
let bed: 'day' | 'night' = 'day';
const ring: string[] = [];
const counts: Record<string, number> = {};
const lastAt: Partial<Record<SfxName, number>> = {};
let birdNext = 3;
let cricketNext = 2;
let howlNext = 25;
let onMutedCb: ((m: boolean) => void) | null = null;

/** 懒建 AudioContext：解锁前绝不调用构造函数（autoplay 策略与无音频环境红线） */
function ensureCtx(): boolean {
  if (ctx) return true;
  if (!unlocked) return false;
  try {
    const AC: typeof AudioContext = window.AudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : SOUND.master;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.0);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = bed === 'day' ? SOUND.dayWindHz : SOUND.nightWindHz;
    windGain = ctx.createGain();
    windGain.gain.value = SOUND.windGain;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
  } catch {
    ctx = null; // 无音频环境：永久静默降级
  }
  return !!ctx;
}

/** 首次用户手势解锁（autoplay 合规入口） */
export function unlockSound(): void {
  if (unlocked) return;
  unlocked = true;
  if (ensureCtx() && ctx && ctx.state === 'suspended') void ctx.resume();
}

/* ---------------- 合成原语 ---------------- */

function oscHit(type: OscillatorType, f0: number, f1: number, dur: number, g: number, at = 0): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  gn.gain.setValueAtTime(g, t0);
  gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(gn).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noiseHit(freq: number, dur: number, g: number, type: BiquadFilterType = 'bandpass', q = 1.2, at = 0): void {
  if (!ctx || !master || !noiseBuf) return;
  const t0 = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 1 + Math.random() * 0.2; // 每次微抖动，防机关枪感
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(g, t0);
  gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f).connect(gn).connect(master);
  s.start(t0, Math.random() * 0.5, dur + 0.05);
}

/* ---------------- 事件派发 ---------------- */

const SFX: Record<SfxName, () => void> = {
  chop: () => noiseHit(260, 0.1, 0.5),
  mine: () => { noiseHit(950, 0.09, 0.4, 'highpass'); oscHit('triangle', 720, 380, 0.12, 0.16); },
  pick: () => oscHit('sine', 1150, 1650, 0.07, 0.1),
  pickup: () => { oscHit('sine', 660, 660, 0.08, 0.16); oscHit('sine', 990, 990, 0.1, 0.16, 0.09); },
  hurt: () => oscHit('square', 210, 85, 0.18, 0.2),
  bite: () => { oscHit('sawtooth', 150, 55, 0.12, 0.22); noiseHit(500, 0.08, 0.3); },
  down: () => oscHit('sine', 95, 38, 0.5, 0.4),
  thud: () => noiseHit(180, 0.34, 0.4, 'lowpass', 0.7),
  build: () => { noiseHit(240, 0.1, 0.45); noiseHit(240, 0.1, 0.4, undefined, 1.2, 0.14); oscHit('triangle', 300, 220, 0.16, 0.18, 0.28); },
  repair: () => { noiseHit(1300, 0.14, 0.35, 'highpass'); oscHit('square', 420, 300, 0.1, 0.12, 0.06); },
  win: () => [330, 412, 494, 660].forEach((f, i) => oscHit('triangle', f, f, 0.16, 0.2, i * 0.13)),
  coin: () => { oscHit('sine', 1490, 1490, 0.05, 0.14); oscHit('sine', 1990, 1990, 0.08, 0.12, 0.05); },
  ref: () => oscHit('sine', 240, 165, 0.12, 0.16),
  yes: () => { oscHit('sine', 520, 520, 0.07, 0.16); oscHit('sine', 780, 780, 0.1, 0.16, 0.08); },
  no: () => oscHit('sine', 300, 190, 0.14, 0.16),
  bird: () => { oscHit('sine', 2300 + Math.random() * 400, 2900, 0.09, 0.05); oscHit('sine', 2700, 2350, 0.08, 0.04, 0.12); },
  cricket: () => { for (let i = 0; i < 3; i++) noiseHit(4600, 0.02, 0.06, 'bandpass', 6, i * 0.07); },
  howl: () => { oscHit('sawtooth', 175, 235, 0.7, 0.06); oscHit('sawtooth', 235, 110, 0.9, 0.05, 0.7); },
};

/**
 * 单一发声入口。同名音效按真实时间节流（D5）：**吞发声不吞记录**，
 * ring/counts 始终完整——e2e 断言口径因此与音频设备无关。
 */
export function sfx(name: SfxName): void {
  counts[name] = (counts[name] ?? 0) + 1;
  ring.push(name);
  if (ring.length > 40) ring.shift();
  const now = performance.now();
  if (now - (lastAt[name] ?? -1e12) < SOUND.throttle * 1000) return;
  lastAt[name] = now;
  if (!muted && ensureCtx() && ctx && ctx.state !== 'closed') SFX[name]();
}

/* ---------------- 昼夜环境床 ---------------- */

/** 床层切换：isNight 翻转沿调用（daynight.ts），幂等 */
export function setBed(night: boolean): void {
  bed = night ? 'night' : 'day';
  if (!ctx || !windFilter || !windGain) return;
  const t = ctx.currentTime;
  windFilter.frequency.linearRampToValueAtTime(night ? SOUND.nightWindHz : SOUND.dayWindHz, t + SOUND.bedFade);
  windGain.gain.linearRampToValueAtTime(night ? SOUND.windGainNight : SOUND.windGain, t + SOUND.bedFade);
  if (master && !muted) master.gain.linearRampToValueAtTime(SOUND.master, t + 0.05);
}

/** 真实时间驱动的点缀排程（表现层 Math.random，禁碰 sim Rng 红线）。
 *  自带 performance.now 差分——不依赖主循环被 min(0.05) 钳制的 dt，低帧率下排程仍按真实秒走（D6 兑现）。 */
let lastRealAt = 0;
export function soundTick(): void {
  const now = performance.now();
  const realDt = lastRealAt ? Math.min((now - lastRealAt) / 1000, 1) : 0;
  lastRealAt = now;
  birdNext -= realDt;
  if (birdNext <= 0) {
    if (bed === 'day' && !muted) sfx('bird');
    birdNext = SOUND.birdGap[0] + Math.random() * (SOUND.birdGap[1] - SOUND.birdGap[0]);
  }
  cricketNext -= realDt;
  if (cricketNext <= 0) {
    if (bed === 'night' && !muted) sfx('cricket');
    cricketNext = SOUND.cricketGap[0] + Math.random() * (SOUND.cricketGap[1] - SOUND.cricketGap[0]);
  }
  howlNext -= realDt;
  if (howlNext <= 0) {
    if (bed === 'night' && !muted) sfx('howl');
    howlNext = SOUND.howlGap[0] + Math.random() * (SOUND.howlGap[1] - SOUND.howlGap[0]);
  }
}

/* ---------------- 静音 ---------------- */

export function onMutedChange(cb: (m: boolean) => void): void { onMutedCb = cb; }
export function isMuted(): boolean { return muted; }
export function setMuted(v: boolean): void {
  muted = v;
  if (ctx && master && ctx.state !== 'closed') {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.linearRampToValueAtTime(v ? 0 : SOUND.master, t + 0.08);
  }
  if (onMutedCb) onMutedCb(v);
}
export function toggleMuted(): boolean { setMuted(!muted); return muted; }

/* ---------------- 测试夹具 ---------------- */

export function soundStats(): { unlocked: boolean; muted: boolean; bed: string; ring: string[]; counts: Record<string, number> } {
  return { unlocked, muted, bed, ring: [...ring], counts: { ...counts } };
}
