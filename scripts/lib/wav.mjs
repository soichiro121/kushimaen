/**
 * Minimal WAV writer + tiny synthesiser for placeholder audio. Build-time only.
 *
 * Real audio ships as compressed `.m4a`/`.ogg`; these uncompressed placeholders exist
 * so the audio pipeline (unlock, BGM/SE channels, volume, mute) is exercised for real
 * from day one. Swapping them is a one-line `src` change in the manifest.
 */

export const SAMPLE_RATE = 22050;

export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // format: PCM
  buffer.writeUInt16LE(1, 22); // channels: mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34); // bit depth
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32000), 44 + i * bytesPerSample);
  }
  return buffer;
}

const WAVES = {
  sine: (phase) => Math.sin(phase * Math.PI * 2),
  square: (phase) => (phase % 1 < 0.5 ? 1 : -1),
  saw: (phase) => 2 * (phase % 1) - 1,
  triangle: (phase) => 4 * Math.abs((phase % 1) - 0.5) - 1,
  noise: () => Math.random() * 2 - 1,
};

/**
 * Render one voice into a sample buffer.
 *
 * @param {Float32Array} out
 * @param {object} options
 * @param {number} options.start   seconds
 * @param {number} options.duration seconds
 * @param {number} options.freq    Hz at note start
 * @param {number} [options.freqEnd] Hz at note end (linear sweep)
 * @param {keyof WAVES} [options.wave]
 * @param {number} [options.gain]
 * @param {number} [options.attack] seconds
 * @param {number} [options.release] fraction of remaining time
 */
export function renderVoice(out, options) {
  const {
    start = 0,
    duration,
    freq,
    freqEnd = freq,
    wave = 'sine',
    gain = 0.3,
    attack = 0.005,
    release = 0.6,
  } = options;

  const startSample = Math.floor(start * SAMPLE_RATE);
  const lengthSamples = Math.floor(duration * SAMPLE_RATE);
  const oscillator = WAVES[wave] ?? WAVES.sine;
  let phase = 0;

  for (let i = 0; i < lengthSamples; i++) {
    const index = startSample + i;
    if (index >= out.length) break;
    const t = i / lengthSamples;
    const frequency = freq + (freqEnd - freq) * t;
    phase += frequency / SAMPLE_RATE;

    const attackSamples = Math.max(1, attack * SAMPLE_RATE);
    const attackGain = Math.min(1, i / attackSamples);
    const releaseStart = 1 - release;
    const releaseGain = t < releaseStart ? 1 : 1 - (t - releaseStart) / Math.max(release, 0.0001);

    out[index] += oscillator(phase) * gain * attackGain * Math.max(0, releaseGain);
  }
  return out;
}

export function createBuffer(durationSec) {
  return new Float32Array(Math.ceil(durationSec * SAMPLE_RATE));
}

/** Soft-clip so summed voices never produce digital crackle. */
export function normalize(samples, peak = 0.85) {
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  if (max === 0) return samples;
  const scale = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return samples;
}

/** Equal-power crossfade of the tail into the head so a BGM loop has no click. */
export function makeSeamless(samples, fadeSec = 0.12) {
  const fade = Math.min(Math.floor(fadeSec * SAMPLE_RATE), Math.floor(samples.length / 4));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const head = samples[i];
    const tail = samples[samples.length - fade + i];
    samples[i] = head * Math.sqrt(t) + tail * Math.sqrt(1 - t);
  }
  return samples.slice(0, samples.length - fade);
}

/** Semitone offset from A4 (440 Hz). */
export function note(semitonesFromA4) {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}
