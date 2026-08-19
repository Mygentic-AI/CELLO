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
