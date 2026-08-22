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
-- described above, so they are NOT deleted on the read path. `pruneOtpSendsBefore` exists for a
-- deliberate operator-run or scheduled cleanup; nothing calls it automatically, so no row disappears
-- as a side effect of someone signing up.
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

-- The limiter's only read: "how many sends for this requester since T". Ordered DESC on sent_at so
-- the window scan stops early instead of walking a requester's whole history.
CREATE INDEX IF NOT EXISTS idx_otp_send_log_requester_time
  ON otp_send_log (channel, channel_user_id, sent_at DESC);

-- The retention sweep's read: "everything older than T", across all requesters.
CREATE INDEX IF NOT EXISTS idx_otp_send_log_sent_at
  ON otp_send_log (sent_at);

COMMENT ON TABLE otp_send_log IS
  'DOD-M15-SIGNUP-DURABLE-1: append-only log of successful signup OTP sends, keyed on the REQUESTER '
  '(channel, channel_user_id) and never on the email address or domain. Backs the rolling-window '
  'rate limiter, which previously lived in process memory and was emptied by every deploy.';
