/**
 * Configure pg type parsers for consistent date handling across all CELLO directory
 * code. Must be called before any pg.Pool is created that reads DATE/TIMESTAMP columns.
 *
 * Problem: pg returns DATE columns as JavaScript Date objects adjusted to the local
 * timezone. In non-UTC environments (e.g. UTC+2), a stored date "2026-01-01" comes
 * back as 2025-12-31T22:00:00.000Z — breaking hash chain verification which compares
 * INSERT-time serialization (UTC midnight) against verify-time serialization (local).
 *
 * Solution: return DATE/TIMESTAMP/TIMESTAMPTZ as raw strings so application code
 * receives the canonical database value without timezone adjustment.
 */
import pg from "pg";

let configured = false;

export function configurePgTypes(): void {
  if (configured) return;
  configured = true;
  pg.types.setTypeParser(1082, (val: string) => val); // DATE   → "YYYY-MM-DD"
  pg.types.setTypeParser(1114, (val: string) => val); // TIMESTAMP
  pg.types.setTypeParser(1184, (val: string) => val); // TIMESTAMPTZ
}
