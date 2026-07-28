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

variable "region_subnets" {
  description = "Regional subnets in cello-vpc. Scheme: 10.10.<n>.0/24, n assigned in region-add order (us-east1 = 0). One node = one region; adding a region = adding one entry here."
  type        = map(string)
  default = {
    us-east1 = "10.10.0.0/24"
  }
}
