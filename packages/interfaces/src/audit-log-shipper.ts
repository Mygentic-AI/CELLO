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
  /** ISO-8601 timestamp of the statement */
  timestamp: string;
  /** Session identifier (e.g. Postgres session ID or correlation ID) */
  sessionId: string;
  /** Object type targeted by the statement (e.g. "TABLE", "VIEW") */
  objectType: string;
  /** SQL command type: SELECT, INSERT, UPDATE, DELETE, DDL, etc. */
  command: string;
  /** Full SQL statement text as executed */
  statementText: string;
  /** Bind parameters associated with the statement */
  parameters: string[];
  /** Optional correlation ID to thread async flows */
  correlationId?: string;
}

/**
 * AuditLogShipper — exactly two methods by design (AC-007).
 * ship() is called per log entry; flush() drains all buffered entries before returning.
 * flush() returns the total number of entries shipped (both immediate and retried).
 */
export interface AuditLogShipper {
  ship(entry: AuditLogEntry): Promise<void>;
  flush(): Promise<number>;
}
