import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { compareDecoded, compareFrames, parseBmp, type DecodedFrame, type ToBmp } from './frame-compare.js';

type Rgb = [number, number, number];

/** Builds a BMP file. `pixel(x, y)` gives the top-down colour of each pixel. */
function makeBmp(
  width: number,
  height: number,
  bpp: 24 | 32,
  pixel: (x: number, y: number) => Rgb,
  topDown = false,
): Buffer {
  const bytesPerPixel = bpp / 8;
  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  const dataOffset = 54;
  const buffer = Buffer.alloc(dataOffset + stride * height);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(dataOffset, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(topDown ? -height : height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(bpp, 28);
  buffer.writeUInt32LE(0, 30);
  for (let row = 0; row < height; row += 1) {
    const y = topDown ? row : height - 1 - row;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = dataOffset + row * stride + x * bytesPerPixel;
      buffer[at] = b;
      buffer[at + 1] = g;
      buffer[at + 2] = r;
      if (bpp === 32) {
        buffer[at + 3] = 255;
      }
    }
  }
  return buffer;
}

const black = (): Rgb => [0, 0, 0];

describe('parseBmp', () => {
  it('decodes bottom-up 24 bit rows with 4-byte padding', () => {
    // 3 pixels x 3 bytes = 9 bytes per row, padded to 12.
    const bmp = makeBmp(3, 2, 24, (x, y) => [x * 10, y * 100, 7]);
    const frame = parseBmp(bmp);
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(2);
    expect(Array.from(frame.rgb.subarray(0, 3))).toEqual([0, 0, 7]);
    expect(Array.from(frame.rgb.subarray(3 * 3 * 1, 3 * 3 * 1 + 3))).toEqual([0, 100, 7]);
    expect(Array.from(frame.rgb.subarray(2 * 3, 2 * 3 + 3))).toEqual([20, 0, 7]);
  });

  it('decodes 32 bit top-down rows and drops alpha', () => {
    const bmp = makeBmp(2, 2, 32, (x, y) => [x, y, 99], true);
    const frame = parseBmp(bmp);
    expect(Array.from(frame.rgb)).toEqual([0, 0, 99, 1, 0, 99, 0, 1, 99, 1, 1, 99]);
  });

  it('rejects files that are not 24 or 32 bit BMPs', () => {
    expect(() => parseBmp(Buffer.from('not a bitmap at all, just some text here padding'))).toThrow(
      'not a BMP',
    );
    const eight = makeBmp(2, 2, 24, black);
    eight.writeUInt16LE(8, 28);
    expect(() => parseBmp(eight)).toThrow('bit depth 8');
  });

  it('rejects truncated pixel data', () => {
    const bmp = makeBmp(4, 4, 24, black);
    expect(() => parseBmp(bmp.subarray(0, bmp.length - 4))).toThrow('truncated');
  });
});

describe('compareDecoded', () => {
  const frame = (width: number, height: number, value: (i: number) => number): DecodedFrame => ({
    width,
    height,
    rgb: Uint8Array.from({ length: width * height * 3 }, (_, i) => value(i)),
  });

  it('reports no change for identical frames', () => {
    const a = frame(4, 4, () => 50);
    expect(compareDecoded(a, frame(4, 4, () => 50))).toEqual({
      changedPercent: 0,
      meanDelta: 0,
      bbox: null,
    });
  });

  it('ignores channel differences of 8 or less and counts 9 as changed', () => {
    const before = frame(2, 1, () => 0);
    const small = frame(2, 1, (i) => (i === 0 ? 8 : 0));
    expect(compareDecoded(before, small).changedPercent).toBe(0);
    const big = frame(2, 1, (i) => (i === 0 ? 9 : 0));
    expect(compareDecoded(before, big).changedPercent).toBe(50);
  });

  it('computes changed share, mean delta and bounding box', () => {
    // 2x1 image: the second pixel's red channel moves by 10.
    const before = frame(2, 1, () => 0);
    const after = frame(2, 1, (i) => (i === 3 ? 10 : 0));
    expect(compareDecoded(before, after)).toEqual({
      changedPercent: 50,
      meanDelta: 1.67,
      bbox: [1, 0, 1, 1],
    });
  });

  it('bounds the changed region across rows and columns', () => {
    const before = frame(5, 5, () => 0);
    // Changes at (1,1) and (3,2): bbox x 1..3, y 1..2.
    const after = frame(5, 5, (i) => {
      const pixel = Math.floor(i / 3);
      return pixel === 1 * 5 + 1 || pixel === 2 * 5 + 3 ? 200 : 0;
    });
    const result = compareDecoded(before, after);
    expect(result.bbox).toEqual([1, 1, 3, 2]);
    expect(result.changedPercent).toBe(8);
  });

  it('reports a size mismatch as fully changed', () => {
    expect(compareDecoded(frame(2, 2, () => 0), frame(3, 2, () => 0))).toEqual({
      changedPercent: 100,
      meanDelta: null,
      bbox: null,
      note: 'size differs',
    });
  });
});

describe('compareFrames', () => {
  it('converts both PNGs with the injected converter, compares them and removes its temp files', async () => {
    const images: Record<string, Buffer> = {
      'before.png': makeBmp(2, 1, 24, () => [0, 0, 0]),
      'after.png': makeBmp(2, 1, 24, (x) => (x === 1 ? [255, 0, 0] : [0, 0, 0])),
    };
    const seen: string[] = [];
    const toBmp: ToBmp = async (png, bmp) => {
      seen.push(bmp);
      const name = png.split('/').pop()!;
      await writeFile(bmp, images[name]!);
    };
    const result = await compareFrames('/render/before.png', '/render/after.png', { toBmp });
    expect(result).toEqual({ changedPercent: 50, meanDelta: 42.5, bbox: [1, 0, 1, 1] });
    expect(seen).toHaveLength(2);
    for (const file of seen) {
      expect(existsSync(file)).toBe(false);
    }
  });
});
