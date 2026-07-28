# Per-workload service accounts (DOD-GCP-IAM-1).
#
# Org constraints (enforced, see infra/GCP-STATE.md): SA keys cannot be created or uploaded,
# and default service accounts get zero automatic grants. So every workload runs as its own SA
# attached to its compute resource, and every permission below is the explicit, minimal,
# project-level floor. Resource-scoped bindings (a specific bucket, a specific secret) replace
# project-level ones as those resources come into existence — tightening is expected, widening
# needs a journal entry.

locals {
  # Secret access is NEVER project-level: each secret grants its reader via
  # google_secret_manager_secret_iam_member in the unit that creates the secret. A missing
  # per-secret grant fails loud (403), which is the enforcement mechanism — a project-level
  # secretAccessor would let every workload read every other workload's key material and the
  # 403 that prompts tightening would never fire.
  workload_sas = {
    directory-node = {
      display_name = "CELLO directory node"
      roles = [
        "roles/cloudsql.client",
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
      ]
    }
    relay-node = {
      display_name = "CELLO relay node"
      roles = [
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
      ]
    }
    ops-agent = {
      display_name = "CELLO ops agent"
      roles = [
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
      ]
    }
    portal = {
      display_name = "CELLO portal"
      roles = [
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

# The org disables automatic role grants for service agents too — Cloud Build's P4SA arrives
# with nothing and cannot manage the GitHub-connection OAuth secret without its standard role.
resource "google_project_iam_member" "cloudbuild_service_agent" {
  project = var.project_id
  role    = "roles/cloudbuild.serviceAgent"
  member  = "serviceAccount:service-${data.google_project.cello_infra.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

# CI reads its build source from the staging bucket ONLY — bucket-scoped, never project-level,
# so the CI SA can never read the Terraform state bucket (which retains every historical state
# version and may transit sensitive values).
resource "google_storage_bucket_iam_member" "cloudbuild_staging_source" {
  bucket = "${var.project_id}_cloudbuild"
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.workload["cloud-build"].email}"
}

# 2nd-gen GitHub connections: the P4SA stores the OAuth token as a Secret Manager secret it
# creates itself — documented requirement is secretmanager.admin on the project for the P4SA.
resource "google_project_iam_member" "cloudbuild_p4sa_secret_admin" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:service-${data.google_project.cello_infra.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}
