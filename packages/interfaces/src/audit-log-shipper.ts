/**
 * AuditLogShipper — interface for forwarding pgaudit log entries to external storage
 * (PERSIST-006).
 *
 * The interface is intentionally narrow: exactly two methods.
 * ship() accepts one entry; flush() ensures all shipped entries are persisted.
 *
 * Implementations:
 *   LocalAuditLogShipper  (CELLO_ENV=local) — appends JSON lines to a local file
 *   S3AuditLogShipper     (CELLO_ENV=dev)   — ships to S3 with retry + buffer overflow alarm
 */

export interface AuditLogEntry {
  /** The Postgres role that executed the statement (e.g. "cello_service") */
  role: string;
  /** SQL statement type: SELECT, INSERT, UPDATE, DELETE, DDL, etc. */
  statement: string;
  /** Table name the statement targeted */
  table: string;
  /** ISO-8601 timestamp of the statement */
  timestamp: string;
}

/**
 * AuditLogShipper — exactly two methods by design (AC-007).
 * ship() is called per log entry; flush() drains all buffered entries before returning.
 */
export interface AuditLogShipper {
  ship(entry: AuditLogEntry): Promise<void>;
  flush(): Promise<void>;
}
