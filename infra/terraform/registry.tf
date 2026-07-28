# Artifact Registry — the single image home for all CELLO images on GCP (DOD-CI-REGISTRY-1).
# Images are pushed ONLY by Cloud Build (cello-cloud-build SA); never from a local machine.

resource "google_artifact_registry_repository" "cello" {
  project       = var.project_id
  location      = "us-east1"
  repository_id = "cello"
  description   = "CELLO directory and relay images — pushed by Cloud Build only"
  format        = "DOCKER"
}

# A node pulls its own image at every boot and every restart, so without this it crash-loops on
# `docker pull … denied` — which is what happened on the first gcp-use1 boot. Org policy strips all
# automatic grants, so nothing is implicit here.
#
# READER, and repository-scoped: the node pulls and must never push. A node that could write to the
# registry could replace the image every other node runs, which is a consortium-wide compromise
# reached from one host. Writing stays exclusively with Cloud Build (iam.tf).
resource "google_artifact_registry_repository_iam_member" "directory_node_reader" {
  for_each   = var.directory_nodes
  project    = var.project_id
  location   = google_artifact_registry_repository.cello.location
  repository = google_artifact_registry_repository.cello.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.directory_node[each.key].email}"
}
