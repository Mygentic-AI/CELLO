# The live CELLO topology on GCP. Committed on purpose: this file IS the answer to
# "what exists", and a topology kept only in someone's shell history is not IaC.

environment = "dev"

# Immutable commit-SHA tag built by Cloud Build. Never a moving tag — see infra/cloudbuild/*.yaml.
directory_image_tag = "12c493ff5b0f4bd4ec9bd78314a21ca225ac9844"

# One node = one region = one independent deployment. The map key is the region, which makes two
# nodes in one region unrepresentable rather than merely discouraged.
#
# node_id is PERMANENT: it feeds Identifier.derive() and is the FROST participant identifier.
# `gcp-use1` is us-east1 (Moncks Corner, SC) — a different geography from the AWS node's us-east-1
# (N. Virginia), so a regional event does not take both.
directory_nodes = {
  us-east1 = {
    node_id = "gcp-use1"
    # ⚠️ MOVED -b → -c 2026-09-01 during the 7befcc95 roll. `us-east1-b` hit
    # ZONE_RESOURCE_POOL_EXHAUSTED and stayed there for ~10 minutes of retries with the node DOWN,
    # while a throwaway probe of the SAME (zone, type) pair succeeded — capacity there is flickering
    # in and out, and the MIG kept landing on the empty moments. Probed `-c` and `-d` directly, per
    # the playbook: both had capacity. Zone changes are safe within a region (the external IP is a
    # regional google_compute_address, so the published manifest stays valid); a REGION change would
    # not be. Revert only with a fresh probe, never on assumption.
    zone         = "us-east1-d"
    subnet_index = 0
    # ⚠️ UPSIZED e2-standard-2 → c3-standard-4 2026-09-01, same reason and same answer as usc1 on
    # 2026-08-10: us-east1 had no 2-vCPU standard capacity in `-b` OR `-c`, the node sat DOWN for
    # ~20 minutes of MIG retries, and the playbook's lesson is that the MACHINE TYPE is the variable,
    # not the zone. `c3-standard-4` is what had capacity when everything smaller was exhausted there.
    # NOT a downsize to e2-medium: heap_mb=4096 gives V8 a ~4,288 MB ceiling, so 4 GB of RAM would be
    # OOM-killed by the kernel — worse than the stall it was raised to fix.
    # `c3-standard-4` was tried FIRST and also hit ZONE_RESOURCE_POOL_EXHAUSTED — us-east1 was short
    # across e2 AND c3 on this day. `n2-standard-2` is used because it is the one pair that was
    # DIRECTLY PROBED SUCCESSFUL in this zone (12:09 UTC-7), not because it was the next guess. Same
    # 8 GB as the original e2-standard-2, so the heap ceiling is unchanged; different capacity pool,
    # which is the entire point. N2_CPUS quota is 200. Revert only with a fresh probe.
    machine_type = "n2-standard-2"
    db_tier      = "db-custom-1-3840"
    hostname     = "directory-gcp-use1.cello.mygentic.ai"
    # No TLS terminator in front of this node yet — it listens on 8080 itself.
    public_port      = 8080
    public_transport = "ws"
  }

  # Node 2. A different region is the whole point — one node = one region = one independent
  # deployment, so a regional event can never take two validators. us-central1 (Council Bluffs, IA)
  # shares no power grid, no network fabric and no failure domain with us-east1.
  us-central1 = {
    node_id          = "gcp-usc1"
    zone             = "us-central1-a"
    subnet_index     = 1
    # ⚠️ TEMPORARY UPSIZE 2026-08-10 — REVERT TO "e2-standard-2" WHEN us-central1 HAS CAPACITY.
    # `ZONE_RESOURCE_POOL_EXHAUSTED` again, and WORSE than 2026-08-06: that time e2-medium had room
    # in -a. This time the whole region was empty of 2-vCPU capacity — probed e2-standard-2, e2-medium,
    # n2-standard-2, t2d-standard-2, n2d-standard-2 and e2-highcpu-4 across -a/-b/-c, all exhausted.
    # `c3-standard-4` had capacity in -a, probed as the (zone, type) PAIR the playbook insists on.
    # Bigger than needed (4 vCPU / 16 GB) and taken deliberately: the MIG deletes before it creates,
    # so the alternative was leaving the consortium at exactly threshold with zero spare. GCP credits
    # are not a constraint. Re-probe with the playbook command before reverting.
    # ⬇️ REVERTED 2026-08-19 — `c3-standard-4` itself hit ZONE_RESOURCE_POOL_EXHAUSTED during the
    # M12 Tier P5 roll, so the temporary upsize below is no longer available and the node could not
    # be recreated. Probed the (zone, machine type) PAIR per the GCP-STATE playbook rather than
    # guessing: `e2-standard-2` HAS capacity in `us-central1-a`, which is the size the revert marker
    # below always intended to return to. The upsize note is kept for the history it explains.
    machine_type     = "e2-standard-2"
    db_tier          = "db-custom-1-3840"
    hostname         = "directory-gcp-usc1.cello.mygentic.ai"
    public_port      = 8080
    public_transport = "ws"
  }

  # Node 3. Temporary Wave-1 member so the standalone GCP consortium is N=3 with T=majority=2
  # (spec-of-record decision 2); displaced or re-rolled as a replica when the AWS node joins in P3.
  # Another continent, because at N=3 the third node is what decides whether a US-wide event can
  # take the consortium below threshold.
  europe-west1 = {
    node_id          = "gcp-euw1"
    # ⚠️ MOVED -b → -c 2026-09-01 during the 7befcc95 roll, same failure and same remedy as use1
    # earlier the same hour: `europe-west1-b` returned ZONE_RESOURCE_POOL_EXHAUSTED on this
    # instance's OWN insert operations (twice), leaving the node down. Zone changes are safe within
    # a region — the external IP is a regional google_compute_address, so the published consortium
    # manifest stays valid. Revert only with a fresh probe, never on assumption.
    zone             = "europe-west1-c"
    subnet_index     = 2
    machine_type     = "e2-standard-2"
    db_tier          = "db-custom-1-3840"
    hostname         = "directory-gcp-euw1.cello.mygentic.ai"
    public_port      = 8080
    public_transport = "ws"
  }
}

# Directory node signing pubkeys — PUBLIC data, and the set a relay will accept instructions from.
# Terraform generates the key SEEDS but cannot derive Ed25519 public keys, so these come from
# infra/scripts/gcp-node-identities.sh. Verified byte-identical to what each node logs for itself
# at boot, which is the basis for trusting a manifest built from them. Re-run the script and
# re-apply if a node key is ever rotated.
directory_node_pubkeys = {
  gcp-use1 = "7969e22a7d95293ae343cb2667c2a4d7127aa8748478582fa637674c30e0113c"
  gcp-usc1 = "ef961384100bb087f36b68e3a270acb8f22fdf62c4cd5e517e423afb7f399002"
  gcp-euw1 = "9cb77b68a98f49056fef232f4d56eeb9b66b1a6646fe06b966ff570a82ca6c14"
}

# Relays do NOT enter the threshold, so they may scale freely — one is enough for Wave 1.
# us-east1 alongside gcp-use1 keeps the first live session's path short while the topology is
# being proven; additional relays are additional map entries.
# Same source as directory_node_pubkeys — infra/scripts/gcp-node-identities.sh.
directory_node_peer_ids = {
  gcp-use1 = "12D3KooWMH58hm8xpuwgwaNSvnvXBuc126jfuUMVbrGNcU2MeEAX"
  gcp-usc1 = "12D3KooWExQLMbvaioVqQCPkc1ZZgJ5kdoePymtMrg46ugMBs5zi"
  gcp-euw1 = "12D3KooWP52VSVrakyRdPyt23kAuhgp3FV6tiVRByfdyVvHAaEeJ"
}

# The relay registers with the directory in its own region — shortest path, and no cross-region
# dependency for the thing that makes sessions brokerable at all.
relay_primary_directory = "gcp-use1"

# DOD-RELAY-KEEPALIVE-1 / DOD-GCP-RELAY-DRIFT-1. Built by Cloud Build 8eaddd07 from the GitHub
# repository resource at this exact revision — not from a local tree — and verified to resolve
# @cello-protocol/transport@0.0.44, the version below which this relay refuses to start.
relay_image_tag = "1695c1a9406c7eddfc434a4e73a65ddbb8a44b70"

relay_nodes = {
  us-east1 = {
    node_id = "gcp-relay-use1"
    # ⚠️ MOVED -b → -d 2026-09-01. us-east1-b was out of capacity for e2-small AND n2-standard-2;
    # changing machine type alone did not rescue it, unlike the directory. The WAL disk moves with
    # it (recreated empty) — acceptable only because there are no users and the WAL journals
    # in-flight frames rather than durable state.
    zone         = "us-east1-d"
    subnet_index = 0
    # ⚠️ e2-small → n2-standard-2, 2026-09-01, during the 7befcc95 roll. us-east1-b was out of e2
    # capacity all afternoon (it took the DIRECTORY out of this zone entirely).
    #
    # THE ZONE IS NOT THE LEVER FOR A RELAY, and this is the difference from a directory: the relay
    # has a ZONAL WAL persistent disk (`google_compute_disk.relay_wal`) attached by name, holding
    # in-flight session frames. A zonal disk cannot follow the instance to another zone, so moving
    # zone means recreating the disk and dropping frames agents believe were delivered. Change the
    # machine type instead and leave the disk where it is.
    #
    # Oversized for a relay (it journals and forwards; it does not compute), taken because n2 had
    # capacity in this region today when e2 did not. Revert only with a fresh probe.
    machine_type = "n2-standard-2"
    hostname     = "relay-gcp-use1.cello.mygentic.ai"
  }
  europe-west1 = {
    node_id = "gcp-relay-euw1"
    # ⚠️ MOVED -b → -c 2026-09-01, same as this region's DIRECTORY an hour earlier and for the same
    # reason: europe-west1-b returned ZONE_RESOURCE_POOL_EXHAUSTED. The WAL disk is recreated in -c
    # (zonal disks cannot follow an instance), which costs in-flight frames — acceptable only
    # because there are no users.
    zone         = "europe-west1-c"
    subnet_index = 2
    machine_type = "e2-small"
    hostname     = "relay-gcp-euw1.cello.mygentic.ai"
  }
}

# The officer public key the consortium manifest is verified against, and how many officer
# signatures it needs. NOT the FROST threshold — that is majority(validators) = 2 and the node
# derives it from the manifest.
consortium_root_keys = "e8300a2b9de7be6f6d629f778dc319715ad0010c0639f3a1564181d56d3eb104"
consortium_threshold = 1

# Pre-authorization issuer PUBLIC key. Setting this is what ENABLES capability checking on every
# directory — unset, a node does not perform a weaker check, it performs none and accepts
# registration from anyone who can reach it. ONE issuer for the consortium, because a client
# presents its capability to whichever directory it reaches.
# Derived from cello-consortium-preauth-issuer-key with infra/scripts/derive-pubkey.js.
preauth_issuer_pubkey = "4468292bbe38ab929e504a1d962abeebe4f02db0a380b4d7880eb4f4dbd56c07"

# DOD-MOVE-PORTAL-1 — the operator surface on GCP.
portal_image_tag = "portal-61b1abf"
ops_agent_image_tag = "ops-11941353"
waitlist_image_tag = "waitlist-a12fd1a3"

# DOD-GCP-OPS-1 — built by Cloud Build from Andre-Mygentic/cello-ops-dashboard.
ops_dashboard_image_tag = "ops-e6d0f32"

# Seal-alert notifier (M12 Tier P5 / DOD-M12-SEAL-ALERT-1). No :latest exists; SHAs are pinned.
seal_notifier_image_tag = "a54137bf5496e71ba3272fc9b1756a61c42be6db"
