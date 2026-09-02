-- V64: sessions.high_stakes — the solo-seal tier a conversation opted in to.
--
-- ─── Why a column and not a memory map ─────────────────────────────────────────────────────────
-- `DOD-M15-UNILATERAL-1` gives the solo seal ("seal without your counterparty") two tiers. STANDARD
-- is the default and behaves as it always has. HIGH-STAKES has a longer floor and, far more
-- importantly, REFUSES to issue a receipt recording the counterparty absent unless the relay
-- actually observed them leave — it never falls back to the clock.
--
-- The directory holds that opt-in in `#sessionHighStakes`, which is process memory. A directory
-- restart mid-conversation would empty it, and the next solo close would then be judged at the
-- STANDARD bar: a shorter floor and no evidence requirement, for a conversation whose initiator
-- had asked for the opposite. Nobody would be told. A silent downgrade of a security control at a
-- moment nobody chose is exactly the shape this milestone exists to remove, so the flag lives on
-- the row the roster already survives on and is restored beside it.
--
-- ─── Why the default is false and NULL reads as false ──────────────────────────────────────────
-- Absent means STANDARD, deliberately. Standard is the tier that always eventually yields a receipt
-- to an honest party; high-stakes is the one that can withhold it. An unknown value must therefore
-- resolve to the tier that cannot strand anyone — never to the stricter one on a guess. Rows
-- written before this column existed read back NULL, and `loadActiveSessionParticipants` maps that
-- with `=== true`, so they are standard.
--
-- Nothing infers this flag. The relay is deliberately blind to content and the directory never sees
-- it, so there is no signal either could read to decide a conversation is consequential. The
-- initiator declares it on `session_request` or the conversation is standard.
--
-- ─── The hash chain, stated correctly ──────────────────────────────────────────────────────────
-- An earlier draft of this comment said the chain "covers the columns present when each row was
-- written". That describes the WRITER and not the VERIFIER, and the difference is the whole issue:
-- `verifyChain` does `SELECT *` and rehashes every row with whatever columns exist NOW. So a new
-- column that the writer hashes makes every pre-existing row fail verification, because those rows'
-- stored hashes were computed without it.
--
-- `high_stakes` is therefore added to the sessions exclusion set in `hash-chain.ts`, alongside
-- `initiator_pubkey_hex` and `target_pubkey_hex`, which were excluded by V29 for exactly this
-- reason. The consequence is written out there and is real: the tier is stored and NOT
-- tamper-evident. Chaining it properly requires rechaining every existing sessions row, which is
-- its own unit.
--
-- Additive with a default: no backfill.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS high_stakes BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sessions.high_stakes IS
  'DOD-M15-UNILATERAL-1: the initiator opted this conversation in to the HIGH-STAKES solo-seal tier '
  '(longer floor, and the relay''s positive gone-observation is mandatory rather than best-effort). '
  'FALSE is STANDARD and is the safe default — it is the tier that never withholds a receipt from an '
  'honest party.';
