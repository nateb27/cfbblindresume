import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { crc32, encodePalettePng, zlibDeflate } from '../../functions/_lib/png';
import { IndexedCanvas, levelsFor } from '../../functions/_lib/raster';
import { decodePng, pixelHex } from './helpers';

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('continues across chunks', () => {
    const a = new TextEncoder().encode('12345');
    const b = new TextEncoder().encode('6789');
    expect(crc32(b, crc32(a))).toBe(0xcbf43926);
  });
});

describe('zlibDeflate', () => {
  it('produces a zlib stream that inflates back', async () => {
    const data = new Uint8Array(10000).map((_, i) => (i * 7) % 13);
    const z = await zlibDeflate(data);
    expect(z[0]! & 0x0f).toBe(8); // CM = deflate
    expect(((z[0]! << 8) | z[1]!) % 31).toBe(0); // FCHECK
    expect(new Uint8Array(inflateSync(z))).toEqual(data);
  });
});

describe('encodePalettePng', () => {
  it('writes a valid palette PNG: signature, IHDR, PLTE, IDAT, IEND, CRCs', async () => {
    const width = 5;
    const height = 3;
    const raw = new Uint8Array((width + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = (x + y) % 3;
    const palette = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255);
    const bytes = await encodePalettePng({ width, height, palette, raw });
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const img = decodePng(bytes);
    expect(img.chunks.map((c) => c.type)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
    expect(img.chunks.every((c) => c.crcOk)).toBe(true);
    expect(img.chunks[0]!.length).toBe(13);
    expect([img.width, img.height, img.bitDepth, img.colorType]).toEqual([5, 3, 8, 3]);
    expect(pixelHex(img, 0, 0)).toBe('#ff0000');
    expect(pixelHex(img, 1, 0)).toBe('#00ff00');
    expect(pixelHex(img, 2, 0)).toBe('#0000ff');
    expect(pixelHex(img, 0, 2)).toBe('#0000ff');
  });

  it('rejects bad palettes and buffer sizes', async () => {
    await expect(encodePalettePng({ width: 2, height: 1, palette: new Uint8Array(0), raw: new Uint8Array(3) })).rejects.toThrow(RangeError);
    await expect(encodePalettePng({ width: 2, height: 1, palette: new Uint8Array(3), raw: new Uint8Array(5) })).rejects.toThrow(RangeError);
  });
});

describe('IndexedCanvas', () => {
  it('fills rectangles, strokes, and encodes rows equal to the row above as zero Up rows', async () => {
    const c = new IndexedCanvas(20, 10, '#0e0f12');
    const red = c.color('#ff0000');
    c.fillRect(2, 2, 6, 5, red);
    c.strokeRect(10, 1, 8, 8, c.color('#3a3f49'));
    expect(c.pixel(0, 0)).toBe(0);
    expect(c.pixel(2, 2)).toBe(red);
    expect(c.pixel(7, 6)).toBe(red);
    expect(c.pixel(8, 6)).toBe(0);
    expect(c.pixel(10, 4)).not.toBe(0);
    expect(c.pixel(13, 4)).toBe(0);
    const raw = c.finishScanlines();
    // Row 3 repeats row 2 exactly: filter 2 and all zeros.
    expect(raw[3 * 21]).toBe(2);
    expect(raw.subarray(3 * 21 + 1, 4 * 21).every((v) => v === 0)).toBe(true);
    // Row 2 starts the rectangle: filter 0 and real indices.
    expect(raw[2 * 21]).toBe(0);
    const img = decodePng(await encodePalettePng({ width: 20, height: 10, palette: c.paletteBytes(), raw }));
    expect(pixelHex(img, 4, 4)).toBe('#ff0000');
    expect(pixelHex(img, 4, 8)).toBe('#0e0f12');
    expect(pixelHex(img, 10, 5)).toBe('#3a3f49');
  });

  it('keeps the palette within 256 entries', () => {
    const c = new IndexedCanvas(4, 4, '#000000');
    for (let i = 0; i < 400; i++) c.color(i * 997);
    expect(c.palette.length).toBe(256);
  });

  it('levelsFor budgets blends into the palette', () => {
    expect(levelsFor(40, 0)).toBe(16);
    expect(levelsFor(37, 16)).toBe(14); // 37 + 16 * 13 = 245 <= 256
    expect(37 + 16 * (levelsFor(37, 16) - 1)).toBeLessThanOrEqual(256);
    expect(levelsFor(250, 40)).toBe(2);
  });
});
