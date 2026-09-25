// Sound port: synthesized Web Audio effects for path moves (no static assets).
// Mirrors the storage port pattern: swap the implementation per platform.
class ZipSfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.silentAudio = null; // For the unlock trick
    this.isUnlocked = false;
  }

  /**
   * Unlocks audio on the first user gesture.
   * Should be called from a 'pointerdown' or 'click' event handler.
   */
  unlock() {
    if (this.isUnlocked || !this.enabled) return;

    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        console.warn('Web Audio API not supported.');
        this.enabled = false;
        return;
      }

      if (!this.ctx) {
        this.ctx = new AC();
      }

      // The "silent audio" trick for stubborn browsers.
      // Creating and playing a silent HTMLAudioElement can help trigger
      // audio focus and unlock the AudioContext on some Android browsers.
      if (!this.silentAudio) {
        this.silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
        this.silentAudio.volume = 0;
      }
      this.silentAudio.play().catch(() => { /* ignore */ });

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.isUnlocked = true;
        }).catch(err => console.warn('AudioContext resume failed:', err));
      } else {
        this.isUnlocked = true;
      }
    } catch (e) {
      console.warn('Failed to unlock audio context:', e);
      this.enabled = false;
    }
  }

  /**
   * A more compatible way to play a short synthesized sound.
   * It uses a single oscillator and a gain envelope.
   */
  playTone({ frequency, duration, type = 'sine', volume = 0.3 }) {
    if (!this.enabled || !this.ctx || !this.isUnlocked) return;

    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t0);

    // Simple attack and release envelope to avoid clicks
    gainNode.gain.setValueAtTime(0, t0);
    gainNode.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Player extends the path forward. `level` raises the pitch. */
  forwardMove(level = 0) {
    if (!this.isUnlocked) return;
    const lvl = Math.min(level, 12);
    const baseFreq = 520 * Math.pow(2, lvl / 6);
    this.playTone({ frequency: baseFreq, duration: 0.08, type: 'triangle', volume: 0.25 });
    setTimeout(() => {
      this.playTone({ frequency: baseFreq * 1.5, duration: 0.07, type: 'triangle', volume: 0.2 });
    }, 45);
  }

  /** Player undoes one step or truncates the path. */
  backtrackMove(level = 0) {
    if (!this.isUnlocked) return;
    const lvl = Math.min(level, 12);
    const baseFreq = 520 * Math.pow(2, lvl / 6);
    this.playTone({ frequency: baseFreq, duration: 0.12, type: 'sine', volume: 0.2 });
    setTimeout(() => {
      this.playTone({ frequency: baseFreq * 0.5, duration: 0.14, type: 'triangle', volume: 0.15 });
    }, 10);
  }

  /** Path reset to start. */
  resetMove() {
    if (!this.isUnlocked) return;
    this.playTone({ frequency: 340, duration: 0.18, type: 'sine', volume: 0.2 });
  }

  /** Puzzle completed. */
  solve() {
    if (!this.isUnlocked) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      setTimeout(() => this.playTone({ frequency: f, duration: 0.12, type: 'sine', volume: 0.25 }), i * 90);
    });
  }
}

export const sfx = new ZipSfx();