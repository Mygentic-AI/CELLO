---
name: GCP Wave-1 Test Runbook
type: runbook
date: 2026-07-29
milestone: M12
status: open
topics: [m12, gcp, testing, consortium, e2e]
description: >
  How to point a CELLO client at the live GCP consortium and register an agent. No npm publish and
  no portal required; the AWS system is untouched.
---

# Testing against the live GCP consortium

The Wave-1 GCP system runs in PARALLEL with AWS and shares no runtime state (M12-D4). Pointing a
client at it is four environment variables — **no publish, no `latest` promotion, no changes to the
bundled manifest**, which stays AWS until the Wave-2 cutover.

## The live system

| Role | node_id | Address |
|---|---|---|
| directory | `gcp-use1` | `34.75.172.108` |
| directory | `gcp-usc1` | `34.136.176.190` |
| directory | `gcp-euw1` | `34.34.166.245` |
| relay | `gcp-relay-use1` | `34.139.119.165` |

**Ports.** `9090` is HTTP — `/bootstrap`, `/manifest`, `/registry`, `/health`. `8080` is the libp2p
WS listener and answers plain HTTP with **400**; a client pointed there resolves zero nodes from a
valid manifest. `4001` is the relay's WS port.

Three validators, **T = majority(3) = 2**. Officer pubkey
`e8300a2b9de7be6f6d629f778dc319715ad0010c0639f3a1564181d56d3eb104`.

## 1. Point a client at it

```bash
export CELLO_DIR=~/.cello-gcp                       # separate profile — a different consortium
                                                    # means a fresh registration, which is the
                                                    # rebuild test anyway
export CELLO_DIRECTORY_URL=http://34.75.172.108:9090   # HTTP port, NOT 8080 (libp2p WS)
export CELLO_CONSORTIUM_MANIFEST=<repo>/infra/manifests/gcp-consortium-manifest.json
export CELLO_CONSORTIUM_ROOT_KEYS=e8300a2b9de7be6f6d629f778dc319715ad0010c0639f3a1564181d56d3eb104
export CELLO_CONSORTIUM_THRESHOLD=1
```

`CELLO_DIR` is what keeps this off your AWS daemon profile. The manifest override is the toggle
M12-D4 specifies; the bundled roster is untouched, so a client without these variables still talks
to AWS exactly as before.

## 2. Mint a registration capability

Registration requires a pre-authorization capability — the directories verify one and refuse
without it. The portal normally issues these; it runs on AWS, which is hibernated, so mint one
directly with the consortium issuer key:

```bash
node infra/scripts/mint-preauth-capability.mjs
```

It prints a base64url blob for `cello register`. Same artifact, same canonical bytes, same issuer
the nodes verify against — the point is to exercise the REAL registration path rather than one with
the check disabled, which would pass for the wrong reason.

Verified end to end against the **published** `@cello-protocol/crypto`, not just its own signer:

```
{"decoded":true,"verifies":{"ok":true},
 "tampered_sig_rejected":{"ok":false,"reason":"capability_signature_invalid"},
 "wrong_issuer_rejected":{"ok":false,"reason":"capability_signature_invalid"}}
```

One capability authorizes ONE agent: the directory binds its `nonce` to the DKG epoch, so a replay
does not register a second.

## 3. What to expect

A registration drives a DKG across the reachable validators with T = 2. Because T < N you can kill
any ONE directory and both registration and sealing continue — that is the property to test, and it
is what `DOD-E2E-GCP-1` formalises.

## Known limits, deliberately

- **`ws://` not `wss://`.** No TLS terminator sits in front of the nodes yet, so the manifest
  advertises the address a client can actually dial. An endpoint that lies is worse than one that is
  plain. Needed before anything customer-facing.
- **No DNS.** `directory-gcp-*.cello.mygentic.ai` records live in Route53 on hibernated AWS. Both
  the manifest endpoints and the multiaddr each node advertises from `/bootstrap` carry IPs instead
  (`CELLO_DIRECTORY_BOOTSTRAP_MULTIADDR`). `MULTIADDR-1` built that seam precisely so this costs
  nothing; drop the override once the records exist.
- **Relay manifest not published.** Directories log `relay.manifest.not_found`; the relay has
  registered live (`relay.registered`), which is what session brokering uses.

## Regenerating the manifest

After any node key rotation or topology change:

```bash
infra/scripts/gcp-node-identities.sh                                    # inspect
node infra/scripts/sign-gcp-consortium-manifest.mjs --out infra/manifests/gcp-consortium-manifest.json
cd infra/terraform && terraform apply                                   # nodes pick it up on roll
```

Nothing in that pipeline is hand-entered: identities derive from the same Secret Manager seeds the
nodes use, and were verified byte-identical to what each node logs for itself at boot.
