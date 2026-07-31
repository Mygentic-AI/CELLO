// ─────────────────────────────────────────────────────────────────────────────────────────────
// DOD-MOVE-PORTAL-1 — the portal on GCP.
//
// The portal is the operator surface and the kill switch. Until it serves from GCP, the fleet is a
// protocol with no way for a person to manage an agent or pull the plug — which makes this the one
// remaining gap a first customer would actually hit.
//
// COUPLING CLAUSE, resolved: APP-FIRST with a NEW GCP database.
// The DoD required this be decided explicitly rather than drifted into. The portal's RDS also carries
// the M11 waitlist tables, and the waitlist Lambdas + SES hooks are AWS-native. Moving both at once
// would drag those along; the portal is useless without a database it can reach, and AWS is
// hibernating with credits nearly gone. So: the portal app and the portal's OWN schema move here; the
// waitlist stays behind and is migrated separately, or not at all. Nothing a customer touches depends
// on the waitlist tables.
//
// Cloud Run rather than a MIG: the portal is stateless request/response with no peer identity, no
// libp2p, no shares. The reasons directory nodes are VMs — a pinned transport key that IS the peer id,
// an anti-entropy dialer, a per-node database — none apply. Scale-to-zero also matters while credits
// are the binding constraint.
// ─────────────────────────────────────────────────────────────────────────────────────────────

resource "google_sql_database_instance" "portal" {
  name    = "cello-portal"
  project = var.project_id
  // us-east1 to sit beside the registry and the use1 node; the portal is not region-sovereign the way
  // a directory is — it is ONE service, not a consortium member, so there is nothing to distribute.
  region              = "us-east1"
  database_version    = "POSTGRES_17"
  deletion_protection = true

  settings {
    tier              = var.portal_db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 20
    disk_autoresize   = true
    edition           = "ENTERPRISE"

    ip_configuration {
      // PUBLIC IP, unlike the nodes — and deliberately, because Cloud Run reaches Cloud SQL through
      // the managed connector rather than from inside the VPC. `ipv4_enabled` here does not mean
      // "open": authorized_networks is empty, so nothing can dial it directly, and SSL is required.
      // The nodes stay PSC-only because their databases hold FROST shares; this one does not.
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "04:00"
      point_in_time_recovery_enabled = true
    }
  }
}

resource "google_sql_database" "portal" {
  name     = "cello_portal"
  project  = var.project_id
  instance = google_sql_database_instance.portal.name
}

// Generated here, never typed by a human and never committed. Same reasoning as the node credentials:
// tfstate lives in a bucket only Terraform can read, and CI has no access to it.
resource "random_password" "portal_db" {
  length  = 32
  special = false
}

resource "google_sql_user" "portal" {
  name     = "cello_portal"
  project  = var.project_id
  instance = google_sql_database_instance.portal.name
  password = random_password.portal_db.result
}

// The connection string the app reads. Assembled here so the password never leaves Secret Manager and
// the app needs exactly one secret rather than five env vars it has to reassemble correctly.
resource "google_secret_manager_secret" "portal_database_url" {
  project   = var.project_id
  secret_id = "cello-portal-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "portal_database_url" {
  secret = google_secret_manager_secret.portal_database_url.id
  // Cloud Run's Cloud SQL connector exposes the instance on a unix socket, so the host is a path.
  secret_data = format(
    "postgresql://%s:%s@localhost/%s?host=/cloudsql/%s",
    google_sql_user.portal.name,
    random_password.portal_db.result,
    google_sql_database.portal.name,
    google_sql_database_instance.portal.connection_name,
  )
}

resource "google_secret_manager_secret_iam_member" "portal_database_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.portal_database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["portal"].email}"
}

resource "google_cloud_run_v2_service" "portal" {
  name     = "cello-portal"
  project  = var.project_id
  location = "us-east1"
  // The portal is the public operator surface — it is MEANT to be reachable. Ingress is open; auth is
  // the app's own (GitHub OAuth), not the network's.
  ingress = "INGRESS_TRAFFIC_ALL"

  // OFF, deliberately, and the asymmetry with the database is the point: the Cloud SQL instance keeps
  // deletion_protection because losing it loses accounts, while this service is a stateless container
  // that Terraform must be able to replace. During a migration that is a property we want — a service
  // Terraform cannot recreate is one that has to be repaired by hand in the console.
  deletion_protection = false

  template {
    service_account = google_service_account.workload["portal"].email

    // Scale to zero. Credits are the binding constraint, and an idle operator surface should cost
    // nothing. Cold start is a page load, not a protocol timeout — no peer is waiting on it.
    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.portal.connection_name]
      }
    }

    containers {
      image = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev/${var.project_id}/cello/portal:${var.portal_image_tag}"

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 3000
      }

      env {
        name  = "CELLO_ENV"
        value = var.environment
      }

      // The GCP consortium, by public address. The portal talks to directories the same way any
      // client does — over their public API — so it needs no VPC path to them and stays deployable
      // anywhere.
      env {
        name  = "DIRECTORY_API_URLS"
        value = join(",", [for k, n in var.directory_nodes : "http://${google_compute_address.node[k].address}:9090"])
      }

      env {
        name = "PORTAL_KMS_MASTER_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.portal_kms_master_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "PORTAL_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.portal_database_url.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 20
        tcp_socket {
          port = 3000
        }
      }
    }
  }
}

// Public: the operator surface must be reachable without a Google account. The app authenticates its
// own users; requiring IAM here would lock out every customer.
resource "google_cloud_run_v2_service_iam_member" "portal_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.portal.location
  name     = google_cloud_run_v2_service.portal.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "portal_url" {
  value       = google_cloud_run_v2_service.portal.uri
  description = "The portal's Cloud Run URL — the operator surface, until a *.cello.mygentic.ai mapping is attached."
}

// The Cloud Run service agent must be able to PULL the portal image.
//
// Granted explicitly because this org strips every automatic service-agent grant — the same behaviour
// that forced explicit grants for Cloud Build's P4SA (see infra/GCP-STATE.md). The failure mode is
// worth naming: without this, `terraform apply` returns
// "Error code 7 … The service has encountered an internal error", which reads like a transient GCP
// fault and is actually PERMISSION_DENIED on the image pull.
data "google_project" "this" {
  project_id = var.project_id
}

resource "google_artifact_registry_repository_iam_member" "cloudrun_pull" {
  project    = var.project_id
  location   = google_artifact_registry_repository.cello.location
  repository = google_artifact_registry_repository.cello.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.this.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

// The portal's data-at-rest key (`PORTAL_KMS_MASTER_KEY`, 32 bytes / 64 hex).
//
// prevent_destroy because this key is not rotatable by accident: it decrypts the recoverable values
// the portal holds (the email the directory deliberately never sees — it stores hashes only). Lose it
// and that data is gone, with nothing to restore from.
//
// A NEW key, not the AWS one, and that is a consequence of the app-first decision above: the GCP
// database starts empty, so there is nothing here encrypted under the old key. If the AWS portal data
// is ever migrated, it must come with ITS key or be re-encrypted — copying rows without the key
// produces a database of unreadable ciphertext.
resource "random_id" "portal_kms_master_key" {
  byte_length = 32
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret" "portal_kms_master_key" {
  project   = var.project_id
  secret_id = "cello-portal-kms-master-key"
  replication {
    auto {}
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_version" "portal_kms_master_key" {
  secret      = google_secret_manager_secret.portal_kms_master_key.id
  secret_data = random_id.portal_kms_master_key.hex
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_iam_member" "portal_kms_master_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.portal_kms_master_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["portal"].email}"
}
