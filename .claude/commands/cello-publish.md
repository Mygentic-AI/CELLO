---
name: cello-publish
description: How to publish the cello-client npm packages. Use when bumping versions, publishing to beta, or promoting to latest. Enforces the correct commit ordering that prevents shipping incomplete code.
---

# Publishing @cello-protocol/connect

## The rule that must never be violated

**The version bump commit and tag MUST be the very last thing on the branch — after every other code commit is in place.**

CI builds from the tag. Any commit pushed after the tag is ignored by the published package. This has caused broken publishes. Do not bump the version until you are certain no more code changes are needed.

## How CI publishes — critical to understand before tagging

The GitHub Actions workflow has a pre-publish gate: it checks that npm already has the sub-packages (`@cello-protocol/client`, etc.) at the version numbers in the local `package.json` before allowing the connect publish to proceed.

**This gate ONLY passes if the sub-packages were previously published.** Sub-packages get their versions bumped and published in the same CI run. If you push the version bump commit and the tag simultaneously:

1. Main-branch CI runs (no publish step — tags only)
2. Tag CI runs in parallel → pre-publish gate checks npm → npm still has OLD version → gate FAILS → publish step does NOT run

**Result: the tag is burned, a corrupt 0-byte binary is published, and you need to bump again.**

**The correct sequence:**

1. Push the version bump commit to main FIRST (no tag yet)
2. Wait for the main-branch CI to pass (it runs tests/build/lint but does NOT publish — confirm it's green)
3. Confirm npm has the new versions: `npm view @cello-protocol/client@beta version`
4. Only THEN push the tag

Wait — re-read step 2. Main-branch CI does NOT publish. Sub-packages are not published by main-branch CI. They are published only by the tag CI. So the pre-publish gate's intent is: "client was published in a prior tag run, now we're publishing connect." This means client and connect need **separate tags** if they're bumped together.

**Actually the correct flow is:** The tag CI publishes ALL packages including client. The pre-publish gate is checking that the packages match what's already on beta — which would only be true if client was previously published separately. This gate is designed for the case where only connect changes (client version stays the same as what's already on npm).

**When BOTH client and connect change (the common case), the pre-publish gate will always fail.** This is a CI workflow design bug. The workaround: push the tag, let it fail the gate, but confirm the packages WERE published (the publish step runs despite the gate failure with `|| true`). Then verify the binary.

## Step 1: Confirm all code commits are in place

Before touching any version number:

```bash
git log --oneline main | head -10
```

Verify every commit you intend to ship is already on main and there are no outstanding code changes pending. If in doubt, make the code commits first.

## Step 2: Bump versions

In `cello-client`:

1. Increment `core/client/package.json` → `"version"` (`0.0.X` → `0.0.X+1`)
2. Increment `core/adapter-claude-code/package.json` → `"version"` (`0.0.Y` → `0.0.Y+1`)
3. Run `pnpm install` to update the lockfile
4. Commit:

```bash
git add core/client/package.json core/adapter-claude-code/package.json pnpm-lock.yaml
git commit -m "chore: version bump — client X.X.X→X.X.X+1, connect Y.Y.Y→Y.Y.Y+1"
```

## Step 3: Tag and push

```bash
git tag v{connect-version}
git push origin main
git push origin v{connect-version}
```

The tag CI will likely FAIL at the pre-publish gate (because it checks npm before publishing client). This is expected. The publish step still runs regardless (it uses `|| true`). Wait for the run to complete.

## Step 4: Verify the binary — not the CI status

**CI failure at the gate does NOT mean the packages weren't published.** Always verify the actual binary.

Check npm versions:
```bash
npm view @cello-protocol/client@beta version
npm view @cello-protocol/connect@beta version
```

Then verify the fix code is in the published client package (NOT the connect binary — the fix lives in client):
```bash
cd /tmp
npm pack @cello-protocol/client@{new-client-version} 2>/dev/null
tar xzf cello-protocol-client-{new-client-version}.tgz
grep "your.new.string" package/dist/mcp-server.js
```

Pick a string unique to your change. If grep returns no matches: the code is not in the package. Investigate and republish with the next version number.

Also confirm connect's dependency points to the new client version:
```bash
npm view @cello-protocol/connect@{new-connect-version} dependencies
# Must show "@cello-protocol/client": "{new-client-version}", NEVER "workspace:*"
```

## Step 5: Update trustless-cello dependency

In `trustless-cello/packages/directory/package.json`, update:

```json
"@cello-protocol/client": "^0.0.{new-client-version}"
```

Then:

```bash
pnpm install
pnpm run typecheck
git add packages/directory/package.json pnpm-lock.yaml
git commit -m "chore: update @cello-protocol/client to 0.0.{N}"
git push origin main
```

## Step 6: Install on demo agent (EC2 via SSM)

```bash
aws ssm start-session --target {instance-id} --document-name AWS-StartInteractiveSSMSession --region us-east-1
# Then in SSM session:
cd /opt/cello-demo && npm install @cello-protocol/connect@{new-connect-version}
sudo systemctl restart cello-demo
```

## Step 7: Promote to latest — REQUIRED before MCP reconnects

**Always promote to `latest` after verifying the binary.** This is not optional. Claude Code and npx without a pinned version both resolve `latest` — if `latest` still points to an old version, reconnect will silently serve stale code.

**Tell the human operator to run this command:**

```bash
npm dist-tag add @cello-protocol/connect@{version} latest
```

Do not proceed past this step until they confirm they have run it.

Then ask them to verify:
```bash
npm view @cello-protocol/connect@latest version
# Must match the version you just published
```

**Then ask the human operator to reconnect the MCP server** — restart Claude Code or disconnect/reconnect via `/mcp`. The new version does not take effect until they do.

## Common mistake: checking the connect binary instead of the client package

The `dist/bin/cello-mcp.js` in the connect tarball is the compiled `cello-mcp.ts` entrypoint. It imports `@cello-protocol/client` at runtime — it does NOT contain the client code inline. Most fixes (mcp-server.ts, signaling-manager.ts, session-manager.ts) live in client. Always grep the client package dist, not the connect binary.
