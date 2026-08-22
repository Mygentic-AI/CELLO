-- V63: otp_send_log — the signup OTP rate limiter, in a form that survives a deploy.
--
-- ─── The defect ────────────────────────────────────────────────────────────────────────────────
-- The limiter that decides whether someone may be sent another verification code lived entirely in
-- `RegistrationStateMachine`'s process memory (`#otpSends`). Every restart emptied it. The ops-agent
-- deploy on 2026-08-09 wiped it in exactly that way, and nothing recorded that it had happened
-- because there was nothing to record — the state simply ceased to exist.
--
-- So the control worked against someone impatient and not at all against someone patient. An abuser
-- clears their count by waiting for a release, which for an alpha under active development is a
-- shorter wait than the one-hour window the limiter is nominally enforcing.
--
-- ─── The shape, and why it is this one ─────────────────────────────────────────────────────────
-- APPEND-ONLY LOG OF SEND EVENTS, not a counter. Two reasons, and the second is the one that bites:
--
--   1. A rolling window needs the individual timestamps. A fixed window (count + window_start) has
--      to decide when to reset, and a stale window_start silently grants a fresh allowance — the
--      same unbounded-growth-or-wrong-answer trade the in-memory version documented and avoided.
--      Writing rows and counting the recent ones has neither problem.
--
--   2. It leaves evidence. A counter that reads 5 says nothing about when, or how bursty, or
--      whether the same person has been at this for a week. The rows do, and this is the table an
--      operator will want when they are trying to work out whether a signup wave was real people.
--
-- KEYED ON THE REQUESTER — (channel, channel_user_id) — never on the email address or a hash of it.
-- This is the design DOD-M15-SIGNUP-1's review overturned and it must not be rebuilt here by
-- accident. Keying on the address throttles the VICTIM of a typo'd or malicious address rather than
-- the sender, and keying on the email DOMAIN throttled five strangers who happened to share a mail
-- provider against the sixth — which is precisely what an invite wave would have walked into.
--
-- ─── Retention ─────────────────────────────────────────────────────────────────────────────────
-- Rows older than the limiter's window are dead weight for the limiter but are the evidence
-- described above, so nothing deletes them on the read path — no row disappears as a side effect of
-- someone signing up.
--
-- THERE IS NO APPLICATION-SIDE PRUNE, and the migration must not imply one. An earlier draft of this
-- comment promised "an operator action against a role that holds DELETE" — no such role exists in
-- any migration, and a `pruneOtpSendsBefore` repository method was written against it that could
-- never have executed. Retention, when it is wanted, is `psql` as the migration owner. Granting
-- DELETE to a service role would also need a DELETE *policy*: with RLS on and no policy, a role
-- holding the privilege deletes zero rows and reports success.
--
-- NO PII. `channel_user_id` is the Telegram/WhatsApp user id the person is already identified by
-- throughout `registrations` — this table adds no email, no phone, and no hash of either.

CREATE TABLE IF NOT EXISTS otp_send_log (
  id               BIGSERIAL    PRIMARY KEY,
  channel          TEXT         NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'cli')),
  channel_user_id  TEXT         NOT NULL,
  -- When the send SUCCEEDED. Rows are written after delivery resolves, never before: a bounced or
  -- throttled send must not spend one of the person's allowance, or a delivery outage locks out the
  -- very people who never received anything.
  sent_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- The limiter's only read: "how many sends for this requester since T". The leading (channel,
-- channel_user_id) equality is what makes it cheap; the `sent_at` predicate then bounds the range
-- scan. DESC is a preference, not the optimisation — Postgres walks a btree backwards at no cost, so
-- an earlier version of this comment claiming DESC is what "stops the scan early" was wrong.
CREATE INDEX IF NOT EXISTS idx_otp_send_log_requester_time
  ON otp_send_log (channel, channel_user_id, sent_at DESC);

-- For an operator answering "what happened across everyone in this window" — a signup wave, an
-- abuse investigation — and for a manual retention delete run as the migration owner. Not read by
-- the application, which only ever asks about one requester.
CREATE INDEX IF NOT EXISTS idx_otp_send_log_sent_at
  ON otp_send_log (sent_at);

-- ─── Row-level security, policies and grants ───────────────────────────────────────────────────
--
-- THE FIRST VERSION OF THIS MIGRATION HAD NONE OF THIS, and every ops-agent integration test failed
-- with `permission denied for table otp_send_log`. It was invisible for one reason worth recording:
-- those suites are gated on CELLO_ENV=local and had never run in any automated context
-- (DOD-M15-CI-SKIPS-SILENT-1, same milestone). A table can be created, typecheck, lint, and pass a
-- 1669-test gate while being unusable by the only process that needs it.
--
-- APPEND-ONLY, matching `registrations` and `signal_revocations`. There is no UPDATE policy and
-- DELETE is revoked from BOTH roles: a rate-limit record that the limited party's own service could
-- edit or remove is not a rate limit. See the retention note above for why there is no application
-- prune and what would be required to add one.

ALTER TABLE otp_send_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'otp_send_log' AND policyname = 'insert_only'
  ) THEN
    CREATE POLICY insert_only ON otp_send_log
      FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'otp_send_log' AND policyname = 'select_all'
  ) THEN
    CREATE POLICY select_all ON otp_send_log
      FOR SELECT TO cello_service USING (true);
  END IF;
  -- THE ROLE THAT ACTUALLY WRITES THIS TABLE. The ops agent connects as `cello_ops_agent`, a role
  -- V26 created and deliberately scoped to the registration tables and nothing else. Granting only
  -- `cello_service` — which the second version of this migration did — left every ops-agent
  -- integration test failing with `permission denied` against a table whose grants looked correct
  -- in the file. Least privilege means a new table is invisible to that role until it is named.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'otp_send_log' AND policyname = 'insert_ops_agent'
  ) THEN
    CREATE POLICY insert_ops_agent ON otp_send_log
      FOR INSERT TO cello_ops_agent WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'otp_send_log' AND policyname = 'select_ops_agent'
  ) THEN
    CREATE POLICY select_ops_agent ON otp_send_log
      FOR SELECT TO cello_ops_agent USING (true);
  END IF;
END $$;

GRANT INSERT, SELECT ON otp_send_log TO cello_service;
GRANT INSERT, SELECT ON otp_send_log TO cello_ops_agent;
-- BIGSERIAL: the INSERTs above cannot allocate an id without this.
GRANT USAGE, SELECT ON SEQUENCE otp_send_log_id_seq TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE otp_send_log_id_seq TO cello_ops_agent;
-- Append-only, enforced rather than described (SI-002, as `registrations` does). A rate-limit record
-- the limited party's own service could edit or delete is not a rate limit.
REVOKE UPDATE, DELETE ON otp_send_log FROM cello_service;
REVOKE UPDATE, DELETE ON otp_send_log FROM cello_ops_agent;

COMMENT ON TABLE otp_send_log IS
  'DOD-M15-SIGNUP-DURABLE-1: append-only log of successful signup OTP sends, keyed on the REQUESTER '
  '(channel, channel_user_id) and never on the email address or domain. Backs the rolling-window '
  'rate limiter, which previously lived in process memory and was emptied by every deploy.';
