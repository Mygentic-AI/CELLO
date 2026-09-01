# Alerting — the fleet tells you when a conversation could NOT be sealed.
#
# WHY THIS EXISTS. During the 2026-08-18/19 sealing failure the fleet emitted a perfectly good
# signal — `relay.directory.connection.stale` fired roughly 220 times an hour for over ten hours —
# and nobody was told. The signal was never missing; nothing watched it. That is launch-triage item
# 17 ("nothing watches anything") applied to the one failure that costs a receipt.
#
# SCOPE IS DELIBERATELY NARROW (Andre, 2026-08-19): UNRECOVERABLE failures only. Not every muxer
# death, not every eviction, not a node running old code. The test for inclusion is "this cost, or
# is about to cost, a receipt". Everything else is a log line you go and read.
#
#   relay.seal.rejected                  — a seal was actually refused. A receipt was lost.
#   *.redial.outcome  recovered=false    — the repair ran and did not repair. The next seal fails.
#
# An alert that fires on the ordinary case gets muted, and a muted alert is worse than none because
# it reads as coverage. If the Tier P5 fix works, this channel should be SILENT — and silence here
# is meaningful precisely because the noisy events were left out.
#
# SHAPE: log sink -> Pub/Sub -> Cloud Run (push) -> Telegram Bot API. A sink rather than a
# log-based metric + alert policy, because these are rare discrete events and a metric would
# aggregate them into a delayed threshold. The sink delivers the matching log entry itself, so the
# message can name the session and the reason instead of saying "something happened".

# ─── The filter, as a local so it is testable by eye and appears once ─────────────────────────────
locals {
  # Anchored on jsonPayload.event so a substring match cannot widen it silently. `recovered=false`
  # is checked explicitly rather than "NOT recovered=true": a MISSING field must not alert, or a
  # future log line without it pages at 3am for nothing.
  seal_unrecoverable_filter = <<-EOT
    resource.type="gce_instance"
    AND (
      jsonPayload.event="relay.seal.rejected"
      OR (
        (
          jsonPayload.event="relay.directory.redial.outcome"
          OR jsonPayload.event="relay.adapter.redial.outcome"
          OR jsonPayload.event="antientropy.peer.redial.outcome"
        )
        AND jsonPayload.recovered=false
      )
    )
  EOT
}

# ─── Transport: sink -> topic ────────────────────────────────────────────────────────────────────
resource "google_pubsub_topic" "seal_alerts" {
  name    = "cello-seal-alerts"
  project = var.project_id
}

resource "google_logging_project_sink" "seal_alerts" {
  name        = "cello-seal-alerts"
  project     = var.project_id
  destination = "pubsub.googleapis.com/${google_pubsub_topic.seal_alerts.id}"
  filter      = local.seal_unrecoverable_filter

  # The sink writes as its own service account; the binding below is what makes that work. Without
  # it the sink is created successfully and silently publishes nothing — a failure mode that looks
  # exactly like "no alerts because nothing is wrong".
  unique_writer_identity = true
}

resource "google_pubsub_topic_iam_member" "seal_alerts_sink_writer" {
  project = var.project_id
  topic   = google_pubsub_topic.seal_alerts.name
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.seal_alerts.writer_identity
}

# ─── The bot credential ──────────────────────────────────────────────────────────────────────────
#
# CREATED EMPTY ON PURPOSE. Terraform makes the container; the VALUE is added out of band by the
# operator so the token never enters this repo, this state file, or an agent's context. That is a
# deliberate departure from the per-node secrets in secrets.tf, which ARE generated here — those are
# machine-generated per-region values that must not be hand-copied, whereas this one comes from
# outside GCP entirely and only Andre has it.
#
#   gcloud secrets versions add cello-telegram-bot-token --project cello-infra --data-file=-
#   gcloud secrets versions add cello-telegram-chat-id  --project cello-infra --data-file=-
resource "google_secret_manager_secret" "telegram_bot_token" {
  secret_id = "cello-telegram-bot-token"
  project   = var.project_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "telegram_chat_id" {
  secret_id = "cello-telegram-chat-id"
  project   = var.project_id
  replication {
    auto {}
  }
}

# ─── The notifier's identity, scoped to exactly two secrets ──────────────────────────────────────
resource "google_service_account" "seal_notifier" {
  account_id   = "cello-seal-notifier"
  display_name = "CELLO seal alert notifier (Pub/Sub push -> Telegram)"
  project      = var.project_id
}

# PER-SECRET, never project-level — iam.tf states the rule and the reason: a project-level
# secretAccessor would let this notifier read every node's key material, and nothing would ever
# force the tightening.
resource "google_secret_manager_secret_iam_member" "seal_notifier_token" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.telegram_bot_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.seal_notifier.email}"
}

resource "google_secret_manager_secret_iam_member" "seal_notifier_chat" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.telegram_chat_id.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.seal_notifier.email}"
}

# ─── The notifier: Pub/Sub push → Telegram ───────────────────────────────────────────────────────
variable "seal_notifier_image_tag" {
  description = "Commit SHA of the seal-notifier image. No :latest exists; consumers pin SHAs."
  type        = string
}

resource "google_cloud_run_v2_service" "seal_notifier" {
  name     = "cello-seal-notifier"
  project  = var.project_id
  location = "us-east1"
  # Internal only. Nothing outside GCP has any business reaching this, and a public endpoint that
  # sends Telegram messages is an open relay for anyone who finds it.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.seal_notifier.email

    scaling {
      min_instance_count = 0
      # Bounded deliberately. Each instance throttles independently (in-memory), so N instances can
      # send up to N times the intended volume. One keeps the throttle honest; alert volume is tiny
      # by construction and a cold start costs seconds on a path nobody is waiting on.
      max_instance_count = 1
    }

    containers {
      image = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cello.repository_id}/seal-notifier:${var.seal_notifier_image_tag}"

      env {
        name = "TELEGRAM_BOT_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.telegram_bot_token.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "TELEGRAM_CHAT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.telegram_chat_id.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.seal_notifier_token,
    google_secret_manager_secret_iam_member.seal_notifier_chat,
  ]
}

# Pub/Sub pushes as its own SA and must be allowed to invoke the service.
resource "google_service_account" "seal_pusher" {
  account_id   = "cello-seal-pusher"
  display_name = "CELLO seal alert Pub/Sub push identity"
  project      = var.project_id
}

resource "google_cloud_run_v2_service_iam_member" "seal_pusher_invoke" {
  project  = var.project_id
  location = google_cloud_run_v2_service.seal_notifier.location
  name     = google_cloud_run_v2_service.seal_notifier.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.seal_pusher.email}"
}

resource "google_pubsub_subscription" "seal_alerts" {
  name    = "cello-seal-alerts-push"
  project = var.project_id
  topic   = google_pubsub_topic.seal_alerts.name

  push_config {
    push_endpoint = google_cloud_run_v2_service.seal_notifier.uri
    oidc_token {
      service_account_email = google_service_account.seal_pusher.email
    }
  }

  # The notifier answers 5xx ONLY for transient failures (Telegram down, secrets unbound) and 2xx
  # for anything it can never process. So a retry here is always worth making — but not forever:
  # 24h of retries on a genuinely broken alert is 24h of noise in the logs about the alert rather
  # than the outage.
  message_retention_duration = "3600s"
  ack_deadline_seconds       = 30
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
  # A message that cannot be delivered is DROPPED after the retention window rather than dead-
  # lettered. Deliberate: the alert is a convenience copy — the log entry it came from is durable
  # in Cloud Logging either way, so nothing is actually lost, and a dead-letter topic nobody reads
  # is one more thing that looks like coverage.
}

# ═════════════════════════════════════════════════════════════════════════════════════════════════
# NODE HEALTH — the fleet tells you when a directory node is unwell (DOD-M15-ALERTING-1)
# ═════════════════════════════════════════════════════════════════════════════════════════════════
#
# WHY THIS EXISTS. Everything above this line alerts on a DISCRETE EVENT that has already cost a
# receipt. Nothing alerted on a node that is merely sick. A directory node ran at ~0.4 of a core
# against a fleet steady state of 0.055 for FIFTY-ONE HOURS and nobody was told; it was found by a
# person looking. The same blindness covers the memory growth documented in GCP-STATE — the process
# adds a few hundred MB a day against a ~4,288 MB V8 ceiling, and at ~80% of that ceiling it
# garbage-collects continuously on the SAME thread that serves HTTP, so the node answers nothing
# for 40 s at a time while looking perfectly alive to anything that does not measure it.
#
# THE SAME RULE AS ABOVE APPLIES AND IT IS THE HARD PART: an alert that fires on the ordinary case
# gets muted, and a muted alert is worse than none because it reads as coverage. Both thresholds
# below were therefore chosen by REPLAYING them over 30 days of real fleet data, not by picking a
# round number — the measurements are quoted beside each one so the next person can retune from
# evidence instead of taste.

locals {
  # Derived from var.directory_nodes so adding a region needs no edit here — the DOD-INV-IAC
  # region-expansion test. `monitoring.regex.full_match` anchors both ends, so the relay
  # (`cello-gcp-relay-use1-…`) cannot match: its name does not begin with any directory node_id.
  # Verified against the live project — this regex returned 58 instances over 30 days and not one
  # of them was a relay, though relay instances were present in the same metric.
  directory_instance_regex = "(${join("|", [for n in var.directory_nodes : "cello-${n.node_id}"])})-.*"

  # V8's REAL ceiling is the configured old-space plus ~192 MB of young generation (GCP-STATE:
  # heap_mb 4096 measured live as a 4,288 MB ceiling). `min` because the smallest ceiling in the
  # fleet is the one that stalls first, so the alert must be sized to it.
  directory_heap_ceiling_mb = min([for n in var.directory_nodes : n.heap_mb]...) + 192

  # Fire at 60% of that ceiling. Reasoning is in the policy's own comment below.
  directory_rss_alert_kb = floor(local.directory_heap_ceiling_mb * 0.60 * 1024)
}

# ─── Where a person is actually told ─────────────────────────────────────────────────────────────
#
# EMAIL, NOT THE TELEGRAM PATH ABOVE, AND THAT IS A DELIBERATE CHOICE RATHER THAN THE EASY ONE.
# The seal notifier parses Cloud Logging's LogEntry shape directly — `jsonPayload.event` and
# `resource.labels.zone` (see packages/seal-notifier/src/format.ts). A Monitoring incident carries
# neither, so an alert policy pointed at that Pub/Sub topic would arrive in Telegram as
# "unknown_event in unknown-zone": a notification that fires correctly and names nothing, which is
# the same "reads as coverage" failure this file was written to avoid. Making it work means
# changing the notifier, which is a different unit.
#
# The cost of a second route is that nobody knows it exists, so it is named in infra/GCP-STATE.md
# alongside the Telegram one. Two routes, both written down: node health arrives by email, a lost
# receipt arrives on Telegram.
variable "alert_operator_email" {
  type        = string
  default     = "andre@mygentic.ai"
  description = "Where node-health alerts are delivered. Same person as ops_dashboard_operator_email, kept as its own variable because the two are unrelated concerns and overloading one would hide a change to either."
}

resource "google_monitoring_notification_channel" "operator_email" {
  display_name = "CELLO operator — node health"
  type         = "email"
  project      = var.project_id

  labels = {
    email_address = var.alert_operator_email
  }
}

# ─── 1. Sustained CPU ────────────────────────────────────────────────────────────────────────────
#
# THE METRIC IS CONFIRMED ARRIVING, not assumed: `compute.googleapis.com/instance/cpu/usage_time`
# was queried against this project over 30 days and returned 58 directory instance series at ~60 s
# resolution. The filter string below is byte-identical in shape to the one that query used.
#
# ⚠️ USAGE_TIME, NOT UTILIZATION, AND THIS IS THE WHOLE DESIGN. `instance/cpu/utilization` is
# normalised across vCPUs, so the SAME illness reads as a different number on a different machine —
# and these nodes change machine type under capacity pressure (use1 went e2-standard-2 →
# n2-standard-2 on 2026-09-01 after us-east1 exhausted e2 AND c3, and c3-standard-4 was very nearly
# what it landed on). A utilization threshold tuned today would silently halve in meaning the next
# time a node is resized to escape an exhausted zone. `usage_time` with ALIGN_RATE is CORE-SECONDS
# PER SECOND — "how many cores is this burning" — which is invariant to machine size and is also
# the physically right question, because the pathology is single-threaded: V8's GC pins ONE core.
#
# THRESHOLD: 0.25 cores, sustained 60 minutes. Both halves replayed over 30 days of real data:
#
#   WOULD IT HAVE CAUGHT THE INCIDENT? Yes, twice, and not marginally:
#     cello-gcp-use1-246m   peaked 0.456 cores, over threshold CONTINUOUSLY FOR 3,090 MINUTES (51 h)
#     cello-gcp-euw1-9lvn   peaked 0.395 cores, over threshold CONTINUOUSLY FOR 2,490 MINUTES (41 h)
#   A third instance (usc1-9kxz, 0.264 peak) would have fired once for 2.5 h. That is a real
#   elevated period, not noise.
#
#   WOULD IT FIRE ON A NORMAL DAY? No. The other 55 directory instances observed in that window
#   never got there: fleet steady state is 0.055 cores (p95 0.061) and the HIGHEST reading among all
#   55 was 0.162 — the threshold sits 1.5x above the worst healthy sample ever recorded and 1.8x
#   below the incident's peak. Boot is the one loud thing a healthy node does (image pull + Flyway,
#   measured up to ~1.0 core) and it cannot trip this: it lasts minutes, and 30-minute ALIGN_RATE
#   buckets held above threshold for a full hour is a state, not a spike.
#
# The alignment period and the 2-bucket duration are exactly what the replay above tested. Change
# one and the evidence in this comment no longer applies to the policy.
resource "google_monitoring_alert_policy" "directory_cpu_sustained" {
  display_name = "Directory node burning CPU for an hour"
  project      = var.project_id
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "Directory node over 0.25 cores for 60 minutes"

    condition_threshold {
      # Assembled with join so the string is the single line that was verified against
      # timeSeries.list, rather than a heredoc whose whitespace nobody checked.
      filter = join(" AND ", [
        "metric.type=\"compute.googleapis.com/instance/cpu/usage_time\"",
        "resource.type=\"gce_instance\"",
        "metric.label.instance_name=monitoring.regex.full_match(\"${local.directory_instance_regex}\")",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 0.25
      duration        = "3600s"

      aggregations {
        alignment_period   = "1800s"
        per_series_aligner = "ALIGN_RATE"
      }

      # Per INSTANCE, deliberately — no cross-series reducer. A sick node is a sick process, and
      # replacing the instance is the fix, so an incident that closes itself when the MIG rolls is
      # the correct behaviour. It is also exactly the shape the 30-day replay measured.
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.operator_email.id]

  # ONE mail when it opens and one when it closes — Monitoring does not re-notify while a condition
  # stays true, which is what makes a 51-hour incident a single message rather than the flood that
  # gets a rule muted. Auto-close at 24 h so a rolled node does not leave an incident open forever.
  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      A directory node has burned more than 0.25 CPU cores for over an hour. Fleet steady state is
      0.055 cores, so this is roughly 5x normal and it is sustained, not a spike.

      **The known cause is memory.** The node process grows a few hundred MB a day; near ~80% of its
      V8 ceiling it garbage-collects continuously on the same thread that serves HTTP, so the node
      answers nothing for ~40 s at a time while still passing as alive. Clients drop it from the
      roster and sessions surface `counterparty_offline`, which names the wrong thing entirely.

      **Two things to do, in order:**

      1. Check whether this is the memory case — the companion alert is "Directory node approaching
         its heap ceiling", and the raw samples are:
         `gcloud logging read 'jsonPayload.SYSLOG_IDENTIFIER="cello-memsample"' --project cello-infra --freshness=6h --format="value(timestamp,jsonPayload.MESSAGE)"`
      2. If it is, roll THAT NODE ONLY — `terraform apply -target` on the one instance group, and
         confirm it is serving before touching another. `infra/CLAUDE.md` §2 has the procedure and
         the reason: an untargeted apply replaces all three at once and the threshold tolerates one.
    EOT
  }
}
