# Per-workload service accounts (DOD-GCP-IAM-1).
#
# Org constraints (enforced, see infra/GCP-STATE.md): SA keys cannot be created or uploaded,
# and default service accounts get zero automatic grants. So every workload runs as its own SA
# attached to its compute resource, and every permission below is the explicit, minimal,
# project-level floor. Resource-scoped bindings (a specific bucket, a specific secret) replace
# project-level ones as those resources come into existence — tightening is expected, widening
# needs a journal entry.

locals {
  workload_sas = {
    directory-node = {
      display_name = "CELLO directory node"
      roles = [
        "roles/secretmanager.secretAccessor",
        "roles/cloudsql.client",
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
      ]
    }
    relay-node = {
      display_name = "CELLO relay node"
      roles = [
        "roles/secretmanager.secretAccessor",
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
      ]
    }
    ops-agent = {
      display_name = "CELLO ops agent"
      roles = [
        "roles/secretmanager.secretAccessor",
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
      ]
    }
    portal = {
      display_name = "CELLO portal"
      roles = [
        "roles/secretmanager.secretAccessor",
        "roles/cloudsql.client",
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
      ]
    }
    cloud-build = {
      display_name = "CELLO CI (Cloud Build)"
      roles = [
        "roles/artifactregistry.writer",
        "roles/logging.logWriter",
        "roles/storage.objectViewer",
      ]
    }
  }

  sa_role_pairs = flatten([
    for sa_key, sa in local.workload_sas : [
      for role in sa.roles : {
        key    = "${sa_key}--${role}"
        sa_key = sa_key
        role   = role
      }
    ]
  ])
}

resource "google_service_account" "workload" {
  for_each     = local.workload_sas
  project      = var.project_id
  account_id   = "cello-${each.key}"
  display_name = each.value.display_name
}

resource "google_project_iam_member" "workload" {
  for_each = { for p in local.sa_role_pairs : p.key => p }
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.workload[each.value.sa_key].email}"
}
