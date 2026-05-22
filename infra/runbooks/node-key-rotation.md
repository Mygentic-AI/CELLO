---
name: Node Private Key Rotation Runbook
type: runbook
date: 2026-05-22
topics: [operations, security, key-rotation, Ed25519, ECS, Secrets Manager, relayId]
status: active
description: Operational procedure for rotating CELLO directory and relay node Ed25519 private keys stored in Secrets Manager. This is a manual, coordinated operation — NOT automated. Covers key generation, peer distribution for directory nodes, and relayId re-registration for relay nodes.
---

# Node Private Key Rotation Runbook

## Overview

CELLO directory and relay nodes each hold an Ed25519 private key in AWS Secrets Manager:

| Secret path | Usage |
|---|---|
| `cello/{env}/directory/node-private-key` | Directory node signing key (signs SessionAssignments, relay manifests, checkpoint co-signatures) |
| `cello/{env}/relay/node-private-key` | Relay node identity key (derives the relay's `relayId` and signs WAL entries) |

**These secrets have NO automatic rotation.** Rotation requires protocol-level coordination that cannot be automated safely:

- Directory key rotation requires distributing the new public key to all peer nodes before stopping old tasks.
- Relay key rotation produces a new `relayId` that must be registered with the directory before the old relay is deactivated.

Automated rotation would break protocol invariants. This runbook documents the manual procedure.

**When to rotate:**

- Suspected private key compromise
- Decommissioning a node
- Routine key aging policy (not required at Alpha — review at Consortium phase)

---

## Prerequisites

- AWS CLI configured with credentials that have `secretsmanager:PutSecretValue` and `ecs:UpdateService` permissions
- Access to the `infra/scripts/generate-node-keys.sh` script in this repository
- For directory key rotation: SSH or SSM access to peer directory nodes (to update their peer key configuration)

---

## Step 1: Generate a new Ed25519 key pair

Use `infra/scripts/generate-node-keys.sh` to generate a new Ed25519 key pair and store it in Secrets Manager.

**Do NOT run this script yet for directory nodes** — read the directory-specific procedure below first.

```bash
# For relay nodes (safe to run immediately, see Step 2):
./infra/scripts/generate-node-keys.sh <env> <region>

# For directory nodes (read Step 3 first before overwriting):
./infra/scripts/generate-node-keys.sh <env> <region> --rotate
```

The script:
1. Generates a new Ed25519 key pair using `openssl genpkey -algorithm ed25519`
2. Stores the 32-byte private key seed (hex-encoded) in Secrets Manager
3. Prints the 32-byte public key (hex-encoded) to stdout — **record this immediately**

If the secret already contains a non-placeholder value, the script exits non-zero with:

```
Key already exists — use --rotate flag to replace
```

Use `--rotate` to overwrite after completing the preparation steps below.

---

## Step 2: Relay node rotation procedure

Relay nodes are simpler to rotate because they are stateless with respect to the directory's trust model. The directory will accept a new relay registration from any node in the relay pool manifest.

**Procedure:**

1. Run the key generation script:
   ```bash
   ./infra/scripts/generate-node-keys.sh <env> <region> --rotate
   ```

2. Record the new relay public key printed to stdout.

3. Restart the relay ECS task to pick up the new key from Secrets Manager:
   ```bash
   aws ecs update-service \
     --cluster cello-<env> \
     --service cello-relay-service \
     --force-new-deployment \
     --region <region>
   ```

4. Wait for the new relay task to start and become healthy:
   ```bash
   aws ecs wait services-stable \
     --cluster cello-<env> \
     --services cello-relay-service \
     --region <region>
   ```

5. Verify the new `relayId` has been registered with the directory. The relay ECS task registers itself on startup by calling the directory's relay registration endpoint. Check the directory CloudWatch logs for a `relay.registered` event containing the new relay's public key.

6. Verify the relay appears as healthy in the directory's health check log (every 30 seconds). The old `relayId` will disappear from the active relay pool after 3 consecutive missed pings.

7. Update the relay pool manifest (`infra/relay-manifest.json`) with the new relay public key and sign it via the lowest-`node_id` directory node. Restart the directory to reload the manifest.

---

## Step 3: Directory node rotation procedure

Directory node key rotation is more complex because:
- The public key is known to peer directory nodes (used for checkpoint co-signature verification)
- Client agents cache the directory public key and use it to verify `SessionAssignment` signatures
- The relay pool manifest is signed by the lowest-`node_id` directory node

**Preparation (before generating the new key):**

1. Generate the new key pair on a test machine (do NOT store it in Secrets Manager yet):
   ```bash
   # Generate a temporary key pair to get the new public key
   openssl genpkey -algorithm ed25519 2>/dev/null \
     | openssl pkey -outform DER 2>/dev/null \
     | tail -c 32 \
     | xxd -p -c 64
   ```
   Or use the dry-run approach: run the script on a non-production environment first to get the new public key format.

2. Distribute the new public key to all peer directory nodes:
   - Update the peer node configuration in each region's directory ECS task definition to trust the new public key
   - This step must complete BEFORE the old key is deactivated
   - Peer nodes use the directory public key to verify checkpoint round signatures

3. Wait for peer node configuration to propagate (all ECS tasks in all regions must be running the updated configuration).

**Rotation (after distributing the new public key):**

4. Store the new key pair in Secrets Manager:
   ```bash
   ./infra/scripts/generate-node-keys.sh <env> <region> --rotate
   ```
   Record the new public key printed to stdout.

5. Perform a rolling ECS task restart for the directory service:
   ```bash
   aws ecs update-service \
     --cluster cello-<env> \
     --service cello-directory-service \
     --force-new-deployment \
     --region <region>
   ```

6. Wait for the new directory tasks to become healthy before stopping old tasks:
   ```bash
   aws ecs wait services-stable \
     --cluster cello-<env> \
     --services cello-directory-service \
     --region <region>
   ```

7. Verify the directory node is operating correctly:
   - Check CloudWatch logs for `session.established` events (new sessions should work)
   - Check checkpoint logs for `checkpoint.confirmed` events (cross-signing should continue)
   - Verify TLS handshakes succeed against the ALB endpoint

8. Update the relay pool manifest if this directory node is the manifest signer (lowest `node_id`). The new manifest signature uses the new node-private-key. Distribute the updated manifest to all relay nodes and directory nodes.

---

## Rollback

If the new key causes issues:

1. Re-run the script with the previous key value (if you recorded it):
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id "cello/<env>/<service>/node-private-key" \
     --secret-string "<previous_private_key_hex>" \
     --region <region>
   ```

2. Restart the ECS tasks to pick up the old key.

3. Verify the service recovers.

---

## Security notes

- The private key is a 32-byte Ed25519 seed stored as a 64-character hex string. It must never appear in logs, environment variables, or be transmitted over unencrypted channels.
- `generate-node-keys.sh` stores only the private key in Secrets Manager. The public key is printed to stdout and must be recorded by the operator immediately — it is not stored automatically.
- The script uses `openssl genpkey -algorithm ed25519` which produces a proper Ed25519 key from OS entropy (not a random byte string). Do not substitute `openssl rand` for key generation.
- After rotation, the old private key version remains in Secrets Manager (as a non-current version) for 30 days before expiry. This provides a rollback window.

---

## Related files

- `infra/scripts/generate-node-keys.sh` — key generation script (idempotent, supports `--rotate`)
- `infra/cloudformation/cello-secrets.yaml` — Secrets Manager resource definitions (no rotation Lambda on node-private-key secrets, per AC-006)
- `infra/cloudformation/cello-rotation.yaml` — RDS credential rotation Lambda (separate from node key rotation)
