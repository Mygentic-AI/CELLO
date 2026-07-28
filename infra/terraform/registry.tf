# Artifact Registry — the single image home for all CELLO images on GCP (DOD-CI-REGISTRY-1).
# Images are pushed ONLY by Cloud Build (cello-cloud-build SA); never from a local machine.

resource "google_artifact_registry_repository" "cello" {
  project       = var.project_id
  location      = "us-east1"
  repository_id = "cello"
  description   = "CELLO directory and relay images — pushed by Cloud Build only"
  format        = "DOCKER"
}
