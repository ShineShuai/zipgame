// Tiny synthesized SFX — no audio files, no deps. Lazily creates one AudioContext
// on first call (required by browser autoplay policy: must follow a user gesture,
// which pointerdown already gives us).
let ctx = null;
const getCtx = () => ctx ??= new (window.AudioContext || window.webkitAudioContext)();

// One-shot tone: freq (Hz) can be a single number or an array played in sequence.
// dur = seconds per note, type = oscillator waveform, gain = peak volume (0-1).
function tone(freq, { dur = 0.07, type = 'sine', gain = 0.15, gap = 0 } = {}) {
  const ac = getCtx();
  if (ac.state === 'suspended') ac.resume();
  const freqs = Array.isArray(freq) ? freq : [freq];
  let t = ac.currentTime;
  for (const f of freqs) {
    const osc = ac.createOscillator(), amp = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(ac.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
    t += dur + gap;
  }
}

let enabled = true;
export const setSoundEnabled = on => { enabled = on; };
export const isSoundEnabled = () => enabled;

const play = fn => { if (enabled) try { fn(); } catch { /* audio unsupported/blocked, ignore */ } };

// forward step: short high blip
export const sfxMove = () => play(() => tone(660, { dur: 0.045, type: 'sine', gain: 0.12 }));
// backtrack (pop or truncate): short low blip, slightly longer/duller
export const sfxBack = () => play(() => tone(220, { dur: 0.06, type: 'triangle', gain: 0.12 }));
// checkpoint crossed in order: bright two-note chime
export const sfxCheckpoint = () => play(() => tone([784, 988], { dur: 0.07, type: 'sine', gain: 0.16, gap: 0.01 }));
// puzzle solved: ascending fanfare
export const sfxSolved = () => play(() => tone([523, 659, 784, 1047], { dur: 0.11, type: 'sine', gain: 0.18, gap: 0.02 }));
