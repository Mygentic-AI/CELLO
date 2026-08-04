#!/usr/bin/env python3
"""
DOD-GCP-RELAY-DRIFT-1 infrastructure tests — the GCP relay's timeout/idle configuration, and
whether it still agrees with AWS.

WHY THIS FILE EXISTS. The relay's SESSION idle sweep was asserted on NEITHER cloud before this
file — a review corrected the premise this unit started from. test_m6b_007.py asserts the AWS
*ALB* idle timeout (300s), a different knob entirely; a repo-wide grep for
RELAY_SESSION_MAX_IDLE_MS returned no test at all. With nothing holding either side, the value
drifted unnoticed: cloud-init shipped
RELAY_SESSION_MAX_IDLE_MS=1800000 (30 minutes) against AWS's 86400000 (24 hours). No one chose 30
minutes for GCP — it simply differed, and the consequence is that a quiet-but-live conversation on
a GCP relay gets swept as idle and the agents have to re-establish, while the identical
conversation on AWS does not.

The lesson of the drift is not "fix the number". It is that a per-cloud value with no
cross-cloud assertion WILL diverge again, so the tests below assert the value on each side AND
that the two sides agree.

Run: python3 infra/tests/test_gcp_relay_config.py
"""

import os
import re
import sys
import traceback
import yaml

# ── Resolve repo root ────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INFRA_DIR = os.path.dirname(SCRIPT_DIR)
CFN_DIR = os.path.join(INFRA_DIR, "cloudformation")
TF_DIR = os.path.join(INFRA_DIR, "terraform")

GCP_CLOUD_INIT = os.path.join(TF_DIR, "templates", "relay-cloud-init.yaml")
GCP_RELAY_TF = os.path.join(TF_DIR, "node-relay.tf")
AWS_RELAY_CFN = os.path.join(CFN_DIR, "cello-ecs-relay.yaml")

# The deliberate value, both clouds. A relay must not end a conversation that is merely quiet.
EXPECTED_MAX_IDLE_MS = 86400000


def _read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


# ── CloudFormation-aware YAML loader (same shape as test_m6b_007.py) ─────────

class _CfnTag(yaml.YAMLObject):
    """Opaque placeholder for any CloudFormation intrinsic function tag."""

    def __init__(self, tag, value):
        self.tag = tag
        self.value = value

    def __repr__(self):
        return f"{self.tag}({self.value!r})"


def _cfn_constructor(loader, tag_suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return _CfnTag(tag_suffix, loader.construct_scalar(node))
    if isinstance(node, yaml.SequenceNode):
        return _CfnTag(tag_suffix, loader.construct_sequence(node))
    return _CfnTag(tag_suffix, loader.construct_mapping(node))


class CfnLoader(yaml.SafeLoader):
    pass


CfnLoader.add_multi_constructor("!", _cfn_constructor)


def _aws_relay_env():
    """The relay container's Environment list from the AWS task definition, as a dict."""
    doc = yaml.load(_read(AWS_RELAY_CFN), Loader=CfnLoader)
    for resource in doc["Resources"].values():
        if resource.get("Type") != "AWS::ECS::TaskDefinition":
            continue
        for container in resource["Properties"]["ContainerDefinitions"]:
            env = {e["Name"]: e["Value"] for e in container.get("Environment", [])}
            if "RELAY_SESSION_MAX_IDLE_MS" in env:
                return env
    raise AssertionError("no AWS relay container defines RELAY_SESSION_MAX_IDLE_MS")


def _gcp_boot_env():
    """
    The relay boot environment written by GCP cloud-init, as a dict of KEY=VALUE lines.

    Scoped to the ENVEOF heredoc — the block that actually becomes /etc/cello/relay.env and is
    handed to `docker run --env-file`. Scraping the whole YAML instead was a demonstrated bypass:
    a review moved RELAY_SESSION_MAX_IDLE_MS two lines up, out of the heredoc and into
    relay-boot.sh as a shell local that never reaches the relay, and all five tests stayed green.
    The same looseness also swept four shell locals (MD, TOKEN, NODE_KEY, TRANSPORT_KEY) that are
    not relay env vars at all.
    """
    text = _read(GCP_CLOUD_INIT)
    body = re.search(r"cat > /etc/cello/relay\.env <<ENVEOF\n(.*?)\n\s*ENVEOF", text, re.DOTALL)
    assert body, (
        "relay-cloud-init.yaml must write /etc/cello/relay.env via an ENVEOF heredoc — if that "
        "changed, this parser is reading a block the relay no longer consumes"
    )
    env = {}
    for match in re.finditer(r"^\s*([A-Z][A-Z0-9_]*)=(.*)$", body.group(1), re.MULTILINE):
        env[match.group(1)] = match.group(2).strip()
    if not env:
        raise AssertionError("parsed no KEY=VALUE lines out of the relay.env heredoc")
    return env


# ── AC-001: the GCP relay's idle sweep is the deliberate 24h ─────────────────

def test_gcp_relay_max_idle_is_24h():
    env = _gcp_boot_env()
    assert "RELAY_SESSION_MAX_IDLE_MS" in env, (
        "GCP cloud-init must set RELAY_SESSION_MAX_IDLE_MS — absent, the relay falls back to its "
        "own default and the sweep behaviour is whatever the binary happens to ship"
    )
    actual = int(env["RELAY_SESSION_MAX_IDLE_MS"])
    assert actual == EXPECTED_MAX_IDLE_MS, (
        f"GCP RELAY_SESSION_MAX_IDLE_MS is {actual}, expected {EXPECTED_MAX_IDLE_MS} (24h). "
        f"It shipped as 1800000 (30 min), which sweeps a live-but-quiet session and forces the "
        f"agents to re-establish."
    )


# ── AC-002: THE DRIFT CHECK — the two clouds must agree ─────────────────────

def test_gcp_and_aws_max_idle_agree():
    gcp_env = _gcp_boot_env()
    assert "RELAY_SESSION_MAX_IDLE_MS" in gcp_env, (
        "GCP cloud-init does not set RELAY_SESSION_MAX_IDLE_MS at all — the relay then falls back "
        "to its binary default, silently, and no log line says which value is in force"
    )
    gcp = int(gcp_env["RELAY_SESSION_MAX_IDLE_MS"])
    aws = int(_aws_relay_env()["RELAY_SESSION_MAX_IDLE_MS"])
    assert gcp == aws, (
        f"relay idle sweep disagrees across clouds: GCP {gcp} vs AWS {aws}. An agent's session "
        f"must not survive longer because of which cloud brokered it. This is the assertion whose "
        f"ABSENCE let the original 30-min/24h drift ship unnoticed — if the value legitimately "
        f"changes, change it on BOTH sides."
    )


def test_aws_relay_max_idle_is_24h():
    # Asserted here too, so a "fix" that silently drags AWS down to the GCP value to make the
    # drift check pass cannot happen quietly.
    aws = int(_aws_relay_env()["RELAY_SESSION_MAX_IDLE_MS"])
    assert aws == EXPECTED_MAX_IDLE_MS, f"AWS RELAY_SESSION_MAX_IDLE_MS is {aws}, expected {EXPECTED_MAX_IDLE_MS}"


# ── AC-003: the GCP relay's other timeout knob — the health check ────────────

def test_gcp_relay_health_check_timings_are_sane():
    tf = _read(GCP_RELAY_TF)
    block = re.search(
        r'resource\s+"google_compute_health_check"\s+"relay"\s*\{(.*?)\n\}', tf, re.DOTALL
    )
    assert block, "node-relay.tf must define google_compute_health_check.relay"
    body = block.group(1)

    interval = re.search(r"check_interval_sec\s*=\s*(\d+)", body)
    timeout = re.search(r"timeout_sec\s*=\s*(\d+)", body)
    assert interval and timeout, "the relay health check must set check_interval_sec and timeout_sec"

    interval_s, timeout_s = int(interval.group(1)), int(timeout.group(1))
    # A timeout at or above the interval means checks overlap and a slow-but-healthy relay is
    # marked down while the previous probe is still outstanding.
    assert timeout_s < interval_s, (
        f"health check timeout_sec ({timeout_s}) must be less than check_interval_sec "
        f"({interval_s}) — otherwise probes overlap and a slow relay is failed spuriously"
    )
    # The health check is a liveness probe for the PROCESS. It must never be short enough to
    # collect a relay that is merely busy.
    assert timeout_s >= 5, f"health check timeout_sec ({timeout_s}) is too aggressive for a WAN probe"


# ── AC-004: the GCP relay's boot env keeps the ports the firewall opens ──────

def test_gcp_relay_listeners_do_not_collide():
    env = _gcp_boot_env()
    tcp = env.get("CELLO_RELAY_LISTEN_ADDR", "")
    ws = env.get("CELLO_RELAY_WS_LISTEN_ADDR", "")
    assert tcp and ws, "the GCP relay must configure BOTH listeners explicitly"
    tcp_port = re.search(r"/tcp/(\d+)", tcp)
    ws_port = re.search(r"/tcp/(\d+)", ws)
    assert tcp_port and ws_port, f"could not read ports from {tcp!r} / {ws!r}"
    # libp2p treats a listen-address collision as fatal (EADDRINUSE) and the relay never starts.
    assert tcp_port.group(1) != ws_port.group(1), (
        f"the plain-TCP and WebSocket listeners share port {tcp_port.group(1)} — libp2p fails "
        f"fatally on the collision and the relay does not come up at all"
    )


if __name__ == "__main__":
    tests = [
        test_gcp_relay_max_idle_is_24h,
        test_gcp_and_aws_max_idle_agree,
        test_aws_relay_max_idle_is_24h,
        test_gcp_relay_health_check_timings_are_sane,
        test_gcp_relay_listeners_do_not_collide,
    ]

    passed = 0
    failed = 0
    errors = []

    for test in tests:
        try:
            test()
            print(f"  PASS  {test.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {test.__name__}: {e}")
            failed += 1
            errors.append((test.__name__, str(e)))
        except Exception as e:  # noqa: BLE001 — a broken test file must report, not vanish
            print(f"  ERROR {test.__name__}: {e}")
            traceback.print_exc()
            failed += 1
            errors.append((test.__name__, str(e)))

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
