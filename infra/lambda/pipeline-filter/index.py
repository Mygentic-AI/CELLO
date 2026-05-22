"""
cello-pipeline-filter Lambda

Reads changed file paths from a GitHub push payload (delivered via EventBridge),
looks up matching CodePipelines from infra/pipeline-mappings.json, and triggers
each matched pipeline.

AC-007: The mappings are data-driven — read from pipeline-mappings.json at
invocation time. No Lambda redeployment is required to add a new pipeline.

AC-002: A path under packages/directory/ triggers only cello-directory-pipeline.
AC-003: A path under packages/crypto/ triggers ALL 8 CELLO pipelines (crypto is
        a shared dependency — changing it requires downstream re-test everywhere).
AC-004: A root config file (tsconfig.base.json, pnpm-workspace.yaml, package.json)
        triggers all 8 CELLO pipelines.
DB-002: A single pipeline start failure does not block other pipelines; each is
        attempted independently.

Observability:
  - pipeline.triggered (INFO) — fields: pipeline, commitSha, matchedPath,
    executionId
  - pipeline.trigger.failed (ERROR) — fields: pipeline, reason

Pseudocode:
  1. Load pipeline-mappings.json from /var/task/ (Lambda working directory).
     - packageMappings: list of { prefix, pipelines }
     - rootConfigFiles: list of filenames that trigger all pipelines
     - allCelloPipelines: list of all 8 pipeline names
  2. Parse EventBridge event.detail to get commit list.
  3. Collect changed file paths from modified + added + removed across all commits.
  4. If any changed path is in rootConfigFiles → trigger allCelloPipelines.
  5. Else → for each mapping, if any changed path starts with mapping.prefix →
     add mapping.pipelines to the trigger set.
  6. For each pipeline in the trigger set:
     a. Call codepipeline.start_pipeline_execution(name=pipeline).
     b. On success → log pipeline.triggered with executionId.
     c. On failure → log pipeline.trigger.failed with reason, continue.
  7. Return 200 with summary.
"""

import json
import os

import boto3

# ── Clients ────────────────────────────────────────────────────────────────
codepipeline = boto3.client("codepipeline")


# ── Structured logging ─────────────────────────────────────────────────────

def _log(level: str, event_name: str, **fields) -> None:
    """Emit a structured JSON log line to stdout (CloudWatch)."""
    record = {"event": event_name, "level": level, **fields}
    print(json.dumps(record), flush=True)


# ── Mappings loader ────────────────────────────────────────────────────────
# Loaded once per Lambda container from /var/task/pipeline-mappings.json.
# This is the data-driven heart of AC-007: updating the JSON file in the
# source artifact is sufficient to change routing — no Lambda code change needed.
_cached_mappings: dict | None = None


def _load_mappings() -> dict:
    """
    Load pipeline-mappings.json from the Lambda working directory.
    Cached in module scope for warm invocations.
    """
    global _cached_mappings
    if _cached_mappings is not None:
        return _cached_mappings

    # /var/task is the Lambda deployment package root.
    mappings_path = os.path.join(os.path.dirname(__file__), "pipeline-mappings.json")
    with open(mappings_path) as f:
        _cached_mappings = json.load(f)
    return _cached_mappings


def _collect_changed_files(detail: dict) -> list:
    """Collect all changed file paths from modified + added + removed in commits."""
    changed = []
    for commit in detail.get("commits", []):
        for field in ("modified", "added", "removed"):
            changed.extend(commit.get(field, []))
    return changed


def _resolve_pipelines(changed_files: list, mappings: dict) -> set:
    """
    Determine which pipelines to trigger given the changed file list.

    Root config files trigger all 8 CELLO pipelines.
    Package path prefixes trigger the pipelines listed for that prefix.
    """
    root_config_set = set(mappings.get("rootConfigFiles", []))
    all_cello = mappings.get("allCelloPipelines", [])
    package_mappings = mappings.get("packageMappings", [])

    pipelines_to_trigger = set()

    # Root config check: any match triggers all CELLO pipelines.
    for path in changed_files:
        if path in root_config_set:
            pipelines_to_trigger.update(all_cello)
            return pipelines_to_trigger  # already maximum set

    # Package prefix check.
    for mapping in package_mappings:
        prefix = mapping["prefix"]
        matching = [p for p in changed_files if p.startswith(prefix)]
        if matching:
            pipelines_to_trigger.update(mapping["pipelines"])

    return pipelines_to_trigger


def lambda_handler(event, context):
    """Lambda entry point for cello-pipeline-filter."""

    # ── 1. Load data-driven mappings ────────────────────────────────────────
    try:
        mappings = _load_mappings()
    except Exception as exc:
        _log("error", "pipeline.filter.mappings_load_failed", reason=str(exc))
        return {"statusCode": 500, "body": json.dumps({"error": "Failed to load mappings"})}

    # ── 2. Parse EventBridge detail ─────────────────────────────────────────
    detail_raw = event.get("detail", "{}")
    if isinstance(detail_raw, str):
        try:
            detail = json.loads(detail_raw)
        except json.JSONDecodeError:
            detail = {}
    else:
        detail = detail_raw

    commit_sha = detail.get("after", detail.get("head_commit", {}).get("id", "unknown"))

    # ── 3. Collect changed files ─────────────────────────────────────────────
    changed_files = _collect_changed_files(detail)

    # ── 4. Resolve which pipelines to trigger ───────────────────────────────
    pipelines_to_trigger = _resolve_pipelines(changed_files, mappings)

    if not pipelines_to_trigger:
        _log("info", "pipeline.filter.no_match", changedFileCount=len(changed_files))
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "No matching pipelines.", "changedFiles": changed_files}),
        }

    # ── 5. Trigger each matched pipeline ────────────────────────────────────
    # DB-002: failure of one pipeline does not block others.
    triggered = []
    for pipeline_name in pipelines_to_trigger:
        # Identify the first matching path for observability context.
        matched_path = "root_config"
        for mapping in mappings.get("packageMappings", []):
            if pipeline_name in mapping["pipelines"]:
                prefix = mapping["prefix"]
                candidates = [p for p in changed_files if p.startswith(prefix)]
                if candidates:
                    matched_path = candidates[0]
                    break

        try:
            resp = codepipeline.start_pipeline_execution(name=pipeline_name)
            execution_id = resp["pipelineExecutionId"]
            _log(
                "info",
                "pipeline.triggered",
                pipeline=pipeline_name,
                commitSha=commit_sha,
                matchedPath=matched_path,
                executionId=execution_id,
            )
            triggered.append({"pipeline": pipeline_name, "executionId": execution_id})
        except Exception as exc:
            _log(
                "error",
                "pipeline.trigger.failed",
                pipeline=pipeline_name,
                reason=str(exc),
            )

    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": f"Triggered {len(triggered)} pipeline(s)",
            "pipelines": triggered,
        }),
    }
