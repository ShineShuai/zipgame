// Sound port: synthesized Web Audio effects for path moves (no static assets).
// Mirrors the storage port pattern: swap the implementation per platform.
class ZipSfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  /** Must be called from a user gesture (pointerdown/keydown) to unlock audio. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  blip({ startFreq, endFreq, duration, type = 'triangle', gain = 0.25, delay = 0 }) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Player extends the path forward. */
  forwardMove() {
    this.blip({ startFreq: 520, endFreq: 780, duration: 0.08, gain: 0.30 });
    this.blip({ startFreq: 780, endFreq: 1040, duration: 0.07, gain: 0.22, delay: 0.045 });
  }

  /** Player undoes one step or truncates the path back to an earlier cell. */
  backtrackMove() {
    this.blip({ startFreq: 520, endFreq: 260, duration: 0.12, type: 'sine', gain: 0.22 });
    this.blip({ startFreq: 180, endFreq: 90, duration: 0.14, gain: 0.12, delay: 0.01 });
  }

  /** Path reset to start (clicked checkpoint 1 while drawing). */
  resetMove() {
    this.blip({ startFreq: 340, endFreq: 120, duration: 0.18, type: 'sine', gain: 0.20 });
  }

  /** Puzzle completed. */
  solve() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.blip({ startFreq: f, endFreq: f, duration: 0.12, gain: 0.24, delay: i * 0.09 }));
  }
}

export const sfx = new ZipSfx();