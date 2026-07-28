variable "project_id" {
  description = "The GCP project all M12 resources live in"
  type        = string
  default     = "cello-infra"
}

variable "disposable_probe" {
  description = "DOD-IAC-BASE-1 enforcer: when true, stands up one disposable COS VM in a MIG(1) with static IP, firewall rule, and attached SA. Proves the node shape entirely from code, then flips back to false."
  type        = bool
  default     = false
}

variable "environment" {
  description = "CELLO_ENV the nodes run as. Names the database (cello_{env}) and the SSM/secret paths."
  type        = string
  default     = "dev"
}

variable "directory_image_tag" {
  description = "Artifact Registry tag of the directory image to run. Always a commit SHA built by Cloud Build — there is no :latest (a moving tag makes 'which code is live' unanswerable)."
  type        = string
}

variable "directory_nodes" {
  description = <<-EOT
    Directory nodes, keyed by REGION. One node = one region = one independent deployment; the map
    key enforces that (two nodes in one region is unrepresentable). Adding a region is adding one
    entry — that is the DOD-INV-IAC region-expansion test.

    node_id is `<cloud>-<region>` and is PERMANENT: it feeds Identifier.derive() and is the FROST
    participant identifier, so renaming it is a decommission, not a rename (spec-of-record
    decision 7).
  EOT
  type = map(object({
    node_id      = string
    zone         = string
    machine_type = string
    db_tier      = string
    hostname     = string
  }))
  default = {}
}

variable "region_subnets" {
  description = "Regional subnets in cello-vpc. Scheme: 10.10.<n>.0/24, n assigned in region-add order (us-east1 = 0). One node = one region; adding a region = adding one entry here."
  type        = map(string)
  default = {
    us-east1 = "10.10.0.0/24"
  }
}
