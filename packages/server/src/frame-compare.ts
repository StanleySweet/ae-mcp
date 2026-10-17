import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** Result of comparing two rendered frames. `bbox` is `[x, y, w, h]` in pixels. */
export interface FrameComparison {
  changedPercent: number;
  meanDelta: number | null;
  bbox: [number, number, number, number] | null;
  note?: string;
}

/** Decoded colour channels, top-down, three bytes (R, G, B) per pixel. */
export interface DecodedFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** Converts a PNG to a BMP file. The default uses macOS `sips`; tests inject a fake. */
export type ToBmp = (png: string, bmp: string) => Promise<void>;

/** A pixel counts as changed when any colour channel differs by more than this. */
export const CHANGED_CHANNEL_THRESHOLD = 8;

const execFileAsync = promisify(execFile);

/** Default converter: `sips -s format bmp <png> --out <bmp>`. */
export const sipsToBmp: ToBmp = async (png, bmp) => {
  await execFileAsync('sips', ['-s', 'format', 'bmp', png, '--out', bmp]);
};

/**
 * Parses a 24 or 32 bit uncompressed BMP (BITMAPINFOHEADER or later). Rows are
 * bottom-up unless the height is negative, and each row is padded to 4 bytes.
 * Alpha is dropped; only the colour channels are kept.
 */
export function parseBmp(buffer: Buffer): DecodedFrame {
  if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') {
    throw new Error('not a BMP file');
  }
  const dataOffset = buffer.readUInt32LE(10);
  const headerSize = buffer.readUInt32LE(14);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bpp = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  if (headerSize < 40) {
    throw new Error(`unsupported BMP header size ${headerSize}`);
  }
  if (bpp !== 24 && bpp !== 32) {
    throw new Error(`unsupported BMP bit depth ${bpp}`);
  }
  if (compression !== 0 && compression !== 3) {
    throw new Error(`unsupported BMP compression ${compression}`);
  }
  const height = Math.abs(rawHeight);
  if (width <= 0 || height <= 0) {
    throw new Error('empty BMP');
  }
  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  if (buffer.length < dataOffset + stride * height) {
    throw new Error('BMP pixel data is truncated');
  }
  const bytesPerPixel = bpp / 8;
  const rgb = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    const y = rawHeight > 0 ? height - 1 - row : row;
    const rowStart = dataOffset + row * stride;
    for (let x = 0; x < width; x += 1) {
      const src = rowStart + x * bytesPerPixel;
      const dst = (y * width + x) * 3;
      // BMP stores channels as B, G, R (, A).
      rgb[dst] = buffer[src + 2]!;
      rgb[dst + 1] = buffer[src + 1]!;
      rgb[dst + 2] = buffer[src]!;
    }
  }
  return { width, height, rgb };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Compares two decoded frames pixel by pixel. */
export function compareDecoded(before: DecodedFrame, after: DecodedFrame): FrameComparison {
  if (before.width !== after.width || before.height !== after.height) {
    return { changedPercent: 100, meanDelta: null, bbox: null, note: 'size differs' };
  }
  const { width, height } = before;
  const total = width * height;
  let changed = 0;
  let sumDelta = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      let worst = 0;
      for (let c = 0; c < 3; c += 1) {
        const delta = Math.abs(before.rgb[i + c]! - after.rgb[i + c]!);
        sumDelta += delta;
        worst = Math.max(worst, delta);
      }
      if (worst > CHANGED_CHANNEL_THRESHOLD) {
        changed += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    changedPercent: round2((changed * 100) / total),
    meanDelta: round2(sumDelta / (total * 3)),
    bbox: changed === 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1],
  };
}

/**
 * Compares two PNG frames. Each is converted to BMP in a temporary directory
 * (removed afterwards) and decoded by `parseBmp`.
 */
export async function compareFrames(
  beforePng: string,
  afterPng: string,
  options: { toBmp?: ToBmp } = {},
): Promise<FrameComparison> {
  const toBmp = options.toBmp ?? sipsToBmp;
  const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-frame-compare-'));
  try {
    const beforeBmp = join(dir, 'before.bmp');
    const afterBmp = join(dir, 'after.bmp');
    await toBmp(beforePng, beforeBmp);
    await toBmp(afterPng, afterBmp);
    const before = parseBmp(await readFile(beforeBmp));
    const after = parseBmp(await readFile(afterBmp));
    return compareDecoded(before, after);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
