---
name: cello-publish
description: How to publish the cello-client npm packages. Use when bumping versions, publishing to beta, or promoting to latest. Enforces the version cascade and the three-registration rule that prevent shipping empty or skewed packages.
---

# Publishing the @cello-protocol packages

## What ships, and what an operator installs

cello-client publishes **seven** packages (plus `interfaces`, which originates in trustless-cello):
`crypto`, `protocol-types`, `transport`, `client`, `daemon`, `cli`, `connect`.

The architecture matters for publishing:
- **`connect`** (`@cello-protocol/connect`) is a thin **MCP shim**. It creates no libp2p node; it proxies
  to a running daemon over `~/.cello/daemon.sock`.
- **`daemon`** (`@cello-protocol/daemon`) is the heavy local node — crypto, FROST, transport, SQLite. This
  is where most protocol logic lives post-M7.
- **`cli`** (`@cello-protocol/cli`) provides the `cello` binary; `cello login` spawns the daemon. The cli
  depends on the daemon.

So an operator install is **`@cello-protocol/connect` + `@cello-protocol/cli`** (the cli pulls the daemon
transitively). Both must be on `latest` for the default install path to work. Installing connect alone gives
an MCP that fails with `daemon_not_running`.

## Invariants — violating any of these ships a broken package (all happened 2026-06-23)

**Source-level tests pass on a broken publish** — vitest runs TS source, not the built `dist/`. The only
checks that catch publish breakage are the CI Build "Publish-completeness" step and the `smoke-tag` job
(clean-installs the published packages and loads their module graphs). Trust those, not green unit tests.

1. **npm version ≡ published content.** If you change ANY `core/*` source, bump that package's version and
   republish — even if no dependent changed. Same version + different content = npm keeps the old build
   forever, and every consumer pinning it silently gets stale code. This broke `daemon`: `crypto` gained
   `sealToRecipient` without a bump, so published `crypto@0.0.8` lacked it and the daemon crashed at startup.

2. **Bump the whole cascade.** Inter-package deps inside cello-client are `workspace:*` and resolve to the
   current local version at publish time. Bump crypto → every package that depends on crypto must ALSO be
   bumped + republished to re-pin the fresh crypto, or their published copies keep pinning the old one.
   Dependency order: crypto, protocol-types → transport → client, daemon → cli, connect.

3. **A new publishable `core/*` package needs THREE registrations:** root `tsconfig.json` `references` (so
   `tsc --build` compiles it → non-empty `dist/`), the CI publish list in `ci.yml`, and the verify/smoke
   loops. Miss tsconfig → it publishes empty (`package.json` only). Miss the publish list → it never ships.
   The Build "Publish-completeness" step enforces the first two.

## Never run `npm publish`

CI publishes via `pnpm publish` on a `v*` git tag. `npm publish` ships raw `workspace:*` specifiers → broken
package → version burned forever.

## Procedure

### 1. Determine what changed and compute the cascade

```bash
# Which core packages have source changes since their last publish / last version bump?
git -C cello-client log --oneline -- core/<pkg>/src | head
```
List every package whose source changed, then add every package that (transitively) depends on those.
That full set gets bumped. When in doubt, bump all seven — version churn is free in alpha, and it guarantees
npm == local source with consistent pins.

### 2. Bump versions (in cello-client)

Increment `"version"` in each affected `core/*/package.json`. Inter-package `workspace:*` deps need no edit —
pnpm resolves them at publish. (`@cello-protocol/interfaces` is the one pinned, non-workspace dep — leave it
unless interfaces itself changed.)

```bash
pnpm install            # update lockfile
```

### 3. Commit — version bump LAST

The version-bump commit (and the tag) must be the last thing on the branch. CI builds from the tag; the
tagged commit's tree must contain every code change AND the bumped versions.

```bash
git add core/*/package.json pnpm-lock.yaml
git commit -m "chore: version cascade — <summary>"
git push origin main
```

### 4. Tag and push

The tag is just a monotonic CI trigger — **NOT** the connect version. They have **drifted** (e.g. tag
`v0.0.52` existed while connect was `0.0.48`), because a re-run/abandoned cycle can burn a tag without
bumping connect. So **always pick the next free `v*` counter**, never assume it equals the connect version:

```bash
git -C cello-client tag -l 'v*' --sort=-v:refname | head -1   # find the highest existing tag, e.g. v0.0.52
# then increment THAT counter (→ v0.0.53). Verify it is free before pushing:
git -C cello-client tag -l v0.0.53                            # must print nothing
git tag v0.0.53
git push origin v0.0.53
```

If you push a tag that already exists, the push is rejected (or re-triggers a stale build) — that is the
symptom of using the connect version blindly. The connect version is what gets PUBLISHED (from the
package.json versions on the tagged commit); the tag name only triggers the run.

The tag CI runs: Build (tests + the Publish-completeness guard) → `publish-tag` (publishes every package in
dependency order to the `beta` dist-tag; already-published versions are skipped via `|| true`) → the verify
step → `smoke-tag` (clean-installs `cli@beta` + `connect@beta` and loads the daemon/client module graphs).
A green `smoke-tag` is the real success signal.

> The old cross-repo e2e-gate (`e2e-gate-tag`) is **disabled** (`if: false`) — it required an OIDC role/secret
> that were never stood up and a `cello-e2e-tests-pipeline` that isn't green. Re-enable only after both exist.

### 5. Verify the published artifacts — not the CI status

```bash
# every package: beta == local
for p in crypto protocol-types transport client daemon cli connect; do
  echo "$p: $(npm view @cello-protocol/$p@beta version)"
done
# the package that changed actually contains your change (grep its dist, not connect's —
# connect is a shim; the logic is usually in daemon or client):
cd /tmp && npm pack @cello-protocol/daemon@{ver} && tar xzf cello-protocol-daemon-{ver}.tgz
grep "your.new.symbol" package/dist/*.js
# cross-pins are real versions, never workspace:*:
npm view @cello-protocol/cli@{ver} dependencies      # @cello-protocol/daemon must be the NEW daemon ver
npm view @cello-protocol/connect@{ver} dependencies  # client/crypto/transport must be the NEW versions
```

### 6. Promote to `latest` — REQUIRED (operator-run)

`beta` is what CI publishes; the default install path (`npx @cello-protocol/connect`, `npm i -g ...@latest`)
uses `latest`. Promotion is manual and human-run (needs Andre's explicit go). **WE PROMOTE, WE DO NOT PIN**
— pinning exact versions on operator machines is fragile and error-prone (Andre, 2026-07-07); the whole
point of `latest` is that nobody has to pin. `connect` and `cli` are the two installed by name; the rest
are transitive but **promote ALL SEVEN at their current published versions** so the whole `latest` graph is
consistent (unchanged packages just print a `latest is already set` warning — harmless).

Promote every package to `latest` at its exact published version — the canonical command set
(fill in the actual versions from step 5's verify; this is the real 2026-07-07 run):

```bash
npm dist-tag add @cello-protocol/connect@0.0.61 latest
npm dist-tag add @cello-protocol/cli@0.0.32 latest
npm dist-tag add @cello-protocol/daemon@0.0.35 latest
npm dist-tag add @cello-protocol/client@0.0.46 latest
npm dist-tag add @cello-protocol/crypto@0.0.18 latest
npm dist-tag add @cello-protocol/transport@0.0.16 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.18 latest
```

`npm dist-tag add` may prompt for a browser auth (`Authenticate your account at: https://…`) the first time
per session — press ENTER, complete it, done. A `+latest: @cello-protocol/<pkg>@<ver>` line confirms each.

Verify `latest` resolves to the promoted versions:

```bash
for p in connect cli daemon client crypto transport protocol-types; do echo "$p latest: $(npm view @cello-protocol/$p@latest version)"; done
```

**Propagation-lag caveat:** `npm view @…@latest version` hits an npm CDN cache that can lag ~1–2 min behind a
just-set dist-tag — so a package can briefly still read the OLD version right after promotion even though the
tag WAS set (the `+latest: …@<newver>` line is the authoritative confirmation). Re-run the verify loop after
a minute; it settles. This never blocks the operator install anyway, because `cli` pins `daemon` at an
**exact** version (e.g. cli@0.0.32 → daemon@0.0.35), so `npm i -g @cello-protocol/cli@latest` pulls the
correct daemon regardless of daemon's dist-tag propagation.

**Operators then just install `@latest`** — no pinning, ever. **Use `--prefer-online`:**
```bash
npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login   # restart the daemon onto the new binary (CLI lifecycle, not pkill)
# then reconnect the MCP: /mcp  (or restart Claude Code)
```

**Why `--prefer-online` is not optional right after a promotion.** `@latest` is resolved on the
OPERATOR'S machine, from npm's cached packument (`~/.npm/_cacache`) — npm reads `dist-tags.latest` out
of that cached JSON rather than asking the registry. Promote and install seconds apart and the cache
still predates the tag, so `@latest` installs the PREVIOUS version, the install reports success, and
`cello -v` shows the old number. It looks identical to a promotion that did not take. This burned two
rounds on 2026-07-31 (installed 0.0.99 then 0.0.100 while `latest` was 0.0.100 then 0.0.102).
`--prefer-online` forces revalidation. Verify on disk, not from the install's output:
```bash
node -p "require('$(npm prefix -g)/lib/node_modules/@cello-protocol/cli/package.json').version"
```

If a version was published empty by mistake, `npm deprecate @cello-protocol/<pkg>@<bad> "..."` it after
publishing the fixed one, and re-point `latest`.

### 7. Reconnect

Operator reinstalls (`npm i -g @cello-protocol/cli@latest @cello-protocol/connect@latest`), runs
`cello login` to start the daemon, then reconnects the MCP (`/mcp` or restart Claude Code). `cello status`
confirms the daemon is up.

## Verify against the binary, never against memory

After every publish, the truth is the tarball on npm — `npm pack` it and grep `dist/`. Never assume a change
shipped because the commit is on main; a missing tsconfig reference, a missing publish line, or an unbumped
version will silently drop it.
