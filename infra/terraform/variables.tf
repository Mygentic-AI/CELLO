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
    # Third octet of this region's 10.10.<n>.0/24 subnet. Assigned once per region and never
    # reused — an existing node's addresses (including its Cloud SQL PSC endpoint) live in it.
    # Carried here rather than in a separate map so that adding a region is genuinely ONE entry,
    # which is what DOD-INV-IAC's region-expansion test claims.
    subnet_index = number
    # What a client can actually DIAL. A GCP node has no load balancer in front of it, so it
    # advertises the port it listens on; the AWS shape (80/ws fronted by an ALB) is the default
    # the code falls back to, not something to repeat here.
    public_port      = number
    public_transport = string
  }))
  default = {}
}

# Subnets are derived from directory_nodes[*].subnet_index — see network.tf. This variable remains
# only for subnets that belong to no directory node (a relay-only region, say); it is empty today.
variable "extra_region_subnets" {
  description = "Subnets in cello-vpc for regions that host no directory node. Same 10.10.<n>.0/24 scheme; the index must not collide with any node's subnet_index."
  type        = map(string)
  default     = {}
}
