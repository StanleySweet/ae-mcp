import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseBmp, type DecodedFrame, type ToBmp } from './frame-compare.js';

// Pixel helpers for ae_render_frame: crop, scale, contact sheets and PNG output. Only Node
// built-ins (zlib, fs) and the BMP decoder in frame-compare.ts are used.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Size {
  width: number;
  height: number;
}

/** Reads width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(png: Buffer): Size | null {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Scales `size` down so its longest edge is `maxEdge`; a size that already fits is returned as is. */
export function fitSize(size: Size, maxEdge: number): Size {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) {
    return size;
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Decodes a rendered PNG by converting it to BMP (through `toBmp`) in a temporary directory. */
export async function decodeFrameFile(png: string, toBmp: ToBmp): Promise<DecodedFrame> {
  const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-frame-image-'));
  try {
    const bmp = join(dir, 'frame.bmp');
    await toBmp(png, bmp);
    return parseBmp(await readFile(bmp));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Copies the `w` x `h` rectangle at (`x`, `y`). The caller checks it lies inside the frame. */
export function cropFrame(frame: DecodedFrame, x: number, y: number, w: number, h: number): DecodedFrame {
  const rgb = new Uint8Array(w * h * 3);
  for (let row = 0; row < h; row += 1) {
    const src = ((y + row) * frame.width + x) * 3;
    rgb.set(frame.rgb.subarray(src, src + w * 3), row * w * 3);
  }
  return { width: w, height: h, rgb };
}

/** Box-filter resize: each output pixel is the average of the source pixels it covers. */
export function scaleFrame(frame: DecodedFrame, width: number, height: number): DecodedFrame {
  if (width === frame.width && height === frame.height) {
    return frame;
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let dy = 0; dy < height; dy += 1) {
    const y0 = Math.floor((dy * frame.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * frame.height) / height));
    for (let dx = 0; dx < width; dx += 1) {
      const x0 = Math.floor((dx * frame.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * frame.width) / width));
      const sums = [0, 0, 0];
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * frame.width + sx) * 3;
          sums[0] += frame.rgb[i]!;
          sums[1] += frame.rgb[i + 1]!;
          sums[2] += frame.rgb[i + 2]!;
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const o = (dy * width + dx) * 3;
      rgb[o] = Math.round(sums[0]! / count);
      rgb[o + 1] = Math.round(sums[1]! / count);
      rgb[o + 2] = Math.round(sums[2]! / count);
    }
  }
  return { width, height, rgb };
}

// CRC-32 (ISO 3309) over chunk type and data, as PNG requires.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes RGB pixels as an 8-bit truecolour PNG. */
export function encodePng(frame: DecodedFrame): Buffer {
  const stride = frame.width * 3;
  const raw = Buffer.alloc((stride + 1) * frame.height);
  for (let y = 0; y < frame.height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(frame.rgb.buffer, frame.rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(frame.width, 0);
  header.writeUInt32BE(frame.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 3x5 bitmap glyphs for the characters a time label needs.
const GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '.': ['...', '...', '...', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  s: ['...', '###', '##.', '..#', '###'],
};

/** Draws `text` with the bitmap font at (`x`, `y`) on a black box, clipped to the frame. */
export function drawLabel(frame: DecodedFrame, x: number, y: number, text: string, scale = 2): void {
  const advance = 4 * scale;
  const pad = 2 * scale;
  const boxW = text.length * advance - scale + pad * 2;
  const boxH = 5 * scale + pad * 2;
  const put = (px: number, py: number, value: number): void => {
    if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) {
      return;
    }
    const i = (py * frame.width + px) * 3;
    frame.rgb[i] = value;
    frame.rgb[i + 1] = value;
    frame.rgb[i + 2] = value;
  };
  for (let by = 0; by < boxH; by += 1) {
    for (let bx = 0; bx < boxW; bx += 1) {
      put(x + bx, y + by, 0);
    }
  }
  for (let c = 0; c < text.length; c += 1) {
    const glyph = GLYPHS[text[c]!] ?? GLYPHS['.']!;
    const gx = x + pad + c * advance;
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        if (glyph[row]![col] !== '#') {
          continue;
        }
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            put(gx + col * scale + sx, y + pad + row * scale + sy, 255);
          }
        }
      }
    }
  }
}

export interface SheetCell {
  frame: DecodedFrame;
  label: string;
}

/**
 * Lays cells out in a grid of `cols` columns that fits `maxEdge` on its longest side. Each
 * cell keeps the frame's aspect ratio, and its label is drawn in the top-left corner.
 */
export function contactSheet(cells: SheetCell[], cols: number, maxEdge: number): DecodedFrame {
  const first = cells[0]!.frame;
  const rows = Math.ceil(cells.length / cols);
  const cellW = Math.max(
    1,
    Math.min(Math.floor(maxEdge / cols), Math.floor((maxEdge * first.width) / (first.height * rows))),
  );
  const cellH = Math.max(1, Math.round((cellW * first.height) / first.width));
  const sheet: DecodedFrame = {
    width: cols * cellW,
    height: rows * cellH,
    rgb: new Uint8Array(cols * cellW * rows * cellH * 3).fill(32),
  };
  cells.forEach((cell, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const scaled = scaleFrame(cell.frame, cellW, cellH);
    const ox = col * cellW;
    const oy = row * cellH;
    for (let y = 0; y < cellH; y += 1) {
      const src = y * scaled.width * 3;
      const dst = ((oy + y) * sheet.width + ox) * 3;
      sheet.rgb.set(scaled.rgb.subarray(src, src + cellW * 3), dst);
    }
    drawLabel(sheet, ox + 2, oy + 2, cell.label);
  });
  return sheet;
}
