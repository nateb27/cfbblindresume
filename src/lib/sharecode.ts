/**
 * Share codes (SPEC "Share code"). Binary layout, then base64url without padding:
 *
 *   [version=1][season-2000][week][nRounds] then per round 3 team indices in the user's order
 *   (1st, 2nd, 3rd), then CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, big-endian) of all
 *   preceding bytes.
 *
 * A team index is its position in the ascending-sorted list of ALL FBS slugs in that week's file
 * (GameData.slugs). 15 rounds = 51 bytes = 68 chars; the byte count is always a multiple of 3, so
 * codes never carry padding bits. Decoding never throws: it returns a typed error.
 *
 * Compatibility contract for future versions: byte 0 stays the version and the code still ends
 * with this CRC-16 over every preceding byte. That lets this decoder tell a newer-version link
 * (version 2..15 with an intact CRC: kind 'version') from a damaged or mistyped one (kind
 * 'checksum', 'length' or 'bad-base64'), so garbage never reads as "from another version".
 */

/** Current share-code format version (first byte). */
export const SHARE_CODE_VERSION = 1;
/** Version bytes a future format may use (see the compatibility contract above). */
export const FUTURE_SHARE_CODE_VERSIONS = Object.freeze({ min: SHARE_CODE_VERSION + 1, max: 15 });
/** Rounds a code may carry. */
export const SHARE_MIN_ROUNDS = 1;
export const SHARE_MAX_ROUNDS = 30;

/** A run as the game knows it. Each round is [1st, 2nd, 3rd] in the user's order. */
export interface SharedRun {
  season: number;
  week: number;
  rounds: [string, string, string][];
}

/**
 * What {@link encodeRun} accepts: any rounds the game holds (e.g. `Trio[]` or `string[][]`). Each
 * round must be 3 distinct slugs in the user's order; that is checked at runtime.
 */
export interface RunToEncode {
  season: number;
  week: number;
  rounds: readonly (readonly string[])[];
}

/** A structurally valid code before slugs are resolved (indices into the week's sorted slugs). */
export interface RawSharedRun {
  version: number;
  season: number;
  week: number;
  rounds: [number, number, number][];
}

/** Why a code failed to decode. */
export type ShareCodeErrorKind =
  | 'bad-base64'
  | 'length'
  | 'checksum'
  | 'version'
  | 'round-count'
  | 'duplicate-team'
  | 'index-out-of-range'
  | 'week-not-found';

/** Typed decode error. `round` is 1-based when present. */
export interface ShareCodeError {
  kind: ShareCodeErrorKind;
  message: string;
  round?: number;
  index?: number;
  version?: number;
  season?: number;
  week?: number;
}

/** Result type of every decode function. */
export type ShareCodeResult<T> = { ok: true; value: T } | { ok: false; error: ShareCodeError };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV: Int16Array = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** base64url without padding. */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + B64[(v >> 6) & 63]! + B64[v & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const v = bytes[i]! << 16;
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]!;
  } else if (rem === 2) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + B64[(v >> 6) & 63]!;
  }
  return out;
}

/** Strict base64url decode (no padding, no other characters, zero trailing bits); null if invalid. */
export function base64urlDecode(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const vals = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INV[c]! : -1;
    if (v < 0) return null;
    vals[i] = v;
  }
  const full = Math.floor(s.length / 4);
  const rem = s.length % 4;
  const out = new Uint8Array(full * 3 + (rem === 0 ? 0 : rem - 1));
  let o = 0;
  for (let q = 0; q < full; q++) {
    const v = (vals[4 * q]! << 18) | (vals[4 * q + 1]! << 12) | (vals[4 * q + 2]! << 6) | vals[4 * q + 3]!;
    out[o++] = (v >> 16) & 255;
    out[o++] = (v >> 8) & 255;
    out[o++] = v & 255;
  }
  const b = 4 * full;
  if (rem === 2) {
    if (vals[b + 1]! & 15) return null;
    out[o++] = (vals[b]! << 2) | (vals[b + 1]! >> 4);
  } else if (rem === 3) {
    if (vals[b + 2]! & 3) return null;
    const v = (vals[b]! << 12) | (vals[b + 1]! << 6) | vals[b + 2]!;
    out[o++] = (v >> 10) & 255;
    out[o++] = (v >> 2) & 255;
  }
  return out;
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, xorout 0 (check "123456789" = 0x29B1). */
export function crc16ccitt(bytes: Uint8Array, end: number = bytes.length): number {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) {
    crc ^= bytes[i]! << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * Encode a run. `slugs` must be the ascending-sorted list of all FBS slugs for that week.
 * @throws RangeError on invalid input (programmer error): unknown slug, repeated team in a round,
 * 0 or > 30 rounds, season outside 2000..2255, week outside 0..255, more than 256 slugs.
 */
export function encodeRun(run: RunToEncode, slugs: readonly string[]): string {
  if (slugs.length > 256) throw new RangeError('more than 256 FBS teams cannot be indexed in a byte');
  const n = run.rounds.length;
  if (n < SHARE_MIN_ROUNDS || n > SHARE_MAX_ROUNDS) throw new RangeError(`rounds must be 1..30, got ${n}`);
  const s = run.season - 2000;
  if (!Number.isInteger(s) || s < 0 || s > 255) throw new RangeError(`season out of range: ${run.season}`);
  if (!Number.isInteger(run.week) || run.week < 0 || run.week > 255) throw new RangeError(`week out of range: ${run.week}`);
  const index = new Map<string, number>();
  slugs.forEach((x, i) => index.set(x, i));
  const bytes = new Uint8Array(4 + 3 * n + 2);
  bytes[0] = SHARE_CODE_VERSION;
  bytes[1] = s;
  bytes[2] = run.week;
  bytes[3] = n;
  run.rounds.forEach((r, ri) => {
    if (r.length !== 3 || new Set(r).size !== 3) throw new RangeError(`round ${ri + 1} needs 3 distinct teams`);
    r.forEach((slug, k) => {
      const i = index.get(slug);
      if (i === undefined) throw new RangeError(`unknown slug "${slug}"`);
      bytes[4 + 3 * ri + k] = i;
    });
  });
  const crc = crc16ccitt(bytes, bytes.length - 2);
  bytes[bytes.length - 2] = crc >> 8;
  bytes[bytes.length - 1] = crc & 255;
  return base64urlEncode(bytes);
}

const fail = <T>(error: ShareCodeError): ShareCodeResult<T> => ({ ok: false, error });

/**
 * Decode the structure of a code (no slug lookup). Checks in order: base64, version (only a
 * plausible future version with an intact checksum reports 'version'), length, checksum, round
 * count, length, duplicates.
 */
export function parseShareCode(code: string): ShareCodeResult<RawSharedRun> {
  const bytes = typeof code === 'string' ? base64urlDecode(code.trim()) : null;
  if (!bytes || bytes.length === 0) return fail({ kind: 'bad-base64', message: 'This share code is not valid.' });
  const crcOk = (): boolean => {
    if (bytes.length < 3) return false;
    const crc = crc16ccitt(bytes, bytes.length - 2);
    return bytes[bytes.length - 2] === crc >> 8 && bytes[bytes.length - 1] === (crc & 255);
  };
  const version = bytes[0]!;
  if (version !== SHARE_CODE_VERSION && version >= FUTURE_SHARE_CODE_VERSIONS.min && version <= FUTURE_SHARE_CODE_VERSIONS.max && crcOk()) {
    return fail({ kind: 'version', version, message: `Unsupported share code version ${version}.` });
  }
  if (bytes.length < 4 + 3 + 2) return fail({ kind: 'length', message: 'This share code is too short.' });
  if (version !== SHARE_CODE_VERSION || !crcOk()) {
    return fail({ kind: 'checksum', message: 'This share code is damaged (checksum mismatch).' });
  }
  const n = bytes[3]!;
  if (n < SHARE_MIN_ROUNDS || n > SHARE_MAX_ROUNDS) {
    return fail({ kind: 'round-count', message: `A share code must hold 1 to 30 rounds, this one says ${n}.` });
  }
  if (bytes.length !== 4 + 3 * n + 2) return fail({ kind: 'length', message: 'This share code has the wrong length.' });
  const rounds: [number, number, number][] = [];
  for (let r = 0; r < n; r++) {
    const a = bytes[4 + 3 * r]!;
    const b = bytes[5 + 3 * r]!;
    const c = bytes[6 + 3 * r]!;
    if (a === b || a === c || b === c) {
      return fail({ kind: 'duplicate-team', round: r + 1, message: `Round ${r + 1} lists the same team twice.` });
    }
    rounds.push([a, b, c]);
  }
  return { ok: true, value: { version, season: 2000 + bytes[1]!, week: bytes[2]!, rounds } };
}

/** Map indices to slugs using the week's sorted FBS slugs (null/undefined = week not found). */
export function resolveShareCode(raw: RawSharedRun, slugs: readonly string[] | null | undefined): ShareCodeResult<SharedRun> {
  if (!slugs) {
    return fail({ kind: 'week-not-found', season: raw.season, week: raw.week, message: `No data for ${raw.season} week ${raw.week}.` });
  }
  const rounds: [string, string, string][] = [];
  for (let r = 0; r < raw.rounds.length; r++) {
    const t = raw.rounds[r]!;
    for (const i of t) {
      if (i >= slugs.length) {
        return fail({ kind: 'index-out-of-range', round: r + 1, index: i, message: `Round ${r + 1} names a team that does not exist.` });
      }
    }
    rounds.push([slugs[t[0]]!, slugs[t[1]]!, slugs[t[2]]!]);
  }
  return { ok: true, value: { season: raw.season, week: raw.week, rounds } };
}

/**
 * Full decode. `slugsFor(season, week)` returns that week's sorted FBS slugs or null/undefined
 * if the week does not exist. Never throws (a throwing lookup is reported as week-not-found).
 */
export function decodeRun(
  code: string,
  slugsFor: (season: number, week: number) => readonly string[] | null | undefined,
): ShareCodeResult<SharedRun> {
  const parsed = parseShareCode(code);
  if (!parsed.ok) return parsed;
  let slugs: readonly string[] | null | undefined;
  try {
    slugs = slugsFor(parsed.value.season, parsed.value.week);
  } catch {
    slugs = null;
  }
  return resolveShareCode(parsed.value, slugs);
}
