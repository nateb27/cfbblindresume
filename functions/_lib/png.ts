/**
 * Minimal PNG encoder for 8-bit palette images (color type 3). Compression uses the platform's
 * native CompressionStream('deflate'), which emits exactly the zlib stream an IDAT chunk holds, so
 * no JavaScript deflate runs at request time.
 */

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ISO-HDLC, as PNG uses) of `bytes`, continuing from `crc` (pass the previous result). */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** zlib (RFC 1950) compression via the native CompressionStream. */
export async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
  return out;
}

export interface PalettePng {
  width: number;
  height: number;
  /** r, g, b per entry, at most 256 entries. */
  palette: Uint8Array;
  /** Scanlines: per row one filter byte (0) followed by `width` palette indices. */
  raw: Uint8Array;
}

/** Encode an 8-bit palette PNG. */
export async function encodePalettePng(img: PalettePng): Promise<Uint8Array> {
  const entries = img.palette.length / 3;
  if (!Number.isInteger(entries) || entries < 1 || entries > 256) throw new RangeError(`png: palette must have 1-256 entries, got ${entries}`);
  if (img.raw.length !== (img.width + 1) * img.height) throw new RangeError('png: raw scanline buffer has the wrong size');
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, img.width);
  v.setUint32(4, img.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // color type: palette
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering (all rows use filter 0)
  ihdr[12] = 0; // no interlace
  const idat = await zlibDeflate(img.raw);
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('PLTE', img.palette), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
