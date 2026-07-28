# Cloud Build CI (DOD-CI-REGISTRY-1): GitHub connection (OAuth completed by Andre 2026-07-28,
# token in Secret Manager, managed by the Cloud Build P4SA), the CELLO repo link, and the two
# path-filtered image triggers. Builds run as the cello-cloud-build SA; images go to Artifact
# Registry. No other path pushes images, ever.

resource "google_cloudbuildv2_connection" "github" {
  project  = var.project_id
  location = "us-east1"
  name     = "cello-github"

  # Reinstalling the GitHub App or recreating the connection changes BOTH values below —
  # update them here; plan will show loud drift, which is intended (no ignore_changes).
  github_config {
    app_installation_id = 149532787
    authorizer_credential {
      # OAuth token secret created by the connection flow itself (P4SA-managed); TF references
      # it but never creates or rotates it.
      oauth_token_secret_version = "projects/cello-infra/secrets/cello-github-github-oauthtoken-c3e205/versions/latest"
    }
  }
}

resource "google_cloudbuildv2_repository" "cello" {
  project           = var.project_id
  location          = "us-east1"
  name              = "CELLO"
  parent_connection = google_cloudbuildv2_connection.github.name
  remote_uri        = "https://github.com/Mygentic-AI/CELLO.git"
}

locals {
  # Path filters per image. Root workspace files are in both sets because both Dockerfiles
  # COPY them; a lockfile bump must rebuild both images.
  image_triggers = {
    directory = {
      config = "infra/cloudbuild/directory.yaml"
      included_files = [
        "packages/directory/**",
        "packages/interfaces/**",
        "infra/cloudbuild/directory.yaml",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "package.json",
        "tsconfig.base.json",
        "tsconfig.json",
      ]
    }
    relay = {
      config = "infra/cloudbuild/relay.yaml"
      included_files = [
        "packages/relay/**",
        "packages/interfaces/**",
        "infra/cloudbuild/relay.yaml",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "package.json",
        "tsconfig.base.json",
        "tsconfig.json",
      ]
    }
  }
}

resource "google_cloudbuild_trigger" "image" {
  for_each = local.image_triggers

  project         = var.project_id
  location        = "us-east1"
  name            = "cello-${each.key}-image"
  description     = "Build + push the ${each.key} image on main-branch changes to its paths"
  filename        = each.value.config
  included_files  = each.value.included_files
  service_account = google_service_account.workload["cloud-build"].id

  substitutions = {
    _REGISTRY = "us-east1-docker.pkg.dev/${var.project_id}/cello"
  }

  repository_event_config {
    repository = google_cloudbuildv2_repository.cello.id
    push {
      branch = "^main$"
    }
  }
}
