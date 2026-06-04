#!/usr/bin/env python3
"""
CELLO-M6B-007 infrastructure tests.

# Specification interpretation:
# AC-001: cello-ecs-relay.yaml validated template structure:
#   (1) RelayAlb resource: internet-facing, HTTP, idle_timeout 300s
#   (2) RelayTargetGroup: port 4002, health check /health port 4000
#   (3) HTTP listener port 80 forwarding to RelayTargetGroup
#   (4) ECS Service LoadBalancers block includes ContainerPort 4002
#   (5) CELLO_RELAY_WS_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4002/ws in container Environment
#   (6) port 4002 in container PortMappings
#
# AC-002: cello-vpc.yaml EcsRelaySecurityGroup has:
#   - port 4000 from EcsDirectorySecurityGroup (unchanged)
#   - port 4001 from EcsDirectorySecurityGroup (exists since commit 40543d5)
#   - port 4002 from AlbSecurityGroup (new — ALB WebSocket forwarding)
#   - port 4000 from AlbSecurityGroup (new — ALB health checks on Fargate awsvpc)
#   - no direct internet ingress on port 4002 (SI-001)
#
# AC-003: deploy.sh contains:
#   - RELAY_SUBDOMAIN case block (relay-us1, relay-eu1, relay-ap1)
#   - cello-route53-relay-${ENVIRONMENT} stack invocation after ecs-relay
#   - STACK_COUNT incremented by 1
#
# AC-007: cello-cloudwatch.yaml has cello-relay-alb-5xx-${Environment} alarm
#   using metric math (Metrics list) to compute 5xx rate = HTTPCode_ELB_5XX_Count /
#   RequestCount * 100; expression metric with ReturnData:true; threshold 5 (5%);
#   period 300s; LoadBalancer dimension uses full ARN suffix via !ImportValue relay-alb-arn
"""

import os
import sys
import yaml

# ── Resolve repo root ────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INFRA_DIR = os.path.dirname(SCRIPT_DIR)
CFN_DIR = os.path.join(INFRA_DIR, "cloudformation")


# ── CloudFormation-aware YAML loader (same as test_secops_003.py) ────────────

class _CfnTag(yaml.YAMLObject):
    """Opaque placeholder for any CloudFormation intrinsic function tag."""
    def __init__(self, tag, value):
        self.tag = tag
        self.value = value

    def __repr__(self):
        return f"{self.tag}({self.value!r})"

    def __str__(self):
        return repr(self)


def _cfn_constructor(loader, tag_suffix, node):
    """Generic constructor for any !Tag node - returns a _CfnTag wrapper."""
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node, deep=True)
    else:
        value = loader.construct_mapping(node, deep=True)
    return _CfnTag(tag_suffix, value)


class CfnLoader(yaml.SafeLoader):
    pass


for _tag in [
    "!Ref", "!Sub", "!ImportValue", "!GetAtt", "!If", "!And", "!Or",
    "!Not", "!Equals", "!Select", "!Split", "!Join", "!FindInMap",
    "!Base64", "!Cidr", "!Transform", "!Condition",
]:
    CfnLoader.add_multi_constructor(_tag, _cfn_constructor)

CfnLoader.add_multi_constructor("", _cfn_constructor)


def load_yaml(filename: str) -> dict:
    path = os.path.join(CFN_DIR, filename)
    with open(path) as f:
        return yaml.load(f, Loader=CfnLoader)  # noqa: S506 — internal test only


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_resources(tmpl: dict) -> dict:
    return tmpl.get("Resources", {})


def _get_container_env(tmpl: dict, container_name: str = "relay") -> list:
    """Return the Environment list for the named container in the task definition."""
    resources = _get_resources(tmpl)
    for name, res in resources.items():
        if res.get("Type") == "AWS::ECS::TaskDefinition":
            containers = res.get("Properties", {}).get("ContainerDefinitions", [])
            for c in containers:
                if c.get("Name") == container_name:
                    return c.get("Environment", [])
    return []


def _get_container_port_mappings(tmpl: dict, container_name: str = "relay") -> list:
    """Return the PortMappings list for the named container."""
    resources = _get_resources(tmpl)
    for name, res in resources.items():
        if res.get("Type") == "AWS::ECS::TaskDefinition":
            containers = res.get("Properties", {}).get("ContainerDefinitions", [])
            for c in containers:
                if c.get("Name") == container_name:
                    return c.get("PortMappings", [])
    return []


def _get_ecs_service_load_balancers(tmpl: dict) -> list:
    """Return the LoadBalancers list from the ECS Service."""
    resources = _get_resources(tmpl)
    for name, res in resources.items():
        if res.get("Type") == "AWS::ECS::Service":
            return res.get("Properties", {}).get("LoadBalancers", [])
    return []


def _get_sg_ingress_rules(tmpl: dict, sg_logical_name: str) -> list:
    """Return the SecurityGroupIngress rules for a security group resource."""
    resources = _get_resources(tmpl)
    sg = resources.get(sg_logical_name, {})
    return sg.get("Properties", {}).get("SecurityGroupIngress", [])


def _str_contains(obj, substr: str) -> bool:
    """Recursively check if str(obj) contains substr."""
    return substr in str(obj)


# ════════════════════════════════════════════════════════════════════════════
# AC-001a: RelayAlb resource exists and is internet-facing
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_relay_alb_resource_exists():
    """AC-001a: cello-ecs-relay.yaml has a RelayAlb (AWS::ElasticLoadBalancingV2::LoadBalancer)."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    assert "RelayAlb" in resources, (
        "cello-ecs-relay.yaml must define a RelayAlb resource of type "
        "AWS::ElasticLoadBalancingV2::LoadBalancer (AC-001)"
    )
    assert resources["RelayAlb"].get("Type") == "AWS::ElasticLoadBalancingV2::LoadBalancer", (
        "RelayAlb must be of type AWS::ElasticLoadBalancingV2::LoadBalancer"
    )


def test_ac001_relay_alb_internet_facing():
    """AC-001a: RelayAlb Scheme is internet-facing."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    alb = resources.get("RelayAlb", {})
    scheme = alb.get("Properties", {}).get("Scheme")
    assert scheme == "internet-facing", (
        f"RelayAlb must have Scheme: internet-facing, got: {scheme} (AC-001)"
    )


def test_ac001_relay_alb_idle_timeout_300():
    """AC-001a: RelayAlb has idle_timeout.timeout_seconds=300 (prevents silent WebSocket drops)."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    alb = resources.get("RelayAlb", {})
    attrs = alb.get("Properties", {}).get("LoadBalancerAttributes", [])
    timeout_attrs = [a for a in attrs
                     if str(a.get("Key")) == "idle_timeout.timeout_seconds"]
    assert timeout_attrs, (
        "RelayAlb must have LoadBalancerAttributes idle_timeout.timeout_seconds (AC-001)"
    )
    assert str(timeout_attrs[0].get("Value")) == "300", (
        f"RelayAlb idle_timeout must be 300 seconds, got: {timeout_attrs[0].get('Value')} (AC-001)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-001b: RelayTargetGroup on port 4002 with health check /health:4000
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_relay_target_group_exists():
    """AC-001b: cello-ecs-relay.yaml has a RelayTargetGroup resource."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    assert "RelayTargetGroup" in resources, (
        "cello-ecs-relay.yaml must define a RelayTargetGroup resource (AC-001)"
    )
    assert resources["RelayTargetGroup"].get("Type") == "AWS::ElasticLoadBalancingV2::TargetGroup"


def test_ac001_relay_target_group_port_4002():
    """AC-001b: RelayTargetGroup Port is 4002."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    tg = resources.get("RelayTargetGroup", {})
    port = tg.get("Properties", {}).get("Port")
    assert port == 4002, (
        f"RelayTargetGroup Port must be 4002, got: {port} (AC-001)"
    )


def test_ac001_relay_target_group_health_check_port_4000():
    """AC-001b: RelayTargetGroup HealthCheckPort is 4000 (relay health server port)."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    tg = resources.get("RelayTargetGroup", {})
    hc_port = tg.get("Properties", {}).get("HealthCheckPort")
    assert str(hc_port) == "4000", (
        f"RelayTargetGroup HealthCheckPort must be 4000, got: {hc_port} (AC-001)\n"
        "Port 4002 is the WS-only listener; /health is served on port 4000."
    )


def test_ac001_relay_target_group_health_check_path():
    """AC-001b: RelayTargetGroup HealthCheckPath is /health."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    tg = resources.get("RelayTargetGroup", {})
    hc_path = tg.get("Properties", {}).get("HealthCheckPath")
    assert hc_path == "/health", (
        f"RelayTargetGroup HealthCheckPath must be /health, got: {hc_path} (AC-001)"
    )


def test_ac001_relay_target_group_type_ip():
    """AC-001b: RelayTargetGroup TargetType is ip (required for Fargate awsvpc)."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    tg = resources.get("RelayTargetGroup", {})
    target_type = tg.get("Properties", {}).get("TargetType")
    assert target_type == "ip", (
        f"RelayTargetGroup TargetType must be ip (Fargate awsvpc), got: {target_type} (AC-001)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-001c: HTTP listener on port 80 forwarding to RelayTargetGroup
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_relay_alb_listener_exists():
    """AC-001c: cello-ecs-relay.yaml has a RelayAlbListener resource."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    assert "RelayAlbListener" in resources, (
        "cello-ecs-relay.yaml must define a RelayAlbListener resource (AC-001)"
    )
    assert resources["RelayAlbListener"].get("Type") == "AWS::ElasticLoadBalancingV2::Listener"


def test_ac001_relay_alb_listener_port_80():
    """AC-001c: RelayAlbListener port is 80 (HTTP, mirrors directory ALB pattern)."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    listener = resources.get("RelayAlbListener", {})
    port = listener.get("Properties", {}).get("Port")
    assert port == 80, (
        f"RelayAlbListener Port must be 80, got: {port} (AC-001)"
    )


def test_ac001_relay_alb_listener_protocol_http():
    """AC-001c: RelayAlbListener Protocol is HTTP."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    listener = resources.get("RelayAlbListener", {})
    protocol = listener.get("Properties", {}).get("Protocol")
    assert protocol == "HTTP", (
        f"RelayAlbListener Protocol must be HTTP, got: {protocol} (AC-001)"
    )


def test_ac001_relay_alb_listener_forwards_to_target_group():
    """AC-001c: RelayAlbListener DefaultAction forwards to RelayTargetGroup."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    resources = _get_resources(tmpl)
    listener = resources.get("RelayAlbListener", {})
    actions = listener.get("Properties", {}).get("DefaultActions", [])
    assert actions, "RelayAlbListener must have DefaultActions"

    forward_actions = [a for a in actions if a.get("Type") == "forward"]
    assert forward_actions, (
        "RelayAlbListener DefaultActions must include Type: forward (AC-001)"
    )

    # Check that it references RelayTargetGroup (via !Ref)
    tg_ref = forward_actions[0].get("TargetGroupArn")
    assert tg_ref is not None, "RelayAlbListener forward action must have TargetGroupArn"
    assert _str_contains(tg_ref, "RelayTargetGroup"), (
        f"RelayAlbListener must forward to RelayTargetGroup, got: {tg_ref} (AC-001)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-001d: ECS Service LoadBalancers block includes ContainerPort 4002
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_ecs_service_load_balancers_port_4002():
    """AC-001d: ECS Service LoadBalancers block contains ContainerPort 4002 entry."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    load_balancers = _get_ecs_service_load_balancers(tmpl)
    assert load_balancers, (
        "ECS Service must have a LoadBalancers block (AC-001)"
    )
    ports = [lb.get("ContainerPort") for lb in load_balancers]
    assert 4002 in ports, (
        f"ECS Service LoadBalancers must include ContainerPort 4002. "
        f"Found ports: {ports} (AC-001)"
    )


def test_ac001_ecs_service_load_balancers_4002_targets_relay_tg():
    """AC-001d: ECS Service LoadBalancers ContainerPort 4002 targets RelayTargetGroup."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    load_balancers = _get_ecs_service_load_balancers(tmpl)
    entries_4002 = [lb for lb in load_balancers if lb.get("ContainerPort") == 4002]
    assert entries_4002, "No LoadBalancers entry with ContainerPort 4002"
    tg_arn = entries_4002[0].get("TargetGroupArn")
    assert _str_contains(tg_arn, "RelayTargetGroup"), (
        f"LoadBalancers ContainerPort 4002 must target RelayTargetGroup, got: {tg_arn} (AC-001)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-001e: CELLO_RELAY_WS_LISTEN_ADDR env var in container Environment
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_relay_ws_listen_addr_env_var():
    """AC-001e: CELLO_RELAY_WS_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4002/ws in container Environment."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    env = _get_container_env(tmpl, "relay")
    ws_addr_entries = [e for e in env if e.get("Name") == "CELLO_RELAY_WS_LISTEN_ADDR"]
    assert ws_addr_entries, (
        "relay container Environment must include CELLO_RELAY_WS_LISTEN_ADDR (AC-001)"
    )
    assert ws_addr_entries[0].get("Value") == "/ip4/0.0.0.0/tcp/4002/ws", (
        f"CELLO_RELAY_WS_LISTEN_ADDR must be /ip4/0.0.0.0/tcp/4002/ws, "
        f"got: {ws_addr_entries[0].get('Value')} (AC-001)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-001f: port 4002 in container PortMappings
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_port_4002_in_port_mappings():
    """AC-001f: relay container PortMappings includes port 4002."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    mappings = _get_container_port_mappings(tmpl, "relay")
    ports = [m.get("ContainerPort") for m in mappings]
    assert 4002 in ports, (
        f"relay container PortMappings must include ContainerPort 4002. "
        f"Found: {ports} (AC-001)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-001: Relay ALB outputs exported for route53 stack
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_relay_alb_dns_name_output():
    """AC-001: cello-ecs-relay.yaml exports RelayAlbDnsName for deploy.sh step 13b."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    outputs = tmpl.get("Outputs", {})
    assert "RelayAlbDnsName" in outputs, (
        "cello-ecs-relay.yaml must export RelayAlbDnsName so deploy.sh can read it "
        "to deploy cello-route53-relay (AC-001, AC-003)"
    )


def test_ac001_relay_alb_hosted_zone_id_output():
    """AC-001: cello-ecs-relay.yaml exports RelayAlbHostedZoneId for deploy.sh step 13b."""
    tmpl = load_yaml("cello-ecs-relay.yaml")
    outputs = tmpl.get("Outputs", {})
    assert "RelayAlbHostedZoneId" in outputs, (
        "cello-ecs-relay.yaml must export RelayAlbHostedZoneId (AC-001, AC-003)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-002: cello-vpc.yaml EcsRelaySecurityGroup ingress rules
# ════════════════════════════════════════════════════════════════════════════

def test_ac002_port_4001_from_directory_sg_present():
    """AC-002: EcsRelaySecurityGroup has port 4001 from EcsDirectorySecurityGroup.

    Present since commit 40543d5. Deploying vpc to secondary regions closes the
    port-4001 gap in eu-central-1 and ap-northeast-1 (AC-005).
    """
    tmpl = load_yaml("cello-vpc.yaml")
    rules = _get_sg_ingress_rules(tmpl, "EcsRelaySecurityGroup")
    port_4001_rules = [
        r for r in rules
        if r.get("FromPort") == 4001 and r.get("ToPort") == 4001
    ]
    assert port_4001_rules, (
        "EcsRelaySecurityGroup must have port 4001 ingress rule (AC-002)"
    )
    # Must come from EcsDirectorySecurityGroup, not from internet
    from_dir_sg = [
        r for r in port_4001_rules
        if _str_contains(r.get("SourceSecurityGroupId", ""), "EcsDirectorySecurityGroup")
    ]
    assert from_dir_sg, (
        "EcsRelaySecurityGroup port 4001 ingress must be from EcsDirectorySecurityGroup (AC-002)"
    )


def test_ac002_port_4000_from_directory_sg_unchanged():
    """AC-002 req-1: EcsRelaySecurityGroup port 4000 from EcsDirectorySecurityGroup is unchanged.

    The directory polls GET /health on port 4000 for relay health checks.
    This pre-existing rule must survive the M6B-007 SG changes.
    """
    tmpl = load_yaml("cello-vpc.yaml")
    rules = _get_sg_ingress_rules(tmpl, "EcsRelaySecurityGroup")
    port_4000_dir_rules = [
        r for r in rules
        if r.get("FromPort") == 4000
        and r.get("ToPort") == 4000
        and _str_contains(r.get("SourceSecurityGroupId", ""), "EcsDirectorySecurityGroup")
    ]
    assert port_4000_dir_rules, (
        "EcsRelaySecurityGroup must retain port 4000 ingress from EcsDirectorySecurityGroup (AC-002 req-1).\n"
        "The directory health-check path (GET /health on port 4000) must remain unblocked."
    )


def test_ac002_port_4002_from_alb_sg():
    """AC-002: EcsRelaySecurityGroup has port 4002 from AlbSecurityGroup (new — WS forwarding)."""
    tmpl = load_yaml("cello-vpc.yaml")
    rules = _get_sg_ingress_rules(tmpl, "EcsRelaySecurityGroup")
    port_4002_rules = [
        r for r in rules
        if r.get("FromPort") == 4002 and r.get("ToPort") == 4002
    ]
    assert port_4002_rules, (
        "EcsRelaySecurityGroup must have port 4002 ingress rule (AC-002, M6B-007)"
    )
    from_alb_sg = [
        r for r in port_4002_rules
        if _str_contains(r.get("SourceSecurityGroupId", ""), "AlbSecurityGroup")
    ]
    assert from_alb_sg, (
        "EcsRelaySecurityGroup port 4002 ingress must be from AlbSecurityGroup (AC-002)\n"
        "SI-001: only the ALB SG may send traffic to port 4002."
    )


def test_ac002_port_4000_from_alb_sg():
    """AC-002: EcsRelaySecurityGroup has port 4000 from AlbSecurityGroup (ALB health checks).

    On Fargate awsvpc mode, ALB health check packets originate from ALB IPs (not VPC CIDR).
    Without this rule, the ALB marks tasks unhealthy and returns 502 for all WS connections.
    """
    tmpl = load_yaml("cello-vpc.yaml")
    rules = _get_sg_ingress_rules(tmpl, "EcsRelaySecurityGroup")
    # Must have port 4000 from AlbSecurityGroup specifically
    port_4000_alb_rules = [
        r for r in rules
        if r.get("FromPort") == 4000
        and r.get("ToPort") == 4000
        and _str_contains(r.get("SourceSecurityGroupId", ""), "AlbSecurityGroup")
    ]
    assert port_4000_alb_rules, (
        "EcsRelaySecurityGroup must have port 4000 ingress from AlbSecurityGroup (AC-002)\n"
        "Fargate awsvpc: ALB health checks originate from ALB IPs, not VPC CIDR. "
        "Without this rule, ALB marks tasks unhealthy and all WS connections return 502."
    )


def test_si001_port_4002_no_internet_ingress():
    """SI-001: Port 4002 must not have CidrIp 0.0.0.0/0 (direct internet access forbidden)."""
    tmpl = load_yaml("cello-vpc.yaml")
    rules = _get_sg_ingress_rules(tmpl, "EcsRelaySecurityGroup")
    port_4002_rules = [
        r for r in rules
        if r.get("FromPort") == 4002 and r.get("ToPort") == 4002
    ]
    internet_4002 = [
        r for r in port_4002_rules
        if r.get("CidrIp") == "0.0.0.0/0"
    ]
    assert not internet_4002, (
        "SI-001 VIOLATION: EcsRelaySecurityGroup must not have port 4002 ingress from "
        "0.0.0.0/0. Only AlbSecurityGroup may send traffic to port 4002. "
        "An attacker who knows the relay task IP must not be able to bypass the ALB."
    )


def test_si001_port_4002_uses_sg_not_cidr():
    """SI-001: Port 4002 ingress uses SourceSecurityGroupId (not CidrIp or CidrIpv6)."""
    tmpl = load_yaml("cello-vpc.yaml")
    rules = _get_sg_ingress_rules(tmpl, "EcsRelaySecurityGroup")
    port_4002_rules = [
        r for r in rules
        if r.get("FromPort") == 4002 and r.get("ToPort") == 4002
    ]
    assert port_4002_rules, "EcsRelaySecurityGroup must have port 4002 ingress rule"
    for rule in port_4002_rules:
        cidr = rule.get("CidrIp")
        cidr_ipv6 = rule.get("CidrIpv6")
        sg_id = rule.get("SourceSecurityGroupId")
        assert sg_id is not None, (
            "SI-001: port 4002 ingress must use SourceSecurityGroupId, not CidrIp"
        )
        assert cidr is None or cidr == "", (
            f"SI-001 VIOLATION: port 4002 ingress has CidrIp: {cidr}. "
            "Must use SourceSecurityGroupId only."
        )
        assert cidr_ipv6 is None or cidr_ipv6 == "", (
            f"SI-001 VIOLATION: port 4002 ingress has CidrIpv6: {cidr_ipv6}. "
            "Must use SourceSecurityGroupId only — IPv6 CIDR also bypasses the ALB restriction."
        )


# ════════════════════════════════════════════════════════════════════════════
# AC-003: deploy.sh relay subdomain + relay route53 stack
# ════════════════════════════════════════════════════════════════════════════

def test_ac003_relay_subdomain_case_block():
    """AC-003: deploy.sh has RELAY_SUBDOMAIN case block for all three regions."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    assert "RELAY_SUBDOMAIN" in content, (
        "deploy.sh must define RELAY_SUBDOMAIN variable (AC-003)"
    )
    assert 'RELAY_SUBDOMAIN="relay-us1"' in content, (
        "deploy.sh RELAY_SUBDOMAIN must map us-east-1 to relay-us1 (AC-003)"
    )
    assert 'RELAY_SUBDOMAIN="relay-eu1"' in content, (
        "deploy.sh RELAY_SUBDOMAIN must map eu-central-1 to relay-eu1 (AC-003)"
    )
    assert 'RELAY_SUBDOMAIN="relay-ap1"' in content, (
        "deploy.sh RELAY_SUBDOMAIN must map ap-northeast-1 to relay-ap1 (AC-003)"
    )


def test_ac003_route53_relay_stack_deployed():
    """AC-003: deploy.sh deploys cello-route53-relay stack."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    assert 'deploy_stack "cello-route53-relay-' in content, (
        "deploy.sh must deploy cello-route53-relay-${ENVIRONMENT} stack (AC-003)"
    )


def test_ac003_relay_subdomain_passed_to_route53():
    """AC-003: cello-route53-relay stack invocation passes Subdomain=${RELAY_SUBDOMAIN}."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    assert "Subdomain=${RELAY_SUBDOMAIN}" in content, (
        "deploy.sh cello-route53-relay invocation must pass Subdomain=${RELAY_SUBDOMAIN} (AC-003)"
    )


def test_ac003_relay_route53_after_ecs_relay():
    """AC-003: cello-route53-relay is deployed AFTER cello-ecs-relay in deploy.sh."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    ecs_relay_pos = content.find('deploy_stack "cello-ecs-relay-')
    route53_relay_pos = content.find('deploy_stack "cello-route53-relay-')

    assert ecs_relay_pos != -1, "deploy_stack cello-ecs-relay not found"
    assert route53_relay_pos != -1, "deploy_stack cello-route53-relay not found"
    assert ecs_relay_pos < route53_relay_pos, (
        "cello-route53-relay must be deployed AFTER cello-ecs-relay in deploy.sh (AC-003)\n"
        "The relay ALB must exist before the DNS A record ALIAS can be created."
    )


def test_ac003_stack_count_incremented():
    """AC-003: deploy.sh STACK_COUNT is incremented by 1 to account for relay route53 stack."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    # STACK_COUNT=16 in us-east-1 (was 15: 14 base + cicd + new relay route53)
    # STACK_COUNT=15 in other regions (was 14: 14 base + new relay route53)
    assert "STACK_COUNT=16" in content, (
        "deploy.sh STACK_COUNT must be 16 in us-east-1 (was 15, +1 for relay route53) (AC-003)"
    )
    assert "STACK_COUNT=15" in content, (
        "deploy.sh STACK_COUNT must be 15 in other regions (was 14, +1 for relay route53) (AC-003)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-007: cello-cloudwatch.yaml relay ALB 5xx alarm
#
# The alarm uses CloudWatch metric math (Metrics list) to compute a true
# 5% error rate alarm. A simple Sum threshold on HTTPCode_ELB_5XX_Count is
# an absolute count (not a rate) and would not satisfy the AC. The metric math
# expression is: rate = IF(m2 > 0, m1/m2*100, 0) where:
#   m1 = HTTPCode_ELB_5XX_Count (5xx responses)
#   m2 = RequestCount (total requests)
# Threshold: 5 = 5% rate. The dimension uses the full ARN suffix from the
# RelayAlbArn export (required by AWS/ApplicationELB CloudWatch namespace).
# ════════════════════════════════════════════════════════════════════════════

def test_ac007_relay_alb_5xx_alarm_exists():
    """AC-007: cello-cloudwatch.yaml defines a relay ALB 5xx error rate alarm."""
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    assert "RelayAlb5xxAlarm" in resources, (
        "cello-cloudwatch.yaml must define RelayAlb5xxAlarm (AWS::CloudWatch::Alarm) (AC-007)"
    )
    assert resources["RelayAlb5xxAlarm"].get("Type") == "AWS::CloudWatch::Alarm"


def test_ac007_alarm_name_contains_relay_alb_5xx():
    """AC-007: RelayAlb5xxAlarm AlarmName contains cello-relay-alb-5xx."""
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    alarm = resources.get("RelayAlb5xxAlarm", {})
    name = alarm.get("Properties", {}).get("AlarmName")
    assert name is not None, "RelayAlb5xxAlarm must have AlarmName"
    assert _str_contains(name, "cello-relay-alb-5xx"), (
        f"RelayAlb5xxAlarm AlarmName must contain cello-relay-alb-5xx, got: {name} (AC-007)"
    )


def test_ac007_alarm_metric_5xx_count():
    """AC-007: RelayAlb5xxAlarm uses metric math with HTTPCode_ELB_5XX_Count in Metrics list.

    The alarm is a metric math alarm (Metrics list, not top-level MetricName).
    One of the Metrics entries must reference HTTPCode_ELB_5XX_Count.
    """
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    alarm = resources.get("RelayAlb5xxAlarm", {})
    props = alarm.get("Properties", {})
    metrics = props.get("Metrics", [])
    assert len(metrics) > 0, (
        "RelayAlb5xxAlarm must use metric math (Metrics list) to compute a rate, "
        "not a simple MetricName threshold (AC-007)"
    )
    metric_names = [
        m.get("MetricStat", {}).get("Metric", {}).get("MetricName")
        for m in metrics
        if "MetricStat" in m
    ]
    assert "HTTPCode_ELB_5XX_Count" in metric_names, (
        f"RelayAlb5xxAlarm Metrics must include HTTPCode_ELB_5XX_Count, "
        f"found metric names: {metric_names} (AC-007)"
    )


def test_ac007_alarm_period_300():
    """AC-007: RelayAlb5xxAlarm metric period is 300 seconds (5 minutes).

    For metric math alarms, Period is on each MetricStat entry, not top-level.
    """
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    alarm = resources.get("RelayAlb5xxAlarm", {})
    props = alarm.get("Properties", {})
    metrics = props.get("Metrics", [])
    # All MetricStat entries must have Period 300
    metric_stat_periods = [
        m.get("MetricStat", {}).get("Period")
        for m in metrics
        if "MetricStat" in m
    ]
    assert all(p == 300 for p in metric_stat_periods), (
        f"All RelayAlb5xxAlarm MetricStat entries must have Period 300 (5 minutes), "
        f"got: {metric_stat_periods} (AC-007)"
    )
    assert len(metric_stat_periods) > 0, (
        "RelayAlb5xxAlarm must have at least one MetricStat entry (AC-007)"
    )


def test_ac007_alarm_threshold_5():
    """AC-007: RelayAlb5xxAlarm Threshold is 5 (fires when 5xx rate > 5%)."""
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    alarm = resources.get("RelayAlb5xxAlarm", {})
    threshold = alarm.get("Properties", {}).get("Threshold")
    assert threshold == 5, (
        f"RelayAlb5xxAlarm Threshold must be 5 (5% error rate), got: {threshold} (AC-007)"
    )


def test_ac007_alarm_namespace_application_elb():
    """AC-007: RelayAlb5xxAlarm uses AWS/ApplicationELB namespace in its Metrics list."""
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    alarm = resources.get("RelayAlb5xxAlarm", {})
    props = alarm.get("Properties", {})
    metrics = props.get("Metrics", [])
    namespaces = [
        m.get("MetricStat", {}).get("Metric", {}).get("Namespace")
        for m in metrics
        if "MetricStat" in m
    ]
    assert "AWS/ApplicationELB" in namespaces, (
        f"RelayAlb5xxAlarm Metrics must include AWS/ApplicationELB namespace, "
        f"found: {namespaces} (AC-007)"
    )


def test_ac007_alarm_uses_rate_expression():
    """AC-007: RelayAlb5xxAlarm Metrics contains a rate expression (IF(m2 > 0, m1/m2*100, 0)).

    The expression metric with ReturnData:true is what the alarm evaluates.
    This verifies the alarm is a true rate alarm, not an absolute count alarm.
    """
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    alarm = resources.get("RelayAlb5xxAlarm", {})
    props = alarm.get("Properties", {})
    metrics = props.get("Metrics", [])
    expression_metrics = [m for m in metrics if "Expression" in m]
    assert len(expression_metrics) > 0, (
        "RelayAlb5xxAlarm must include an Expression metric to compute the 5xx rate "
        "(not a raw count alarm) (AC-007)"
    )
    # The expression metric with ReturnData:true is what the threshold is evaluated against
    return_data_metrics = [m for m in expression_metrics if m.get("ReturnData") is True]
    assert len(return_data_metrics) == 1, (
        "RelayAlb5xxAlarm must have exactly one Expression metric with ReturnData:true "
        f"(the evaluated rate), found: {return_data_metrics} (AC-007)"
    )


def test_ac007_relay_alb_arn_output_exported():
    """AC-007 / Issue-2: cello-ecs-relay.yaml exports RelayAlbArn for use in CloudWatch dimension.

    CloudWatch AWS/ApplicationELB LoadBalancer dimension requires the full ARN suffix
    (app/<name>/<hash>). This is extracted from the exported RelayAlbArn at deploy time.
    Without this export, the alarm would have an incomplete dimension and be permanently
    in INSUFFICIENT_DATA.
    """
    tmpl = load_yaml("cello-ecs-relay.yaml")
    outputs = tmpl.get("Outputs", {})
    assert "RelayAlbArn" in outputs, (
        "cello-ecs-relay.yaml must export RelayAlbArn so cello-cloudwatch.yaml can "
        "construct the correct LoadBalancer dimension (AC-007)"
    )
    export = outputs["RelayAlbArn"].get("Export", {})
    export_name = export.get("Name")
    assert export_name is not None, "RelayAlbArn output must have an Export.Name"
    assert _str_contains(export_name, "relay-alb-arn"), (
        f"RelayAlbArn Export.Name must contain relay-alb-arn, got: {export_name} (AC-007)"
    )


def test_ac007_alarm_dimension_uses_relay_alb_arn_import():
    """AC-007 / Issue-2: RelayAlb5xxAlarm LoadBalancer dimension uses !ImportValue relay-alb-arn.

    The dimension value must use the full ARN suffix (app/<name>/<hash>) obtained by
    splitting the imported ARN on 'loadbalancer/'. A plain app/<name> prefix without
    the hash suffix causes permanent INSUFFICIENT_DATA on the alarm.
    """
    tmpl = load_yaml("cello-cloudwatch.yaml")
    resources = _get_resources(tmpl)
    alarm = resources.get("RelayAlb5xxAlarm", {})
    props = alarm.get("Properties", {})
    metrics = props.get("Metrics", [])
    # The dimension value must reference the relay-alb-arn export
    all_dims = []
    for m in metrics:
        if "MetricStat" in m:
            dims = m.get("MetricStat", {}).get("Metric", {}).get("Dimensions", [])
            all_dims.extend(dims)
    # Check that at least one LoadBalancer dimension references relay-alb-arn
    lb_dims = [d for d in all_dims if _str_contains(d.get("Name", ""), "LoadBalancer")]
    assert len(lb_dims) > 0, (
        "RelayAlb5xxAlarm must have LoadBalancer dimensions in its Metrics entries (AC-007)"
    )
    lb_dim_values = [d.get("Value") for d in lb_dims]
    assert any(_str_contains(v, "relay-alb-arn") for v in lb_dim_values), (
        f"RelayAlb5xxAlarm LoadBalancer dimension must reference relay-alb-arn import "
        f"(to get the full ARN suffix including hash), found: {lb_dim_values} (AC-007)"
    )


# ════════════════════════════════════════════════════════════════════════════
# Main runner
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import traceback

    tests = [
        test_ac001_relay_alb_resource_exists,
        test_ac001_relay_alb_internet_facing,
        test_ac001_relay_alb_idle_timeout_300,
        test_ac001_relay_target_group_exists,
        test_ac001_relay_target_group_port_4002,
        test_ac001_relay_target_group_health_check_port_4000,
        test_ac001_relay_target_group_health_check_path,
        test_ac001_relay_target_group_type_ip,
        test_ac001_relay_alb_listener_exists,
        test_ac001_relay_alb_listener_port_80,
        test_ac001_relay_alb_listener_protocol_http,
        test_ac001_relay_alb_listener_forwards_to_target_group,
        test_ac001_ecs_service_load_balancers_port_4002,
        test_ac001_ecs_service_load_balancers_4002_targets_relay_tg,
        test_ac001_relay_ws_listen_addr_env_var,
        test_ac001_port_4002_in_port_mappings,
        test_ac001_relay_alb_dns_name_output,
        test_ac001_relay_alb_hosted_zone_id_output,
        test_ac002_port_4001_from_directory_sg_present,
        test_ac002_port_4002_from_alb_sg,
        test_ac002_port_4000_from_alb_sg,
        test_si001_port_4002_no_internet_ingress,
        test_si001_port_4002_uses_sg_not_cidr,
        test_ac003_relay_subdomain_case_block,
        test_ac003_route53_relay_stack_deployed,
        test_ac003_relay_subdomain_passed_to_route53,
        test_ac003_relay_route53_after_ecs_relay,
        test_ac003_stack_count_incremented,
        test_ac007_relay_alb_5xx_alarm_exists,
        test_ac007_alarm_name_contains_relay_alb_5xx,
        test_ac007_alarm_metric_5xx_count,
        test_ac007_alarm_period_300,
        test_ac007_alarm_threshold_5,
        test_ac007_alarm_namespace_application_elb,
        test_ac007_alarm_uses_rate_expression,
        test_ac007_relay_alb_arn_output_exported,
        test_ac007_alarm_dimension_uses_relay_alb_arn_import,
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
        except Exception as e:
            print(f"  ERROR {test.__name__}: {e}")
            traceback.print_exc()
            failed += 1
            errors.append((test.__name__, str(e)))

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
