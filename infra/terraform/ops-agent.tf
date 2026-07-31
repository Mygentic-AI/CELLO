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
// rather than re-derived.
//
// `cello_ops_agent` — the role built for exactly this, by V26, and neither of the two roles this
// file reached for first.
//
// The `postgres` owner was wrong: it bypasses every RLS policy (no table declares FORCE ROW LEVEL
// SECURITY) and the REVOKE never applied to it, so it would leave `conversation_seals`,
// `attestations` and `agent_key_shares` freely mutable by a process that has no business touching
// them. `cello_service` was also wrong, and only probing BOTH tables showed it: it can write
// `registrations` but has no rights at all on `channel_identities`, so registration would have
// failed at the step that records the operator's channel identity — a failure that would only have
// appeared when a real person tried to register.
//
// Privileges verified directly against the live database with has_table_privilege, not inferred:
//   cello_ops_agent → registrations INSERT ✓, channel_identities INSERT ✓, flyway_schema_history ✗
// V57 grants that last read (SELECT only), mirroring what V50 did for cello_service.
// The role itself exists in every node database (V26 creates it idempotently); what it lacks on
// Cloud SQL is a password it can log in with. This sets one without touching its grants.
resource "random_password" "ops_agent_db" {
  length  = 32
  special = false
}

resource "google_sql_user" "ops_agent" {
  name     = "cello_ops_agent"
  project  = var.project_id
  instance = google_sql_database_instance.node[local.ops_agent_node].name
  password = random_password.ops_agent_db.result
}

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
    google_sql_user.ops_agent.name,
    random_password.ops_agent_db.result,
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
    // The schema this revision was built to expect. Cloud Run keys a new revision off any template
    // change, so tying the label to the migration version means a schema bump always produces a
    // FRESH revision rather than reusing one that failed against the old schema and was given up on.
    // It is also the first thing worth knowing when a revision refuses to start.
    labels = {
      "expected-schema" = var.ops_agent_expected_migration_version
    }

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

      // EVERY node's health endpoint, not just the one it talks to. Each sovereign directory runs
      // its own Flyway, so schema correctness is a per-node fact — a node a migration behind keeps
      // accepting writes and diverges quietly. Reading /health avoids holding admin credentials for
      // every node's database, which would be a standing cross-node privilege in a system built to
      // have none. Internal addresses on 9090; a degraded sweep is reported, never a startup gate.
      env {
        name  = "DIRECTORY_HEALTH_URLS"
        value = join(",", [for k, n in var.directory_nodes : "http://${google_compute_address.node_internal[k].address}:9090"])
      }

      // The waitlist gate is an AWS Lambda backed by the portal RDS. With AWS hibernated it cannot
      // answer, and it fails CLOSED — correctly — which refuses every registration. The waitlist is
      // empty and unlaunched, so admission-gating it protects nothing while blocking the only
      // person who needs to register.
      //
      // REMOVE THIS when the waitlist ports to GCP (cutover item C). It is an explicit opt-out:
      // absent or any other value leaves the gate ON, and the agent warns on every boot while it is
      // off, so this cannot become the silent default.
      env {
        name  = "WAITLIST_GATE"
        value = "disabled"
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
  default     = "57"
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


// The two secrets carried over from AWS Secrets Manager. DECLARED here rather than only referenced:
// without these resources they exist solely because a human ran `gcloud secrets create`, the
// region-expansion test fails ("would this work in a brand-new project with zero manual steps?"),
// and nothing records where their values came from.
//
// `ignore_changes` on the version, because the VALUE is not ours to generate — the bot token comes
// from BotFather and the SES pair from an AWS IAM user. Terraform owns the secret's existence and
// its access policy; a human owns the contents. Without the ignore, every apply would fight whatever
// version is actually in place.
resource "google_secret_manager_secret" "ops_agent_carried" {
  for_each  = toset(["cello-ops-agent-telegram-bot-token", "cello-ops-agent-ses-credentials"])
  project   = var.project_id
  secret_id = each.value
  replication {
    auto {}
  }
  lifecycle {
    prevent_destroy = true
  }
}
