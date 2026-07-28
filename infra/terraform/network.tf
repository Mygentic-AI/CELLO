# Custom-mode VPC. The auto-created default network was deleted at bootstrap — nodes get
# per-region subnets added here as they are built (one node = one region).

resource "google_compute_network" "cello_vpc" {
  name                    = "cello-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
}
