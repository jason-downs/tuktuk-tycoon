// Game sound, all synthesised with the Web Audio API (no audio files): the
// tuk-tuk's putter, its horn, coins on payment, a notification tick and rain.
// Browsers only allow audio after a user gesture, so the AudioContext is
// created on the first click, tap or key press. Volume and mute are remembered
// in localStorage.

export interface SoundSettings {
  /** 0–1. */
  volume: number;
  muted: boolean;
}

const STORAGE_KEY = 'tuktuk-audio';
/** A modest default: the master gain is volume², so 0.5 plays at a quarter of full scale. */
const DEFAULT_SETTINGS: SoundSettings = { volume: 0.5, muted: false };

/** Loudness of each sound before the master volume. */
const LEVEL = { engineIdle: 0.08, engineFull: 0.14, horn: 0.3, coins: 0.22, tick: 0.14, rain: 0.16 };

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<SoundSettings>;
    const volume = typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : DEFAULT_SETTINGS.volume;
    return { volume, muted: p.muted === true };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: SoundSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the setting lasts for this session only */
  }
}

interface EngineNodes {
  firing: OscillatorNode;
  lope: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface RainNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: EngineNodes | null = null;
  private rain: RainNodes | null = null;
  private current: SoundSettings = loadSettings();
  private readonly listeners = new Set<() => void>();
  private unlockInstalled = false;
  private engineState = { active: false, speed: -1 };
  private rainLevel = 0;

  // ------------------------------------------------------------ settings
  get settings(): SoundSettings {
    return this.current;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  setVolume(volume: number): void {
    this.update({ volume: Math.max(0, Math.min(1, volume)), muted: volume > 0 ? false : this.current.muted });
  }

  setMuted(muted: boolean): void {
    this.update({ muted });
  }

  toggleMute(): void {
    this.update({ muted: !this.current.muted });
  }

  private update(patch: Partial<SoundSettings>): void {
    this.current = { ...this.current, ...patch };
    saveSettings(this.current);
    this.applyMaster();
    this.listeners.forEach((l) => l());
  }

  private masterLevel(): number {
    return this.current.muted ? 0 : this.current.volume * this.current.volume;
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------ context
  /** Create the AudioContext on the first user gesture, and pause audio while the tab is hidden. */
  installUnlock(): () => void {
    if (this.unlockInstalled || typeof window === 'undefined') return () => {};
    this.unlockInstalled = true;
    const unlock = () => this.unlock();
    const onVisibility = () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      document.removeEventListener('visibilitychange', onVisibility);
      this.unlockInstalled = false;
    };
  }

  private unlock(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) {
      try {
        const ctx = new Ctor();
        const master = ctx.createGain();
        master.gain.value = this.masterLevel();
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.ratio.value = 6;
        master.connect(limiter).connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended' && document.visibilityState !== 'hidden') void this.ctx.resume();
  }

  /** The context when sound can play right now, else null. */
  private live(): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.masterLevel() === 0) return null;
    return ctx;
  }

  // ------------------------------------------------------------ engine
  private buildEngine(ctx: AudioContext): EngineNodes {
    // A low sawtooth at the firing rate, roughened by a square wave at half
    // the rate, through a resonant low-pass: a soft single-cylinder putter.
    const firing = ctx.createOscillator();
    firing.type = 'sawtooth';
    const lope = ctx.createOscillator();
    lope.type = 'square';
    const lopeGain = ctx.createGain();
    lopeGain.gain.value = 0.35;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 110;
    body.gain.value = 6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    firing.connect(filter);
    lope.connect(lopeGain).connect(filter);
    filter.connect(body).connect(gain).connect(this.master!);
    firing.start();
    lope.start();
    return { firing, lope, filter, gain };
  }

  /** Engine putter: on while the player's tuk-tuk moves under the camera; pitch follows speed (m/s). */
  setEngine(active: boolean, speed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const s = Math.round(speed * 2) / 2;
    if (active === this.engineState.active && (!active || s === this.engineState.speed)) return;
    this.engineState = { active, speed: s };
    if (!active && !this.engine) return;
    const e = (this.engine ??= this.buildEngine(ctx));
    const t = ctx.currentTime;
    const rate = 22 + Math.min(14, s) * 2.2;
    e.firing.frequency.setTargetAtTime(rate, t, 0.15);
    e.lope.frequency.setTargetAtTime(rate / 2, t, 0.15);
    e.filter.frequency.setTargetAtTime(280 + rate * 7, t, 0.2);
    const level = LEVEL.engineIdle + (LEVEL.engineFull - LEVEL.engineIdle) * Math.min(1, s / 14);
    e.gain.gain.setTargetAtTime(active ? level : 0, t, active ? 0.25 : 0.12);
  }

  // ------------------------------------------------------------ rain
  /** Rain ambience, 0 (dry) to 1 (storm). */
  setRain(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const level = Math.round(Math.max(0, Math.min(1, intensity)) * 20) / 20;
    if (level === this.rainLevel) return;
    this.rainLevel = level;
    if (!this.rain) {
      if (level === 0) return;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 700;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 5_500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(high).connect(low).connect(gain).connect(this.master);
      source.start();
      this.rain = { source, gain };
    }
    this.rain.gain.gain.setTargetAtTime(level * LEVEL.rain, ctx.currentTime, 1.5);
  }

  // ------------------------------------------------------------ one-shots
  private tone(ctx: AudioContext, type: OscillatorType, freq: number, at: number, dur: number, level: number, dest: AudioNode): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(dest);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /** Tuk-tuk horn: a short, reedy "meep-meep". */
  horn(): void {
    const ctx = this.live();
    if (!ctx) return;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1_100;
    band.Q.value = 0.9;
    band.connect(this.master!);
    const t = ctx.currentTime + 0.02;
    for (const start of [0, 0.19]) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t + start);
      env.gain.exponentialRampToValueAtTime(LEVEL.horn, t + start + 0.012);
      env.gain.setValueAtTime(LEVEL.horn, t + start + 0.11);
      env.gain.exponentialRampToValueAtTime(0.0001, t + start + 0.15);
      env.connect(band);
      for (const f of [415, 523]) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = f;
        osc.connect(env);
        osc.start(t + start);
        osc.stop(t + start + 0.17);
      }
    }
  }

  /** Coins on payment; a third chime for a tip. */
  coins(tip: boolean): void {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const notes = tip ? [1318.5, 1975.5, 2637] : [1318.5, 1975.5];
    notes.forEach((f, i) => {
      this.tone(ctx, 'sine', f, t + i * 0.075, 0.45, LEVEL.coins, this.master!);
      this.tone(ctx, 'triangle', f * 2.01, t + i * 0.075, 0.2, LEVEL.coins * 0.25, this.master!);
    });
  }

  /** A soft tick for goal and event notices. */
  tick(kind: 'goal' | 'event'): void {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    if (kind === 'goal') {
      this.tone(ctx, 'sine', 1046.5, t, 0.3, LEVEL.tick, this.master!);
      this.tone(ctx, 'sine', 1568, t + 0.09, 0.4, LEVEL.tick, this.master!);
    } else {
      this.tone(ctx, 'sine', 880, t, 0.3, LEVEL.tick, this.master!);
    }
  }
}

/** The game's one sound engine. */
export const sound = new SoundEngine();
