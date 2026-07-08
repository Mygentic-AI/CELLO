#!/usr/bin/env bash
# ── CELLO PUBLISH GUARD (PreToolUse hook) ─────────────────────────────────────
# Turns the "always run /cello-publish before publishing" rule from skippable prose
# into a hard stop. Two jobs, keyed off the tool call JSON on stdin:
#   1. Skill tool invoked with skill=cello-publish  → record a fresh marker.
#   2. Bash publish-trigger command (dist-tag/publish/version tag/tag-push)
#        → BLOCK (exit 2) unless the marker is fresh (skill loaded for THIS publish).
# Freshness window is short (20 min) on purpose: a SECOND publish later in the same
# session must re-load the skill — that "loaded once earlier ≠ covered" gap is exactly
# what burned a cascade before. Fail-open: any parsing error exits 0 (never blocks work).

marker="$HOME/.cache/.cello-publish-guard"
fresh_secs=1200
jq_bin=/usr/bin/jq
[ -x "$jq_bin" ] || jq_bin="$(command -v jq 2>/dev/null || true)"

input="$(cat)"

# Fast path: only publish-relevant tool calls do any real work.
printf '%s' "$input" | grep -Eq 'dist-tag|npm[[:space:]]+publish|pnpm[[:space:]]+publish|git[[:space:]]+tag|git[[:space:]]+push|cello-publish' || exit 0
[ -n "$jq_bin" ] || exit 0   # no jq → fail open

tool="$(printf '%s' "$input" | "$jq_bin" -r '.tool_name // empty' 2>/dev/null || true)"

# 1. Record the marker whenever the /cello-publish skill is invoked.
if [ "$tool" = "Skill" ]; then
  skill="$(printf '%s' "$input" | "$jq_bin" -r '.tool_input.skill // empty' 2>/dev/null || true)"
  case "$skill" in
    cello-publish|*:cello-publish) mkdir -p "$HOME/.cache" && : > "$marker" ;;
  esac
  exit 0
fi

# 2. Guard publish-trigger Bash commands.
if [ "$tool" = "Bash" ]; then
  cmd="$(printf '%s' "$input" | "$jq_bin" -r '.tool_input.command // empty' 2>/dev/null || true)"
  # Anchor each trigger to a command-START position (line start, or after && ; |) so the same
  # strings appearing INSIDE a quoted arg — e.g. a git commit -m "…npm dist-tag add…" message —
  # do NOT false-trigger. grep is line-based, so `^[[:space:]]*` = the verb leads its line.
  # Anchor to line-start or after && / ; only (NOT after a pipe): a real publish command leads its
  # segment; it is never *piped into*. This also means prose like "npm|pnpm publish" in a commit
  # message (pipe-separated) does not false-trigger.
  trig='(npm[[:space:]]+dist-tag[[:space:]]+add|npm[[:space:]]+publish|pnpm[[:space:]]+publish|git[[:space:]]+tag[[:space:]]+(-a[[:space:]]+)?v[0-9]|git[[:space:]]+push[[:space:]][^&;|]*[[:space:]]v[0-9])'
  if printf '%s' "$cmd" | grep -Eq "(^|&&|;)[[:space:]]*$trig"; then
    if [ -f "$marker" ]; then
      now="$(date +%s)"
      mtime="$(stat -f %m "$marker" 2>/dev/null || stat -c %Y "$marker" 2>/dev/null || echo 0)"
      [ $(( now - mtime )) -lt "$fresh_secs" ] && exit 0
    fi
    {
      echo "🚨 CELLO PUBLISH GUARD — blocked. This is a publish action:"
      echo "    $cmd"
      echo
      echo "Invoke the /cello-publish skill FIRST (Skill tool, skill: cello-publish) — for THIS publish,"
      echo "even if you loaded it earlier in the session (loaded-once ≠ covered). It is the authoritative"
      echo "procedure; publishing from memory has burned npm versions and skewed workspace:* cross-pins."
      echo "Load it, follow it, then re-run this command."
    } >&2
    exit 2
  fi
fi
exit 0
