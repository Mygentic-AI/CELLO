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
  # Roles every directory node needs. The SA itself is PER NODE (below) — see the comment there
  # for why a shared one defeats the whole topology.
  directory_node_roles = [
    "roles/cloudsql.client",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ]

  directory_node_role_pairs = flatten([
    for region, node in var.directory_nodes : [
      for role in local.directory_node_roles : {
        key    = "${region}--${role}"
        region = region
        role   = role
      }
    ]
  ])

  workload_sas = {
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

# ── One service account PER DIRECTORY NODE ───────────────────────────────────────────────────
#
# NOT one shared `directory-node` SA. Every per-node grant in secrets.tf, kms.tf and storage.tf is
# for_each'd over var.directory_nodes, so with a single principal the resources are per-node while
# the ACCESS is not: the moment a second region exists, the VM in region B holds secretAccessor on
# region A's transport key, node key and database password, and cryptoKeyEncrypterDecrypter on
# region A's envelope key. That is one host able to unwrap every other node's shares — precisely
# the single point of failure the sovereign-node topology exists to remove, reached despite every
# key being correctly per-node.
#
# Invisible at N=1 and automatic at N=2, which is why it is fixed before the second region rather
# than after.
resource "google_service_account" "directory_node" {
  for_each     = var.directory_nodes
  project      = var.project_id
  account_id   = "cello-dir-${each.value.node_id}"
  display_name = "CELLO directory node ${each.value.node_id}"
}

resource "google_project_iam_member" "directory_node" {
  for_each = { for p in local.directory_node_role_pairs : p.key => p }
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.directory_node[each.value.region].email}"
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

# 2nd-gen GitHub connections: the P4SA manages the connection's OAuth token as a Secret Manager
# secret. Scoped to THAT SECRET, not the project.
#
# It previously held project-level `secretmanager.admin`, which is strictly stronger than
# secretAccessor and covers every secret in the project — so as soon as this project gained node
# secrets, CI could read every node's transport key, node key and database password. That also
# defeated the tfstate argument in secrets.tf: CI is deliberately scoped away from the state
# bucket, and reached the same key material through the front door.
resource "google_secret_manager_secret_iam_member" "cloudbuild_p4sa_github_token" {
  project   = var.project_id
  secret_id = "cello-github-github-oauthtoken-c3e205"
  role      = "roles/secretmanager.admin"
  member    = "serviceAccount:service-${data.google_project.cello_infra.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}
