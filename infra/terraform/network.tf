# Custom-mode VPC. The auto-created default network was deleted at bootstrap — nodes get
# per-region subnets added here as they are built (one node = one region).

resource "google_compute_network" "cello_vpc" {
  name                    = "cello-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "regional" {
  for_each      = var.region_subnets
  name          = "cello-${each.key}"
  project       = var.project_id
  region        = each.key
  network       = google_compute_network.cello_vpc.id
  ip_cidr_range = each.value
}
