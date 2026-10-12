/**
 * Fully procedural Web Audio sound engine — no audio files to license or
 * fail to load. Every public method is a safe no-op until `unlock()` has been
 * called from a user gesture (autoplay policy) or if Web Audio is missing.
 */

type Ctx = AudioContext;

class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineLfo: OscillatorNode | null = null;
  private engineLfoDepth: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private ambienceGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private nextAmbientHorn = 0;
  private failed = false;

  get ready() {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture handler. */
  unlock() {
    if (this.failed) return;
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** Suspend the context while the tab is hidden to save battery. */
  setSuspended(suspended: boolean) {
    if (!this.ctx) return;
    if (suspended && this.ctx.state === "running") void this.ctx.suspend();
    if (!suspended && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private build() {
    const AC: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) {
      this.failed = true;
      return;
    }
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    master.connect(comp);
    this.master = master;

    // White noise buffer shared by wind, ambience, crash.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // --- Two-stroke tuk-tuk engine: sawtooth + sub, amplitude-modulated by
    // a "firing" LFO, through a lowpass that opens with speed.
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 700;
    engineFilter.Q.value = 3;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const amp = ctx.createGain();
    amp.gain.value = 0.55;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;
    const sub = ctx.createOscillator();
    sub.type = "square";
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 16;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(amp.gain);
    osc.connect(amp);
    sub.connect(subGain).connect(amp);
    amp.connect(engineFilter).connect(engineGain).connect(master);
    osc.start();
    sub.start();
    lfo.start();
    this.engineOsc = osc;
    this.engineSub = sub;
    this.engineLfo = lfo;
    this.engineLfoDepth = lfoDepth;
    this.engineFilter = engineFilter;
    this.engineGain = engineGain;

    // --- Wind / road rush rising with speed.
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 800;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windGain = windGain;
    this.windFilter = windFilter;

    // --- Distant traffic rumble.
    const amb = ctx.createBufferSource();
    amb.buffer = buf;
    amb.loop = true;
    amb.playbackRate.value = 0.5;
    const ambFilter = ctx.createBiquadFilter();
    ambFilter.type = "lowpass";
    ambFilter.frequency.value = 260;
    const ambGain = ctx.createGain();
    ambGain.gain.value = 0;
    amb.connect(ambFilter).connect(ambGain).connect(master);
    amb.start();
    this.ambienceGain = ambGain;
  }

  /**
   * Per-frame update (cheap: only schedules parameter targets).
   * @param speed player speed m/s
   * @param mode  "menu" idles, "playing" drives, "silent" fades the engine out.
   */
  update(speed: number, mode: "menu" | "playing" | "silent", dt: number) {
    const ctx = this.ctx;
    if (!ctx || !this.engineOsc || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const k = Math.min(1, Math.max(0, (speed - 8) / 42));
    const tc = 0.08;
    if (mode === "silent") {
      this.engineGain!.gain.setTargetAtTime(0, t, 0.15);
      this.windGain!.gain.setTargetAtTime(0, t, 0.2);
      this.ambienceGain!.gain.setTargetAtTime(0, t, 0.3);
      return;
    }
    const idle = mode === "menu";
    this.engineOsc.frequency.setTargetAtTime(idle ? 52 : 70 + k * 85, t, tc);
    this.engineSub!.frequency.setTargetAtTime(idle ? 26 : 35 + k * 42, t, tc);
    this.engineLfo!.frequency.setTargetAtTime(idle ? 13 : 20 + k * 30, t, tc);
    this.engineLfoDepth!.gain.setTargetAtTime(idle ? 0.5 : 0.38, t, tc);
    this.engineFilter!.frequency.setTargetAtTime(idle ? 520 : 800 + k * 1300, t, tc);
    this.engineGain!.gain.setTargetAtTime(idle ? 0.07 : 0.11, t, 0.2);
    this.windGain!.gain.setTargetAtTime(idle ? 0.004 : 0.012 + k * 0.05, t, 0.3);
    this.windFilter!.frequency.setTargetAtTime(500 + k * 1500, t, 0.3);
    this.ambienceGain!.gain.setTargetAtTime(idle ? 0.06 : 0.09, t, 0.5);

    // Random distant honks — the soundtrack of every Cairo bridge.
    if (mode === "playing") {
      this.nextAmbientHorn -= dt;
      if (this.nextAmbientHorn <= 0) {
        this.nextAmbientHorn = 2.5 + Math.random() * 5;
        this.horn({ gain: 0.035 + Math.random() * 0.04, pitch: 0.8 + Math.random() * 0.5, pan: Math.random() * 2 - 1, beeps: 1 + Math.floor(Math.random() * 3) });
      }
    }
  }

  horn(opts: { gain?: number; pitch?: number; pan?: number; beeps?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const { gain = 0.22, pitch = 1, pan = 0, beeps = 2 } = opts;
    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.value = pan;
      out.connect(panner).connect(this.master);
    } else {
      out.connect(this.master);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.connect(out);
    let t = ctx.currentTime + 0.01;
    for (let b = 0; b < beeps; b++) {
      const dur = b === beeps - 1 ? 0.28 : 0.12;
      for (const f of [415 * pitch, 523 * pitch]) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.015);
        g.gain.setValueAtTime(0.5, t + dur - 0.03);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(filter);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
      t += dur + 0.07;
    }
    setTimeout(() => out.disconnect(), (t - ctx.currentTime + 0.3) * 1000);
  }

  /** Short bright "ding" — a rising hijaz-flavored arpeggio on close calls. */
  overtake(closeCall: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const notes = closeCall ? [587.3, 622.3, 740, 784, 1174.7] : [784, 1174.7];
    let t = ctx.currentTime + 0.005;
    const step = closeCall ? 0.055 : 0.07;
    for (const f of notes) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(closeCall ? 0.12 : 0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.25);
      t += step;
    }
  }

  crash() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    if (ctx.state !== "running") return;
    const t = ctx.currentTime;
    // Crunch: filtered noise burst sweeping down.
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(180, t + 0.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 1);
    // Thump.
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.35);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
    // Glass tinkles.
    for (let i = 0; i < 7; i++) {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 5000 + Math.random() * 4000;
      const g = ctx.createGain();
      const st = t + 0.08 + Math.random() * 0.45;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.18, st + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0005, st + 0.08);
      s.connect(hp).connect(g).connect(this.master);
      s.start(st, Math.random());
      s.stop(st + 0.1);
    }
    // The other driver leans on the horn.
    setTimeout(() => this.horn({ gain: 0.16, pitch: 0.92, beeps: 3 }), 450);
  }
}

export const audio = new AudioEngine();
