// ─────────────────────────────────────────────────────────────────────────────────────────────
// portal.cello.mygentic.ai — the hostname, in front of Cloud Run.
//
// WHY A LOAD BALANCER AND NOT A CLOUD RUN DOMAIN MAPPING.
// A domain mapping is simpler and cheaper, and it was the first choice. It requires the domain to be
// user-verified in the project (Search Console), which is a console step a person has to do by hand —
// `gcloud domains list-user-verified` returns nothing here. A global external ALB needs no domain
// verification at all: proof of control is the DNS record itself, which is already ours to change.
//
// WHY THE HOSTNAME IS WORTH THIS AT ALL.
// The GitHub OAuth app's callback is registered against portal.cello.mygentic.ai, and WEBAUTHN_RP_ID
// is part of what every passkey is cryptographically bound to. Serving from the run.app URL instead
// would mean re-registering the OAuth app and invalidating every passkey already enrolled —
// permanently, since a passkey cannot be moved between origins. Keeping the name turns the migration
// into a DNS change.
// ─────────────────────────────────────────────────────────────────────────────────────────────

resource "google_compute_global_address" "portal" {
  name    = "cello-portal-lb-ip"
  project = var.project_id
  // Static: the A record points here, and a released ephemeral IP would silently break the hostname
  // AND the managed certificate's renewal, which re-validates over the same DNS.
}

// The serverless NEG is the adapter between a load balancer, which speaks backends, and Cloud Run,
// which has no IP to point at.
resource "google_compute_region_network_endpoint_group" "portal" {
  name                  = "cello-portal-neg"
  project               = var.project_id
  region                = google_cloud_run_v2_service.portal.location
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.portal.name
  }
}

resource "google_compute_backend_service" "portal" {
  name                  = "cello-portal-backend"
  project               = var.project_id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.portal.id
  }

  // No health check, and that is not an omission: serverless NEGs do not take one. Cloud Run's own
  // startup probe is what decides a revision is ready to serve.
}

// Google-managed, so renewal is automatic. It provisions only AFTER the A record below resolves to
// this load balancer — Google validates control by fetching over the same name — so a first apply
// leaves the cert PROVISIONING for a while, and that is expected rather than a failure.
resource "google_compute_managed_ssl_certificate" "portal" {
  name    = "cello-portal-cert"
  project = var.project_id

  managed {
    domains = [var.portal_hostname]
  }

  // A certificate cannot be updated in place — changing the domain replaces it, and the replacement
  // must exist before the proxy stops referencing the old one, or the hostname serves nothing in the
  // gap.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_url_map" "portal" {
  name            = "cello-portal-urlmap"
  project         = var.project_id
  default_service = google_compute_backend_service.portal.id
}

resource "google_compute_target_https_proxy" "portal" {
  name             = "cello-portal-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.portal.id
  ssl_certificates = [google_compute_managed_ssl_certificate.portal.id]
}

resource "google_compute_global_forwarding_rule" "portal_https" {
  name                  = "cello-portal-https"
  project               = var.project_id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.portal.id
  ip_address            = google_compute_global_address.portal.id
}

// Port 80 exists ONLY to redirect. WebAuthn requires a secure origin, and an operator who types the
// bare hostname would otherwise get a connection refused rather than the site.
resource "google_compute_url_map" "portal_redirect" {
  name    = "cello-portal-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "portal" {
  name    = "cello-portal-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.portal_redirect.id
}

resource "google_compute_global_forwarding_rule" "portal_http" {
  name                  = "cello-portal-http"
  project               = var.project_id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.portal.id
  ip_address            = google_compute_global_address.portal.id
}

output "portal_lb_ip" {
  value       = google_compute_global_address.portal.address
  description = "The A record target for the portal hostname. DNS is in Route 53 and is not managed here."
}
