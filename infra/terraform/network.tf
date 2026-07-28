# Custom-mode VPC. The auto-created default network was deleted at bootstrap — nodes get
# per-region subnets added here as they are built (one node = one region).

resource "google_compute_network" "cello_vpc" {
  name                    = "cello-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
}

# One subnet per region, derived from the node's own subnet_index so that adding a region is one
# entry in directory_nodes rather than two coordinated ones. Scheme: 10.10.<index>.0/24.
locals {
  region_subnets = merge(
    { for region, node in var.directory_nodes : region => "10.10.${node.subnet_index}.0/24" },
    var.extra_region_subnets,
  )
}

resource "google_compute_subnetwork" "regional" {
  for_each      = local.region_subnets
  name          = "cello-${each.key}"
  project       = var.project_id
  region        = each.key
  network       = google_compute_network.cello_vpc.id
  ip_cidr_range = each.value
}
