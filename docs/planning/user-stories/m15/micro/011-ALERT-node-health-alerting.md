---
name: 011-ALERT — Something tells us when a directory node is unwell
type: micro-work-order
date: 2026-09-01
status: open
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
>    finding → commit. Commit per fix, push after every commit.
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

*(Reviewer verdict goes here. One quote. Not a transcript. Include the terraform plan summary.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
