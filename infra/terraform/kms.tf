# Cloud KMS envelope key (DOD-ADAPTER-GCP-1 → KmsEnvelopeKeyProvider).
#
# Wraps K_server_X share material before it is written to the node's database. The key never
# leaves Google's HSM boundary — the node sends ciphertext and receives plaintext, so a stolen
# database file is not a stolen share.
#
# One key ring PER NODE REGION, and one key per node. Sovereignty is the reason: a shared key
# would mean one compromised node's KMS grant unwraps every other node's shares, which is exactly
# the single point of failure the topology exists to remove.
#
# Key rings CANNOT be deleted, by design in Cloud KMS. Destroying this Terraform config leaves the
# ring behind; a re-apply adopts it rather than failing, so plan on the ring being permanent once a
# region has ever hosted a node.

resource "google_kms_key_ring" "node" {
  for_each = var.directory_nodes
  name     = "cello-${each.value.node_id}"
  project  = var.project_id
  location = each.key

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "envelope" {
  for_each = var.directory_nodes
  name     = "envelope"
  key_ring = google_kms_key_ring.node[each.key].id
  purpose  = "ENCRYPT_DECRYPT"

  # Cloud KMS rotates VERSIONS server-side; old versions stay available for decrypt, so previously
  # wrapped shares keep opening. This is why KmsEnvelopeKeyProvider.rotate() is a documented no-op.
  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# encrypterDecrypter, not admin: the node wraps and unwraps. It cannot destroy key versions, which
# would render every share on it permanently unopenable.
resource "google_kms_crypto_key_iam_member" "node_envelope" {
  for_each      = var.directory_nodes
  crypto_key_id = google_kms_crypto_key.envelope[each.key].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.workload["directory-node"].email}"
}
