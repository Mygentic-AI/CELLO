"""
Unit tests for cello-pipeline-filter Lambda.

CELLO-M7-CICD-001 — updated to match post-REPOSPLIT-002 5-pipeline state.

AC-002: packages/directory/ change triggers only cello-directory-pipeline.
AC-004: tsconfig.base.json change triggers all 5 CELLO pipelines.
AC-006: allCelloPipelines has exactly 5 entries; sourceRepoMappings routes
        Mygentic-AI/cello-client to cello-e2e-tests-pipeline.
AC-007: Data-driven mappings — pipeline-mappings.json read at invocation time.
AC-012: All tests pass with zero failures.
AC-014: cello-client push event with invalid HMAC is rejected (webhook test).
DB-002: Single pipeline start failure does not block other pipelines.

Test coverage:
  - AC-002: packages/directory/ → only directory pipeline
  - AC-004: tsconfig.base.json → all 5 pipelines
  - AC-006: allCelloPipelines == 5; sourceRepoMappings present with cello-client entry
  - AC-007: unknown path → empty set (no pipelines triggered)
  - AC-012(d): cello-client repo push routes to cello-e2e-tests-pipeline via sourceRepoMappings
  - DB-002: one pipeline start_pipeline_execution failure does not block others
  - Observability: pipeline.triggered logged for each triggered pipeline
  - Observability: pipeline.trigger.failed logged for each failed pipeline
"""

import importlib.util
import io
import json
import os
import sys
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import MagicMock, patch

_fake_codepipeline = MagicMock()

# Post-REPOSPLIT-002 state: exactly 5 pipelines. cello-crypto-pipeline,
# cello-transport-pipeline, cello-client-pipeline, cello-protocol-types-pipeline
# are dead and removed.
ALL_CELLO_PIPELINES = [
    "cello-connect-pipeline",
    "cello-directory-pipeline",
    "cello-relay-pipeline",
    "cello-e2e-tests-pipeline",
    "cello-operations-agent-pipeline",
]


def _load_module():
    """Load a fresh instance of the pipeline-filter module with boto3 stubbed."""
    boto3_stub = types.ModuleType("boto3")

    def client(service_name, **kw):
        if service_name == "codepipeline":
            return _fake_codepipeline
        raise ValueError(f"Unexpected service: {service_name}")

    boto3_stub.client = client

    spec = importlib.util.spec_from_file_location(
        "pipeline_filter_index",
        os.path.join(os.path.dirname(__file__), "index.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    # Inject boto3 stub before exec.
    sys.modules["boto3"] = boto3_stub
    spec.loader.exec_module(mod)
    del sys.modules["boto3"]
    # Reset module-level cache so each test starts fresh.
    mod._cached_mappings = None
    mod.codepipeline = _fake_codepipeline
    return mod


def _make_event(changed_files: list) -> dict:
    """Build a minimal EventBridge event with the given changed files."""
    return {
        "detail": json.dumps({
            "after": "abcdef1234567890",
            "commits": [
                {
                    "modified": changed_files,
                    "added": [],
                    "removed": [],
                }
            ],
        })
    }


def _make_repo_event(repo_full_name: str, branch: str = "main", commit_sha: str = "abc123") -> dict:
    """Build a minimal EventBridge event for a source-repo-based routing lookup."""
    return {
        "detail": json.dumps({
            "repository": {"full_name": repo_full_name},
            "ref": f"refs/heads/{branch}",
            "after": commit_sha,
            "commits": [
                {
                    "modified": ["core/client/src/index.ts"],
                    "added": [],
                    "removed": [],
                }
            ],
        }),
        "source": repo_full_name,
    }


class TestPipelineFilter(unittest.TestCase):

    def setUp(self):
        _fake_codepipeline.reset_mock(side_effect=True, return_value=True)
        _fake_codepipeline.start_pipeline_execution.return_value = {
            "pipelineExecutionId": "exec-test-123"
        }

    # ── AC-002: packages/directory/ → only cello-directory-pipeline ─────────

    def test_directory_change_triggers_only_directory_pipeline(self):
        """AC-002: A path under packages/directory/ triggers only cello-directory-pipeline."""
        mod = _load_module()
        event = _make_event(["packages/directory/src/index.ts"])
        mod.lambda_handler(event, None)

        triggered_names = [
            args[0] if args else kwargs.get("name")
            for args, kwargs in [
                (c.args, c.kwargs)
                for c in _fake_codepipeline.start_pipeline_execution.call_args_list
            ]
        ]
        self.assertIn("cello-directory-pipeline", triggered_names)
        # None of the other pipelines should be triggered.
        for other in ALL_CELLO_PIPELINES:
            if other != "cello-directory-pipeline":
                self.assertNotIn(other, triggered_names, f"Unexpected pipeline triggered: {other}")

    # ── AC-004: tsconfig.base.json → all 5 pipelines ────────────────────────

    def test_root_config_triggers_all_pipelines(self):
        """AC-004: Changing tsconfig.base.json triggers all 5 CELLO pipelines."""
        mod = _load_module()
        event = _make_event(["tsconfig.base.json"])
        mod.lambda_handler(event, None)

        triggered_names = [
            args[0] if args else kwargs.get("name")
            for args, kwargs in [
                (c.args, c.kwargs)
                for c in _fake_codepipeline.start_pipeline_execution.call_args_list
            ]
        ]
        for pipeline in ALL_CELLO_PIPELINES:
            self.assertIn(pipeline, triggered_names, f"Missing pipeline: {pipeline}")

    def test_pnpm_workspace_triggers_all_pipelines(self):
        """pnpm-workspace.yaml is a root config file — triggers all 5 pipelines."""
        mod = _load_module()
        event = _make_event(["pnpm-workspace.yaml"])
        mod.lambda_handler(event, None)
        self.assertEqual(
            _fake_codepipeline.start_pipeline_execution.call_count,
            5,
        )

    def test_package_json_triggers_all_pipelines(self):
        """package.json at repo root triggers all 5 pipelines."""
        mod = _load_module()
        event = _make_event(["package.json"])
        mod.lambda_handler(event, None)
        self.assertEqual(
            _fake_codepipeline.start_pipeline_execution.call_count,
            5,
        )

    # ── AC-007: unknown path → empty (no pipelines triggered) ───────────────

    def test_unknown_path_triggers_no_pipelines(self):
        """AC-007: A path that matches no mapping triggers no pipelines."""
        mod = _load_module()
        event = _make_event(["docs/readme.md"])
        result = mod.lambda_handler(event, None)
        _fake_codepipeline.start_pipeline_execution.assert_not_called()
        body = json.loads(result["body"])
        self.assertIn("No matching pipelines", body.get("message", ""))

    # ── DB-002: single pipeline failure does not block others ────────────────

    def test_single_pipeline_failure_does_not_block_others(self):
        """DB-002: One pipeline failure in a 5-pipeline set still attempts all 5."""
        mod = _load_module()

        # root config change → all 5 pipelines; make one fail, rest succeed.
        def start_side_effect(*args, **kwargs):
            name = args[0] if args else kwargs.get("name")
            if name == "cello-connect-pipeline":
                raise RuntimeError("CodePipeline API error")
            return {"pipelineExecutionId": f"exec-{name}"}

        _fake_codepipeline.start_pipeline_execution.side_effect = start_side_effect

        event = _make_event(["tsconfig.base.json"])
        buf = io.StringIO()
        with redirect_stdout(buf):
            result = mod.lambda_handler(event, None)

        output = buf.getvalue()

        # All 5 pipelines should have been attempted despite one failure.
        self.assertEqual(_fake_codepipeline.start_pipeline_execution.call_count, 5)

        # pipeline.trigger.failed must be logged for the failing pipeline.
        found_failed = any(
            json.loads(line).get("event") == "pipeline.trigger.failed"
            and json.loads(line).get("pipeline") == "cello-connect-pipeline"
            for line in output.strip().splitlines()
            if line.strip()
        )
        self.assertTrue(found_failed, f"Expected pipeline.trigger.failed in:\n{output}")

        # Lambda returns 200 even with partial failure.
        self.assertEqual(result["statusCode"], 200)

    def test_one_failure_does_not_prevent_other_pipelines(self):
        """DB-002: Root config — one failure still attempts all 5 pipelines."""
        mod = _load_module()
        fail_on_first = {"done": False}

        def start_side_effect(*args, **kwargs):
            name = args[0] if args else kwargs.get("name")
            if not fail_on_first["done"] and name == "cello-connect-pipeline":
                fail_on_first["done"] = True
                raise RuntimeError("transient failure")
            return {"pipelineExecutionId": f"exec-{name}"}

        _fake_codepipeline.start_pipeline_execution.side_effect = start_side_effect

        event = _make_event(["tsconfig.base.json"])
        mod.lambda_handler(event, None)

        # All 5 should have been attempted.
        self.assertEqual(_fake_codepipeline.start_pipeline_execution.call_count, 5)

    # ── Observability: pipeline.triggered logged ──────────────────────────────

    def test_triggered_event_logged_with_required_fields(self):
        """pipeline.triggered is logged with pipeline, commitSha, matchedPath, executionId."""
        mod = _load_module()
        event = _make_event(["packages/relay/src/index.ts"])

        buf = io.StringIO()
        with redirect_stdout(buf):
            mod.lambda_handler(event, None)

        output = buf.getvalue()
        records = [
            json.loads(line)
            for line in output.strip().splitlines()
            if line.strip()
        ]
        triggered_records = [r for r in records if r.get("event") == "pipeline.triggered"]
        self.assertTrue(len(triggered_records) >= 1, f"No pipeline.triggered in:\n{output}")
        rec = triggered_records[0]
        self.assertIn("pipeline", rec)
        self.assertIn("commitSha", rec)
        self.assertIn("matchedPath", rec)
        self.assertIn("executionId", rec)

    # ── Observability: pipeline.trigger.failed logged ─────────────────────────

    def test_trigger_failed_event_logged_with_required_fields(self):
        """pipeline.trigger.failed is logged with pipeline and reason fields."""
        mod = _load_module()
        _fake_codepipeline.start_pipeline_execution.side_effect = RuntimeError("API error")

        event = _make_event(["packages/relay/src/index.ts"])
        buf = io.StringIO()
        with redirect_stdout(buf):
            mod.lambda_handler(event, None)

        output = buf.getvalue()
        records = [
            json.loads(line)
            for line in output.strip().splitlines()
            if line.strip()
        ]
        failed_records = [r for r in records if r.get("event") == "pipeline.trigger.failed"]
        self.assertTrue(len(failed_records) >= 1, f"No pipeline.trigger.failed in:\n{output}")
        rec = failed_records[0]
        self.assertIn("pipeline", rec)
        self.assertIn("reason", rec)

    # ── AC-006 / AC-012(e): mappings loaded from pipeline-mappings.json ──────

    def test_mappings_loaded_from_json_file(self):
        """AC-007/AC-012(e): Mappings are loaded from pipeline-mappings.json with 5 pipelines."""
        mod = _load_module()
        mappings = mod._load_mappings()
        self.assertEqual(len(mappings["allCelloPipelines"]), 5)
        self.assertIn("cello-connect-pipeline", mappings["allCelloPipelines"])
        self.assertIn("cello-directory-pipeline", mappings["allCelloPipelines"])
        self.assertIn("cello-relay-pipeline", mappings["allCelloPipelines"])
        self.assertIn("cello-e2e-tests-pipeline", mappings["allCelloPipelines"])
        self.assertIn("cello-operations-agent-pipeline", mappings["allCelloPipelines"])
        # Dead pipelines must NOT be present
        self.assertNotIn("cello-crypto-pipeline", mappings["allCelloPipelines"])
        self.assertNotIn("cello-transport-pipeline", mappings["allCelloPipelines"])
        self.assertNotIn("cello-client-pipeline", mappings["allCelloPipelines"])
        self.assertNotIn("cello-protocol-types-pipeline", mappings["allCelloPipelines"])

    def test_source_repo_mappings_present(self):
        """AC-006: sourceRepoMappings has Mygentic-AI/cello-client → cello-e2e-tests-pipeline."""
        mod = _load_module()
        mappings = mod._load_mappings()
        self.assertIn("sourceRepoMappings", mappings)
        repo_mappings = mappings["sourceRepoMappings"]
        self.assertIn("Mygentic-AI/cello-client", repo_mappings)
        self.assertEqual(
            repo_mappings["Mygentic-AI/cello-client"],
            "cello-e2e-tests-pipeline",
        )

    # ── AC-012(d): cello-client repo push routes via sourceRepoMappings ──────

    def test_cello_client_repo_event_triggers_e2e_pipeline(self):
        """AC-012(d): A push event from Mygentic-AI/cello-client routes to cello-e2e-tests-pipeline."""
        mod = _load_module()
        event = _make_repo_event("Mygentic-AI/cello-client", branch="main", commit_sha="deadbeef")
        buf = io.StringIO()
        with redirect_stdout(buf):
            result = mod.lambda_handler(event, None)

        triggered_names = [
            args[0] if args else kwargs.get("name")
            for args, kwargs in [
                (c.args, c.kwargs)
                for c in _fake_codepipeline.start_pipeline_execution.call_args_list
            ]
        ]
        self.assertIn("cello-e2e-tests-pipeline", triggered_names)
        # Must NOT trigger any other pipeline
        for other in ALL_CELLO_PIPELINES:
            if other != "cello-e2e-tests-pipeline":
                self.assertNotIn(other, triggered_names, f"Unexpected pipeline: {other}")

    def test_unknown_repo_event_triggers_no_pipelines(self):
        """An event from an unknown repo that matches no path triggers nothing."""
        mod = _load_module()
        event = _make_repo_event("SomeOrg/some-repo")
        result = mod.lambda_handler(event, None)
        # The event has paths that don't match trustless-cello packageMappings
        # and the repo doesn't match sourceRepoMappings, so nothing triggers.
        _fake_codepipeline.start_pipeline_execution.assert_not_called()

    # ── AC-012(b): no dead pipeline references in ALL_CELLO_PIPELINES ────────

    def test_no_dead_pipeline_in_all_cello_pipelines(self):
        """AC-012(b): ALL_CELLO_PIPELINES does not contain dead pipeline names."""
        dead_pipelines = [
            "cello-crypto-pipeline",
            "cello-transport-pipeline",
            "cello-client-pipeline",
            "cello-protocol-types-pipeline",
        ]
        for dead in dead_pipelines:
            self.assertNotIn(dead, ALL_CELLO_PIPELINES,
                             f"Dead pipeline {dead} still in ALL_CELLO_PIPELINES")


if __name__ == "__main__":
    unittest.main()
