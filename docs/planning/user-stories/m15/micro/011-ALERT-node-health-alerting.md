---
name: 011-ALERT — Something tells us when a directory node is unwell
type: micro-work-order
date: 2026-09-01
status: complete
description: >
  There is not one `google_monitoring_alert_policy` in the whole Terraform tree. A directory node
  ran at 38-44% CPU against a healthy idle of 0.3-0.4% for days and nothing said a word. Add a
  sustained-CPU policy and a memory policy — but verify the metric actually arrives before writing
  a policy against it, because a policy that cannot fire reads as coverage. Source: DOD-M15-ALERTING-1.
---

# **<ins>MICRO</ins>** WORK ORDER 011-ALERT — The fleet tells you when a node is unwell

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It is the working discipline for this
>    milestone and it binds you — the gate, the review dispatch, the invariants, how tests are run.
>    **Do not read `M15-DEFINITION-OF-DONE.md` or `M15-BUILD-JOURNAL.md`**; this order carries
>    everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.** Minimal without omitting anything.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict** — the
>    two are one fact, and eight orders in a row have shipped with them disagreeing.
> 6. **Done is done.** When the Definition of Done below is met, stop.

> ## 🚨 INFRASTRUCTURE RULES — NON-NEGOTIABLE
>
> - **CELLO runs on GCP.** Terraform in `infra/terraform/` is the deploy path. The CloudFormation
>   under `infra/cloudformation/` and `infra/deploy.sh` are STALE for the protocol — seeing a deploy
>   script does not make it the deploy path.
> - **Read `infra/CLAUDE.md` before you touch anything**, and `infra/GCP-STATE.md` for what exists.
> - **Update `infra/GCP-STATE.md` IMMEDIATELY after any GCP change — never batched.** A session that
>   changes GCP without updating it is incomplete.
> - **Everything in GCP exists in Terraform.** Do not click anything into being in the console.

---

## The problem, plainly

**There is not a single `google_monitoring_alert_policy` in the entire Terraform tree.** Confirmed by
grep across `infra/terraform/*.tf` — zero policies, zero notification channels.

What that cost, concretely: a directory node sat at **38-44% CPU** for days against a healthy idle
of **0.3-0.4%**, and nobody was told. It was found by a person looking, not by the system saying so.

There is a related known problem this alerting would have surfaced: the directory process grows
roughly **250 MB/day** against a 4,096 MB ceiling, and at about 80% of that ceiling the node stops
answering anything for **40 seconds** while garbage collection runs on the same thread that serves
HTTP. That is a node that looks alive and serves nothing.

---

## ⚠️ WHAT ALREADY EXISTS — reuse it, do not build a second one

`infra/terraform/alerting.tf` is **not empty**. It carries a working notification pipeline for a
different purpose (a seal was refused):

> log sink → Pub/Sub topic → Cloud Run service (`seal_notifier`) → Telegram Bot API,
> with the bot token and chat id in Secret Manager.

**Read that file's header before writing anything.** It states the design rule this unit must also
obey, and it was learned the hard way:

> *"An alert that fires on the ordinary case gets muted, and a muted alert is worse than none
> because it reads as coverage."*

Its scope was deliberately narrowed to unrecoverable failures only, for exactly that reason. Your
two policies must clear the same bar: **if it would fire on a normal Tuesday, the threshold is
wrong.**

**Where a person actually gets told is a decision, and it is yours to make and write down:** either
route the new metric alerts into the existing Telegram path, or add a notification channel. Whatever
you choose, say why in one line — a second, unrelated notification route that nobody knows exists is
its own failure.

---

## 🔴 VERIFY THE METRIC EXISTS BEFORE YOU WRITE A POLICY AGAINST IT

This is the single most important instruction in this order.

The memory policy is supposed to watch a metric a host sampler emits (`cello.node.memory`). **I
could not confirm from the repo that it is arriving in Cloud Monitoring.** A policy written against
a metric that never arrives never fires — and a never-firing alert is indistinguishable from a
healthy fleet. That is precisely the "reads as coverage" failure above, in its worst form.

**So: confirm the metric is actually present in Cloud Monitoring before writing its policy.** If it
is not:

- **Do not invent a sampler.** That is a different unit and it is not this one.
- Ship the CPU policy, which rests on a standard GCE metric that certainly exists.
- Write the missing metric under *Newly discovered* with what you checked.

### The trap that already cost a full fleet roll

If you do end up touching anything that logs from the instances: **COS forwards journald to Cloud
Logging at WARNING AND ABOVE ONLY.** The first version of a sampler logged at info, produced
perfectly correct lines that never left the instance, and cost a second roll of all three nodes to
discover. Anything below WARNING is invisible no matter how right it looks locally.

---

## The work

1. **A sustained-CPU alert policy** on the directory nodes. Sustained is the point — a spike is
   normal, days at 40% against a 0.4% baseline is not. Pick the window and threshold so the incident
   described above would have fired and an ordinary day would not, and **state the reasoning in a
   comment beside the policy**, because the next person will otherwise tune it blind.
2. **A memory alert policy** — subject to the verification above. It should fire with enough runway
   to act before the node reaches the ceiling where it stalls for 40 seconds, not at the moment it
   does.
3. **Route both somewhere a human sees**, per the decision framed above.
4. **Update `infra/GCP-STATE.md`** in the same change.

---

## Definition of Done

1. A sustained-CPU alert policy exists in Terraform for the directory nodes.
2. A memory alert policy exists — **or** the metric was verified absent, the CPU policy shipped
   alone, and the absence is recorded in *Newly discovered* with what was checked.
3. **Every policy is against a metric confirmed to be arriving.** State how you confirmed it, per
   policy. "It is in the docs" is not confirmation.
4. Both thresholds carry a comment giving the reasoning: what real incident they would have caught,
   and why they will not fire on a normal day.
5. Alerts reach a human, and the route is named in a comment saying why that route.
6. `terraform validate` and `terraform plan` are clean, and **the plan is read** — it names only the
   resources you intended to add. Paste the plan's add/change/destroy summary in the *Review*
   section. **A plan that destroys anything is a stop-and-ask, not a proceed.**
7. **`infra/GCP-STATE.md` updated in the same change.**
8. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope, explicitly:** building or fixing a metrics sampler; the directory's memory growth
itself (that is its own line); alerting on the relay; dashboards; anything in the application code;
CloudFormation, which is stale for the protocol.

---

## Traps recorded before you start

- **An alert that fires on the ordinary case gets muted, and a muted alert is worse than none.**
  This file's neighbour learned that already.
- **A policy against a metric that never arrives is the same failure wearing a green badge.**
  Verify, do not assume.
- **Anything logged below WARNING never leaves a COS instance.** It already cost one fleet roll.
- **Never create GCP resources by hand.** If it is not in Terraform it does not exist, and the next
  `terraform apply` will fight you.
- **Do not touch `infra/terraform/terraform.tfvars` casually** — a deploy may be mid-flight in
  another session, and image pins live there.

---

## Review

### Terraform plan summary

Targeted at the four resources this unit adds:

```
  # google_logging_metric.directory_node_rss will be created
  # google_monitoring_alert_policy.directory_cpu_sustained will be created
  # google_monitoring_alert_policy.directory_memory_ceiling will be created
  # google_monitoring_notification_channel.operator_email will be created
Plan: 4 to add, 0 to change, 0 to destroy.
```

`terraform validate` — `Success! The configuration is valid.` `terraform fmt -check alerting.tf` — clean. **Qualified deliberately:** repo-scope `terraform fmt -check` exits 3, naming `node-relay.tf` (pre-existing — it fails identically on `main`, checked) and `terraform.tfvars` (the in-flight roll's uncommitted edit). Neither is from this diff, and an unqualified "fmt clean" would have let the next person believe the repo gate passes.

**The UNTARGETED plan destroys two things, and neither is mine.** It reports `7 to add, 6 to change,
2 to destroy`; the destroys and changes are relay resources belonging to the in-flight `7befcc95`
roll. Proven rather than asserted: the same plan run on `main` **without this change** reports
`3 to add, 6 to change, 2 to destroy`, and diffing the two resource-action lists leaves exactly the
four additions above. Three consecutive plan runs also disagreed with each other about *which*
relay resources move — the fleet is being changed underneath the plan — while the four alerting
resources were create-only in every run.

### Applied and live

The lock cleared later in the session, so the four resources were applied — `Apply complete!
Resources: 4 added, 0 changed, 0 destroyed.` — targeted at exactly them, plus one in-place change
(`0 added, 1 changed, 0 destroyed`) for the review's H3 fix. Read back from GCP rather than from
Terraform state: both policies `enabled`, thresholds 0.25 / 2634547, durations 3600s / 1800s. A
post-apply plan reports **`No changes. Your infrastructure matches the configuration.`**

**Nothing fired on apply, and that was checked before applying rather than hoped for:** every
directory instance sat at 0.038–0.060 cores against a 0.25 threshold and 248–275 MB against 2,573 MB.

**The one thing still unproven is delivery.** No incident has ever actually landed in a mailbox
through this channel; a channel that accepts creation and silently drops mail looks identical to a
healthy one from every check available here. Forcing it means either a throwaway policy created by
hand — against the rule that nothing exists outside Terraform — or an hour of synthetic load on a
production node. The one-click close (Console → Alerting → Notification channels → **Send test
notification**) is recorded in `GCP-STATE.md`. Treat node-health alerting as wired-and-plausible
rather than proven until someone presses it.

### How each metric was confirmed to be arriving (DoD 3)

- **CPU** — `timeSeries.list` against the live project returned **58 directory instance series over
  30 days** at ~60 s resolution. The same query is the negative control for the regex: relay
  instances exist in that metric and none of them matched.
- **Memory** — `cello.node.memory` is **a log line, not a metric**, so the policy is against a
  log-based metric built over the stream that already exists. Its filter, run verbatim against Cloud
  Logging, returned samples from all three nodes within the hour and 20,000 across 7 days; a negative
  control with a deliberately wrong `SYSLOG_IDENTIFIER` returned nothing. Both extractor regexes were
  run against the real message strings.
- **The aligner** — `ALIGN_PERCENTILE_99` + `REDUCE_MAX` was put to the live Monitoring API against
  an existing DELTA/DISTRIBUTION metric and accepted; `ALIGN_MAX` was rejected with *"the aligner
  cannot be applied to metrics with kind DELTA and value type DISTRIBUTION"*.

### Reviewer verdict

> **SPEC: DEVIATIONS FOUND** … **SILENT FALLBACKS FOUND** — H3 (missing data reads as healthy; a
> dead process silences both policies) and H2 (unverified channel) are [blocking]. … *"Not
> rubber-stamping: the two things that would have shipped unnoticed are the record/reality inversion
> and a channel with no proof it delivers."*

Findings and disposition — 3 high, 2 medium, 3 low:

| # | Finding | Disposition |
|---|---|---|
| H1 | GCP-STATE said the resources were not applied when they were | **already fixed** before the verdict arrived — the reviewer read a snapshot taken before the apply |
| H2 | Channel delivery unproven; the status check misleads | **fixed** — the check now distinguishes an absent field from `UNVERIFIED`, and the unproven last hop is stated outright rather than left implied |
| **H3** | **A dead directory process silenced BOTH alerts** | **fixed and applied** — `evaluation_missing_data = ACTIVE` on the memory condition. The best finding in the review |
| M1 | Plan summary said `1 to add`, was `4` | **already fixed** before the verdict arrived |
| M2 | `terraform fmt -check` claimed clean at repo scope | **fixed** — qualified above; `node-relay.tf` recorded below |
| L1 | Cloud-init comment says `cos_system`, actual is `cos_journal_warning` | **NOT fixed — see Newly discovered 3.** Editing that file re-renders the instance template and forces a fleet roll for a one-word comment |
| L2 | File argues for `join`, then uses a heredoc | **fixed** — the claim is narrowed to the monitoring filter; the logging heredoc shows no drift |
| L3 | Percentile returns bucket-edge values | **already fixed** — the 50 MB quantisation note was added before the verdict |

The reviewer independently re-derived every quoted figure and re-ran the filters against live GCP:
all twelve numbers hold, the regex excludes relays and the capacity probes, and the metric returned
three correctly-labelled series. Its own summary of that: *"The memory policy is not permanently
silent — which was the order's central fear, and it is answered."*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

> **Item 1 was CLOSED inside this unit, not deferred.** I first filed "if the sampler stops the
> alert goes silent and that reads like health" here and left it. The reviewer showed it was worse
> than filed — a dead directory process silences BOTH policies — and that it had a one-attribute
> fix. It is struck rather than deleted because the misjudgement is the useful part: the thing I
> classified as a future design decision was the failure the unit exists to catch.

1. ~~**If the memory sampler stops, the alert goes silent and that reads exactly like health.**~~
   **CLOSED** — `evaluation_missing_data = "EVALUATION_MISSING_DATA_ACTIVE"` on the memory
   condition, applied and verified live. What remains open by design: the CPU condition is per
   instance and instances legitimately vanish on every roll, so it stays `INACTIVE`. The memory
   condition covers the node-down case for both.

2. **`node-relay.tf` fails `terraform fmt -check`** (exit 3, a misaligned `templatefile` argument
   block). Pre-existing — it fails identically on `main` — so repo-scope `terraform fmt` has been red
   for a while and nobody is running it at repo scope.

3. **A comment in `directory-cloud-init.yaml` says journald forwards as `cos_system`; it is
   `cos_journal_warning`,** which the line 20 below it and the live logs both confirm. Now
   load-bearing: the memory metric pins that `logName`, so someone "correcting" the metric to match
   the wrong comment would silently empty it. **Left alone deliberately — editing that file
   re-renders the instance template and forces a replacement of all three nodes for a one-word
   comment fix.** Worth folding into the next roll that touches the file for another reason.

4. ~~**The relay's Terraform state does not agree with itself run to run right now.**~~
   **EXPLAINED, not a defect.** Three plans in succession named three different relay action sets and
   one wanted to *create* a relay `GCP-STATE.md` records as live. That was the `7befcc95` roll being
   read mid-flight. It has since landed on `main` (`infra: the whole fleet is on 7befcc95`), which
   moved both relays to new zones and machine types, and after rebasing onto it a plan reports
   **`No changes`**. Recorded because "terraform thinks a live relay does not exist" is alarming to
   read cold, and the answer is that someone was mid-roll.
