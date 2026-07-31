// The waitlist service (DOD-GCP-RUNTIME-1) — the M11 waitlist, off AWS.
//
// ONE Cloud Run service carrying all thirteen handlers, replacing 13 Lambda
// functions, an API Gateway, 4 EventBridge rules, an SNS subscription and a NAT
// gateway. The handlers are unmodified; `_router`/`_app` are the entry layer
// that API Gateway used to be.
//
// IT SHARES THE PORTAL'S DATABASE, and that is a decision rather than an
// accident (M11-D35, and DOD-INV-SINGLE-DB before it): all M11 database work
// targets the portal instance and no new database is provisioned. The waitlist
// tables live alongside the portal's in `cello_portal`, sharing one
// `schema_migrations` ledger keyed on the full filename stem — 11 portal rows,
// 26 waitlist rows, and 4 more when the ops dashboard lands.
//
// SES STAYS ON AWS. Google has no email-sending service. The ops-agent already
// calls SES from GCP with static credentials and that pattern is proven, so the
// waitlist reuses the same secret rather than inventing a second path.

// ─── the service's own credentials ──────────────────────────────────────────

// The shared token for the internal surface: the eight handlers that were never
// publicly reachable on AWS. Five had no trigger at all (IAM-gated invoke only)
// and three were EventBridge-driven. `waitlist-waves` opens a wave and mints
// admission tokens, `waitlist-gate` burns one, `waitlist-firstwin` mints three
// premium invite codes — none of that may be reachable by an unauthenticated
// POST, and `internal_invoke` refuses when this is absent rather than admitting.
resource "random_password" "waitlist_internal_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "waitlist_internal_token" {
  project   = var.project_id
  secret_id = "cello-waitlist-internal-token"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "waitlist_internal_token" {
  secret      = google_secret_manager_secret.waitlist_internal_token.id
  secret_data = random_password.waitlist_internal_token.result
}

// Per-secret, per-workload. Three need it: the service checks a presented token,
// and the scheduler and the ops-agent each present one — the ops-agent because
// the Telegram gate is one of the eight handlers on the internal surface.
resource "google_secret_manager_secret_iam_member" "waitlist_internal_token" {
  for_each = toset(["waitlist", "waitlist-scheduler", "ops-agent"])

  project   = var.project_id
  secret_id = google_secret_manager_secret.waitlist_internal_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload[each.key].email}"
}

// The portal database URL, reused rather than re-derived — one connection
// string, one password, one place it can go stale.
resource "google_secret_manager_secret_iam_member" "waitlist_database_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.portal_database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["waitlist"].email}"
}

// SES, shared with the ops-agent. The same IAM user sends OTP mail for
// registration and waitlist mail; splitting them would mean two sets of static
// AWS keys to rotate, on an account that is otherwise being wound down.
resource "google_secret_manager_secret_iam_member" "waitlist_ses_credentials" {
  project   = var.project_id
  secret_id = "cello-ops-agent-ses-credentials"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["waitlist"].email}"
}

// ─── the service ────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "waitlist" {
  name     = "cello-waitlist"
  project  = var.project_id
  location = "us-east1"

  // Public by necessity: the signup form, the magic-link click and the gallery
  // are all reached by a browser with no account. Authorisation is the app's
  // (sessions, the internal token), never the network's.
  ingress = "INGRESS_TRAFFIC_ALL"

  // Stateless container Terraform must be able to replace. The DATABASE keeps
  // deletion_protection; this does not, and the asymmetry is the point.
  deletion_protection = false

  template {
    service_account = google_service_account.workload["waitlist"].email

    // NOT scale-to-zero, unlike the portal, and for one specific reason: the
    // email dispatcher runs on a one-minute schedule and the immediate-drain
    // nudge is a self-directed HTTP call. A cold start on every tick would add
    // seconds to exactly the sign-in link this system already spent effort
    // making fast. One warm instance is cheap; credits are not the constraint.
    scaling {
      min_instance_count = 1
      max_instance_count = 4
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.portal.connection_name]
      }
    }

    containers {
      image = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev/${var.project_id}/cello/waitlist:${var.waitlist_image_tag}"

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 8080
      }

      // Reaches the instance over the Cloud SQL unix socket, which is why the
      // secret's host is a /cloudsql path rather than an IP. `_dburl.py` prefers
      // DATABASE_URL over its Secrets Manager path, so no handler changed.
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.portal_database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "INTERNAL_INVOKE_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.waitlist_internal_token.secret_id
            version = "latest"
          }
        }
      }

      // Where the immediate-drain nudge posts. Self-directed: on AWS one Lambda
      // invoked another in the same account; here one path on this service
      // calls another. Absent, `nudge_dispatcher` logs
      // waitlist.email.nudge.unconfigured and the mail waits for the schedule —
      // degraded, never lost.
      env {
        name  = "WAITLIST_EMAIL_SERVICE_URL"
        value = "https://${var.waitlist_hostname}"
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
        name  = "SES_REGION"
        value = "us-east-1"
      }

      // FOUR VARIABLES THE CFN TEMPLATE SET AND THIS DID NOT, found by the
      // deployed service rather than by reading: the one-minute drain schedule
      // returned 500 on its first tick, and the exception boundary named
      // `RuntimeError` from waitlist-email. Transcribed from the Environment
      // block of cello-waitlist.yaml so the set is complete rather than the one
      // that happened to raise.
      //
      // WAITLIST_SES_CONFIG_SET is the one that raises — waitlist-email refuses
      // to send without it, correctly: the configuration set is what publishes
      // bounce and complaint events to SNS, and sending without it means
      // suppression silently never happens (DOD-INV-EMAIL-SUPPRESS). The
      // configuration set is an SES resource and SES stays on AWS; this name is
      // read from the live account, not invented.
      env {
        name  = "WAITLIST_SES_CONFIG_SET"
        value = "cello-waitlist-${var.environment}"
      }

      // The other three are quieter and worse: nothing raises. They build the
      // links inside every email — WAITLIST_SITE is the origin of the confirm
      // link, WAITLIST_API_BASE is the endpoint it calls. Absent, E1 goes out
      // carrying a broken confirmation URL, which is the most-clicked link in
      // the product and fails for the recipient, not for us.
      env {
        name  = "WAITLIST_SITE"
        value = "https://${var.waitlist_site_domain}"
      }

      env {
        name  = "WAITLIST_API_BASE"
        value = "https://${var.waitlist_site_domain}/api/waitlist"
      }

      env {
        name  = "WAITLIST_FROM_EMAIL"
        value = var.waitlist_from_email
      }

      env {
        name  = "CELLO_ENV"
        value = var.environment
      }

      // LIVENESS ONLY. /health returns 200 as soon as the process is up and
      // reaches no handler and no database — infra/CLAUDE.md's ECS rule applies
      // unchanged here. A readiness-gated check means the platform kills the
      // container while it waits for the dependency, forever.
      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 6
      }

      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds = 30
      }
    }
  }
}

// Public invoker. The service is a public API; its own code decides what is
// allowed, and the internal surface refuses without the shared token.
resource "google_cloud_run_v2_service_iam_member" "waitlist_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.waitlist.location
  name     = google_cloud_run_v2_service.waitlist.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

// ─── the schedules ──────────────────────────────────────────────────────────
//
// FOUR, matching the EventBridge rules in cello-waitlist.yaml exactly. Measured
// from the template rather than remembered — an earlier note said eight.
//
// The cron expressions are translated, not copied: EventBridge uses a 6-field
// AWS form (`cron(17 6 * * ? *)`) and Cloud Scheduler uses standard 5-field
// unix cron, so `? *` is dropped. Both are UTC here, which is set explicitly
// below because Cloud Scheduler otherwise defaults to the project's timezone
// and would silently move every sweep by several hours.
locals {
  waitlist_schedules = {
    email-drain = {
      description = "Drains email_jobs. Polls every minute."
      schedule    = "* * * * *"
      target      = "waitlist-email"
      body        = jsonencode({})
    }
    feedback-sweep = {
      description = "High-activity detection (§5c). Daily."
      schedule    = "17 6 * * *"
      target      = "waitlist-feedback"
      body        = jsonencode({})
    }
    re-engage-sweep = {
      description = "E-re 60-day re-engagement sweep. Daily, between the feedback and outreach sweeps."
      schedule    = "23 6 * * *"
      target      = "waitlist-email"
      // WITHOUT this action the daily rule would just drain the queue a second
      // time. The handler reads it off the TOP LEVEL of the payload, which is
      // why `_app` spreads the body rather than only wrapping it.
      body = jsonencode({ action = "sweep_re_engagement" })
    }
    outreach-sweep = {
      description = "Day-6 no-response invite grant. Daily, after the feedback sweep."
      schedule    = "47 6 * * *"
      target      = "waitlist-outreach"
      body        = jsonencode({})
    }
  }
}

resource "google_cloud_scheduler_job" "waitlist" {
  for_each = local.waitlist_schedules

  project     = var.project_id
  region      = "us-east1"
  name        = "cello-waitlist-${each.key}"
  description = each.value.description
  schedule    = each.value.schedule
  time_zone   = "Etc/UTC"

  // A schedule that silently stops is worse than one that fails loudly: the
  // only symptom of a dead sweep is mail that never arrives, noticed weeks
  // later. Retries make a transient 503 survivable.
  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "300s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.waitlist.uri}/internal/${each.value.target}"
    body        = base64encode(each.value.body)

    headers = {
      "Content-Type" = "application/json"
      // The application-level half. Cloud Scheduler cannot reference Secret
      // Manager from a header, so this is the generated value directly — which
      // is no weaker than it looks: the same string is already in Terraform
      // state, and state lives in the restricted bucket that CI cannot read.
      "X-Cello-Internal-Token" = random_password.waitlist_internal_token.result
    }

    // TWO layers, deliberately. OIDC proves to Cloud Run that the caller is
    // this scheduler; the shared token proves to the APPLICATION that the call
    // is internal. Dropping either would be defensible on its own and losing
    // both is what turns wave assembly into a public endpoint.
    oidc_token {
      service_account_email = google_service_account.workload["waitlist-scheduler"].email
      audience              = google_cloud_run_v2_service.waitlist.uri
    }
  }
}

output "waitlist_service_uri" {
  description = "The Cloud Run URL. Traffic arrives via api.cello.mygentic.ai (DOD-GCP-DOMAIN-1); this is for debugging, never for configuration — DOD-INV-DOMAIN forbids a run.app hostname anywhere."
  value       = google_cloud_run_v2_service.waitlist.uri
}
