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
