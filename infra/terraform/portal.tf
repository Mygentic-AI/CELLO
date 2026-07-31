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

    // DIRECT VPC EGRESS. The directories' internal API (8081) is deliberately absent from every
    // public firewall rule — it is the portal's account-scoped seam and the path the kill switch runs
    // through. So the portal joins the VPC rather than the API being exposed to reach it.
    // PRIVATE_RANGES_ONLY: only RFC1918 traffic takes this path, so ordinary egress (OAuth, SES) still
    // goes straight out and does not need a NAT.
    vpc_access {
      network_interfaces {
        network    = google_compute_network.cello_vpc.id
        subnetwork = google_compute_subnetwork.regional["us-east1"].id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

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
      // The INTERNAL address and the INTERNAL API port. 9090 is the health port and does not serve
      // these routes — pointing here at 9090 produced a uniform 404 that looked like a missing
      // endpoint rather than a wrong port.
      env {
        name  = "DIRECTORY_API_URLS"
        value = join(",", [for k, n in var.directory_nodes : "http://${google_compute_address.node_internal[k].address}:8081"])
      }

      // One key per url, SAME ORDER. Each directory holds its own internal API key, so a single key
      // would authenticate to at most one of them and failover would fail over to nodes that reject
      // it. The portal validates the counts match rather than pairing them off.
      env {
        name = "DIRECTORY_API_KEYS"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.portal_directory_api_keys.secret_id
            version = "latest"
          }
        }
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

      // The portal keeps the hostname it had on AWS. That is not sentiment: the GitHub OAuth app's
      // callback is registered against it, and WEBAUTHN_RP_ID is part of what a passkey is bound to —
      // change the host and every existing passkey stops working, permanently. Keeping the name makes
      // the move a DNS change instead of a re-registration for every operator.
      env {
        name  = "PORTAL_BASE_URL"
        value = "https://${var.portal_hostname}"
      }

      env {
        name  = "WEBAUTHN_ORIGIN"
        value = "https://${var.portal_hostname}"
      }

      env {
        name  = "WEBAUTHN_RP_ID"
        value = var.portal_hostname
      }

      // Singular, for the paths that predate the failover list. Points at the same first node.
      env {
        name  = "DIRECTORY_API_URL"
        value = "http://${google_compute_address.node_internal[keys(var.directory_nodes)[0]].address}:8081"
      }

      env {
        name  = "PORTAL_DIRECTORY_BASE_URL"
        value = "http://${google_compute_address.node_internal[keys(var.directory_nodes)[0]].address}:8081"
      }

      // Cloud KMS, not AWS KMS. Set here so the signer selection is a deployment fact rather than a
      // compiled-in choice; the version is pinned because a rotation needs re-enrolment on every
      // directory and must therefore be deliberate.
      env {
        name  = "PORTAL_GCP_KMS_KEY"
        value = "${google_kms_crypto_key.portal_submission.id}/cryptoKeyVersions/1"
      }

      env {
        name = "GITHUB_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = "cello-portal-github-client-id"
            version = "latest"
          }
        }
      }

      env {
        name = "GITHUB_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = "cello-portal-github-client-secret"
            version = "latest"
          }
        }
      }

      // The intake key. Carried over from AWS rather than regenerated, because the consortium manifest
      // clients already trust was signed with its public half — a fresh key here would invalidate
      // every endorsement path against manifests already in the wild.
      env {
        name = "PORTAL_INTAKE_SEEDS"
        value_source {
          secret_key_ref {
            secret  = "cello-portal-intake-key-0"
            version = "latest"
          }
        }
      }

      env {
        name = "PORTAL_INGRESS_TRIGGER_SECRET"
        value_source {
          secret_key_ref {
            secret  = "cello-portal-ingress-trigger-secret"
            version = "latest"
          }
        }
      }

      // Only reached when env is `local`; carried so a local run against these secrets behaves the
      // same way, and so the variable is not silently absent if the signer selection ever changes.
      env {
        name = "PORTAL_SUBMISSION_SEED"
        value_source {
          secret_key_ref {
            secret  = "cello-portal-submission-seed"
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

// The three internal API keys as ONE positional list, in the SAME iteration order as
// DIRECTORY_API_URLS above — both use `var.directory_nodes`, so the pairing holds.
//
// Composed here from the generated values rather than read back from Secret Manager: the keys already
// exist in state (secrets.tf mints them), so a data source would add a dependency and a round trip to
// learn something Terraform already knows. The portal refuses a length mismatch, so a node added
// without a key here fails loudly at boot instead of silently losing failover to that node.
resource "google_secret_manager_secret" "portal_directory_api_keys" {
  project   = var.project_id
  secret_id = "cello-portal-directory-api-keys"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "portal_directory_api_keys" {
  secret = google_secret_manager_secret.portal_directory_api_keys.id
  secret_data = join(",", [
    for k, n in var.directory_nodes : random_id.node_secret["${n.node_id}--internal-api-key"].hex
  ])
}

resource "google_secret_manager_secret_iam_member" "portal_directory_api_keys" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.portal_directory_api_keys.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["portal"].email}"
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The portal's SIGNING key (M10-D6), on Cloud KMS.
//
// Every trust-signal submission and every directory query the portal makes is signed with an Ed25519
// key whose public half is enrolled in each directory's `authorized_issuers`. On AWS the private half
// lived in KMS and signing was an API call, so the running task carried no key material. Cloud KMS
// supports the same key type, so that property moves with the portal instead of being traded for a
// seed in an environment variable.
//
// This is necessarily a NEW key: KMS private material is non-exportable by design, on either cloud.
// That costs nothing here because the GCP directories start with empty databases — the public half is
// enrolled fresh rather than migrated.
// ─────────────────────────────────────────────────────────────────────────────────────────────

resource "google_kms_key_ring" "portal" {
  name     = "cello-portal"
  project  = var.project_id
  location = "us-east1"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "portal_submission" {
  name     = "portal-submission"
  key_ring = google_kms_key_ring.portal.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_ED25519"
    protection_level = "SOFTWARE"
  }

  // Rotation is deliberately absent. A new version would sign with a key nobody has enrolled, so
  // every signature would be refused by every directory until the new public half is registered on
  // each one. Rotation here is a coordinated act, not a schedule.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "portal_sign" {
  crypto_key_id = google_kms_crypto_key.portal_submission.id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${google_service_account.workload["portal"].email}"
}

// Separate from signing: reading the public key is what enrolment and verification need, and it is
// the half an operator may want to grant on its own.
resource "google_kms_crypto_key_iam_member" "portal_pubkey" {
  crypto_key_id = google_kms_crypto_key.portal_submission.id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${google_service_account.workload["portal"].email}"
}

output "portal_submission_key_version" {
  value       = "${google_kms_crypto_key.portal_submission.id}/cryptoKeyVersions/1"
  description = "The portal's Ed25519 signing key version — its public half must be enrolled in every directory's authorized_issuers."
}

// The portal keeps its AWS hostname — see PORTAL_BASE_URL above for why changing it is not free.
variable "portal_hostname" {
  type        = string
  default     = "portal.cello.mygentic.ai"
  description = "Public hostname for the portal. The GitHub OAuth callback and every registered passkey are bound to this value."
}

// The five secrets copied from AWS need an accessor grant each; without it the revision fails to start
// with a permission error on the secret rather than anything resembling a config problem.
resource "google_secret_manager_secret_iam_member" "portal_copied" {
  for_each = toset([
    "cello-portal-github-client-id",
    "cello-portal-github-client-secret",
    "cello-portal-intake-key-0",
    "cello-portal-ingress-trigger-secret",
    "cello-portal-submission-seed",
  ])
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["portal"].email}"
}
