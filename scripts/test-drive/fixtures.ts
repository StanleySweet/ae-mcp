import { Buffer } from 'node:buffer';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Installed After Effects presets folder (the .ffx files the drive may apply). */
export const PRESETS_ROOT = '/Applications/Adobe After Effects 2026/Presets';

/**
 * Writes a mono 16-bit PCM WAV: a sine tone at 44.1 kHz, 1 second long.
 * The RIFF header is written by hand so the drive needs no audio dependency.
 */
export function writeToneWav(file: string, seconds = 1, frequency = 440): void {
  const sampleRate = 44100;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.round(sampleRate * seconds);
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5 * 32767);
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  writeFileSync(file, buffer);
}

/** First .ffx file under `root` (depth-first, sorted), or undefined when none exists. */
export function findFfxPreset(root: string = PRESETS_ROOT): string | undefined {
  if (!existsSync(root)) return undefined;
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.ffx')) {
      return join(root, entry.name);
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const hit = findFfxPreset(join(root, entry.name));
      if (hit) return hit;
    }
  }
  return undefined;
}
