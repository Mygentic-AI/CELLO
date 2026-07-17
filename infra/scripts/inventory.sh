#!/usr/bin/env bash
# ==============================================================================
# inventory.sh — snapshot every hibernate-relevant resource in a region
# ==============================================================================
# Writes a JSON inventory of the live state for one region. Called by hibernate.sh
# (before teardown) and wake.sh (after wake). Running diff between two snapshots
# proves exact equivalence.
#
# Usage:
#   ./inventory.sh ap-northeast-1              # print JSON to stdout
#   ./inventory.sh ap-northeast-1 before.json  # write to file
#   ./inventory.sh --diff before.json after.json  # compare two snapshots
#
# Exit code: 0 = success / identical diff; 1 = differences found or error.
# ==============================================================================

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hibernate-common.sh"

# --- Diff mode ----------------------------------------------------------------
if [[ "${1:-}" == "--diff" ]]; then
  [[ $# -eq 3 ]] || fatal "Usage: $0 --diff before.json after.json"
  BEFORE="$2"; AFTER="$3"
  [[ -f "$BEFORE" ]] || fatal "File not found: $BEFORE"
  [[ -f "$AFTER"  ]] || fatal "File not found: $AFTER"

  python3 - "$BEFORE" "$AFTER" << 'PYEOF'
import json, sys

def load(path):
    with open(path) as f:
        return json.load(f)

def flatten(obj, prefix=""):
    items = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            items.update(flatten(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            items.update(flatten(v, f"{prefix}[{i}]"))
    else:
        items[prefix] = obj
    return items

before = load(sys.argv[1])
after  = load(sys.argv[2])

region_b = before.get("region", "?")
region_a = after.get("region",  "?")
ts_b = before.get("captured_at", "?")
ts_a = after.get("captured_at", "?")

print(f"\n{'='*70}")
print(f"INVENTORY DIFF — region: {region_b}")
print(f"  BEFORE: {ts_b}")
print(f"  AFTER:  {ts_a}")
print(f"{'='*70}\n")

# Fields to IGNORE in diff (expected to change: task IDs, IPs, timestamps,
# ALB/NAT IDs that are recreated, and relay IP which auto-heals via re-registration).
IGNORE_SUFFIXES = [
    "captured_at",
    "task_arn", "task_id", "private_ip",
    "task_ip",                              # ECS task private IP changes on every launch
    "nat.id",
    "alb_dir.arn", "alb_dir.dns", "alb_relay.arn", "alb_relay.dns",
    "listener_dir.arn", "listener_relay.arn",
    # listener rules reference listener ARNs which change; we check them structurally below
    "rules_dir[", "rules_relay[",
    "route53_dir.alias", "route53_relay.alias",  # new ALB DNS
    "ssmmessages_endpoint.id",              # endpoint ID changes on recreate
    "].id",                                 # vpc_endpoints[N].id — changes on recreate
    "dns_resolution.dir", "dns_resolution.relay",  # IPs change with new ALB
    "eip_dir", "eip_relay",                # EIPs on ALBs change
]

def should_ignore(key):
    return any(key == ig or key.endswith(ig) or ig in key for ig in IGNORE_SUFFIXES)

fb = flatten(before)
fa = flatten(after)

# Check STRUCTURAL equivalence of listener rules (paths + priorities, not ARNs)
def check_rules(label, before_rules, after_rules):
    issues = []
    def sig(r): return (r.get("priority"), sorted(r.get("paths", [])), r.get("tg_port"))
    bs = sorted([sig(r) for r in before_rules])
    as_ = sorted([sig(r) for r in after_rules])
    if bs != as_:
        issues.append(f"  RULES DIFFER for {label}:\n    before: {bs}\n    after:  {as_}")
    return issues

issues = []
issues += check_rules("directory",
    before.get("rules_dir", []), after.get("rules_dir", []))
issues += check_rules("relay",
    before.get("rules_relay", []), after.get("rules_relay", []))

all_keys = sorted(set(fb.keys()) | set(fa.keys()))
for key in all_keys:
    if should_ignore(key):
        continue
    bv = fb.get(key, "<MISSING>")
    av = fa.get(key, "<MISSING>")
    if bv != av:
        issues.append(f"  {key}:\n    before: {bv}\n    after:  {av}")

if not issues:
    print("✅  No differences — environment is identical (structurally).")
    sys.exit(0)
else:
    print(f"❌  {len(issues)} difference(s) found:\n")
    for i in issues:
        print(i)
    sys.exit(1)
PYEOF
  exit $?
fi

# --- Snapshot mode ------------------------------------------------------------
[[ $# -ge 1 ]] || fatal "Usage: $0 <region> [output.json]"
REGION="$1"
OUTPUT="${2:-}"

require_tools

step "Snapshotting region ${REGION}"

# ── ECS ──────────────────────────────────────────────────────────────────────
log "ECS services..."
ecs_raw=$(aws ecs describe-services \
  --cluster "${CLUSTER_NAME}" \
  --services "cello-directory-${ENVIRONMENT}" "cello-relay-${ENVIRONMENT}" \
  --region "${REGION}" \
  --query 'services[*].{name:serviceName,desired:desiredCount,running:runningCount,taskdef:taskDefinition}' \
  --output json 2>/dev/null || echo '[]')

ecs_json='[]'
while read -r svc; do
  name=$(echo "$svc" | jq -r '.name')
  desired=$(echo "$svc" | jq -r '.desired')
  taskdef=$(echo "$svc" | jq -r '.taskdef' | sed 's/.*\///' ) # strip ARN prefix
  ecs_json=$(echo "$ecs_json" | jq --arg n "$name" --argjson d "$desired" --arg t "$taskdef" \
    '. + [{name:$n, desired:$d, taskdef:$t}]')
  ok "ECS ${name}: desired=${desired} taskdef=${taskdef}"
done < <(echo "$ecs_raw" | jq -c '.[]')

# ── ECS running task (for private IP — informational only, expected to change) ──
task_arns=$(aws ecs list-tasks --cluster "${CLUSTER_NAME}" \
  --service-name "cello-directory-${ENVIRONMENT}" \
  --region "${REGION}" --query 'taskArns[0]' --output text 2>/dev/null || echo "None")
task_ip="unknown"
if [[ "$task_arns" != "None" && -n "$task_arns" ]]; then
  task_ip=$(aws ecs describe-tasks --cluster "${CLUSTER_NAME}" \
    --tasks "$task_arns" --region "${REGION}" \
    --query 'tasks[0].containers[0].networkInterfaces[0].privateIpv4Address' \
    --output text 2>/dev/null || echo "unknown")
fi
ok "Directory task IP: ${task_ip} (informational — expected to change on wake)"

# ── RDS ──────────────────────────────────────────────────────────────────────
log "RDS..."
rds_raw=$(aws rds describe-db-instances \
  --db-instance-identifier "cello-${ENVIRONMENT}" \
  --region "${REGION}" \
  --query 'DBInstances[0].{id:DBInstanceIdentifier,class:DBInstanceClass,status:DBInstanceStatus,endpoint:Endpoint.Address,port:Endpoint.Port,storage:AllocatedStorage,engine:Engine,version:EngineVersion,multi_az:MultiAZ,deletion_protection:DeletionProtection}' \
  --output json 2>/dev/null || echo '{}')
rds_endpoint=$(echo "$rds_raw" | jq -r '.endpoint // "unknown"')
rds_status=$(echo "$rds_raw" | jq -r '.status // "unknown"')
ok "RDS: ${rds_endpoint} (${rds_status})"

# ── NAT Gateway ───────────────────────────────────────────────────────────────
log "NAT Gateway..."
nat_raw=$(aws ec2 describe-nat-gateways --region "${REGION}" \
  --filter Name=state,Values=available \
  --query 'NatGateways[0].{id:NatGatewayId,subnet:SubnetId,eip_alloc:NatGatewayAddresses[0].AllocationId,public_ip:NatGatewayAddresses[0].PublicIp,vpc:VpcId}' \
  --output json 2>/dev/null || echo 'null')

if [[ "$nat_raw" == "null" || -z "$nat_raw" || $(echo "$nat_raw" | jq -r '.id // "null"') == "null" ]]; then
  nat_json='{"id":"<none>","public_ip":"<none>","eip_alloc":"<none>","subnet":"<none>","vpc":"<none>"}'
  warn "No available NAT Gateway found (may already be hibernated)"
else
  nat_id=$(echo "$nat_raw" | jq -r '.id')
  nat_ip=$(echo "$nat_raw" | jq -r '.public_ip')
  nat_alloc=$(echo "$nat_raw" | jq -r '.eip_alloc')
  nat_json=$(echo "$nat_raw" | jq '{id:.id,public_ip:.public_ip,eip_alloc:.eip_alloc,subnet:.subnet,vpc:.vpc}')
  ok "NAT: ${nat_id} (EIP ${nat_ip}, alloc ${nat_alloc})"
fi

# ── VPC Endpoints ─────────────────────────────────────────────────────────────
log "VPC Endpoints..."
vpc_id=$(echo "$nat_json" | jq -r '.vpc // empty')
if [[ -z "$vpc_id" || "$vpc_id" == "<none>" ]]; then
  # Fallback: get VPC from RDS
  vpc_id=$(aws rds describe-db-instances \
    --db-instance-identifier "cello-${ENVIRONMENT}" --region "${REGION}" \
    --query 'DBInstances[0].DBSubnetGroup.VpcId' --output text 2>/dev/null || echo "")
fi

eps_json='[]'
if [[ -n "$vpc_id" ]]; then
  ep_raw=$(aws ec2 describe-vpc-endpoints --region "${REGION}" \
    --filters "Name=vpc-id,Values=${vpc_id}" \
    --query 'VpcEndpoints[?State==`available`].{id:VpcEndpointId,service:ServiceName,type:VpcEndpointType,subnets:SubnetIds,private_dns:PrivateDnsEnabled}' \
    --output json 2>/dev/null || echo '[]')
  # Normalize: strip service prefix down to just the service name for stable comparison
  eps_json=$(echo "$ep_raw" | jq '[.[] | {
    service: (.service | split(".") | last),
    type: .type,
    subnet_count: (.subnets | length),
    private_dns: .private_dns,
    id: .id
  }]')
  cnt=$(echo "$eps_json" | jq 'length')
  ok "VPC endpoints: ${cnt}"
  echo "$eps_json" | jq -r '.[] | "    - " + .service + " (" + .type + ", id=" + .id + ")"'
fi

# ── ALBs ──────────────────────────────────────────────────────────────────────
log "ALBs..."

capture_alb() {
  local name="$1"
  local alb_raw
  alb_raw=$(aws elbv2 describe-load-balancers --names "$name" --region "${REGION}" \
    --query 'LoadBalancers[0].{arn:LoadBalancerArn,dns:DNSName,zone:CanonicalHostedZoneId,scheme:Scheme,type:Type,state:State.Code}' \
    --output json 2>/dev/null || echo 'null')
  echo "$alb_raw"
}

capture_listener_rules() {
  local listener_arn="$1"
  local rules_raw
  rules_raw=$(aws elbv2 describe-rules --listener-arn "$listener_arn" --region "${REGION}" \
    --query 'Rules[*].{priority:Priority,paths:Conditions[0].Values,tg_arn:Actions[0].TargetGroupArn}' \
    --output json 2>/dev/null || echo '[]')

  # Resolve TG ARN → port for stable comparison (port is stable; ARN changes after ALB recreate)
  # Write Python to a temp file to avoid the stdin conflict (heredoc vs pipe both claim stdin)
  local py_tmp
  py_tmp=$(mktemp)
  trap "rm -f '$py_tmp'" RETURN
  cat > "$py_tmp" << 'PYEOF'
import json, sys, subprocess

rules = json.loads(sys.argv[1])
region = sys.argv[2]

result = subprocess.run(
    ["aws", "elbv2", "describe-target-groups", "--region", region,
     "--query", "TargetGroups[*].{arn:TargetGroupArn,port:Port,hcport:HealthCheckPort}",
     "--output", "json"],
    capture_output=True, text=True)
tg_map = {tg["arn"]: tg for tg in json.loads(result.stdout or "[]")}

out = []
for r in rules:
    tg_arn = r.get("tg_arn", "")
    tg = tg_map.get(tg_arn, {})
    out.append({
        "priority": r["priority"],
        "paths":    r.get("paths") or [],
        "tg_port":  tg.get("port"),
        "tg_hcport": tg.get("hcport"),
    })
print(json.dumps(out))
PYEOF
  python3 "$py_tmp" "$rules_raw" "${REGION}"
  rm -f "$py_tmp"
}

# Directory ALB
alb_dir_name="cello-dir-${ENVIRONMENT}"
alb_dir=$(capture_alb "$alb_dir_name")
alb_dir_arn=$(echo "$alb_dir" | jq -r '.arn // "<none>"')
alb_dir_dns=$(echo "$alb_dir" | jq -r '.dns // "<none>"')
ok "Dir ALB: ${alb_dir_dns}"

rules_dir='[]'
listener_dir_arn=""
if [[ "$alb_dir_arn" != "<none>" ]]; then
  listener_dir_arn=$(aws elbv2 describe-listeners --load-balancer-arn "$alb_dir_arn" \
    --region "${REGION}" --query 'Listeners[0].ListenerArn' --output text 2>/dev/null || echo "")
  if [[ -n "$listener_dir_arn" && "$listener_dir_arn" != "None" ]]; then
    rules_dir=$(capture_listener_rules "$listener_dir_arn")
  fi
fi

# Relay ALB
alb_relay_name="cello-relay-${ENVIRONMENT}"
alb_relay=$(capture_alb "$alb_relay_name")
alb_relay_arn=$(echo "$alb_relay" | jq -r '.arn // "<none>"')
alb_relay_dns=$(echo "$alb_relay" | jq -r '.dns // "<none>"')
ok "Relay ALB: ${alb_relay_dns}"

rules_relay='[]'
listener_relay_arn=""
if [[ "$alb_relay_arn" != "<none>" ]]; then
  listener_relay_arn=$(aws elbv2 describe-listeners --load-balancer-arn "$alb_relay_arn" \
    --region "${REGION}" --query 'Listeners[0].ListenerArn' --output text 2>/dev/null || echo "")
  if [[ -n "$listener_relay_arn" && "$listener_relay_arn" != "None" ]]; then
    rules_relay=$(capture_listener_rules "$listener_relay_arn")
  fi
fi

# ── Target Groups ─────────────────────────────────────────────────────────────
log "Target Groups..."
tg_raw=$(aws elbv2 describe-target-groups --region "${REGION}" \
  --query "TargetGroups[?contains(TargetGroupName,'cello')].{name:TargetGroupName,port:Port,hcport:HealthCheckPort,hcpath:HealthCheckPath,vpc:VpcId,type:TargetType}" \
  --output json 2>/dev/null || echo '[]')
tg_count=$(echo "$tg_raw" | jq 'length')
ok "Target groups: ${tg_count}"
echo "$tg_raw" | jq -r '.[] | "    - " + .name + " port=" + (.port|tostring) + " hc=" + .hcport'

# ── Route53 ───────────────────────────────────────────────────────────────────
log "Route53..."
dir_sub=$(dir_subdomain "${REGION}")
relay_sub=$(relay_subdomain "${REGION}")

r53_dir=$(aws route53 list-resource-record-sets \
  --hosted-zone-id "${HOSTED_ZONE_ID}" \
  --query "ResourceRecordSets[?Name=='${dir_sub}.${DOMAIN}.'].{name:Name,type:Type,alias:AliasTarget.DNSName}" \
  --output json 2>/dev/null | jq '.[0] // {}')

r53_relay=$(aws route53 list-resource-record-sets \
  --hosted-zone-id "${HOSTED_ZONE_ID}" \
  --query "ResourceRecordSets[?Name=='${relay_sub}.${DOMAIN}.'].{name:Name,type:Type,alias:AliasTarget.DNSName}" \
  --output json 2>/dev/null | jq '.[0] // {}')

ok "Route53 dir:   $(echo $r53_dir   | jq -r '.alias // "<missing>"')"
ok "Route53 relay: $(echo $r53_relay | jq -r '.alias // "<missing>"')"

# ── DNS resolution check ──────────────────────────────────────────────────────
log "DNS resolution..."
dir_resolves=$(dig @8.8.8.8 +short "${dir_sub}.${DOMAIN}" 2>/dev/null | head -1 || echo "")
relay_resolves=$(dig @8.8.8.8 +short "${relay_sub}.${DOMAIN}" 2>/dev/null | head -1 || echo "")
[[ -n "$dir_resolves"   ]] && ok "DNS ${dir_sub}: ${dir_resolves}"   || warn "DNS ${dir_sub}: NOT RESOLVING"
[[ -n "$relay_resolves" ]] && ok "DNS ${relay_sub}: ${relay_resolves}" || warn "DNS ${relay_sub}: NOT RESOLVING"

# ── Assemble snapshot ─────────────────────────────────────────────────────────
SNAPSHOT=$(jq -n \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg region "${REGION}" \
  --arg env "${ENVIRONMENT}" \
  --arg cluster "${CLUSTER_NAME}" \
  --arg vpc "${vpc_id}" \
  --argjson ecs "${ecs_json}" \
  --argjson rds "${rds_raw}" \
  --argjson nat "${nat_json}" \
  --argjson eps "${eps_json}" \
  --argjson alb_dir "${alb_dir}" \
  --argjson alb_relay "${alb_relay}" \
  --arg listener_dir "${listener_dir_arn}" \
  --arg listener_relay "${listener_relay_arn}" \
  --argjson rules_dir "${rules_dir}" \
  --argjson rules_relay "${rules_relay}" \
  --argjson tg "${tg_raw}" \
  --argjson r53_dir "${r53_dir}" \
  --argjson r53_relay "${r53_relay}" \
  --arg dir_dns "${dir_resolves:-<not resolving>}" \
  --arg relay_dns "${relay_resolves:-<not resolving>}" \
  --arg task_ip "${task_ip}" \
  '{
    captured_at: $ts,
    region: $region,
    environment: $env,
    cluster: $cluster,
    vpc_id: $vpc,
    ecs_services: $ecs,
    rds: $rds,
    nat: $nat,
    vpc_endpoints: $eps,
    alb_dir: $alb_dir,
    alb_relay: $alb_relay,
    listener_dir: {arn: $listener_dir},
    listener_relay: {arn: $listener_relay},
    rules_dir: $rules_dir,
    rules_relay: $rules_relay,
    target_groups: $tg,
    route53_dir: $r53_dir,
    route53_relay: $r53_relay,
    dns_resolution: {dir: $dir_dns, relay: $relay_dns},
    task_ip: $task_ip
  }')

if [[ -n "$OUTPUT" ]]; then
  echo "$SNAPSHOT" | jq . > "$OUTPUT"
  ok "Snapshot written to ${OUTPUT}"
else
  echo "$SNAPSHOT" | jq .
fi
