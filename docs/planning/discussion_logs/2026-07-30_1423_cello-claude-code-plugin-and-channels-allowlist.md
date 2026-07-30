---
name: cello-claude-code-plugin-and-channels-allowlist
type: discussion
date: 2026-07-30
topics:
  - claude-code-plugin
  - channels
  - distribution
  - skills
  - cello-client
  - managed-settings
description: Built the CELLO Claude Code plugin and marketplace, and established empirically how to get the channels doorbell off --dangerously-load-development-channels. A marketplace alone does not remove the warning; allowedChannelPlugins in managed settings does, but only on the machine that has the file.
---

# The CELLO Claude Code plugin, and getting the channel off the dangerous flag

## Why

Running the CELLO doorbell required `claude --dangerously-load-development-channels server:cello`,
which puts a full-screen red warning in front of every launch:

> `--dangerously-load-development-channels` is for local channel development only. Do not use this
> option to run channels you have downloaded off the internet.

That is a poor first impression for a trust-infrastructure product, and it is the first thing a
prospective user sees. The starting hypothesis — from a Perplexity answer — was that publishing our own
plugin marketplace would remove it.

## Finding 1 — a marketplace does NOT remove the warning

The hypothesis was wrong, and the official docs say so directly
(`code.claude.com/docs/en/channels-reference` → *Package as a plugin*):

> A channel published to your own marketplace **still needs
> `--dangerously-load-development-channels` to run**, since it isn't on the approved allowlist. The
> default allowlist is the channel plugins in `claude-plugins-official`, which Anthropic curates at
> its discretion. The in-app submission forms add plugins to the community marketplace, **which is not
> on the channel allowlist**.

Two separate gates are being conflated:

| Gate | What it controls | How you pass it |
|---|---|---|
| Plugin installability | can a user `/plugin install` it | publish a marketplace |
| **Channel allowlist** | can it register as a channel | Anthropic's curated list, or `allowedChannelPlugins` |

Only three documented routes off the dev flag:

1. Get into `anthropics/claude-plugins-official` — requires an Anthropic partner contact.
2. `allowedChannelPlugins` in managed settings — documented for Team/Enterprise admins.
3. Stay on the dev flag.

Packaging as a plugin is a prerequisite for (1) and (2) and is better distribution than
`claude mcp add` regardless, so it was worth doing either way.

## Finding 2 — route 2 works, and was measured, not assumed

**Baseline.** With the plugin installed and no managed-settings file, the startup banner read:

```
▎ Channels (experimental) messages from plugin:cello@cello-protocol inject
▎ directly in this session · restart without --channels to stop
▎ plugin:cello@cello-protocol · not on the approved channels allowlist
```

The channel did not register. Note the failure mode: Claude Code starts **normally** and the channel
silently does nothing. No error, no exit code.

**After writing `/Library/Application Support/ClaudeCode/managed-settings.json`** (requires sudo):

```json
{
  "channelsEnabled": true,
  "allowedChannelPlugins": [
    { "marketplace": "cello-protocol", "plugin": "cello" },
    { "marketplace": "claude-plugins-official", "plugin": "telegram" },
    { "marketplace": "claude-plugins-official", "plugin": "discord" },
    { "marketplace": "claude-plugins-official", "plugin": "imessage" },
    { "marketplace": "claude-plugins-official", "plugin": "fakechat" }
  ]
}
```

the allowlist line disappeared and no confirmation screen appeared. Verified Telegram still registers
afterwards. The working command is now:

```bash
claude --channels plugin:cello@cello-protocol
```

**`allowedChannelPlugins` REPLACES the Anthropic allowlist entirely.** Listing only `cello` would have
silently killed the Telegram channel. The four official entries above are there for that reason — do
not trim them.

**Scope limit, and it is the important caveat.** Managed settings is a file on one machine. This fixes
it for *this* machine only. Every other user still gets the red screen unless they write the same file
or their org admin does. **Only getting onto Anthropic's curated list fixes it for everybody.** The
account was on `apemmelaar@gmail.com's Organization`, which is why the managed-settings route applied
at all.

## What was built

In `cello-client` (public, `Mygentic-AI/cello-client`):

```
.claude-plugin/marketplace.json          marketplace "cello-protocol"
plugins/cello/
  .claude-plugin/plugin.json             plugin "cello", channels: [{ server: "cello" }]
  .mcp.json                              npx --yes @cello-protocol/connect@latest
  skills/cello/SKILL.md                  the operating manual
  skills/setup/SKILL.md                  first-run: install daemon, register, configure
  skills/reconnect/SKILL.md              reboot + upgrade recovery
  skills/receptionist/SKILL.md           the answering-service pattern
  agents/cello-receptionist.md           blocking poller subagent
```

Inventory and cost, from `claude plugin details`:

```
Skills (4)  cello, receptionist, reconnect, setup
Agents (1)  cello-receptionist
MCP servers (1)  cello
Always-on: ~496 tok
  cello ~100/6.2k · setup ~110/2.2k · receptionist ~100/2.3k
  reconnect ~100/1.8k · cello-receptionist ~100/740
```

### Why these four skills and not five

The split is by **the moment you need it**, because skills load by description match, not by topic.
A `concepts` skill was written and then cut: three of its six ideas were already in `cello` verbatim
(seal-proves-receipt-not-assent, endorsement-text-is-untrusted, agent-cannot-weaken-guards). The
three genuinely unique ones were folded into the top of `cello`, kept because each changes behavior
rather than describing architecture — the relay can't read content, identity is the key and never the
name, a node being down is the design working.

`reconnect` is deliberately **not** called "upgrade" and is deliberately separate from `setup`. A user
cannot tell a reboot from a version skew: both present as "my cello tools stopped working." One skill
triggered on the *symptom* gets loaded; a skill described as "first-time setup" never fires for a
Tuesday-morning outage. It is keyed on a symptom table — `daemon_not_running` /
`ipc_connection_lost` / `Unknown IPC method` / no-tools-at-all.

`cello-walkie-talkie` was **not** revived. Its content (session flow, send-then-receive, signal
tokens) is what `cello` now carries. Andre: *"It was a good skill for that stage, but it's not what we
need anymore."*

## Consequences of the plugin route

**Tool names change.** Under a plugin, `mcp__cello__cello_send` becomes
`mcp__plugin_cello_cello__cello_send` — confirmed live, same shape as
`mcp__plugin_telegram_telegram__reply`. The token cost is noise. The real cost is that name-keyed
config silently stops matching: seven pre-approved permission entries in
`~/.claude/settings.local.json` and `trustless-cello/.claude/settings.local.json` went dead, which
produces fresh permission prompts for tools that were already allowed. The `<channel source=...>`
attribute becomes `plugin:cello:cello` too.

**The plugin does not install a working CELLO.** Plugin install copies files into
`~/.claude/plugins/cache/` and runs nothing. The shim arrives lazily via `npx --yes`, but
`@cello-protocol/cli` — the `cello` binary and the daemon — does not. A new user installs, sees the
tools, calls one, and gets `daemon_not_running`. The `setup` skill is the only thing that closes that
gap today. A `SessionStart` hook could install the CLI into `${CLAUDE_PLUGIN_DATA}`, but `cello login`
starts a long-running process holding key material and a network identity — a much larger claim on the
user's machine than a plugin install normally makes, and process lifecycle is deliberately the
operator's concern. Left undone on purpose.

## Distribution: Cowork cannot take a local path

Claude Code's CLI accepts a filesystem path (`/plugin marketplace add ./my-marketplace`). **Cowork's
Add-marketplace dialog accepts only "a GitHub `owner/repo` or a git repository URL."** So the local
path that works for development does not work for Cowork. The route is
`Mygentic-AI/cello-client` → Sync, which is also the route real users take. The repo is public and all
eight files are on `origin/main`.

## Defects found along the way

- **`cello_send` requires `signal`, and the shipped `SKILL.md` never mentioned it.** An agent
  following the npm-tarball manual gets *"Missing signal token"* on its first send. Fixed in the
  bundled skill; the tarball copy has since been corrected too.
- **The tier names in `SKILL.md` were wrong.** Documented as `1=stranger … 3=trusted`; the settable
  keys are `unknown|known|whitelisted|vip`. `bounds.stranger.max_sessions` fails. The real
  `DEFAULT_TIER_BOUNDS` grid is now in `setup`: blocked 0/0, unknown 3/25MB, known 5/100MB,
  whitelisted 20/500MB, vip 50/2GB.
- **`cello_session_id` had not propagated to the instruction files.** 25 argument sites across
  `cello-client/README.md`, `.claude/commands/cello-chat.md`, and three `trustless-cello` commands
  still said `session_id`. Renamed, arguments only — **response and notification fields stay
  `session_id`** per the source comment. `docs/planning/` was left alone: those are a record of what
  the surface was at the time, not instructions.
- **A daemon shutdown rings the doorbell.** See below.

## Open defect — shutdown is indistinguishable from an incoming call

A `<channel source="cello">` event fired mid-session. It was not a caller. The shim's stderr:

```
{"event":"notification.channel.forwarded","type":"shutdown"}   ×9
cello-mcp: daemon connection lost — reconnecting…              ×9
```

The daemon had exited (`security.gateway.exited`), and its shutdown was forwarded through the channel
with the same generic shape as a real doorbell. From inside the session there is no way to tell "you
have a message" from "your daemon just died" — it took reading the daemon's own stderr log to find
out. An agent following the channels contract calls `cello_inbox`, gets `daemon_not_running`, and
reports a protocol failure.

`channel-params.ts` already synthesizes content-free doorbell text per event type; `shutdown` appears
to fall through to a generic path. Two candidate fixes: do not forward `shutdown` through the channel
at all, or give it distinguishable `meta` so the tag says what happened.

## Pins are out

The `.mcp.json` originally pinned `@cello-protocol/connect@0.0.97`. **Removed — it is now `@latest`,
and pins are not to be reintroduced anywhere.** Version skew between shim and daemon is solved by
floating both sides and documenting the restart, never by pinning. The plugin's own `version` field is
decoupled from the shim version so a docs-only change does not require a shim republish.

## Still open

- `trustless-cello/.claude/` still holds its own `cello-receptionist` (now diverged from the plugin's)
  and `cello-walkie-talkie`.
- Anthropic curated-list submission — the only fix that reaches other people's machines.
- The `shutdown` doorbell defect above.
- The `SessionStart`-hook question for daemon install, deliberately deferred.
