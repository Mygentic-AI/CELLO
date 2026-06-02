/**
 * JSON serialization helpers that preserve Uint8Array through round-trips.
 *
 * JSON.stringify converts Uint8Array to {"0":1,"1":2,...} — a plain object that
 * passes structural checks but breaks any typed-array operation. This module
 * provides a replacer/reviver pair that encodes Uint8Array as
 * {__type:"Uint8Array",hex:"..."} and decodes it back on read.
 *
 * Use stringify/parse from this module anywhere a domain object containing
 * Uint8Array fields is serialized to a JSONB database column.
 */

export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __type: "Uint8Array", hex: Buffer.from(value).toString("hex") };
  }
  return value;
}

export function jsonReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (rec.__type === "Uint8Array" && typeof rec.hex === "string") {
      return Buffer.from(rec.hex as string, "hex");
    }
  }
  return value;
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, jsonReplacer);
}

export function parse<T>(text: string): T {
  return JSON.parse(text, jsonReviver) as T;
}
