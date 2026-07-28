# Custom-mode VPC. The auto-created default network was deleted at bootstrap — nodes get
# per-region subnets added here as they are built (one node = one region).

resource "google_compute_network" "cello_vpc" {
  name                    = "cello-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
}

# First regional subnet — one node = one region; more subnets land here as regions are added.
resource "google_compute_subnetwork" "us_east1" {
  name          = "cello-us-east1"
  project       = var.project_id
  region        = "us-east1"
  network       = google_compute_network.cello_vpc.id
  ip_cidr_range = "10.10.0.0/24"
}
