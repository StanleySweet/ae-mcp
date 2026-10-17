import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import type { DecodedFrame } from './frame-compare.js';
import { contactSheet, cropFrame, drawLabel, encodePng, fitSize, pngSize, scaleFrame } from './frame-image.js';

function solid(width: number, height: number, value: number): DecodedFrame {
  return { width, height, rgb: new Uint8Array(width * height * 3).fill(value) };
}

/** Decodes the IDAT of a PNG this module wrote back to RGB rows (filter type 0 only). */
function decodePixels(png: Buffer): { width: number; height: number; rgb: Uint8Array } {
  const size = pngSize(png)!;
  const idatStart = png.indexOf(Buffer.from('IDAT', 'ascii')) + 4;
  const idatLength = png.readUInt32BE(idatStart - 8);
  const raw = inflateSync(png.subarray(idatStart, idatStart + idatLength));
  const stride = size.width * 3;
  const rgb = new Uint8Array(size.width * size.height * 3);
  for (let y = 0; y < size.height; y += 1) {
    rgb.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { ...size, rgb };
}

describe('frame-image helpers (#234)', () => {
  it('reads the size from a PNG header and refuses non-PNG bytes', () => {
    const png = encodePng(solid(3, 2, 0));

    expect(pngSize(png)).toEqual({ width: 3, height: 2 });
    expect(pngSize(Buffer.from('not a png at all, definitely not one'))).toBeNull();
  });

  it('encodes RGB pixels as a PNG that decodes back to the same pixels', () => {
    const frame: DecodedFrame = {
      width: 2,
      height: 2,
      rgb: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]),
    };

    const decoded = decodePixels(encodePng(frame));

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.rgb)).toEqual(Array.from(frame.rgb));
  });

  it('fits the longest edge to maxEdge and keeps the aspect ratio', () => {
    expect(fitSize({ width: 1920, height: 1080 }, 768)).toEqual({ width: 768, height: 432 });
    expect(fitSize({ width: 100, height: 50 }, 768)).toEqual({ width: 100, height: 50 });
  });

  it('crops a rectangle out of a frame', () => {
    const frame: DecodedFrame = { width: 4, height: 2, rgb: new Uint8Array(4 * 2 * 3) };
    for (let i = 0; i < frame.rgb.length; i += 1) {
      frame.rgb[i] = i;
    }

    const cropped = cropFrame(frame, 1, 1, 2, 1);

    expect(cropped.width).toBe(2);
    expect(cropped.height).toBe(1);
    // Row 1, pixels 1 and 2: source bytes start at (1 * 4 + 1) * 3 = 15.
    expect(Array.from(cropped.rgb)).toEqual([15, 16, 17, 18, 19, 20]);
  });

  it('box-filters a resize so each output pixel averages its source pixels', () => {
    const frame: DecodedFrame = { width: 2, height: 2, rgb: Uint8Array.from([0, 0, 0, 100, 100, 100, 200, 200, 200, 40, 40, 40]) };

    const scaled = scaleFrame(frame, 1, 1);

    expect(Array.from(scaled.rgb)).toEqual([85, 85, 85]);
  });

  it('draws a label in black with white glyph pixels', () => {
    const frame = solid(40, 20, 128);

    drawLabel(frame, 0, 0, '1.5s');

    const values = new Set<number>();
    for (let i = 0; i < frame.rgb.length; i += 3) {
      values.add(frame.rgb[i]!);
    }
    expect(values).toEqual(new Set([0, 255, 128]));
  });

  it('lays cells out on a grid with the frame aspect ratio in each cell', () => {
    const cells = [0, 1, 2].map((time) => ({ frame: solid(64, 48, 90), label: `${time}.00s` }));

    const sheet = contactSheet(cells, 2, 100);

    expect(sheet.width).toBe(100);
    expect(sheet.height).toBe(76);
    // Background is dark grey where the third cell (row 2, column 1) is empty.
    const emptyCell = ((50 + 10) * sheet.width + 60) * 3;
    expect(sheet.rgb[emptyCell]).toBe(32);
  });
});
