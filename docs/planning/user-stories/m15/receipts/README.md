# M15 run receipts

Raw output from runs that are **too expensive to repeat**, committed so the evidence outlives the
machine that produced it.

`2026-09-02_spine-lane-full-run.log` — **the current receipt. It supersedes the 2026-08-23 run.**
49 minutes, 3 of 38 files red: 6 failed / 73 passed / 21 skipped. The three red files are
`j-content` (4), `j-remove` (1) and `j-upgrade-bilateral` (1). The 21 skips are deliberate — the
eight `j-documents` describes plus `j-multiplayer`'s three-daemon describe are `describe.skip`
(shared documents are out of the launch gate), as are `j-stale-session` and `j-suspend-tofn`;
`j-gcp-live` is env-gated behind `skipIf`. Same strip rule as below.

`2026-08-23_spine-lane-full-run.log` — **SUPERSEDED by the 2026-09-02 run above; retained, not
deleted.** The first-ever run of `test:spine`, 56 minutes, 21 of 36 files red. `DOD-M15-SPINERED-1`'s
triage needs the per-failure texts, and re-running to recover them costs another hour of someone's
battery. Flyway/container chatter stripped; every test result, assertion and stack kept.

**Why in the repo and not a temp directory:** the original lived under `/private/tmp`, which a
reboot clears. A receipt that evaporates is not a receipt — and these are the only evidence of what
the multi-process lane the milestone-close gate depends on actually did.

**Strip rule** (apply to any new receipt so the files stay comparable): drop only lines matching
`Migrating schema "public" to version` — 4,800 of them in the 2026-09-02 raw output, one per Flyway
migration per spine database. Everything else stays, including the Flyway banners and the
`notification.channel.forwarded` events, because a missing container or an unapplied migration is a
failure mode these runs have to be able to show.

Delete a file here once the line it evidences is ✅ **and** its finding is closed. Not before.
