// ===========================================
//   SIMON SOUND ENGINE (standalone module)
// ===========================================

// Accurate classic Simon tones
export const TONE_MAP = {
  green: 329.63,   // E4
  red: 261.63,     // C4
  yellow: 220.00,  // A3
  blue: 164.81     // E3
};

// Core audio engine
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

export function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
}

// Play a frequency with soft attack/release
export function playTone(color, durationMs) {
  const freq = TONE_MAP[color];
  if (!freq) return;

  ensureAudioContext();

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  const now = audioCtx.currentTime;
  const duration = durationMs / 1000;

  // Attack → hold → release
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
  gainNode.gain.setValueAtTime(0.3, now + duration - 0.03);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gainNode).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

// Utility so client.js can use one simple API
export function flashSimonLight(color, IMAGE_MAP, simonImageEl, durationMs) {
  if (!IMAGE_MAP[color]) return;

  // Visual ON
  simonImageEl.src = IMAGE_MAP[color];

  // Play tone
  playTone(color, durationMs);

  // Visual OFF after delay
  setTimeout(() => {
    simonImageEl.src = IMAGE_MAP.off;
  }, durationMs);
}
