"""
Unit tests for cello-pipeline-filter Lambda.

AC-002: packages/directory/ change triggers only cello-directory-pipeline.
AC-003: packages/crypto/ change triggers ALL 8 CELLO pipelines.
AC-004: tsconfig.base.json change triggers ALL 8 CELLO pipelines.
AC-007: Data-driven mappings — pipeline-mappings.json read at invocation time.
DB-002: Single pipeline start failure does not block other pipelines.

Test coverage:
  - AC-002: packages/directory/ → only directory pipeline
  - AC-003: packages/crypto/ → all 8 pipelines
  - AC-004: tsconfig.base.json → all 8 pipelines
  - AC-007: unknown path → empty set (no pipelines triggered)
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

ALL_CELLO_PIPELINES = [
    "cello-crypto-pipeline",
    "cello-protocol-types-pipeline",
    "cello-transport-pipeline",
    "cello-client-pipeline",
    "cello-adapter-claude-code-pipeline",
    "cello-directory-pipeline",
    "cello-relay-pipeline",
    "cello-e2e-tests-pipeline",
]

MAPPINGS_PATH = os.path.join(os.path.dirname(__file__), "pipeline-mappings.json")


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
            c.kwargs["name"] if c.kwargs else c.args[0]
            for c in _fake_codepipeline.start_pipeline_execution.call_args_list
        ]
        # Also handle positional-style calls.
        triggered_names = [
            args[0] if args else kwargs.get("name")
            for args, kwargs in [
                (c.args, c.kwargs)
                for c in _fake_codepipeline.start_pipeline_execution.call_args_list
            ]
        ]
        self.assertIn("cello-directory-pipeline", triggered_names)
        # None of the other 7 pipelines should be triggered.
        for other in ALL_CELLO_PIPELINES:
            if other != "cello-directory-pipeline":
                self.assertNotIn(other, triggered_names, f"Unexpected pipeline triggered: {other}")

    # ── AC-003: packages/crypto/ → all 8 pipelines ──────────────────────────

    def test_crypto_change_triggers_all_pipelines(self):
        """AC-003: A path under packages/crypto/ triggers all 8 CELLO pipelines."""
        mod = _load_module()
        event = _make_event(["packages/crypto/src/ed25519.ts"])
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

    # ── AC-004: tsconfig.base.json → all 8 pipelines ────────────────────────

    def test_root_config_triggers_all_pipelines(self):
        """AC-004: Changing tsconfig.base.json triggers all 8 CELLO pipelines."""
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
        """pnpm-workspace.yaml is a root config file — triggers all 8 pipelines."""
        mod = _load_module()
        event = _make_event(["pnpm-workspace.yaml"])
        mod.lambda_handler(event, None)
        self.assertEqual(
            _fake_codepipeline.start_pipeline_execution.call_count,
            8,
        )

    def test_package_json_triggers_all_pipelines(self):
        """package.json at repo root triggers all 8 pipelines."""
        mod = _load_module()
        event = _make_event(["package.json"])
        mod.lambda_handler(event, None)
        self.assertEqual(
            _fake_codepipeline.start_pipeline_execution.call_count,
            8,
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
        """DB-002: One pipeline failure in an 8-pipeline set still attempts all 8."""
        mod = _load_module()

        # crypto change → all 8 pipelines; make one fail, rest succeed.
        def start_side_effect(*args, **kwargs):
            name = args[0] if args else kwargs.get("name")
            if name == "cello-crypto-pipeline":
                raise RuntimeError("CodePipeline API error")
            return {"pipelineExecutionId": f"exec-{name}"}

        _fake_codepipeline.start_pipeline_execution.side_effect = start_side_effect

        event = _make_event(["packages/crypto/src/ed25519.ts"])
        buf = io.StringIO()
        with redirect_stdout(buf):
            result = mod.lambda_handler(event, None)

        output = buf.getvalue()

        # All 8 pipelines should have been attempted despite one failure.
        self.assertEqual(_fake_codepipeline.start_pipeline_execution.call_count, 8)

        # pipeline.trigger.failed must be logged for the failing pipeline.
        found_failed = any(
            json.loads(line).get("event") == "pipeline.trigger.failed"
            and json.loads(line).get("pipeline") == "cello-crypto-pipeline"
            for line in output.strip().splitlines()
            if line.strip()
        )
        self.assertTrue(found_failed, f"Expected pipeline.trigger.failed in:\n{output}")

        # Lambda returns 200 even with partial failure.
        self.assertEqual(result["statusCode"], 200)

    def test_one_failure_does_not_prevent_other_pipelines(self):
        """DB-002: Crypto change — one failure still attempts all 8 pipelines."""
        mod = _load_module()
        fail_on_first = {"done": False}

        def start_side_effect(*args, **kwargs):
            name = args[0] if args else kwargs.get("name")
            if not fail_on_first["done"] and name == "cello-crypto-pipeline":
                fail_on_first["done"] = True
                raise RuntimeError("transient failure")
            return {"pipelineExecutionId": f"exec-{name}"}

        _fake_codepipeline.start_pipeline_execution.side_effect = start_side_effect

        event = _make_event(["packages/crypto/src/ed25519.ts"])
        mod.lambda_handler(event, None)

        # All 8 should have been attempted.
        self.assertEqual(_fake_codepipeline.start_pipeline_execution.call_count, 8)

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

    # ── Data-driven: mappings loaded from pipeline-mappings.json ─────────────

    def test_mappings_loaded_from_json_file(self):
        """AC-007: Mappings are loaded from pipeline-mappings.json, not hardcoded."""
        mod = _load_module()
        # Verify the module reads from the JSON file by checking that
        # _load_mappings() returns the 8-pipeline allCelloPipelines list.
        mappings = mod._load_mappings()
        self.assertEqual(len(mappings["allCelloPipelines"]), 8)
        self.assertIn("cello-directory-pipeline", mappings["allCelloPipelines"])
        self.assertIn("cello-crypto-pipeline", mappings["allCelloPipelines"])

    def test_all_8_package_mappings_present(self):
        """All 8 CELLO packages have entries in packageMappings."""
        mod = _load_module()
        mappings = mod._load_mappings()
        prefixes = {m["prefix"] for m in mappings["packageMappings"]}
        expected_prefixes = {
            "packages/crypto/",
            "packages/protocol-types/",
            "packages/transport/",
            "packages/client/",
            "packages/adapter-claude-code/",
            "packages/directory/",
            "packages/relay/",
            "packages/e2e-tests/",
        }
        self.assertEqual(prefixes, expected_prefixes)


if __name__ == "__main__":
    unittest.main()
