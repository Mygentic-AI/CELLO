# Object storage for the directory nodes (DOD-NODE-DIR-GCP-1, DOD-ADAPTER-GCP-1).
#
# Three buckets, three different trust properties — deliberately NOT one bucket with prefixes:
#
#   audit          write-only for the node, retained, never deleted by the node. Its whole value is
#                  that a compromised node cannot erase its own trail, which prefix separation
#                  inside one bucket does not give you.
#   relay-manifest read-only for the node. The officer-signed relay pool manifest. A node that
#                  could write this could redirect every session it brokers.
#   backups        write-only for the node. pg_dump output. Shares live in the node's database and
#                  NOWHERE else, so this is the only copy that exists off the VM.
#
# Buckets are per-node, not shared: a node in one region has no business reading another node's
# audit trail or backups, and sovereignty means the blast radius of one compromised node stops at
# that node. Region-expansion: adding a node to var.directory_nodes creates its three buckets.

resource "google_storage_bucket" "node_audit" {
  for_each                    = var.directory_nodes
  name                        = "cello-audit-${each.value.node_id}"
  project                     = var.project_id
  location                    = upper(each.key)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  labels = {
    project = "cello"
    node    = each.value.node_id
    purpose = "audit"
  }

  # The bucket exists so that a compromised node cannot erase its own trail. Terraform destroying
  # it wholesale is the same outcome by another route.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket" "relay_manifest" {
  for_each                    = var.directory_nodes
  name                        = "cello-relay-manifest-${each.value.node_id}"
  project                     = var.project_id
  location                    = upper(each.key)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  labels = {
    project = "cello"
    node    = each.value.node_id
    purpose = "relay-manifest"
  }
}

resource "google_storage_bucket" "node_backups" {
  for_each = var.directory_nodes
  # Object versioning is what makes num_newer_versions meaningful; each dump has a unique name, so
  # versions accrue per name rather than replacing.
  name                        = "cello-backups-${each.value.node_id}"
  project                     = var.project_id
  location                    = upper(each.key)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # The node's key shares exist only in its database, so a backup is the only recovery path.
  #
  # `num_newer_versions` and NOT a bare `age = 30`: an age-only rule empties the bucket 30 days
  # after the timer breaks, which is indistinguishable from a node that never backed up — the
  # failure deletes its own evidence. This keeps the most recent dumps regardless of age, so a
  # stale-but-present backup stays recoverable and a missing one stays visible.
  lifecycle_rule {
    condition {
      age                = 30
      num_newer_versions = 14
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    project = "cello"
    node    = each.value.node_id
    purpose = "backups"
  }
}

# ── Grants: bucket-scoped, and asymmetric on purpose ─────────────────────────────────────────
# objectCreator, not objectAdmin: the node may WRITE an audit entry or a backup and may never
# delete or overwrite one. That is what makes the audit trail evidence rather than a log file.

resource "google_storage_bucket_iam_member" "node_audit_writer" {
  for_each = var.directory_nodes
  bucket   = google_storage_bucket.node_audit[each.key].name
  role     = "roles/storage.objectCreator"
  member   = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}

resource "google_storage_bucket_iam_member" "node_backups_writer" {
  for_each = var.directory_nodes
  bucket   = google_storage_bucket.node_backups[each.key].name
  role     = "roles/storage.objectCreator"
  member   = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}

# The node PUBLISHES the manifest as well as polling it, so it needs write on its OWN bucket.
#
# The grant below this one is commented "read — and only read", and that was true when the manifest
# was written by something else. It is not true now: the directory writes it, and without this the
# node logs `relay.manifest.update.failed` 403 `storage.objects.create` every cycle while the
# manifest goes stale and peers fall back to `relay.pool.unavailable`. Live 2026-08-08 on all three
# nodes — a permission gap that presents as a relay-availability problem, several layers away.
#
# objectAdmin rather than objectCreator: the manifest is a SINGLE object rewritten in place, and
# overwriting an existing GCS object requires storage.objects.delete alongside create. objectCreator
# alone fails on the second write, which is the worst shape — it works once, at bootstrap, and then
# silently stops. Versioning on this bucket keeps every superseded manifest, so "delete" archives
# rather than destroys.
#
# The audit and backup buckets keep objectCreator deliberately (see above): those are append-only
# evidence and a node must never be able to rewrite its own trail. The manifest is operational state,
# not evidence — the asymmetry is the point, do not "tidy" the three grants into one.
resource "google_storage_bucket_iam_member" "relay_manifest_writer" {
  for_each = var.directory_nodes
  bucket   = google_storage_bucket.relay_manifest[each.key].name
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}

# The manifest is polled every 120s, so the node needs read — and only read.
resource "google_storage_bucket_iam_member" "relay_manifest_reader" {
  for_each = var.directory_nodes
  bucket   = google_storage_bucket.relay_manifest[each.key].name
  role     = "roles/storage.objectViewer"
  member   = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}

# objectViewer grants storage.objects.* but NOT storage.buckets.get, and the provider needs the
# latter: GCS returns 404 for a missing BUCKET exactly as it does for a missing OBJECT (unlike S3,
# which distinguishes NoSuchBucket from NoSuchKey). GcsCloudStorageProvider therefore probes
# bucket.exists() on a 404, because returning "not found" for a mistyped bucket would report a
# config error as "no manifest published yet" — a state the relay-pool loader treats as benign and
# never retries. bucketViewer is the minimal role carrying that permission
# (storage.buckets.get + list); it grants nothing over objects.
resource "google_storage_bucket_iam_member" "relay_manifest_bucket_reader" {
  for_each = var.directory_nodes
  bucket   = google_storage_bucket.relay_manifest[each.key].name
  role     = "roles/storage.bucketViewer"
  member   = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}
