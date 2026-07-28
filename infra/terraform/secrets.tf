# Secret Manager — the boot secrets a GCP directory node fetches for itself
# (DOD-NODE-DIR-GCP-1; consumed by packages/directory/src/gcp-boot-env.ts).
#
# Why the node fetches rather than being injected: Container-Optimized OS takes container
# environment from instance metadata, and metadata is readable by anything holding
# compute.instances.get. Key material must not travel that way. The node reads these itself with
# the workload identity attached to its VM.
#
# GRANTS ARE PER-SECRET, NEVER PROJECT-LEVEL (iam.tf states the rule). A project-level
# secretAccessor would let any workload read any other's key material, and the 403 that forces
# tightening would never fire.
#
# EVERY VALUE IS PER-NODE AND GENERATED HERE, NEVER COPIED BETWEEN REGIONS. The transport key is
# the sharp case: a copied transport key means two nodes present the SAME libp2p peer id, which
# breaks the manifest-pinned identity check that the anti-entropy handshake depends on. Terraform's
# per-resource randomness makes copying impossible by construction, which is stronger than
# remembering to run `openssl rand -hex 32` once per region.
#
# TFSTATE EXPOSURE, STATED PLAINLY: these values live in the Terraform state object in
# gs://cello-infra-tfstate. That bucket is versioned, uniform-access, public-access-prevented, and
# the CI service account is deliberately scoped away from it (iam.tf). This is the accepted trade
# for DOD-INV-IAC's region-expansion test — a new region must come up with zero manual steps, and
# hand-populated secrets fail that test. Recorded in infra/GCP-STATE.md.

locals {
  # target env var suffix => how the value is produced. gcp-boot-env.ts maps CELLO_GSM_* reference
  # variables to the node's real env vars; this map is the other end of that contract.
  node_secret_names = ["node-key", "transport-key", "internal-api-key", "preauth-issuer-key"]

  node_secret_pairs = flatten([
    for region, node in var.directory_nodes : [
      for name in local.node_secret_names : {
        key     = "${node.node_id}--${name}"
        region  = region
        node_id = node.node_id
        name    = name
      }
    ]
  ])
}

# 32 bytes of randomness, rendered hex — the shape every one of these takes:
# an Ed25519 seed (node key, pre-auth issuer key), a libp2p transport key, or an API key.
resource "random_id" "node_secret" {
  for_each    = { for p in local.node_secret_pairs : p.key => p }
  byte_length = 32
}

resource "google_secret_manager_secret" "node" {
  for_each  = { for p in local.node_secret_pairs : p.key => p }
  project   = var.project_id
  secret_id = "cello-${each.value.node_id}-${each.value.name}"

  # UNRECOVERABLE if destroyed. The transport key IS the node's libp2p peer id and the node key IS
  # its manifest identity: a re-apply mints DIFFERENT values, so the database of KMS-wrapped shares
  # survives with no identity able to serve it. Cloud SQL and the KMS ring already carry this;
  # these are the resources whose loss cannot be undone by any restore.
  lifecycle {
    prevent_destroy = true
  }

  replication {
    user_managed {
      replicas {
        # Pinned to the node's own region. Automatic replication would place copies in regions the
        # node does not run in, which is a sovereignty leak for key material.
        location = each.value.region
      }
    }
  }

  labels = {
    project = "cello"
    node    = each.value.node_id
  }
}

resource "google_secret_manager_secret_version" "node" {
  for_each    = { for p in local.node_secret_pairs : p.key => p }
  secret      = google_secret_manager_secret.node[each.key].id
  secret_data = random_id.node_secret[each.key].hex
}

resource "google_secret_manager_secret_iam_member" "node" {
  for_each  = { for p in local.node_secret_pairs : p.key => p }
  project   = var.project_id
  secret_id = google_secret_manager_secret.node[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  # Keyed by "<node_id>--<secret name>", so the SA lookup goes through the pair's region rather
  # than its key.
  member = "serviceAccount:${google_service_account.directory_node[each.value.region].email}"
}

# ── Database credentials — TWO of them, because there are two roles ──────────────────────────
# Both use the AWS RDS secret's shape ({username, password, host, port, dbname}), so gcp-boot-env
# and the AWS entrypoint agree on what a database credential looks like. `host` is the PSC
# forwarding-rule address — the only route to this instance that exists.
#
#   db-credentials      `postgres`, the schema owner. Flyway (DDL) and pg_dump (backup) only.
#   db-app-credentials  `cello_service`, what the node process connects as. Under RLS, INSERT and
#                       SELECT only — see the two roles in sql.tf for why running the node as the
#                       owner would silently disable the append-only guarantee.

resource "google_secret_manager_secret" "db_credentials" {
  for_each  = var.directory_nodes
  project   = var.project_id
  secret_id = "cello-${each.value.node_id}-db-credentials"

  replication {
    user_managed {
      replicas {
        location = each.key
      }
    }
  }

  labels = {
    project = "cello"
    node    = each.value.node_id
  }
}

resource "google_secret_manager_secret_version" "db_credentials" {
  for_each = var.directory_nodes
  secret   = google_secret_manager_secret.db_credentials[each.key].id
  secret_data = jsonencode({
    username = google_sql_user.admin[each.key].name
    password = random_password.db_admin[each.key].result
    host     = google_compute_address.sql_psc[each.key].address
    port     = 5432
    dbname   = google_sql_database.cello[each.key].name
  })
}

resource "google_secret_manager_secret_iam_member" "db_credentials" {
  for_each  = var.directory_nodes
  project   = var.project_id
  secret_id = google_secret_manager_secret.db_credentials[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}

# The node's runtime credential. Separate secret, not a second field on the admin one: they have
# different readers and different blast radii, and a single blob would hand anything that can read
# the app credential the schema owner's password too.
resource "google_secret_manager_secret" "db_app_credentials" {
  for_each  = var.directory_nodes
  project   = var.project_id
  secret_id = "cello-${each.value.node_id}-db-app-credentials"

  replication {
    user_managed {
      replicas {
        location = each.key
      }
    }
  }

  labels = {
    project = "cello"
    node    = each.value.node_id
  }
}

resource "google_secret_manager_secret_version" "db_app_credentials" {
  for_each = var.directory_nodes
  secret   = google_secret_manager_secret.db_app_credentials[each.key].id
  secret_data = jsonencode({
    username = google_sql_user.cello_service[each.key].name
    password = random_password.db_app[each.key].result
    host     = google_compute_address.sql_psc[each.key].address
    port     = 5432
    dbname   = google_sql_database.cello[each.key].name
  })
}

resource "google_secret_manager_secret_iam_member" "db_app_credentials" {
  for_each  = var.directory_nodes
  project   = var.project_id
  secret_id = google_secret_manager_secret.db_app_credentials[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}
