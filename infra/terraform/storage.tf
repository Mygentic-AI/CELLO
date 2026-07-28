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
  for_each                    = var.directory_nodes
  name                        = "cello-backups-${each.value.node_id}"
  project                     = var.project_id
  location                    = upper(each.key)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # The node's key shares exist only in its database, so a backup is the only recovery path.
  # 30 days of dumps, then age out — long enough to notice corruption, short enough to bound cost.
  lifecycle_rule {
    condition {
      age = 30
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
  member   = "serviceAccount:${google_service_account.workload["directory-node"].email}"
}

resource "google_storage_bucket_iam_member" "node_backups_writer" {
  for_each = var.directory_nodes
  bucket   = google_storage_bucket.node_backups[each.key].name
  role     = "roles/storage.objectCreator"
  member   = "serviceAccount:${google_service_account.workload["directory-node"].email}"
}

# The manifest is polled every 120s, so the node needs read — and only read.
resource "google_storage_bucket_iam_member" "relay_manifest_reader" {
  for_each = var.directory_nodes
  bucket   = google_storage_bucket.relay_manifest[each.key].name
  role     = "roles/storage.objectViewer"
  member   = "serviceAccount:${google_service_account.workload["directory-node"].email}"
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
  member   = "serviceAccount:${google_service_account.workload["directory-node"].email}"
}
