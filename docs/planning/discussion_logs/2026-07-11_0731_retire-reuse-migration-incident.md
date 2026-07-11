---
name: retire-reuse-migration-incident
type: discussion
date: 2026-07-11
topics: [incident, migration, agent-id-joinkey, retire-reuse, sqlcipher, daemon-startup, hardening, address-book, launch-triage]
description: >
  Incident + resolution: on the first live `cello login` onto daemon 0.0.45+, the agent_id backfill
  migration aborted `agent_id_backfill_ambiguous` because the name "Ms_Chelly" resolved to two agent_ids
  (retire-reuse). Root cause proven from the DB (the retired identity owns zero rows), fixed by hand with a
  single rename (DB backed up first), both migrations then ran clean. Includes the launch-hardening finding:
  the migration's only documented recovery is "resolve by hand or wipe your DB", which is unacceptable for a
  real operator who ever reused an agent name.
---

# Incident — retire-reuse ambiguity blocks daemon startup (2026-07-11)

## Symptom

Andre promoted the address-book cascade (daemon 0.0.46 / cli 0.0.44 / connect 0.0.65 → `latest`), installed
it, and ran `cello login`. **The daemon failed to start** (`Daemon exited (code 1) during startup`). The MCP
could not reconnect (nothing to connect to). Daemon log:

```
daemon.migration.agent_id_backfill.failed
  reason: agent_id_backfill_ambiguous: agent name(s) [Ms_Chelly] resolve to more than one agent_id
          (a retired agent's name was reused). … Resolve by hand or start from a fresh database.
daemon.startup.failed  (same reason)
```

**Not the 0.0.46 address-book publish.** The failing migration is the **0.0.45** `agent_id` backfill
(`DOD-AGENT-ID-JOINKEY-1`), which runs as a prerequisite *before* the tier ADD COLUMN. It had never run on
Andre's DB before (`persist.db.opened migrated:false`); this login was its first attempt.

## What we knew vs. proved

The error *asserts* "a retired agent's name was reused" — but an error string is where a failure surfaces,
not a verified cause. What we actually knew: the backfill's `agent_name → agent_id` map (built over **all**
agent rows including retired — `agent-id-migration.ts` `buildNameToAgentId`) found `Ms_Chelly` mapping to
>1 id and aborted **before** any transaction (DB untouched, `migrated:false` — nothing corrupted). We had
**not** proven *why* two ids existed or which owned the session rows.

## Root cause — proven from the DB (read-only forensics)

Opened `~/.cello/sessions.db` read-only with the daemon's own SQLCipher key (`sessions.db.key`) and read the
`agents` + session tables:

- **Two `Ms_Chelly` rows:** a **retired** one (`agent_id b3e969007dd5`, pk `be66b5…`, created 2026-06-25,
  retired 2026-06-26) and the **active** one (`agent_id d87004c8…`, pk `178d420b…` — the current identity,
  created 2026-07-06). Genuine retire-reuse: `removeAgent` freed the name (partial unique index excludes
  retired rows), and a new agent reused it. **Only `Ms_Chelly` was ambiguous**; every other retired agent
  (Demo1/2, capX/Y, tofn1, Agent-1) has a unique name.
- **The retired identity owns ZERO rows.** All 67 `Ms_Chelly` sessions have `created_at ≥ 2026-07-06 18:37`
  (after the active agent existed, 09:55) — `0` created before the active agent, `0` in the retired agent's
  lifetime (it died 06-26). Same for contacts (all 07-07+). A retired agent cannot write, so nothing it
  authored exists. The migration deliberately declines timestamp disambiguation ("cleverness buys nothing on
  a wipeable DB") — but the data shows there is no *real* ambiguity: all 221 rows belong to the active agent.

(Method note: an early pass used **hand-typed epoch constants that were wrong** — caught because the `iso()`
echo showed the wrong dates. Redone relationally, pulling both agents' timestamps from the DB. Lesson: never
hardcode a timestamp you can `SELECT`.)

## Fix — one rename, data-preserving, backed up first

Rather than wipe (which would drop every local agent identity — Ms_Chelly, CELLO_Support, CELLO_Feedback,
Ms_Chelly_Hermes — and their history), **disambiguate the name**:

1. Backed up `sessions.db` (+ key) to `~/.cello/backup-preremediation-20260711-064425/`.
2. One `UPDATE`: the defunct retired row's `agent_name` `Ms_Chelly → Ms_Chelly_retired_b3e96900`
   (targeted `WHERE agent_name='Ms_Chelly' AND state='retired'`, asserted exactly 1 row). Verified the
   ambiguity check then returned `[]` and the active row was untouched.

`cello login` then migrated clean: `daemon.migration.agent_id_backfill` (11 agents mapped, 133 sessions /
309 transcript re-keyed) → `contacts.tier.columns.added` → `contacts.tier.grandfathered count:6 tier:3` →
all 4 agents `agent.online` with correct pubkeys (Ms_Chelly `178d420b…` intact). No data lost; the renamed
retired row sits inert.

## Launch-hardening finding (owed — see the new DoD entry)

**The migration's only documented recovery is "resolve by hand or start from a fresh database." That is
unacceptable for a real operator** who ever retired-and-reused an agent name: on upgrade, their daemon won't
start, and "wipe your DB" means losing their identity + history. This was survivable here only because it
was the developer's machine with DB access and forensic tooling. Before broad launch the migration needs an
**automated resolution**, e.g.:

- **Timestamp auto-attribution** (the strategy the code explicitly parks): a retired agent cannot write, so
  rows postdating the reusing agent's creation provably belong to it; attribute them and let the retired
  agent keep only what predates the reuse. Safe when the retired identity owns zero post-reuse rows (the
  common case).
- Or a **repair subcommand** (`cello repair --disambiguate <name>`) that performs tonight's rename/attribution
  safely, so an operator is never told to wipe.

Tracked as **`DOD-MIGRATION-AMBIGUITY-RESOLVE-1`** (backlog — not a launch blocker for a fresh user, but
unforgivable for any user who reused a name). See [[M8C-DEFINITION-OF-DONE]].

## Related Documents

- [[2026-07-10_agent-id-joinkey]] — the migration and hazard #1 (retire-reuse) this incident realized.
- [[2026-07-10_address-book-build-log]] — the address-book unit this login was deploying; live-smoke close.
- [[M8C-DEFINITION-OF-DONE]] — the hardening DoD entry.
