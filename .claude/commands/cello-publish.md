---
name: cello-publish
description: How to publish the cello-client npm packages. Use when bumping versions, publishing to beta, or promoting to latest. Enforces the correct commit ordering that prevents shipping incomplete code.
---

# Publishing @cello-protocol/connect

## The rule that must never be violated

**The version bump commit and tag MUST be the very last thing on the branch — after every other code commit is in place.**

CI builds from the tag. Any commit pushed after the tag is ignored by the published package. This has caused broken publishes. Do not bump the version until you are certain no more code changes are needed.

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

## Step 3: Tag and push — this triggers CI publish

```bash
git tag v{connect-version}
git push origin main
git push origin v{connect-version}
```

CI will build from the tag and publish to npm beta dist-tag automatically.

## Step 4: Verify the binary — not the version number

Wait ~5 minutes for CI to complete, then verify the actual built binary contains your code. **Do not trust `npm view` version output alone.**

Pick a string that only exists in your new code (an event name, a log message, a function name) and grep for it in the published tarball:

```bash
cd /tmp
npm pack @cello-protocol/connect@{new-version} 2>/dev/null
tar xzf cello-protocol-connect-{new-version}.tgz
grep -r "your.new.event.name" package/dist/
```

If grep returns no matches: the code is not in the package. Do not proceed. Investigate why (wrong tag, CI built from wrong commit) and republish.

If grep returns matches: the code is confirmed in the binary. Proceed.

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

## Step 6: Promote to latest (manual, requires explicit user approval)

Beta is the default publish target. Only promote to `latest` when the user explicitly approves:

```bash
npm dist-tag add @cello-protocol/connect@{version} latest
```

## Common mistake: double-checking with npm view

`npm view @cello-protocol/connect@beta version` only tells you the version number is correct. It does not tell you the code is correct. Always grep the binary (Step 4).
