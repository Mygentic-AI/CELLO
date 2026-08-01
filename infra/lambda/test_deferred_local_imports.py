"""No handler may import a SIBLING module from inside a function.

This is a whole-tree invariant, not a test of one handler, because the failure it
prevents is invisible in every place you would normally look for it.

WHAT HAPPENED. `waitlist-email/handler.py` had `from templates import TEMPLATES`
inside `render()`. That is correct on Lambda, where the handler's own directory
is permanently on `sys.path`. On Cloud Run it is not: `_app.py` inserts the
handler directory, imports the module, and removes it again in a `finally`. A
local import deferred to call time therefore resolves against a `sys.path` that
no longer contains the module sitting right next to it.

WHY NOTHING CAUGHT IT.
  - Unit tests pass. Pytest runs from inside the handler directory, so the
    sibling is importable and the deferred import resolves.
  - The container builds. It is a runtime import; nothing checks it at build.
  - The service starts and reports healthy. Module import succeeds — only the
    later CALL fails.
  - The endpoint returned 200. The failure was caught, logged, and the job
    marked retired, so the scheduler saw success.

The first signal was a person saying they never got an email (2026-08-01), and
by then the queued mail had been permanently retired rather than retried.

WHY A SCANNER AND NOT A CASE. Fixing the one occurrence leaves the trap armed:
the next handler to add a lazy local import re-creates it, and re-creates it in
the same undetectable way. This asserts the property over the whole tree, so the
guard arrives with the bug rather than after it.
"""

import ast
import pathlib

import pytest

# Pure AST reading. Nothing is imported, nothing connects anywhere.
pytestmark = pytest.mark.no_database

LAMBDA_ROOT = pathlib.Path(__file__).resolve().parent


def _deferred_local_imports():
    """Every import of a sibling module that happens inside a function body."""
    found = []
    for handler_dir in sorted(p for p in LAMBDA_ROOT.iterdir() if p.is_dir()):
        siblings = {f.stem for f in handler_dir.glob("*.py")}
        for source in sorted(handler_dir.glob("*.py")):
            if source.name.startswith("test_"):
                continue
            try:
                tree = ast.parse(source.read_text())
            except SyntaxError:  # pragma: no cover - a parse error is its own failure
                continue
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for inner in ast.walk(node):
                    modules = []
                    if isinstance(inner, ast.Import):
                        modules = [a.name.split(".")[0] for a in inner.names]
                    elif isinstance(inner, ast.ImportFrom) and inner.level == 0 and inner.module:
                        modules = [inner.module.split(".")[0]]
                    for module in modules:
                        # A module importing itself is not a sibling import.
                        if module in siblings and module != source.stem:
                            found.append(
                                f"{source.relative_to(LAMBDA_ROOT)}:{inner.lineno} "
                                f"in {node.name}() imports sibling '{module}'"
                            )
    return found


def test_no_handler_imports_a_sibling_from_inside_a_function():
    offenders = _deferred_local_imports()
    assert not offenders, (
        "A sibling module is imported inside a function. On Cloud Run the handler's\n"
        "directory is on sys.path only during module import, so this raises\n"
        "ModuleNotFoundError at call time — after the service has already reported\n"
        "healthy. Move the import to module level.\n\n  " + "\n  ".join(offenders)
    )


def test_the_scanner_would_actually_catch_it(tmp_path):
    """The guard above is worthless if it cannot see the original bug.

    Rebuilds the exact shape that shipped — a handler with a sibling `templates`
    imported inside a function — and asserts the scanner reports it. Without
    this, a scanner that silently matched nothing would pass forever.
    """
    global LAMBDA_ROOT
    handler_dir = tmp_path / "waitlist-something"
    handler_dir.mkdir()
    (handler_dir / "templates.py").write_text("TEMPLATES = {}\n")
    (handler_dir / "handler.py").write_text(
        "def render(job):\n    from templates import TEMPLATES\n    return TEMPLATES\n"
    )

    original = LAMBDA_ROOT
    try:
        LAMBDA_ROOT = tmp_path
        offenders = _deferred_local_imports()
    finally:
        LAMBDA_ROOT = original

    assert len(offenders) == 1, offenders
    assert "imports sibling 'templates'" in offenders[0]
    assert "in render()" in offenders[0]
