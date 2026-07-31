// ─────────────────────────────────────────────────────────────────────────────────────────────
// api.cello.mygentic.ai — the hostname, in front of the waitlist Cloud Run service.
//
// WHY THE HOSTNAME MATTERS MORE HERE THAN ANYWHERE ELSE (DOD-GCP-DOMAIN-1).
// DOD-INV-DOMAIN binds every CELLO URL to *.cello.mygentic.ai, and its checker denies run.app
// hostnames outright — so the service cannot be referenced by its Cloud Run URL in code, copy or
// configuration. That is the invariant. The practical reason is larger:
//
//   1. KEEPING THE NAME MAKES ITEM D A DNS CHANGE. The corp site's nginx already proxies
//      /api/waitlist/ and /gallery/ to api.cello.mygentic.ai. If the name survives the migration,
//      the site needs no code change and no deploy — the Route 53 record moves from API Gateway to
//      this IP and nothing else happens. A new hostname would mean editing and redeploying
//      Lightsail, which is the one piece of infrastructure this migration was trying not to touch.
//
//   2. THE SESSION COOKIE IS SCOPED TO IT. `__Host-cello_wl_session` is issued by waitlist-auth on
//      this origin. `__Host-` prefixed cookies are bound to the exact host with no Domain
//      attribute, so serving from a different name does not "mostly work" — every signed-in user is
//      signed out and cannot sign back in, which is the failure DOD-AUTH-1 already spent four
//      review rounds on from the other direction.
//
//   3. EVERY E1 LINK EVER SENT points at it. Confirmation links are the most-clicked URL in the
//      product, they live in mailboxes indefinitely, and they cannot be rewritten after sending.
//
// WHY A LOAD BALANCER AND NOT A CLOUD RUN DOMAIN MAPPING: same as the portal. A mapping requires the
// domain to be user-verified in the project, which is a console step a person must do by hand. A
// global external ALB needs no domain verification — proof of control is the DNS record itself.
//
// DNS IS IN ROUTE 53 AND IS NOT MANAGED HERE. The record is the last step of the cutover and is
// deliberately manual: it is the moment traffic moves, and it should be a decision rather than a
// side effect of an apply. Note also that Route 53 is one of the services hibernate leaves running,
// so this works with AWS asleep.
// ─────────────────────────────────────────────────────────────────────────────────────────────

resource "google_compute_global_address" "waitlist" {
  name    = "cello-waitlist-lb-ip"
  project = var.project_id
  // Static, for the same reason as the portal's: the A record points here, and a released ephemeral
  // IP would silently break both the hostname and the managed certificate's renewal, which
  // re-validates over the same DNS.
}

resource "google_compute_region_network_endpoint_group" "waitlist" {
  name                  = "cello-waitlist-neg"
  project               = var.project_id
  region                = google_cloud_run_v2_service.waitlist.location
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.waitlist.name
  }
}

resource "google_compute_backend_service" "waitlist" {
  name                  = "cello-waitlist-backend"
  project               = var.project_id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.waitlist.id
  }

  // No health check, and that is not an omission: serverless NEGs do not take one. Cloud Run's own
  // startup probe decides a revision is ready to serve.
}

// Google-managed, so renewal is automatic. It provisions only AFTER the A record resolves to the IP
// above — so on a first deploy the certificate sits in PROVISIONING until DNS is pointed here, and
// that is expected rather than a fault.
resource "google_compute_managed_ssl_certificate" "waitlist" {
  name    = "cello-waitlist-cert"
  project = var.project_id

  managed {
    domains = [var.waitlist_hostname]
  }

  lifecycle {
    // A managed certificate cannot be updated in place; changing the domain replaces it, and the
    // replacement must exist before the old one is detached or the hostname serves an error in
    // between.
    create_before_destroy = true
  }
}

resource "google_compute_url_map" "waitlist" {
  name            = "cello-waitlist-urlmap"
  project         = var.project_id
  default_service = google_compute_backend_service.waitlist.id
}

resource "google_compute_target_https_proxy" "waitlist" {
  name             = "cello-waitlist-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.waitlist.id
  ssl_certificates = [google_compute_managed_ssl_certificate.waitlist.id]
}

resource "google_compute_global_forwarding_rule" "waitlist_https" {
  name                  = "cello-waitlist-https"
  project               = var.project_id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.waitlist.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.waitlist.id
}

// :80 redirects rather than serving. An API that answers on plaintext teaches callers it is
// acceptable, and the session cookie is `Secure` — a request that arrives on :80 cannot carry it,
// so serving there would look like an anonymous user rather than a protocol mistake.
resource "google_compute_url_map" "waitlist_redirect" {
  name    = "cello-waitlist-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "waitlist" {
  name    = "cello-waitlist-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.waitlist_redirect.id
}

resource "google_compute_global_forwarding_rule" "waitlist_http" {
  name                  = "cello-waitlist-http"
  project               = var.project_id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.waitlist.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.waitlist.id
}

output "waitlist_lb_ip" {
  description = "The A record target for api.cello.mygentic.ai. DNS is in Route 53 and is NOT managed here — pointing it is the cutover, and it is deliberately a separate, human decision."
  value       = google_compute_global_address.waitlist.address
}
