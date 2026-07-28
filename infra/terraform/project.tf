# The project itself was bootstrap-created with gcloud (2026-07-28, journal Entry 1) because
# Terraform needs a project to hold its own state bucket. Managed from here on as data + services.

data "google_project" "cello_infra" {
  project_id = var.project_id
}

locals {
  enabled_apis = [
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "serviceusage.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.enabled_apis)
  project  = var.project_id
  service  = each.value

  # Disabling an API tears down its resources; never do that implicitly via destroy.
  disable_on_destroy = false
}

# Terraform's own state bucket — bootstrap-created, imported so drift is visible.
# Holds every historical state version; never destroyable via TF, never publicly exposable.
resource "google_storage_bucket" "tfstate" {
  name                        = "cello-infra-tfstate"
  project                     = var.project_id
  location                    = "US-EAST1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
