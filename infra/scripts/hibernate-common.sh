#!/usr/bin/env bash
# ==============================================================================
# hibernate-common.sh — shared helpers for hibernate.sh / wake.sh
# ==============================================================================
# Sourced by both scripts. Modelled directly on cello-agent's hibernate-common.sh.
#
# DESIGN PRINCIPLE: never trust STATE.md or config files. hibernate.sh discovers
# everything live and writes hibernation-state.json; wake.sh reads only that file.
# ==============================================================================

set -euo pipefail

# --- Environment / cluster (override via env) ---------------------------------
export ENVIRONMENT="${ENVIRONMENT:-dev}"
CLUSTER_NAME="cello-${ENVIRONMENT}"
HOSTED_ZONE_ID="Z02692523DOH7NW521CL8"
DOMAIN="cello.mygentic.ai"

# --- State file ---------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_FILE="${STATE_FILE:-${INFRA_DIR}/hibernation-state.json}"

# --- Execution mode -----------------------------------------------------------
DRY_RUN="${DRY_RUN:-1}"

# --- Dry-run gate -------------------------------------------------------------
# WHY THIS EXISTS: a7cef102 (2026-07-26 11:11) added the portal capture to
# hibernate.sh above the block that assigns $portal_alb_arn. Under `set -u` that
# aborts on the first region — the script was completely unrunnable. Nobody found
# out for 32 hours, because nothing exercises these scripts except a human running
# one, and the next human to run one was doing it for real. There is no CI here
# (CodePipeline only builds images), so the gate has to live in the script.
#
# Rule: --execute refuses to run unless a dry-run of the CURRENT file contents has
# passed. The dry-run is read-only and costs ~2 min. It would have caught the above
# instantly. Escape hatch: --skip-dryrun-check, so this can never strand a wake at
# 3am — but it must be typed deliberately.
DRYRUN_MARKER_DIR="${INFRA_DIR}/.dryrun-ok"

_script_hash() { shasum -a 256 "$0" 2>/dev/null | cut -d' ' -f1; }
_marker_path() { echo "${DRYRUN_MARKER_DIR}/$(basename "$0").$(_script_hash)"; }

# Called at the end of a successful dry-run.
record_dryrun_pass() {
  [[ "${DRY_RUN}" == "1" ]] || return 0
  mkdir -p "${DRYRUN_MARKER_DIR}" 2>/dev/null || return 0
  # Keep only the current hash — a stale marker for old contents is worse than none.
  rm -f "${DRYRUN_MARKER_DIR}/$(basename "$0")".* 2>/dev/null || true
  : > "$(_marker_path)" 2>/dev/null || true
}

# Called before any live mutation.
require_dryrun_pass() {
  [[ "${DRY_RUN}" == "1" ]] && return 0
  [[ "${SKIP_DRYRUN_CHECK:-0}" == "1" ]] && {
    warn "Dry-run gate SKIPPED by --skip-dryrun-check. You are running unverified script contents."
    return 0
  }
  [[ -f "$(_marker_path)" ]] && return 0
  err "No dry-run has passed for the CURRENT contents of $(basename "$0")."
  err "These scripts have no CI. A syntax-clean edit can still abort mid-run under 'set -u'"
  err "(that is exactly what happened on 2026-07-26 and went unnoticed for 32 hours)."
  echo ""
  echo "  Run the read-only dry-run first:   $0"
  echo "  Then re-run with --execute."
  echo "  Deliberate override:               $0 --execute --skip-dryrun-check"
  exit 1
}

# --- Colors -------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

log()   { echo "${C_CYAN}[$(date -u +%H:%M:%S)]${C_RESET} $*"; }
step()  { echo ""; echo "${C_BOLD}${C_BLUE}==> $*${C_RESET}"; }
ok()    { echo "${C_GREEN}  ✓ $*${C_RESET}"; }
warn()  { echo "${C_YELLOW}  ! $*${C_RESET}"; }
err()   { echo "${C_RED}  ✗ $*${C_RESET}" >&2; }
fatal() { err "$*"; exit 1; }

# Dry-run-gated execution. Use run() for every MUTATING AWS call.
run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "${C_YELLOW}  [dry-run] ${C_RESET}$*"
    return 0
  fi
  echo "${C_BLUE}  \$ ${C_RESET}$*"
  "$@"
}

require_tools() {
  for t in aws jq python3; do
    command -v "$t" >/dev/null 2>&1 || fatal "Required tool not found on PATH: $t"
  done
  aws sts get-caller-identity >/dev/null 2>&1 || fatal "AWS credentials not valid"
}

banner() {
  local title="$1"
  local regions="${2:-}"
  echo "${C_BOLD}=============================================================${C_RESET}"
  echo "${C_BOLD} ${title}${C_RESET}"
  echo "${C_BOLD} environment=${ENVIRONMENT}  cluster=${CLUSTER_NAME}${C_RESET}"
  [[ -n "${regions}" ]] && echo "${C_BOLD} regions=${regions}${C_RESET}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "${C_YELLOW}${C_BOLD} MODE: DRY-RUN (no changes — pass --execute to apply)${C_RESET}"
  else
    echo "${C_RED}${C_BOLD} MODE: EXECUTE (live changes WILL be made)${C_RESET}"
  fi
  echo "${C_BOLD} state file: ${STATE_FILE}${C_RESET}"
  echo "${C_BOLD}=============================================================${C_RESET}"
}

confirm_execute() {
  [[ "${DRY_RUN}" == "1" ]] && return 0
  [[ "${ASSUME_YES:-0}" == "1" ]] && return 0
  echo ""
  read -r -p "${C_YELLOW}Proceed with LIVE changes? [y/N] ${C_RESET}" reply
  [[ "${reply}" =~ ^[Yy]$ ]] || fatal "Aborted by user."
}

# Map region → subdomain prefixes used in Route53
dir_subdomain()   { case "$1" in us-east-1) echo "directory-us1" ;; eu-central-1) echo "directory-eu1" ;; ap-northeast-1) echo "directory-ap1" ;; *) echo "directory-${1}" ;; esac; }
relay_subdomain() { case "$1" in us-east-1) echo "relay-us1"     ;; eu-central-1) echo "relay-eu1"     ;; ap-northeast-1) echo "relay-ap1"     ;; *) echo "relay-${1}"     ;; esac; }
