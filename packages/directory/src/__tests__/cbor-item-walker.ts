/**
 * A minimal CBOR head-walker for the trust-signal preimage (M10 / DOD-CBOR-1).
 *
 * WHY THIS EXISTS. The obvious way to assert "no float64 in the preimage" is to grep the hex for
 * `fb` followed by 16 hex digits — the float64 header and its 8 bytes. That check is WRONG, and it
 * fired a false alarm the first time it met a real vector:
 *
 *     ... 1a 696ac4fb 5820 1111...        (expires_at = uint32 0x696ac4fb, then a 32-byte hash)
 *            ^^^^^^^^ ^^
 *            the regex matched `fb5820111111111111` straddling TWO items
 *
 * `fb` there is the last byte of a uint32's VALUE, not a header. A hex substring search has no idea
 * where CBOR items begin, so it reads bytes that were never headers as though they were. It can cry
 * wolf (as above), and the confidence it gives is false either way.
 *
 * So: parse the framing. Read each item's head byte, take its major type, and skip its payload by
 * the length that head declares. Then a "float" claim is about an actual CBOR item, not a coincidence
 * of hex.
 *
 * Scope: the preimage is a flat array of scalars (text, bytes, uints, nulls) — spec §4's closed field
 * set — so this walker deliberately does not recurse. If a nested container ever appears in the
 * preimage, this throws rather than silently mis-parsing it.
 */

export interface CborItem {
  /** CBOR major type: 0=uint 1=negint 2=bytes 3=text 4=array 5=map 6=tag 7=simple/float */
  major: number;
  /** Additional info (low 5 bits of the head byte). For major 7: 25=float16, 26=float32, 27=float64. */
  ai: number;
  /** Byte offset of this item's head. */
  offset: number;
}

/** Length of the argument that follows a head byte with this additional-info value. */
function argBytes(ai: number): number {
  if (ai < 24) return 0;
  if (ai === 24) return 1;
  if (ai === 25) return 2;
  if (ai === 26) return 4;
  if (ai === 27) return 8;
  throw new Error(`CBOR: unsupported additional info ${ai} (indefinite lengths are not canonical)`);
}

/** Read the unsigned argument encoded after a head byte. */
function readArg(b: Uint8Array, off: number, ai: number): { value: number; next: number } {
  const n = argBytes(ai);
  if (n === 0) return { value: ai, next: off + 1 };
  // Bounds-check FIRST. Reading past the end yields `undefined`, which poisons the arithmetic into
  // NaN — and NaN fails every `>=` guard downstream, so the walker would wander through garbage and
  // eventually throw a message naming the wrong cause ("NaN trailing bytes"). Fail here, where the
  // cause actually is.
  if (off + 1 + n > b.length) {
    throw new Error(`CBOR: truncated — a ${n}-byte argument at offset ${off} runs past the end of the buffer (${b.length} bytes)`);
  }
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[off + 1 + i];
  return { value: v, next: off + 1 + n };
}

/**
 * Walk the top-level items of a CBOR array, returning one entry per element (the outer array header
 * itself is NOT included). Throws on a nested container, an indefinite length, or a truncated buffer.
 */
export function walkCborArray(bytes: Uint8Array): CborItem[] {
  const head = bytes[0];
  const major = head >> 5;
  const ai = head & 0x1f;
  if (major !== 4) throw new Error(`CBOR: expected an array at offset 0, got major type ${major}`);

  const { value: count, next } = readArg(bytes, 0, ai);
  const items: CborItem[] = [];
  let off = next;

  for (let i = 0; i < count; i++) {
    if (off >= bytes.length) throw new Error(`CBOR: truncated — expected ${count} items, ran out at ${i}`);
    const h = bytes[off];
    const m = h >> 5;
    const a = h & 0x1f;
    items.push({ major: m, ai: a, offset: off });

    if (m === 4 || m === 5 || m === 6) {
      throw new Error(`CBOR: nested container (major ${m}) at item ${i} — the trust-signal preimage is a flat array of scalars`);
    }

    const { value, next: afterArg } = readArg(bytes, off, a);
    // Byte strings (2) and text strings (3) carry `value` more bytes of content; scalars carry none.
    off = m === 2 || m === 3 ? afterArg + value : afterArg;
  }

  if (off !== bytes.length) {
    throw new Error(`CBOR: ${bytes.length - off} trailing byte(s) after the array — the preimage must encode exactly one array`);
  }
  return items;
}

/** True if this item is an IEEE float (major type 7, additional info 25/26/27). */
export const isCborFloat = (it: CborItem): boolean =>
  it.major === 7 && (it.ai === 25 || it.ai === 26 || it.ai === 27);
