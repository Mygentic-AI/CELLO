// The ops dashboard (DOD-GCP-OPS-1) — operations.cello.mygentic.ai.
//
// WHY THIS IS NOT OPTIONAL, since the M12 checklist first parked it. It owns
// DOD-INV-WAVE-GATE, DOD-WAVE-ASSEMBLY-1 and six DOD-OPS-* lines, and it is the
// ONLY caller of the waitlist's internal surface. Without it the waitlist runs
// and nobody can be admitted from it: no wave can open, no token can be minted,
// no post can be credited. A waitlist you cannot admit anyone from fails the
// launch-triage test outright.
//
// SEPARATE REPO, SEPARATE IMAGE, SHARED DATABASE. `Andre-Mygentic/cello-ops-dashboard`
// is a cello-portal clone with WebAuthn, TOTP, trust signals and the directory
// client stripped (M11-D7). It reaches the same `cello_portal` Cloud SQL as the
// portal and the waitlist — DOD-INV-SINGLE-DB — and applies its own four
// `ops_*` migrations into the shared ledger at container start. The prefix is
// what makes sharing safe: 11 portal + 26 waitlist + 4 ops = 41 rows, no
// collisions, because the ledger keys on the full filename stem.

resource "google_service_account" "ops_dashboard" {
  account_id   = "cello-ops-dashboard"
  display_name = "CELLO ops dashboard"
  project      = var.project_id
}

resource "google_project_iam_member" "ops_dashboard" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ops_dashboard.email}"
}

// ─── the allowlist ──────────────────────────────────────────────────────────
//
// THE ONLY ACCESS CONTROL THE DASHBOARD HAS (M11 §10). A static list in Secret
// Manager rather than a database table, because an operator who can edit the
// operator list from inside the app is not an access control — adding someone
// has to be a deliberate act outside the system.
//
// READ AT RUNTIME, not injected as an env var, and the application depends on
// that: its 60-second cache exists so REMOVING an operator takes effect in a
// minute rather than at the next deploy. Injecting it would quietly turn
// revocation into "whenever the instance restarts".
resource "google_secret_manager_secret" "ops_allowed_emails" {
  project   = var.project_id
  secret_id = "cello-ops-allowed-emails"
  replication {
    auto {}
  }
}

// SEEDED WITH ANDRE'S ADDRESS, and that is a real decision rather than a
// placeholder. An empty list is the correct FAIL-CLOSED default and it is also
// a dashboard nobody can sign into — so the choice is between unusable and
// naming the sole operator. He is the only person who operates this today. Add
// anyone else by adding a secret VERSION, never by editing this resource, so the
// change is an act with an audit trail rather than a Terraform diff.
//
// `ignore_changes` for exactly that reason: once a human has added an operator
// out of band, an apply must not silently reset the list back to one entry.
resource "google_secret_manager_secret_version" "ops_allowed_emails" {
  secret      = google_secret_manager_secret.ops_allowed_emails.id
  secret_data = jsonencode([var.ops_dashboard_operator_email])

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "ops_allowed_emails" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.ops_allowed_emails.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ops_dashboard.email}"
}

// Shared with the portal and the waitlist: one connection string, one password.
resource "google_secret_manager_secret_iam_member" "ops_dashboard_database_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.portal_database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ops_dashboard.email}"
}

// The internal token, to drive wave assembly and the rest.
resource "google_secret_manager_secret_iam_member" "ops_dashboard_internal_token" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.waitlist_internal_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ops_dashboard.email}"
}

// SES, for the operator sign-in link. Same static credentials as everything
// else that sends mail from GCP.
resource "google_secret_manager_secret_iam_member" "ops_dashboard_ses" {
  project   = var.project_id
  secret_id = "cello-ops-agent-ses-credentials"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ops_dashboard.email}"
}

// ─── the service ────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "ops_dashboard" {
  name     = "cello-ops-dashboard"
  project  = var.project_id
  location = "us-east1"

  // Public ingress, allowlist auth. The sign-in page has to be reachable from
  // wherever Andre is; the allowlist and the 8-hour session are the control,
  // and the no-enumeration property means an unknown address learns nothing.
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.ops_dashboard.email

    // SCALE TO ZERO, unlike the waitlist. Nothing polls this and no schedule
    // calls it — it is a page one person opens a few times a day, so a cold
    // start is a page load rather than a missed tick.
    //
    // MAX 1, and that is not a cost decision. The sign-in send is
    // fire-and-forget (it is what makes the no-enumeration timing hold), and
    // migrations run at container start; a second instance starting under load
    // would race the first through `scripts/migrate.mjs`. One instance makes
    // both trivially safe.
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.portal.connection_name]
      }
    }

    containers {
      image = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev/${var.project_id}/cello/ops-dashboard:${var.ops_dashboard_image_tag}"

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 3000
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.portal_database_url.secret_id
            version = "latest"
          }
        }
      }

      // The origin sign-in links are built against. NEVER derived from a
      // request: a Host header is attacker-controlled, and reflecting it into a
      // link mails a real operator a credential pointing at a host somebody
      // else controls.
      env {
        name  = "OPS_PUBLIC_URL"
        value = "https://${var.ops_dashboard_hostname}"
      }

      // The project and the secret NAME, not the secret's value — the app reads
      // it at runtime so revocation is a minute, not a deploy.
      env {
        name  = "OPS_GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "OPS_ALLOWLIST_SECRET_ID"
        value = google_secret_manager_secret.ops_allowed_emails.secret_id
      }

      env {
        name  = "OPS_WAITLIST_SERVICE_URL"
        value = "https://${var.waitlist_hostname}"
      }

      env {
        name = "OPS_WAITLIST_INTERNAL_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.waitlist_internal_token.secret_id
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
        name  = "OPS_AWS_REGION"
        value = "us-east-1"
      }

      env {
        name  = "CELLO_ENV"
        value = var.environment
      }

      // NOT A DOWNGRADE, and it is required rather than optional here.
      //
      // db.ts and scripts/migrate.mjs default to `ssl: { rejectUnauthorized: true }`
      // because on AWS they dialled an RDS endpoint over the network. Cloud Run
      // reaches Cloud SQL over a UNIX SOCKET inside the instance sandbox, and the
      // Cloud SQL connector holds the encrypted hop to the database — there is no
      // network leg for this flag to weaken.
      //
      // The waitlist needs no equivalent because libpq silently ignores sslmode on
      // a unix socket; node-postgres does not, and attempts an SSL negotiation the
      // socket cannot answer. The container therefore exited 1 with
      // `[migrate] FAILED: The server does not support SSL connections` and Cloud
      // Run reported only "failed to start and listen on PORT" — the useful half
      // was in the container log, not the deploy error.
      env {
        name  = "PGSSLMODE"
        value = "disable"
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "ops_dashboard_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.ops_dashboard.location
  name     = google_cloud_run_v2_service.ops_dashboard.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "ops_dashboard_service_uri" {
  description = "Cloud Run URL. Debugging only — DOD-INV-DOMAIN forbids a run.app hostname in code, copy or configuration, and the invariant scanner denies it."
  value       = google_cloud_run_v2_service.ops_dashboard.uri
}
