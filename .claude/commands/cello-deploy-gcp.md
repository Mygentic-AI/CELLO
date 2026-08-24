---
name: cello-deploy-gcp
description: How to deploy the CELLO directory and relay nodes to GCP — build the images, probe capacity, roll node-by-node, and prove the fleet is serving. Use when shipping any change under packages/directory or packages/relay, when a change is committed but "not deployed", or when someone asks why a server-side fix has no effect in production. Enforces the capacity probe that prevents losing an instance and the health signals that actually work.
---

# Deploying the directory and relay to GCP

**Read `infra/CLAUDE.md` and `infra/GCP-STATE.md` first.** This file is the *procedure*; those two are
the *authority*, and `GCP-STATE.md` is what you must update afterwards.

> ### 🚨 The five facts that cost the most when you don't know them
> 1. **Pushing to `main` does NOT build an image.** The Cloud Build trigger has not fired since
>    2026-07-28 (M12-P11). Every build is a manual submit. A merged PR changes nothing in production.
> 2. **`terraform apply` with no `-target` replaces ALL THREE directory nodes at once.**
>    `update_policy = PROACTIVE`, and the threshold tolerates exactly one node down.
> 3. **MIGs never surge.** The instance template pins both the internal and external IP, so two
>    instances from one template can never coexist. Your node is DELETED before its replacement is
>    created — which is why step 2 below exists.
> 4. **You cannot health-check these nodes over HTTP.** Port 8080 is a libp2p WebSocket listener: a
>    plain GET returns `400` from a *healthy* directory. The relay's `/health` answers `000` from
>    outside the VPC by design. Use the log signals in step 5.
> 5. **The image tag does not tell you what a node is running.** Tags and cloud-init templates drift
>    independently and a clean plan does not catch it. Read the node's metadata.

---

## 0. Decide the order — this is a correctness question, not a preference

**Deploy the side that ACCEPTS a change before the side that DEPENDS on it.** Receiver-first, applied
to the fleet.

For anything that adds a field to the wire: **relay first, directory second.** The relay legs accept
and forward — inert against a directory that does not read them. The directory leg is the one that
starts *refusing*, so it goes last, onto a fleet already able to carry what it will ask for.

Reverse that and there is a window where the directory demands something no relay sends.

## 1. Build the images — manually, from the Git SHA

```bash
SHA=$(git rev-parse HEAD)

for CFG in relay directory; do
  gcloud builds submit \
    "projects/cello-infra/locations/us-east1/connections/cello-github/repositories/CELLO" \
    --revision=$SHA --region=us-east1 --config=infra/cloudbuild/$CFG.yaml \
    --service-account=projects/cello-infra/serviceAccounts/cello-cloud-build@cello-infra.iam.gserviceaccount.com \
    --substitutions=_TAG=$SHA --project=cello-infra --async
done
```

**Submit the SHA, never a local tree.** A local submit tags an image with a commit whose contents were
never proven to match it — that has already cost this milestone a demoted claim. And **push first**:
the revision must exist on origin.

**Only build from a tree whose tests you have run.** The image is the artifact; a red suite that
reaches production is not recoverable by a plan.

Wait for `SUCCESS` on both before going near the fleet.

## 2. ⚠️ PROBE CAPACITY — before the MIG deletes anything

**This is the step that stops you losing a node.** `ZONE_RESOURCE_POOL_EXHAUSTED` took `us-central1`
out on 2026-08-06: the MIG deleted the instance, then Google had no machine to give back.

**The MACHINE TYPE is the variable, not the zone.** All three `us-central1` zones were exhausted for
`e2-standard-2` while `e2-medium` had capacity all along. Moving zone while holding the type constant
just rediscovers the shortage somewhere new.

Probe the **(zone, machine-type) PAIR**, for every node you are about to roll:

```bash
probe () { Z=$1; MT=$2; SUB=$3; N="cap-probe-$(echo $Z|tr -d '-')"
  if gcloud compute instances create $N --zone=$Z --machine-type=$MT \
       --image-family=debian-12 --image-project=debian-cloud \
       --subnet=$SUB --no-address --project cello-infra >/dev/null 2>/tmp/pe; then
    echo "✅ $Z / $MT"; gcloud compute instances delete $N --zone=$Z --project cello-infra --quiet >/dev/null
  else echo "❌ $Z / $MT — $(grep -oE 'ZONE_RESOURCE_POOL_EXHAUSTED|QUOTA_EXCEEDED' /tmp/pe | head -1)"; fi; }
```

`--subnet` is not optional: the default network is deleted in this project, so a probe without it
fails on the NETWORK and the error looks nothing like capacity.

Read the zone and type from the **running instances**, not from `terraform.tfvars` — a stale variable
aims the probe at the wrong type:

```bash
gcloud compute instances list --project cello-infra \
  --format='table(name,zone.basename(),machineType.basename(),status)'
```

**If a probe fails:**
- `QUOTA_EXCEEDED` is **ours** — request a bump.
- `ZONE_RESOURCE_POOL_EXHAUSTED` is **Google's** — try a smaller type in the same zone
  (`e2-standard-2` → `e2-medium`), then another zone *in the same region*.
- **Never change REGION to solve capacity.** The node's external IP is regional and the roster is
  bundled into the published client — a region change is a client release, not an infra tweak.

## 3. Pin the new images

```bash
# infra/terraform/terraform.tfvars
directory_image_tag = "<SHA>"
relay_image_tag     = "<SHA>"
```

## 4. Roll ONE node at a time, with `-target`

```bash
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)   # expires hourly; re-export

terraform -chdir=infra/terraform apply -input=false -auto-approve \
  -target='google_compute_instance_template.relay["us-east1"]' \
  -target='google_compute_instance_group_manager.relay["us-east1"]'
```

Resource addresses are `{template,instance_group_manager}.{directory,relay}["<region>"]` —
`terraform state list` if unsure. **A full apply is what turns a one-node roll into a consortium
outage.**

## 5. Confirm the node is SERVING before touching the next

Use the signals the fleet already produces, which prove the node is doing its **job** rather than
merely listening.

**Directory** — anti-entropy rounds resume from its zone:
```bash
gcloud logging read 'jsonPayload.event=~"antientropy.round.(started|completed)"' \
  --project cello-infra --freshness=4m --limit=400 \
  --format='value(resource.labels.zone)' | sort | uniq -c
```
All three zones must appear.

**Relay** — the DIRECTORIES' own probe of it resumes:
```bash
gcloud logging read 'jsonPayload.event="relay.health.check.passed"' \
  --project cello-infra --freshness=3m --limit=200 \
  --format='value(jsonPayload.relayId)' | sort | uniq -c
```
Both `relayId`s must appear, ~10 per relay per 3 minutes.

> ### ⚠️ USE A WINDOW OF AT LEAST 3 MINUTES. A shorter one reads a healthy node as a dead one.
> Straight after a `us-central1` roll (2026-08-24) a **90-second** query returned only
> `europe-west1` — which reads as two of three directories missing, past what the threshold
> tolerates. A 4-minute window showed all three healthy; the node had simply not been up long enough
> to fill the shorter window. **The baseline is quoted per 3 minutes; query at least that.** The
> reaction to the misreading — rolling back, or chasing a node that is fine — is worse than the
> misreading.

## 6. Verify what the nodes actually RUN, not what you asked for

```bash
for i in $(gcloud compute instances list --project cello-infra --format='value(name,zone.basename())' | tr '\t' ':'); do
  N=${i%%:*}; Z=${i##*:}
  echo "$N → $(gcloud compute instances describe $N --zone=$Z --project cello-infra \
    --format='value(metadata.items[].value)' | grep -oE 'cello/(directory|relay):[0-9a-f]{8}' | head -1)"
done
```

**Read metadata, not the tag** — that is the file's own standing warning.

## 7. Prove the CHANGE works, not just that the fleet is up

A rolled fleet answering health checks proves the nodes booted. It does not prove your change does
anything.

**Drive a real session and read the log line your change emits.** For the seal path that is
`seal.final_root.verified`:
```bash
gcloud logging read 'jsonPayload.event=~"^seal\."' --project cello-infra \
  --freshness=8m --limit=30 \
  --format='value(jsonPayload.event,jsonPayload.coverage,jsonPayload.sessionId)'
```

> ### ⚠️ WHERE A PERMISSIVE FALLBACK EXISTS, THE RECEIPT IS NOT THE EVIDENCE.
> Most of these changes tolerate absence so un-upgraded peers keep working. That means **"it worked"
> and "nothing was carried, so nothing was checked" produce the SAME outcome for both participants**
> — a completed operation and a receipt. The distinction exists only in the node's own log. Go there,
> or you are reporting a green that proves nothing.

## 8. Update `GCP-STATE.md` — immediately, in the same commit

**A session that changes GCP without updating it is incomplete.** Never batched.

Record: what rolled, which instance names replaced which, the image tag it moved off, **the capacity
probe result**, and the health signal you used. Where you depended on a templated value, write the
value down — the tag will not carry it.

## Tell the other lanes before you start

The fleet moving under a live test looks exactly like a defect. Say so on the channel before the first
apply, and again when it settles — otherwise someone spends an hour filing a bug against a node that
was mid-roll.
