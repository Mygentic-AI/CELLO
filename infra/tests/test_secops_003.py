#!/usr/bin/env python3
"""
SECOPS-003 infrastructure tests.

AC coverage:
  AC-001: WebACLAssociation exists and ALB ARN uses !ImportValue (IaC-defined, not manual)
  AC-002: RateLimitPerIp rule: Limit=1000, AggregateKeyType=IP, ResponseCode=429
  AC-003: AWSManagedRulesAmazonIpReputationList rule has OverrideAction: None (BLOCK fires)
  AC-004: GeoBlockingEnabled defaults to "false"; geo rule is behind !If / !Ref AWS::NoValue
  AC-005: GeoBlockSelectedCountries rule references !Ref BlockedCountries when active
  AC-006: WafLogGroup name starts with "aws-waf-logs-", RetentionInDays=90
  AC-007: AWSManagedRulesCommonRuleSet has OverrideAction: Count (COUNT mode)
  AC-008-deploy-script-inclusion: deploy.sh deploys cello-waf after cello-ecs-directory

SI coverage:
  SI-001: WebACLAssociation uses !ImportValue (not a hardcoded ARN)
  SI-002: Parameters section has no disable/skip/toggle for WAF association

Notes:
  AC-002/AC-003: Live rate-limit and reputation-list triggering tests require a live AWS
                 environment — marked as integration (manual verify post-deploy).
  AC-001: Live aws wafv2 get-web-acl-for-resource verification is manual post-deploy.
  The unit tests here verify the IaC structure that satisfies each AC.
"""

import os
import sys
import yaml

# ── Resolve repo root ────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INFRA_DIR = os.path.dirname(SCRIPT_DIR)
CFN_DIR = os.path.join(INFRA_DIR, "cloudformation")


# ── CloudFormation-aware YAML loader ─────────────────────────────────────────
# CloudFormation templates use !Ref, !Sub, !ImportValue, !GetAtt, !If, etc.
# Python's yaml.safe_load treats these as unknown tags and raises ConstructorError.
# We register all CFN intrinsic function tags as plain string/dict constructors
# so we can inspect the template structure without needing cfn-python-lint.

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
    """Generic constructor for any !Tag node — returns a _CfnTag wrapper."""
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


# ════════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════════

def _get_waf_rules(tmpl: dict) -> list:
    """Return the Rules list from the WebACL resource."""
    resources = tmpl.get("Resources", {})
    web_acl = resources.get("WebACL", {})
    return web_acl.get("Properties", {}).get("Rules", [])


def _rule_by_name(rules: list, name: str) -> dict | None:
    """Find a rule in the rules list by Name. Unwraps !If-wrapped rules to find the dict.

    Note: PyYAML's add_multi_constructor passes tag_suffix="" for exact-prefix matches,
    so _CfnTag.tag is always "" for registered CFN tags. We identify !If constructs by
    their structure: a _CfnTag whose value is a list of exactly 3 elements
    [ConditionName, TrueBranch, FalseBranch].
    """
    for rule in rules:
        if isinstance(rule, dict) and rule.get("Name") == name:
            return rule
        # Rule may be wrapped in a _CfnTag representing !If [condition, true, false]
        if isinstance(rule, _CfnTag) and isinstance(rule.value, list) and len(rule.value) == 3:
            true_branch = rule.value[1]
            if isinstance(true_branch, dict) and true_branch.get("Name") == name:
                return true_branch
    return None


# ════════════════════════════════════════════════════════════════════════════
# Template exists
# ════════════════════════════════════════════════════════════════════════════

def test_waf_template_exists():
    """cello-waf.yaml CloudFormation template exists."""
    path = os.path.join(CFN_DIR, "cello-waf.yaml")
    assert os.path.exists(path), (
        "infra/cloudformation/cello-waf.yaml not found — SECOPS-003 requires this file"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-001 / SI-001: WebACLAssociation exists and uses !ImportValue for ALB ARN
# ════════════════════════════════════════════════════════════════════════════

def test_ac001_web_acl_association_resource_exists():
    """AC-001: cello-waf.yaml defines an AWS::WAFv2::WebACLAssociation resource."""
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})
    associations = {
        name: res for name, res in resources.items()
        if res.get("Type") == "AWS::WAFv2::WebACLAssociation"
    }
    assert associations, (
        "cello-waf.yaml must define an AWS::WAFv2::WebACLAssociation resource (AC-001)"
    )


def test_si001_web_acl_association_uses_import_value():
    """SI-001: WebACLAssociation ResourceArn uses !ImportValue or Fn::Sub cross-stack ref.

    The association must be IaC-defined via cross-stack reference, not a hardcoded ARN.
    Acceptable forms: short-form `!ImportValue ...` or long-form `Fn::ImportValue` dict.
    A _CfnTag wrapping either form, or a dict with Fn::Sub key referencing an export name,
    all indicate the value is dynamic and IaC-derived — not a hardcoded ARN string.
    """
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})

    for name, res in resources.items():
        if res.get("Type") == "AWS::WAFv2::WebACLAssociation":
            props = res.get("Properties", {})
            resource_arn = props.get("ResourceArn")
            assert resource_arn is not None, (
                f"WebACLAssociation {name} must have ResourceArn property"
            )
            # A hardcoded ARN would be a bare string starting with "arn:aws:"
            # Dynamic forms: _CfnTag (any CFN intrinsic), or dict with Fn::* key
            is_hardcoded = isinstance(resource_arn, str) and resource_arn.startswith("arn:aws:")
            assert not is_hardcoded, (
                f"WebACLAssociation {name} ResourceArn must use a CFN intrinsic function "
                f"(!ImportValue, !Sub, etc.), not a hardcoded ARN. Got: {resource_arn}\n"
                "SI-001: WAF association must be IaC-defined, not a manual step."
            )
            # Must not contain a hardcoded account ID in any form
            resource_arn_str = str(resource_arn)
            assert "257394457473" not in resource_arn_str, (
                f"WebACLAssociation {name} ResourceArn must not hardcode the AWS account ID"
            )


def test_si001_alb_arn_export_in_ecs_directory():
    """SI-001: cello-ecs-directory.yaml exports AlbArn so the WAF stack can import it."""
    tmpl = load_yaml("cello-ecs-directory.yaml")
    outputs = tmpl.get("Outputs", {})

    alb_arn_outputs = {
        name: out for name, out in outputs.items()
        if "AlbArn" in name or "alb-arn" in str(out.get("Export", {}).get("Name", ""))
    }
    assert alb_arn_outputs, (
        "cello-ecs-directory.yaml must export AlbArn (e.g. cello-{env}-alb-arn) "
        "so the WAF stack can associate the WebACL with the ALB (SI-001, AC-001)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-002: Rate-based rule — 1000/5min/IP, BLOCK, HTTP 429
# ════════════════════════════════════════════════════════════════════════════

def test_ac002_rate_based_rule_exists():
    """AC-002: cello-waf.yaml has a rate-based rule named RateLimitPerIp."""
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "RateLimitPerIp")
    assert rule is not None, (
        "cello-waf.yaml WebACL must contain a rule named 'RateLimitPerIp' (AC-002)"
    )


def test_ac002_rate_based_rule_limit_1000():
    """AC-002: RateLimitPerIp rule has Limit=1000."""
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "RateLimitPerIp")
    assert rule is not None, "RateLimitPerIp rule not found"

    statement = rule.get("Statement", {})
    rate_stmt = statement.get("RateBasedStatement", {})
    assert rate_stmt.get("Limit") == 1000, (
        f"RateLimitPerIp rule must have Limit: 1000, got: {rate_stmt.get('Limit')}"
    )


def test_ac002_rate_based_rule_aggregate_by_ip():
    """AC-002: RateLimitPerIp rule aggregates by IP address."""
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "RateLimitPerIp")
    assert rule is not None, "RateLimitPerIp rule not found"

    rate_stmt = rule.get("Statement", {}).get("RateBasedStatement", {})
    assert rate_stmt.get("AggregateKeyType") == "IP", (
        f"RateLimitPerIp must use AggregateKeyType: IP, got: {rate_stmt.get('AggregateKeyType')}"
    )


def test_ac002_rate_based_rule_returns_429():
    """AC-002: RateLimitPerIp rule returns HTTP 429 on block."""
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "RateLimitPerIp")
    assert rule is not None, "RateLimitPerIp rule not found"

    action = rule.get("Action", {})
    block = action.get("Block", {})
    custom_response = block.get("CustomResponse", {})
    assert custom_response.get("ResponseCode") == 429, (
        f"RateLimitPerIp block action must return HTTP 429, "
        f"got: {custom_response.get('ResponseCode')}\n"
        "AC-002 requires HTTP 429 (Too Many Requests) for rate-limit blocks."
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-003: IP Reputation List — OverrideAction: None (BLOCK fires)
# ════════════════════════════════════════════════════════════════════════════

def test_ac003_ip_reputation_rule_exists():
    """AC-003: cello-waf.yaml has AWSManagedRulesAmazonIpReputationList rule."""
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "AWSManagedRulesAmazonIpReputationList")
    assert rule is not None, (
        "cello-waf.yaml WebACL must contain a rule named "
        "'AWSManagedRulesAmazonIpReputationList' (AC-003)"
    )


def test_ac003_ip_reputation_rule_override_action_none():
    """AC-003: AWSManagedRulesAmazonIpReputationList has OverrideAction: None.

    OverrideAction: None means the managed rule group's own BLOCK action fires.
    OverrideAction: Count would switch the group to observe-only — wrong for AC-003.
    """
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "AWSManagedRulesAmazonIpReputationList")
    assert rule is not None, "AWSManagedRulesAmazonIpReputationList rule not found"

    override_action = rule.get("OverrideAction", {})
    assert "None" in override_action or None in override_action, (
        f"AWSManagedRulesAmazonIpReputationList must have OverrideAction: None "
        f"(to allow the rule group's own BLOCK action to fire), "
        f"got OverrideAction: {override_action}\n"
        "AC-003: requests from known malicious IPs must be blocked (HTTP 403)."
    )


def test_ac003_ip_reputation_uses_correct_managed_rule_group():
    """AC-003: AWSManagedRulesAmazonIpReputationList references the correct vendor/name."""
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "AWSManagedRulesAmazonIpReputationList")
    assert rule is not None, "AWSManagedRulesAmazonIpReputationList rule not found"

    managed_group = rule.get("Statement", {}).get("ManagedRuleGroupStatement", {})
    assert managed_group.get("VendorName") == "AWS", (
        f"IP reputation rule VendorName must be 'AWS', got: {managed_group.get('VendorName')}"
    )
    assert managed_group.get("Name") == "AWSManagedRulesAmazonIpReputationList", (
        f"IP reputation rule Name must be 'AWSManagedRulesAmazonIpReputationList', "
        f"got: {managed_group.get('Name')}"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-004: GeoBlockingEnabled defaults to "false"; geo rule absent when false
# ════════════════════════════════════════════════════════════════════════════

def test_ac004_geo_blocking_parameter_default_false():
    """AC-004: GeoBlockingEnabled parameter defaults to 'false'."""
    tmpl = load_yaml("cello-waf.yaml")
    params = tmpl.get("Parameters", {})
    geo_param = params.get("GeoBlockingEnabled", {})
    assert geo_param.get("Default") == "false", (
        f"GeoBlockingEnabled parameter must default to 'false', "
        f"got: {geo_param.get('Default')}\n"
        "AC-004: geo-blocking must be off by default."
    )


def test_ac004_geo_rule_is_conditional():
    """AC-004: The geo-match rule is wrapped in a CloudFormation !If condition.

    When GeoBlockingEnabled=false, the rule must resolve to !Ref AWS::NoValue
    (absent entirely from the WebACL). AC-004 verifies no GeoMatchStatement
    rule fires when geo-blocking is disabled.

    Note: PyYAML's add_multi_constructor passes tag_suffix="" so _CfnTag.tag is
    always "". We identify !If constructs by structure: a _CfnTag whose value is
    a list of exactly 3 elements [ConditionName, TrueBranch, FalseBranch].
    """
    tmpl = load_yaml("cello-waf.yaml")
    rules = _get_waf_rules(tmpl)

    # Find any rule that is a _CfnTag with a 3-element list value — that is the !If geo rule
    conditional_rules = [
        r for r in rules
        if isinstance(r, _CfnTag) and isinstance(r.value, list) and len(r.value) == 3
    ]
    assert conditional_rules, (
        "cello-waf.yaml WebACL Rules must contain a conditional (!If) rule "
        "for geo-blocking. When GeoBlockingEnabled=false, the rule must be "
        "!Ref AWS::NoValue so no GeoMatchStatement fires (AC-004)."
    )

    # The false branch must be !Ref AWS::NoValue
    for cond_rule in conditional_rules:
        branches = cond_rule.value  # [ConditionName, TrueValue, FalseValue]
        false_branch = branches[2]
        false_str = str(false_branch)
        assert "AWS::NoValue" in false_str, (
            f"Geo-blocking !If false branch must be !Ref AWS::NoValue so the rule is "
            f"absent when GeoBlockingEnabled=false. Got: {false_str}\n"
            "AC-004: no GeoMatchStatement must fire when geo-blocking is disabled."
        )


# ════════════════════════════════════════════════════════════════════════════
# AC-005: Geo rule references BlockedCountries parameter when active
# ════════════════════════════════════════════════════════════════════════════

def test_ac005_geo_rule_references_blocked_countries():
    """AC-005: The geo-match rule's CountryCodes references !Ref BlockedCountries.

    When GeoBlockingEnabled=true, the rule must use the BlockedCountries parameter
    so operators can specify countries without modifying template code.
    """
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "GeoBlockSelectedCountries")
    assert rule is not None, (
        "cello-waf.yaml must contain a geo-match rule named 'GeoBlockSelectedCountries' "
        "(visible in the !If true branch) (AC-005)"
    )

    geo_stmt = rule.get("Statement", {}).get("GeoMatchStatement", {})
    country_codes = geo_stmt.get("CountryCodes")
    assert country_codes is not None, (
        "GeoBlockSelectedCountries rule must have Statement.GeoMatchStatement.CountryCodes"
    )
    country_codes_str = str(country_codes)
    assert "BlockedCountries" in country_codes_str, (
        f"GeoMatchStatement CountryCodes must reference !Ref BlockedCountries, "
        f"got: {country_codes_str}\n"
        "AC-005: country list must be a CloudFormation parameter, not hardcoded."
    )


def test_ac005_blocked_countries_parameter_exists():
    """AC-005: BlockedCountries parameter exists in the template."""
    tmpl = load_yaml("cello-waf.yaml")
    params = tmpl.get("Parameters", {})
    assert "BlockedCountries" in params, (
        "cello-waf.yaml must define a BlockedCountries parameter (AC-005)\n"
        "This allows operators to specify blocked country codes without modifying "
        "the template — changing it requires only a CFN parameter update."
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-006: WAF log group name starts with "aws-waf-logs-", RetentionInDays=90
# ════════════════════════════════════════════════════════════════════════════

def test_ac006_waf_log_group_exists():
    """AC-006: cello-waf.yaml defines an AWS::Logs::LogGroup for WAF logs."""
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})
    log_groups = {
        name: res for name, res in resources.items()
        if res.get("Type") == "AWS::Logs::LogGroup"
    }
    assert log_groups, (
        "cello-waf.yaml must define an AWS::Logs::LogGroup resource for WAF logs (AC-006)"
    )


def test_ac006_waf_log_group_name_prefix():
    """AC-006: WAF log group name starts with 'aws-waf-logs-'.

    WAFv2 rejects log group names that do not start with 'aws-waf-logs-'.
    This is an AWS API requirement, not a naming convention.
    """
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})

    for name, res in resources.items():
        if res.get("Type") == "AWS::Logs::LogGroup":
            props = res.get("Properties", {})
            log_group_name = props.get("LogGroupName")
            assert log_group_name is not None, (
                f"Log group {name} must have LogGroupName property"
            )
            name_str = str(log_group_name)
            assert "aws-waf-logs-" in name_str, (
                f"WAF log group LogGroupName must contain 'aws-waf-logs-' prefix. "
                f"Got: {name_str}\n"
                "WAFv2 API requirement: log group names must start with 'aws-waf-logs-'"
            )


def test_ac006_waf_log_group_retention_90_days():
    """AC-006: WAF log group has RetentionInDays=90."""
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})

    for name, res in resources.items():
        if res.get("Type") == "AWS::Logs::LogGroup":
            props = res.get("Properties", {})
            retention = props.get("RetentionInDays")
            assert retention == 90, (
                f"WAF log group {name} must have RetentionInDays: 90, got: {retention} (AC-006)"
            )


def test_ac006_logging_configuration_resource_exists():
    """AC-006: cello-waf.yaml has an AWS::WAFv2::LoggingConfiguration resource."""
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})
    logging_configs = {
        name: res for name, res in resources.items()
        if res.get("Type") == "AWS::WAFv2::LoggingConfiguration"
    }
    assert logging_configs, (
        "cello-waf.yaml must define an AWS::WAFv2::LoggingConfiguration resource "
        "to route WAF decisions to CloudWatch Logs (AC-006)"
    )


def test_ac006_logging_configuration_references_webacl():
    """AC-006: LoggingConfiguration ResourceArn references the WebACL."""
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})

    for name, res in resources.items():
        if res.get("Type") == "AWS::WAFv2::LoggingConfiguration":
            props = res.get("Properties", {})
            resource_arn = props.get("ResourceArn")
            assert resource_arn is not None, (
                f"LoggingConfiguration {name} must have ResourceArn pointing to the WebACL"
            )
            resource_arn_str = str(resource_arn)
            assert "WebACL" in resource_arn_str or "GetAtt" in resource_arn_str, (
                f"LoggingConfiguration ResourceArn must reference the WebACL "
                f"(e.g. !GetAtt WebACL.Arn), got: {resource_arn_str}"
            )


# ════════════════════════════════════════════════════════════════════════════
# AC-007: AWSManagedRulesCommonRuleSet in COUNT mode
# ════════════════════════════════════════════════════════════════════════════

def test_ac007_common_rule_set_exists():
    """AC-007: cello-waf.yaml has AWSManagedRulesCommonRuleSet rule."""
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "AWSManagedRulesCommonRuleSet")
    assert rule is not None, (
        "cello-waf.yaml WebACL must contain a rule named 'AWSManagedRulesCommonRuleSet' (AC-007)"
    )


def test_ac007_common_rule_set_count_mode():
    """AC-007: AWSManagedRulesCommonRuleSet has OverrideAction: Count (not None/Block).

    COUNT mode: requests are not blocked; rule hits are counted and logged.
    This is Phase 1 — operators observe rule hits before switching to BLOCK.
    """
    tmpl = load_yaml("cello-waf.yaml")
    rule = _rule_by_name(_get_waf_rules(tmpl), "AWSManagedRulesCommonRuleSet")
    assert rule is not None, "AWSManagedRulesCommonRuleSet rule not found"

    override_action = rule.get("OverrideAction", {})
    assert "Count" in override_action, (
        f"AWSManagedRulesCommonRuleSet must have OverrideAction: Count (COUNT mode). "
        f"Got: {override_action}\n"
        "AC-007: Phase 1 — observe rule hits before switching to BLOCK mode."
    )
    assert "None" not in override_action, (
        "AWSManagedRulesCommonRuleSet must NOT have OverrideAction: None — "
        "that would activate blocking mode (AC-007 requires COUNT mode)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-008: deploy.sh deploys cello-waf after cello-ecs-directory
# ════════════════════════════════════════════════════════════════════════════

def test_ac008_deploy_sh_contains_waf_step():
    """AC-008: infra/deploy.sh deploys the cello-waf stack."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    assert "cello-waf" in content, (
        "infra/deploy.sh must deploy the cello-waf stack (AC-008-deploy-script-inclusion)"
    )


def test_ac008_waf_deployed_after_ecs_directory():
    """AC-008: deploy.sh deploys cello-waf after cello-ecs-directory.

    WAF imports the ALB ARN from cello-ecs-directory via cross-stack reference.
    The ECS directory stack must deploy first so the ALB ARN export exists.
    """
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    ecs_dir_pos = content.find('deploy_stack "cello-ecs-directory-')
    waf_pos = content.find('deploy_stack "cello-waf-')

    assert ecs_dir_pos != -1, "deploy_stack cello-ecs-directory not found in deploy.sh"
    assert waf_pos != -1, (
        "deploy_stack cello-waf not found in deploy.sh "
        "(AC-008: WAF must deploy automatically without manual steps)"
    )
    assert ecs_dir_pos < waf_pos, (
        "cello-waf must be deployed AFTER cello-ecs-directory in deploy.sh\n"
        "WAF uses !ImportValue cello-{env}-alb-arn — the ALB must exist first."
    )


# ════════════════════════════════════════════════════════════════════════════
# SI-002: No parameter to disable WAF or skip the WebACL association
# ════════════════════════════════════════════════════════════════════════════

def test_si002_no_waf_disable_parameter():
    """SI-002: cello-waf.yaml has no parameter that can disable WAF or skip the association.

    The template must not have a WafEnabled, DisableWaf, SkipWafAssociation, or
    equivalent boolean toggle. WAF and Shield Standard must always be active in
    all environments — the only safe fallback for a misbehaving rule is switching
    it to COUNT mode, not removing the WebACL.
    """
    tmpl = load_yaml("cello-waf.yaml")
    params = tmpl.get("Parameters", {})

    forbidden_names = [
        "WafEnabled", "EnableWaf", "DisableWaf",
        "AssociateWebAcl", "SkipWafAssociation", "WafAssociationEnabled",
        "WafActive", "WafDisabled",
    ]

    for forbidden in forbidden_names:
        assert forbidden not in params, (
            f"SI-002 VIOLATION: cello-waf.yaml has a parameter '{forbidden}' that "
            "could be used to disable WAF protection. This parameter must not exist.\n"
            "SI-002: WAF and Shield Standard must never be disabled in any environment. "
            "The only safe fallback is switching a rule to COUNT mode."
        )


def test_si002_web_acl_association_not_conditional():
    """SI-002: WebACLAssociation resource is not guarded by any Condition.

    The association must be unconditional — it must deploy whenever the stack deploys.
    A conditional association would allow operators to bypass WAF protection.
    """
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})

    for name, res in resources.items():
        if res.get("Type") == "AWS::WAFv2::WebACLAssociation":
            condition = res.get("Condition")
            assert condition is None, (
                f"SI-002 VIOLATION: WebACLAssociation {name} has a Condition: {condition}\n"
                "The WAF association must be unconditional — it must always deploy "
                "when the stack deploys. A conditional association allows bypassing WAF."
            )


# ════════════════════════════════════════════════════════════════════════════
# Structural: WebACL scope is REGIONAL (not CLOUDFRONT)
# ════════════════════════════════════════════════════════════════════════════

def test_webacl_scope_is_regional():
    """cello-waf.yaml WebACL Scope is REGIONAL (not CLOUDFRONT).

    WAFv2 WebACLs for ALBs must use REGIONAL scope. CLOUDFRONT scope is only
    for CloudFront distributions and must be deployed in us-east-1 regardless
    of the ALB's region.
    """
    tmpl = load_yaml("cello-waf.yaml")
    resources = tmpl.get("Resources", {})

    for name, res in resources.items():
        if res.get("Type") == "AWS::WAFv2::WebACL":
            scope = res.get("Properties", {}).get("Scope")
            assert scope == "REGIONAL", (
                f"WebACL {name} must have Scope: REGIONAL (not CLOUDFRONT). "
                f"Got: {scope}\n"
                "ALB-attached WebACLs must use REGIONAL scope."
            )


# ════════════════════════════════════════════════════════════════════════════
# AC-002/AC-003 notes (live integration tests — manual verify)
# ════════════════════════════════════════════════════════════════════════════

# AC-002: Live rate-limit test — send 1,001 requests from a single IP to the
#   directory ALB within a 5-minute window; the 1,001st must return HTTP 429.
#   Verify via: aws logs get-log-events --log-group-name aws-waf-logs-cello-dev
#   Look for action=BLOCK, ruleId=RateLimitPerIp.
#   Cannot be unit-tested without live infrastructure.

# AC-003: Live reputation-list test — requires a request from an IP on the
#   AWSManagedRulesAmazonIpReputationList, which cannot be simulated locally.
#   Verify post-deploy by checking WAF logs for action=BLOCK entries with
#   ruleId=AWSManagedRulesAmazonIpReputationList.
#   Cannot be unit-tested without live infrastructure.

# AC-001: Live WebACL association check:
#   ALB_ARN=$(aws cloudformation describe-stacks --stack-name cello-ecs-directory-dev \
#     --query "Stacks[0].Outputs[?OutputKey=='AlbArn'].OutputValue" --output text)
#   aws wafv2 get-web-acl-for-resource --resource-arn $ALB_ARN --region us-east-1


if __name__ == "__main__":
    import traceback

    tests = [
        test_waf_template_exists,
        test_ac001_web_acl_association_resource_exists,
        test_si001_web_acl_association_uses_import_value,
        test_si001_alb_arn_export_in_ecs_directory,
        test_ac002_rate_based_rule_exists,
        test_ac002_rate_based_rule_limit_1000,
        test_ac002_rate_based_rule_aggregate_by_ip,
        test_ac002_rate_based_rule_returns_429,
        test_ac003_ip_reputation_rule_exists,
        test_ac003_ip_reputation_rule_override_action_none,
        test_ac003_ip_reputation_uses_correct_managed_rule_group,
        test_ac004_geo_blocking_parameter_default_false,
        test_ac004_geo_rule_is_conditional,
        test_ac005_geo_rule_references_blocked_countries,
        test_ac005_blocked_countries_parameter_exists,
        test_ac006_waf_log_group_exists,
        test_ac006_waf_log_group_name_prefix,
        test_ac006_waf_log_group_retention_90_days,
        test_ac006_logging_configuration_resource_exists,
        test_ac006_logging_configuration_references_webacl,
        test_ac007_common_rule_set_exists,
        test_ac007_common_rule_set_count_mode,
        test_ac008_deploy_sh_contains_waf_step,
        test_ac008_waf_deployed_after_ecs_directory,
        test_si002_no_waf_disable_parameter,
        test_si002_web_acl_association_not_conditional,
        test_webacl_scope_is_regional,
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
