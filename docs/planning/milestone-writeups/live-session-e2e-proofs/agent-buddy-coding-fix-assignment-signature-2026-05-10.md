---
name: Buddy Coding Session — Fix assignment_signature Fallback (M2)
type: discussion
date: 2026-05-10
topics: [relay, transport, code-fix, agent-collaboration, directory-relay-protocol, TDD]
status: reference
description: Agent A (reviewer) and Agent B (fixer) used CELLO itself to conduct a live buddy-coding session, removing the dead-code assignment_signature fallback from relay-node.ts and adding a rejection test.
---

# Buddy Coding Session: Fix `assignment_signature` Fallback

A live CELLO M2 buddy-coding session. Agent B (fixer) implemented the fix found in the prior distributed audit; Agent A (reviewer) approved each step before the next began. Every exchange was notarized by the relay.

- **Agent A pubkey** (reviewer): `170138f005bfc26797d0a665490adf0fe5976b70c6a6db159d69cff841afb556`
- **Agent B pubkey** (fixer): `8b6dde20858422fd545dc3d4cb029c3256a97460601dd0deeaa635b7c14014a6`
- **Session ID**: `d351f2846a4bbf599ab57db690b3412c`
- **Genesis prev root**: `574947ffeddea7524142c30a8666ba23af864764de59ab077f47f121716e1341`
- **Date**: 2026-05-10

---

## The Bug

From the prior audit session (`agent-collaboration-distributed-audit-m2-2026-05-10.md`):

In `packages/relay/src/relay-node.ts:278–279`, a fallback existed in the `record_assignment` wire handler:

```typescript
const assignment_signature = req["assignment_signature"] as Uint8Array | undefined;
const relay_assignment_dir_sig = assignment_signature ?? directory_signature;
```

**Why it was wrong**: The two signatures cover different byte sequences:
- `assignment_signature`: signs `CBOR([session_id, participant_a, participant_b, session_timestamp])` — the relay's internal TBS
- `directory_signature`: signs the full CBOR frame body — the directory-relay auth TBS

If `assignment_signature` was absent, the fallback substituted `directory_signature`, which covers different bytes and would always fail `recordAssignment`'s TBS check in production. The fallback appeared to work in old tests only because those helpers accidentally signed `directory_signature` over the assignment TBS bytes.

---

## The Fix — Step by Step

### Step 1 — `directory-relay-types.ts`: add `assignment_signature` as required field

**File**: `packages/relay/src/directory-relay-types.ts`

**Change**: Added `assignment_signature: Uint8Array` to `RecordAssignmentFrame`, before `directory_signature`.

```typescript
// Before
export interface RecordAssignmentFrame {
  type: "record_assignment";
  session_id: Uint8Array;
  participant_a: Uint8Array;
  participant_b: Uint8Array;
  session_timestamp: number | bigint;
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

// After
export interface RecordAssignmentFrame {
  type: "record_assignment";
  session_id: Uint8Array;
  participant_a: Uint8Array;
  participant_b: Uint8Array;
  session_timestamp: number | bigint;
  assignment_signature: Uint8Array; // 64-byte Ed25519 over CBOR([session_id, participant_a, participant_b, session_timestamp])
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}
```

**Reviewer note**: Field placed before `directory_signature` — logical order (assignment TBS first, frame auth second). Non-optional. Approved.

---

### Step 2 — `relay-node.ts`: reject if absent, delete fallback

**File**: `packages/relay/src/relay-node.ts`, lines 260–287

**Change**: Replaced the 18-line comment block and `??` fallback with a hard rejection guard.

```typescript
// Before (simplified)
const assignment_signature = req["assignment_signature"] as Uint8Array | undefined;
const relay_assignment_dir_sig = assignment_signature ?? directory_signature; // ← dead fallback

const result = this.recordAssignment({
  ...
  directory_signature: relay_assignment_dir_sig,
});

// After
const assignment_signature = req["assignment_signature"] as Uint8Array | undefined;
if (!assignment_signature || !(assignment_signature instanceof Uint8Array) || assignment_signature.length !== 64) {
  stream.send(lp.encode.single(CBOR_ENC.encode({ type: "auth_invalid" })));
  await stream.close();
  return;
}

const result = this.recordAssignment({
  ...
  directory_signature: assignment_signature, // passed directly — correct TBS
});
```

**Reviewer note**: Guard covers absent, wrong type, and wrong length — all reject with `auth_invalid`. Passing `assignment_signature` directly to `recordAssignment.directory_signature` is correct; that struct field was named before the wire split and feeds the TBS verifier. Approved.

---

### Steps 3 & 4 — Old test helpers: no changes needed

**Finding**: Both `relay-node.test.ts` and `relay-incremental.test.ts` use `makeAssignment()` which calls `relay.recordAssignment()` directly (in-process), bypassing the wire handler entirely. `SessionAssignment.directory_signature` is defined as the assignment TBS sig by that struct's spec — the old helpers were always correct for their purpose.

The bug only lived in the wire-path handler (`handleDirectoryRelayProtocol`). The wire-path test helper in `directory-relay-protocol.test.ts` already produces both signatures correctly.

**Tool calls used**:
```
grep -n "makeAssignment|recordAssignment" relay-node.test.ts
grep -n "makeAssignment|recordAssignment" relay-incremental.test.ts
# → All calls go to relay.recordAssignment(), not the wire handler
```

---

### Step 5 — New rejection test

**File**: `packages/relay/src/__tests__/directory-relay-protocol.test.ts`

Added `SI-NEW: record_assignment missing assignment_signature → auth_invalid, no state mutation`:

```typescript
describe("SI-NEW: record_assignment missing assignment_signature → auth_invalid, no state mutation", () => {
  it("record_assignment without assignment_signature field → auth_invalid", async () => {
    // Build valid frame body, sign directory_signature correctly,
    // but intentionally omit assignment_signature
    const body = {
      type: "record_assignment",
      session_id, participant_a: pubA, participant_b: pubB, session_timestamp: tsEncoded,
      // assignment_signature intentionally omitted
    };
    const directory_signature = await signFrameBody(fix.dirKp, body);
    const frame = CBOR_ENC.encode({ ...body, directory_signature });

    sendFrame(dirStream, frame);

    // Verify: relay responds auth_invalid
    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("auth_invalid");

    // Verify: no state mutation — subsequent hash_submit returns session_not_found
    ...
    expect(err["reason"]).toBe("session_not_found");
  }, 20_000);
});
```

The test verifies both the rejection response AND that no state was mutated (the correct structure for a security invariant test).

---

## Test Results

```
pnpm --filter @cello/relay run test

 ✓ src/__tests__/index.test.ts                    (4 tests)
 ✓ src/__tests__/relay-incremental.test.ts        (8 tests)
 ✓ src/__tests__/directory-relay-protocol.test.ts (8 tests)  ← includes SI-NEW
 ✓ src/__tests__/relay-node.test.ts               (27 tests)

 Test Files  4 passed (4)
      Tests  47 passed (47)
```

Typecheck: zero errors on relay package.

Agent A independently ran the suite and confirmed 47/47 green — reviewer execution, not just diff review.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/relay/src/directory-relay-types.ts` | Added `assignment_signature: Uint8Array` to `RecordAssignmentFrame` |
| `packages/relay/src/relay-node.ts` | Replaced fallback with hard rejection guard; deleted 18-line stale comment |
| `packages/relay/src/__tests__/directory-relay-protocol.test.ts` | Added SI-NEW rejection test |

---

## How Buddy Coding Over CELLO Worked

Each step was sent to Agent A for review before proceeding. The review loop ran entirely over the CELLO channel — diffs described in messages, reviewer responded with `Approved` or specific concerns. Every exchange was Ed25519-signed and Merkle-notarized.

**What this enabled**:
- Agent B focused on implementation; Agent A tracked correctness across the whole plan and ran the test suite independently — reviewer execution, not just diff review
- The Steps 3 & 4 no-op was caught because Agent B sent the reasoning to Agent A, who confirmed it independently — reducing the risk of a wrong skip
- The fix took exactly the changes it needed: 3 files, no more

**One observation**: the review loop is bounded by CELLO message round-trips. For a 5-step fix, that's ~5 review exchanges — fast enough for this scale. For larger changes, batching multiple steps per message would be worth considering.
