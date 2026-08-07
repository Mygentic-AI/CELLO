-- V59: agent_account_links — the agent↔account binding as an APPEND-ONLY FACT.
--
-- ─── The defect this exists to fix ──────────────────────────────────────────────────────────────
-- The binding lives today in `agent_profiles.account_id`, a MUTABLE column, and mutable columns are
-- excluded from anti-entropy by construction (Tier A replicates only what never changes). The M12
-- design assigned it "Tier B rules" and Tier B was built for two tables out of eight, so the link
-- has never replicated at all.
--
-- Measured on the live fleet 2026-08-07, one operator with three agents:
--   gcp-use1  0 linked      gcp-usc1  2 linked      gcp-euw1  1 linked
--
-- THE KILL SWITCH RIDES ON THIS. Pausing or burning an agent asks "does this agent belong to this
-- account?" against that column (`agent-write-repository.isAgentOwnedByAccount`). On a node without
-- the link the directory answers 403 not_owner — a DELIBERATE refusal, so the client correctly
-- stops rather than trying another node. Two of that operator's three agents could not be paused.
-- The same column is one of the two legs of the self-endorsement check (INV-NO-SELF-STANDING); the
-- account leg has been silently dead wherever the link is absent, leaving the phone-stub leg to
-- carry a check designed to have two.
--
-- ─── Why a table rather than replicating the column ─────────────────────────────────────────────
-- Andre's decision, 2026-08-07, and it follows the shape this codebase already proves. Tier B needs
-- a per-table merge rule, and a WRONG merge rule is worse than no replication: it converges the
-- whole consortium onto the wrong value, silently. `agent_revocations` avoids that entirely by
-- expressing its mutation as an append-only fact in its own table — Tier A then carries it for free,
-- with no merge rule and no clock-skew hazard. This does the same for the link.
--
-- Linking is one-way in practice: an agent is bound to an operator's account at registration and
-- that binding is the thing accountability rests on. So there is nothing to merge — only to insert.
--
-- `agent_profiles.account_id` is NOT dropped here. It is still read by code this migration does not
-- change, and dropping a column in the same step that introduces its replacement leaves no way back
-- if the new path is wrong. It becomes redundant once every reader moves; retiring it is its own
-- migration, deliberately later.

-- ─── the table ──────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_account_links (
  -- ONE PERMANENT LINK PER AGENT. Keyed by the stable agent_id, never a pubkey — pubkeys rotate,
  -- and this is the row an authorization decision is made from.
  agent_id    TEXT         NOT NULL,
  account_id  UUID         NOT NULL,
  -- Per-node wall clock. Excluded from the replicated set for exactly that reason: it would differ
  -- between nodes for the same fact and fork the content hash.
  linked_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT agent_account_links_pkey PRIMARY KEY (agent_id),
  CONSTRAINT agent_account_links_account_fk
    FOREIGN KEY (account_id) REFERENCES user_accounts(account_id)
);

-- The kill switch's question is "is THIS agent owned by THIS account?", and the account's agent list
-- asks the reverse. The PK serves the first; this serves the second.
CREATE INDEX IF NOT EXISTS idx_agent_account_links_account
  ON agent_account_links (account_id);

-- ─── backfill from the mutable column ───────────────────────────────────────────────────────────
--
-- Per node, from whatever that node happens to hold — which is the point. Each node contributes the
-- links it alone has, anti-entropy unions them, and the consortium ends up with the full set that
-- no single node has today. Nothing here needs the nodes to agree beforehand.
--
-- ON CONFLICT DO NOTHING so re-running is safe and so a link already replicated in from a peer is
-- never overwritten by a local row.
INSERT INTO agent_account_links (agent_id, account_id)
  SELECT agent_id, account_id
    FROM agent_profiles
   WHERE agent_id IS NOT NULL
     AND account_id IS NOT NULL
ON CONFLICT (agent_id) DO NOTHING;

-- ─── RLS: INSERT + SELECT only — append-only, like the revocation tombstone ─────────────────────

ALTER TABLE agent_account_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS insert_only ON agent_account_links;
  DROP POLICY IF EXISTS select_all ON agent_account_links;
END $$;

CREATE POLICY insert_only ON agent_account_links
  FOR INSERT TO cello_service WITH CHECK (true);

CREATE POLICY select_all ON agent_account_links
  FOR SELECT TO cello_service USING (true);

-- NO UPDATE and NO DELETE, neither policy nor grant. A binding that can be rewritten is a binding an
-- attacker can rewrite, and this is the row the kill switch authorizes from. Re-homing an agent to a
-- different account is not an UPDATE here — it would be a new, separately-designed fact.
GRANT INSERT, SELECT ON agent_account_links TO cello_service;
