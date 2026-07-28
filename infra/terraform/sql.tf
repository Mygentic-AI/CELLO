# Cloud SQL — one Postgres instance PER DIRECTORY NODE (DOD-NODE-DIR-GCP-1).
#
# NODE-ONLY ACCESS, and the mechanism matters:
#
#   ipv4_enabled = false        no public IP exists to reach at all.
#   psc_config                  Private Service Connect. The consumer end is a forwarding rule in
#                               THIS node's subnet, so the only network that can reach the instance
#                               is the node's own.
#
# PSC and not private IP: Cloud SQL private IP requires Private Service Access, which is a VPC
# peering into Google's producer network — and DOD-INV-NO-VPN forbids VPC peering outright
# (spec-of-record decision 3: "No VPN, no Private Service Access, ever"). PSC creates no peering,
# no reserved range, and no transitive route. Nothing external ever connects to a node's Postgres,
# which is the anti-entropy dividend: directories reconcile over the authenticated libp2p channel,
# never over the database.

resource "google_sql_database_instance" "node" {
  for_each            = var.directory_nodes
  name                = "cello-${each.value.node_id}"
  project             = var.project_id
  region              = each.key
  database_version    = "POSTGRES_17"
  deletion_protection = true

  settings {
    tier              = each.value.db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 20
    disk_autoresize   = true
    edition           = "ENTERPRISE"

    ip_configuration {
      ipv4_enabled = false
      ssl_mode     = "ENCRYPTED_ONLY"

      psc_config {
        psc_enabled               = true
        allowed_consumer_projects = [var.project_id]
      }
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "07:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }

    # pgaudit is not optional here: PERSIST-006 asserts the directory's writes are audited at the
    # database layer, and the migrations CREATE EXTENSION pgaudit. Without the flag the extension
    # cannot be created and V1 fails, so the node would not start — loudly, at least.
    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "on"
    }
    database_flags {
      name  = "pgaudit.log"
      value = "all"
    }
    # The node's pool is DIRECTORY_PG_POOL_MAX (50) and Flyway opens its own during migration.
    database_flags {
      name  = "max_connections"
      value = "200"
    }

    insights_config {
      query_insights_enabled = true
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 8
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_sql_database" "cello" {
  for_each = var.directory_nodes
  name     = "cello_${var.environment}"
  project  = var.project_id
  instance = google_sql_database_instance.node[each.key].name
}

# The application role. Password generated per node and never shared between nodes — a credential
# that unlocked more than one node's database would undo the per-node isolation above.
resource "random_password" "db" {
  for_each = var.directory_nodes
  length   = 32
  special  = false # keeps the JDBC URL and the libpq URL free of escaping divergence
}

resource "google_sql_user" "cello_service" {
  for_each = var.directory_nodes
  name     = "postgres"
  project  = var.project_id
  instance = google_sql_database_instance.node[each.key].name
  password = random_password.db[each.key].result
}

# ── The consumer end of the PSC link ─────────────────────────────────────────────────────────
# A static internal address in the node's own subnet, plus a forwarding rule pointing at the
# instance's service attachment. The address is what goes into the node's DATABASE_URL, so it must
# be reserved rather than ephemeral — an address that moved would silently break the node on the
# next apply.

resource "google_compute_address" "sql_psc" {
  for_each     = var.directory_nodes
  name         = "cello-sql-${each.value.node_id}"
  project      = var.project_id
  region       = each.key
  subnetwork   = google_compute_subnetwork.regional[each.key].id
  address_type = "INTERNAL"
}

resource "google_compute_forwarding_rule" "sql_psc" {
  for_each              = var.directory_nodes
  name                  = "cello-sql-${each.value.node_id}"
  project               = var.project_id
  region                = each.key
  network               = google_compute_network.cello_vpc.id
  subnetwork            = google_compute_subnetwork.regional[each.key].id
  ip_address            = google_compute_address.sql_psc[each.key].id
  target                = google_sql_database_instance.node[each.key].psc_service_attachment_link
  load_balancing_scheme = ""
}
