# CELLO E2E Tests

## Cross-machine relay test (INFRA-001 AC-006)

Verifies that a developer machine can dial the test relay EC2 instance and receive a valid PeerId (confirming TCP reachability, Noise handshake, and identify completed).

### Relay multiaddr

The relay's multiaddr is stored in SSM Parameter Store (eu-west-1):

```
/cello/test-relay-multiaddr
```

Fetch it:

```bash
aws ssm get-parameter --name /cello/test-relay-multiaddr --region eu-west-1 --query Parameter.Value --output text
```

Once the relay EC2 is provisioned, the value will be in the form `/ip4/<elastic-ip>/tcp/4001/p2p/<peerID>`.

### Run the test

```bash
CELLO_RELAY_MULTIADDR=$(aws ssm get-parameter --name /cello/test-relay-multiaddr --region eu-west-1 --query Parameter.Value --output text) \
  pnpm run test:cross-machine
```

Run this on each machine independently. Both machines should pass.

### What this test verifies

- The relay EC2 is reachable over TCP from this machine
- Noise handshake succeeds (relay's PeerID is returned)
- identify has completed (non-empty PeerId string)

### What this test does NOT verify

Full circuit-relay-v2 traversal between two machines — that is covered by the E2E-001 manual sign-off checklist.

---

## E2E sign-off (E2E-001)

Full two-machine agent exchange. See `docs/planning/user-stories/m0/CELLO-E2E-001.yaml` for the complete AC checklist.

Prerequisites:
- Both machines have `@cello-protocol/connect` installed: `npm install -g @cello-protocol/connect`
- Claude Code configured on both: `claude mcp add --transport stdio cello -- cello-mcp`
- Both machines started with: `claude --channels server:cello`
- Both machines on **different networks** (different NATs)

Sign-off record goes in `docs/planning/discussion_logs/YYYY-MM-DD_HHMM_e2e-001-signoff.md`.
