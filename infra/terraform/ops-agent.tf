// ─────────────────────────────────────────────────────────────────────────────────────────────
// The operations agent on GCP.
//
// WHY THIS IS NOT OPTIONAL AT LAUNCH. Registering an agent requires a pre-authorization capability,
// which every directory verifies independently against the pinned issuer key. The ops agent's
// Telegram bot is the ONLY thing that issues one to a human — the portal does not. Without it a new
// operator cannot register at all, which breaks the "a friend's agent connects to yours" story that
// is the point of the product. Everything else it does (health, migration drift) is monitoring.
//
// CLOUD RUN WITH AN INSTANCE ALWAYS RUNNING. Unlike the portal, this is not request/response: the
// Telegram adapter long-polls getUpdates, so it needs a process that exists between requests.
// min_instance_count = 1 with CPU always allocated buys that without a VM to patch. It is the one
// service here that deliberately does NOT scale to zero.
//
// THE RESIDUAL AWS DEPENDENCY, STATED PLAINLY: OTP delivery still goes through SES, using static
// credentials that work from anywhere. SES is not part of the hibernation teardown, so this keeps
// working — but it IS a live AWS dependency in a system that is otherwise off AWS, and it must be
// replaced before that account is closed. Rewriting email delivery was not worth blocking
// registration on.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Which directory the ops agent calls to mint capabilities. Any validator can: the capability is
// signed with the pre-auth issuer key that every node holds, and verification is stateless, so this
// is not a special node — it is simply the nearest one, in the same region as this service.
locals {
  ops_agent_node = "us-east1"
}

// The node's connection string, assembled from the same values secrets.tf gives the node itself
// rather than re-derived. The ops agent reads the schema version to detect migration drift, so it
// needs the admin credentials the migrations run as, not the RLS-constrained app role.
resource "google_secret_manager_secret" "ops_agent_database_url" {
  project   = var.project_id
  secret_id = "cello-ops-agent-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "ops_agent_database_url" {
  secret = google_secret_manager_secret.ops_agent_database_url.id
  secret_data = format(
    "postgresql://%s:%s@%s:5432/%s",
    google_sql_user.admin[local.ops_agent_node].name,
    random_password.db_admin[local.ops_agent_node].result,
    google_compute_address.sql_psc[local.ops_agent_node].address,
    google_sql_database.cello[local.ops_agent_node].name,
  )
}

// One grant per secret, never project-level — the same rule the nodes follow.
resource "google_secret_manager_secret_iam_member" "ops_agent_secrets" {
  for_each = toset([
    google_secret_manager_secret.ops_agent_database_url.secret_id,
    "cello-ops-agent-telegram-bot-token",
    "cello-ops-agent-ses-credentials",
    "cello-${var.directory_nodes[local.ops_agent_node].node_id}-internal-api-key",
  ])
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["ops-agent"].email}"
}

resource "google_cloud_run_v2_service" "ops_agent" {
  name     = "cello-ops-agent"
  project  = var.project_id
  location = "us-east1"
  // No public surface. It reaches OUT to Telegram; nothing needs to reach in. The health endpoint is
  // for us, and internal ingress still permits it from inside the VPC.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  deletion_protection = false

  template {
    service_account = google_service_account.workload["ops-agent"].email

    // Both the directory internal API (8081) and Cloud SQL over PSC are private addresses, so this
    // service joins the VPC. PRIVATE_RANGES_ONLY keeps Telegram and SES traffic on ordinary egress,
    // which needs no NAT.
    vpc_access {
      network_interfaces {
        network    = google_compute_network.cello_vpc.id
        subnetwork = google_compute_subnetwork.regional["us-east1"].id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    // ALWAYS ONE. A long-polling bot that scales to zero stops answering, and an operator waiting on
    // a registration token has no way to tell that from the bot being broken. max 1 as well: two
    // instances would both poll getUpdates and race for the same update.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev/${var.project_id}/cello/ops-agent:${var.ops_agent_image_tag}"

      resources {
        // CPU stays allocated between requests — without this the poll loop is throttled to a stop
        // the moment a request finishes, and the bot goes deaf while looking healthy.
        cpu_idle = false
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 8080
      }

      env {
        name  = "CELLO_ENV"
        value = var.environment
      }

      env {
        name  = "DIRECTORY_INTERNAL_URL"
        value = "http://${google_compute_address.node_internal[local.ops_agent_node].address}:8081"
      }

      env {
        name = "DIRECTORY_API_KEY"
        value_source {
          secret_key_ref {
            secret  = "cello-${var.directory_nodes[local.ops_agent_node].node_id}-internal-api-key"
            version = "latest"
          }
        }
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ops_agent_database_url.secret_id
            version = "latest"
          }
        }
      }

      // The schema version this build expects. A mismatch is a crash on purpose: an ops agent
      // reporting health against a schema it does not understand is worse than one that is down.
      env {
        name  = "EXPECTED_MIGRATION_VERSION"
        value = var.ops_agent_expected_migration_version
      }

      env {
        name = "TELEGRAM_BOT_TOKEN"
        value_source {
          secret_key_ref {
            secret  = "cello-ops-agent-telegram-bot-token"
            version = "latest"
          }
        }
      }

      env {
        name = "SES_CREDENTIALS"
        value_source {
          secret_key_ref {
            secret  = "cello-ops-agent-ses-credentials"
            version = "latest"
          }
        }
      }

      env {
        name  = "SES_FROM_ADDRESS"
        value = var.ops_agent_ses_from_address
      }

      // AWS_DEFAULT_REGION, not AWS_REGION: the latter is reserved in some runtimes and setting it as
      // a custom variable has bitten this project before. This only steers the SES client.
      env {
        name  = "AWS_DEFAULT_REGION"
        value = "us-east-1"
      }

      startup_probe {
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 30
        tcp_socket {
          port = 8080
        }
      }
    }
  }
}

variable "ops_agent_image_tag" {
  type        = string
  description = "Immutable image tag (commit SHA) for the operations agent."
}

variable "ops_agent_expected_migration_version" {
  type        = string
  default     = "56"
  description = "Schema version the ops agent asserts. Bump with every new V{N} migration — a stale value crash-loops it on a fresh deploy."
}

variable "ops_agent_ses_from_address" {
  type        = string
  default     = "CELLO <noreply@cello.mygentic.ai>"
  description = "From address for OTP mail. SES is the residual AWS dependency; see the header of this file."
}

output "ops_agent_url" {
  value       = google_cloud_run_v2_service.ops_agent.uri
  description = "Internal-only URL for the operations agent."
}
