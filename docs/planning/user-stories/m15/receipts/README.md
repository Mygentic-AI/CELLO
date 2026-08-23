# M15 run receipts

Raw output from runs that are **too expensive to repeat**, committed so the evidence outlives the
machine that produced it.

`2026-08-23_spine-lane-full-run.log` — the first-ever run of `test:spine`, 56 minutes, 21 of 36
files red. `DOD-M15-SPINERED-1`'s triage needs the per-failure texts, and re-running to recover them
costs another hour of someone's battery. Flyway/container chatter stripped; every test result,
assertion and stack kept.

**Why in the repo and not a temp directory:** the original lived under `/private/tmp`, which a
reboot clears. A receipt that evaporates is not a receipt — and this one is the only evidence that
the multi-process lane the milestone-close gate depends on is currently half red.

Delete a file here once the line it evidences is ✅ **and** its finding is closed. Not before.
