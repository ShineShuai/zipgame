// Tiny synthesized SFX — no audio files, no deps. Lazily creates one AudioContext
// on first call (required by browser autoplay policy: must follow a user gesture,
// which pointerdown already gives us).
let ctx = null;
const getCtx = () => ctx ??= new (window.AudioContext || window.webkitAudioContext)();

// One-shot tone: freq (Hz) can be a single number or an array played in sequence.
// dur = seconds per note (a single number applies to every note, or an array gives each note its
// own duration — e.g. a sequence that gets shorter as it goes). gap works the same way, per note.
// type = oscillator waveform, gain = peak volume (0-1).
// overtone: optional {ratio, gain} — adds a second, quieter oscillator at ratio*freq under each
// note, giving it a touch of "sparkle" (a bare fundamental reads as a flat UI beep; a fundamental
// plus a soft octave/fifth above it reads as a small musical note instead).
function tone(freq, { dur = 0.07, type = 'sine', gain = 0.15, gap = 0, overtone = null } = {}) {
  const ac = getCtx();
  if (ac.state === 'suspended') {
    // Some OEM Android builds (reported: Vivo) leave the context suspended even after
    // a user-gesture-triggered resume() call; log so this is visible in remote/device debugging.
    ac.resume().catch(err => console.warn('AudioContext.resume() failed:', err));
  }
  const freqs = Array.isArray(freq) ? freq : [freq];
  const durAt = i => Array.isArray(dur) ? dur[Math.min(i, dur.length - 1)] : dur;
  const gapAt = i => Array.isArray(gap) ? gap[Math.min(i, gap.length - 1)] : gap;
  let t = ac.currentTime;
  const voice = (f, g, ty, d) => {
    const osc = ac.createOscillator(), amp = ac.createGain();
    osc.type = ty; osc.frequency.setValueAtTime(f, t);
    amp.gain.setValueAtTime(g, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(amp).connect(ac.destination);
    osc.start(t); osc.stop(t + d + 0.02);
  };
  freqs.forEach((f, i) => {
    const d = durAt(i);
    voice(f, gain, type, d);
    if (overtone) voice(f * overtone.ratio, gain * overtone.gain, overtone.type || type, d);
    t += d + gapAt(i);
  });
}

let enabled = true;
export const setSoundEnabled = on => { enabled = on; };
export const isSoundEnabled = () => enabled;

const play = fn => { if (enabled) try { fn(); } catch { /* audio unsupported/blocked, ignore */ } };

// forward step: short high blip with a soft octave overtone — a touch of "sparkle" instead of a
// flat UI beep
export const sfxMove = () => play(() => tone(660, { dur: 0.045, type: 'sine', gain: 0.12, overtone: { ratio: 2, gain: 0.35 } }));
// backtrack (pop or truncate): short low blip, slightly longer/duller, with a soft sub-octave
// underneath for a bit of "thud" rather than a bare beep
export const sfxBack = () => play(() => tone(220, { dur: 0.06, type: 'triangle', gain: 0.12, overtone: { ratio: 0.5, gain: 0.3, type: 'sine' } }));
// checkpoint crossed in order: bright two-note chime
export const sfxCheckpoint = () => play(() => tone([784, 988], { dur: 0.07, type: 'sine', gain: 0.16, gap: 0.01, overtone: { ratio: 2, gain: 0.25 } }));

// Forward steps after crossing checkpoint k walk up a major-pentatonic scale (the classic
// "coin/pickup" scale — every note is consonant with every other, so climbing it feels rewarding
// rather than alarming the way a raw rising pitch does). One octave = 5 notes; each further
// octave is a real doubling in frequency, so it still never repeats, it just keeps climbing a
// scale instead of sliding up a bare tone. Starts an octave above the scale's own root so it never
// lands on sfxMove's plain 660 Hz.
const PENTA_ROOT = 523.25; // C5
const PENTA_STEPS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3]; // major pentatonic ratios: C D E G A
const PENTA_MAX_OCTAVE = 3; // cap the climb at 3 octaves up (~C8-ish ceiling) so very-high-K boards don't go shrill
const cpSegmentFreq = k => {
  const i = Math.max(0, k - 1);
  const octave = Math.min(PENTA_MAX_OCTAVE, Math.floor(i / PENTA_STEPS.length) + 1); // +1: start one octave up, see above
  return PENTA_ROOT * PENTA_STEPS[i % PENTA_STEPS.length] * 2 ** octave;
};
// forward step taken after crossing checkpoint number `k` (1-indexed: 1 = after the 1st checkpoint)
export const sfxMoveAfterCheckpoint = k => play(() => tone(cpSegmentFreq(Math.max(1, k)), { dur: 0.055, type: 'sine', gain: 0.13, overtone: { ratio: 2, gain: 0.3 } }));

// blocked/illegal move attempt: wall, border, or revisiting own path. A quick descending 3-note
// "bounce" — like a ball dropping and losing energy — rather than a pitch-bend: at these short
// durations a continuous glide reads as just "a blip" (the ear can't track a slide under ~150ms),
// but a short rhythmic sequence of distinct notes stays perceptible even packed into ~110ms total,
// and the shrinking gaps + falling pitch read as springy/lively rather than alarming. Triangle
// wave, no harsh buzz, quietest overall gain of the six effects since this fires most often.
export const sfxBlocked = () => play(() => tone([320, 220, 160], { dur: [0.045, 0.035, 0.03], gap: [0.02, 0.012], gain: 0.11, overtone: { ratio: 0.5, gain: 0.25 } }));
// puzzle solved: ascending fanfare
export const sfxSolved = () => play(() => tone([523, 659, 784, 1047], { dur: 0.11, type: 'sine', gain: 0.18, gap: 0.02, overtone: { ratio: 2, gain: 0.2 } }));
