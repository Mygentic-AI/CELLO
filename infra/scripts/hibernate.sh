#!/usr/bin/env bash
# ==============================================================================
# hibernate.sh — spin DOWN CELLO infrastructure to cut cost
# ==============================================================================
# Discovers live state, writes hibernation-state.json, then tears down the
# expensive-but-idle resources. Exactly reversible by wake.sh.
#
# What is STOPPED (state persists, trivially reversible):
#   - ECS services (directory, relay)  → desiredCount 0
#   - RDS per-region                   → stopped (endpoint DNS unchanged on restart)
#
# What is DELETED (recreated by wake.sh from the state file):
#   - ALBs (dir + relay per region)    ~$150/mo across 3 regions
#   - NAT Gateways per region          ~$109/mo  (EIPs RETAINED for reuse on wake)
#   - VPC ssmmessages Interface Endpoint per region  ~$62/mo
#     NOTE: ECS Exec is unavailable while hibernated (requires ssmmessages endpoint)
#
# What is KEPT untouched (cheap/stateless or too costly to recreate):
#   Target groups, security groups, VPC/subnets/routes, IAM, ECR, S3, Route53
#   ACM certs, Secrets Manager, SSM parameters, KMS keys, CloudWatch, WAF
#   Route53 A records (updated by wake.sh to point at new ALB DNS)
#
# Usage:
#   ./hibernate.sh                                 # DRY-RUN all 3 regions
#   ./hibernate.sh --region ap-northeast-1         # DRY-RUN single region (for testing)
#   ./hibernate.sh --region ap-northeast-1 --execute  # live single region
#   ./hibernate.sh --execute                       # live all 3 regions
#   ./hibernate.sh --execute --yes                 # skip confirmation prompt
# ==============================================================================

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hibernate-common.sh"

# --- Options ------------------------------------------------------------------
ALL_REGIONS=(us-east-1 eu-central-1 ap-northeast-1)
TARGET_REGIONS=()
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)         DRY_RUN=0 ;;
    --dry-run)         DRY_RUN=1 ;;
    --region)          shift; TARGET_REGIONS+=("$1") ;;
    --yes|-y)          ASSUME_YES=1 ;;
    -h|--help)         grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fatal "Unknown argument: $1" ;;
  esac
  shift
done

[[ ${#TARGET_REGIONS[@]} -eq 0 ]] && TARGET_REGIONS=("${ALL_REGIONS[@]}")
REGIONS_STR="${TARGET_REGIONS[*]}"

require_tools
banner "HIBERNATE — CELLO infrastructure" "${REGIONS_STR}"

# ==============================================================================
# PHASE 1: PRE-FLIGHT INVENTORY (read-only)
# ==============================================================================
step "Phase 1: Pre-flight inventory"

SNAPSHOT_DIR="${INFRA_DIR}/hibernation-snapshots"
mkdir -p "${SNAPSHOT_DIR}"
TS=$(date -u +%Y%m%dT%H%M%SZ)

SNAP_PIDS=()
for REGION in "${TARGET_REGIONS[@]}"; do
  (
    log "Snapshotting ${REGION} (before)..."
    BEFORE_FILE="${SNAPSHOT_DIR}/${REGION}-before-${TS}.json"
    "${SCRIPT_DIR}/inventory.sh" "${REGION}" "${BEFORE_FILE}"
    ok "Before-snapshot: ${BEFORE_FILE}"
  ) &
  SNAP_PIDS+=($!)
done
for pid in "${SNAP_PIDS[@]}"; do wait "$pid"; done

# ==============================================================================
# PHASE 2: DISCOVER live state per region and build state file
# ==============================================================================
step "Phase 2: Discovering live state across regions"

REGION_STATES='[]'

for REGION in "${TARGET_REGIONS[@]}"; do
  log "Discovering ${REGION}..."
  export AWS_DEFAULT_REGION="${REGION}"

  # --- NAT Gateway -------------------------------------------------------------
  nat_json=$(aws ec2 describe-nat-gateways --region "${REGION}" \
    --filter Name=state,Values=available \
    --query 'NatGateways[0].{id:NatGatewayId,subnet:SubnetId,eip_alloc:NatGatewayAddresses[0].AllocationId,public_ip:NatGatewayAddresses[0].PublicIp,vpc:VpcId}' \
    --output json 2>/dev/null || echo 'null')
  nat_id=$(echo "$nat_json" | jq -r '.id // ""')
  nat_vpc=$(echo "$nat_json" | jq -r '.vpc // ""')
  [[ -n "$nat_id" ]] && ok "  NAT: ${nat_id} (EIP $(echo $nat_json | jq -r '.public_ip'))" \
                      || warn "  No available NAT in ${REGION}"

  # Private route table routing 0.0.0.0/0 → NAT
  private_rt=""
  if [[ -n "$nat_id" ]]; then
    private_rt=$(aws ec2 describe-route-tables --region "${REGION}" \
      --filters "Name=vpc-id,Values=${nat_vpc}" \
      --query "RouteTables[?Routes[?NatGatewayId=='${nat_id}']].RouteTableId | [0]" \
      --output text 2>/dev/null || echo "")
    [[ "$private_rt" == "None" ]] && private_rt=""
    [[ -n "$private_rt" ]] && ok "  Private RT: ${private_rt}"
  fi

  # NAT tags (restored on recreate)
  nat_tags='[]'
  if [[ -n "$nat_id" ]]; then
    nat_tags=$(aws ec2 describe-nat-gateways --nat-gateway-ids "${nat_id}" \
      --region "${REGION}" --query 'NatGateways[0].Tags' --output json 2>/dev/null || echo '[]')
    [[ "$nat_tags" == "null" ]] && nat_tags='[]'
  fi

  # --- ALBs --------------------------------------------------------------------
  alb_dir_arn=$(aws elbv2 describe-load-balancers \
    --names "cello-dir-${ENVIRONMENT}" --region "${REGION}" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "None")
  alb_relay_arn=$(aws elbv2 describe-load-balancers \
    --names "cello-relay-${ENVIRONMENT}" --region "${REGION}" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "None")
  [[ "$alb_dir_arn"   != "None" ]] && ok "  Dir ALB:   ${alb_dir_arn}"   || warn "  Dir ALB not found"
  [[ "$alb_relay_arn" != "None" ]] && ok "  Relay ALB: ${alb_relay_arn}" || warn "  Relay ALB not found"

  # Capture listener rules before deleting (needed to recreate faithfully on wake)
  dir_rules='[]'
  relay_rules='[]'

  capture_rules() {
    local alb_arn="$1"
    local region="$2"
    if [[ "$alb_arn" == "None" || -z "$alb_arn" ]]; then echo '[]'; return; fi
    local listener_arn
    listener_arn=$(aws elbv2 describe-listeners --load-balancer-arn "$alb_arn" \
      --region "$region" --query 'Listeners[0].ListenerArn' --output text 2>/dev/null || echo "None")
    if [[ "$listener_arn" == "None" || -z "$listener_arn" ]]; then echo '[]'; return; fi
    # Capture rules with target group ARNs (we keep the TGs, so ARNs survive)
    aws elbv2 describe-rules --listener-arn "$listener_arn" --region "$region" \
      --query 'Rules[*].{priority:Priority,paths:Conditions[0].Values,tg_arn:Actions[0].TargetGroupArn}' \
      --output json 2>/dev/null || echo '[]'
  }

  dir_rules=$(capture_rules "$alb_dir_arn" "${REGION}")
  relay_rules=$(capture_rules "$alb_relay_arn" "${REGION}")

  # Capture subnets and SGs from the ALBs (needed to recreate them)
  dir_alb_config='{}'
  relay_alb_config='{}'
  if [[ "$alb_dir_arn" != "None" ]]; then
    dir_alb_config=$(aws elbv2 describe-load-balancers \
      --load-balancer-arns "$alb_dir_arn" --region "${REGION}" \
      --query 'LoadBalancers[0].{subnets:AvailabilityZones[*].SubnetId,sgs:SecurityGroups,scheme:Scheme,idle_timeout:LoadBalancerAttributes}' \
      --output json 2>/dev/null || echo '{}')
    # Also capture the idle timeout attribute specifically
    idle=$(aws elbv2 describe-load-balancer-attributes \
      --load-balancer-arn "$alb_dir_arn" --region "${REGION}" \
      --query 'Attributes[?Key==`idle_timeout.timeout_seconds`].Value | [0]' \
      --output text 2>/dev/null || echo "300")
    dir_alb_config=$(echo "$dir_alb_config" | jq --arg i "$idle" '. + {idle_timeout_seconds: $i}')
  fi
  if [[ "$alb_relay_arn" != "None" ]]; then
    relay_alb_config=$(aws elbv2 describe-load-balancers \
      --load-balancer-arns "$alb_relay_arn" --region "${REGION}" \
      --query 'LoadBalancers[0].{subnets:AvailabilityZones[*].SubnetId,sgs:SecurityGroups,scheme:Scheme}' \
      --output json 2>/dev/null || echo '{}')
    idle=$(aws elbv2 describe-load-balancer-attributes \
      --load-balancer-arn "$alb_relay_arn" --region "${REGION}" \
      --query 'Attributes[?Key==`idle_timeout.timeout_seconds`].Value | [0]' \
      --output text 2>/dev/null || echo "300")
    relay_alb_config=$(echo "$relay_alb_config" | jq --arg i "$idle" '. + {idle_timeout_seconds: $i}')
  fi

  # Capture target group ARNs per role (TGs survive hibernate — only their names change if
  # ALB is recreated, but we reference by ARN in the listener rules we captured above)
  tg_main_arn=$(aws elbv2 describe-target-groups --region "${REGION}" \
    --query "TargetGroups[?Port==\`8080\` && contains(TargetGroupName,'cello')].TargetGroupArn | [0]" \
    --output text 2>/dev/null || echo "None")
  tg_bootstrap_arn=$(aws elbv2 describe-target-groups --region "${REGION}" \
    --query "TargetGroups[?Port==\`9090\` && contains(TargetGroupName,'cello')].TargetGroupArn | [0]" \
    --output text 2>/dev/null || echo "None")
  tg_internal_arn=$(aws elbv2 describe-target-groups --region "${REGION}" \
    --query "TargetGroups[?Port==\`8081\` && contains(TargetGroupName,'cello')].TargetGroupArn | [0]" \
    --output text 2>/dev/null || echo "None")
  tg_relay_arn=$(aws elbv2 describe-target-groups --region "${REGION}" \
    --query "TargetGroups[?Port==\`4002\` && contains(TargetGroupName,'cello')].TargetGroupArn | [0]" \
    --output text 2>/dev/null || echo "None")

  # --- Portal ALB (us-east-1 only) ---------------------------------------------
  portal_alb_arn="None"
  portal_alb_config='{}'
  portal_tg_arn="None"
  portal_acm_cert_arn="None"
  demo_ec2_instance_id="None"
  if [[ "${REGION}" == "us-east-1" ]]; then
    portal_alb_arn=$(aws elbv2 describe-load-balancers \
      --names "cello-portal-${ENVIRONMENT}" --region "${REGION}" \
      --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "None")
    [[ "$portal_alb_arn" != "None" ]] && ok "  Portal ALB: ${portal_alb_arn}" || warn "  Portal ALB not found"

    if [[ "$portal_alb_arn" != "None" ]]; then
      portal_alb_config=$(aws elbv2 describe-load-balancers \
        --load-balancer-arns "$portal_alb_arn" --region "${REGION}" \
        --query 'LoadBalancers[0].{subnets:AvailabilityZones[*].SubnetId,sgs:SecurityGroups,scheme:Scheme}' \
        --output json 2>/dev/null || echo '{}')
      idle=$(aws elbv2 describe-load-balancer-attributes \
        --load-balancer-arn "$portal_alb_arn" --region "${REGION}" \
        --query 'Attributes[?Key==`idle_timeout.timeout_seconds`].Value | [0]' \
        --output text 2>/dev/null || echo "60")
      portal_alb_config=$(echo "$portal_alb_config" | jq --arg i "$idle" '. + {idle_timeout_seconds: $i}')

      # Capture HTTPS listener's ACM cert ARN (needed to recreate the HTTPS listener on wake)
      portal_acm_cert_arn=$(aws elbv2 describe-listeners \
        --load-balancer-arn "$portal_alb_arn" --region "${REGION}" \
        --query 'Listeners[?Protocol==`HTTPS`].Certificates[0].CertificateArn | [0]' \
        --output text 2>/dev/null || echo "None")
      [[ "$portal_acm_cert_arn" != "None" ]] && ok "  Portal ACM cert: ${portal_acm_cert_arn}"

      # Portal target group (port 3000)
      portal_tg_arn=$(aws elbv2 describe-target-groups --region "${REGION}" \
        --query "TargetGroups[?Port==\`3000\` && contains(TargetGroupName,'cello')].TargetGroupArn | [0]" \
        --output text 2>/dev/null || echo "None")
      [[ "$portal_tg_arn" != "None" ]] && ok "  Portal TG: ${portal_tg_arn}"
    fi

    # Demo agent EC2 instance
    demo_ec2_instance_id=$(aws ec2 describe-instances \
      --filters "Name=tag:Name,Values=cello-demo-agent" "Name=instance-state-name,Values=running,stopped" \
      --region "${REGION}" \
      --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo "None")
    [[ "$demo_ec2_instance_id" != "None" && -n "$demo_ec2_instance_id" ]] \
      && ok "  Demo EC2: ${demo_ec2_instance_id}" || warn "  Demo EC2 not found"
  fi

  # --- ECS services ------------------------------------------------------------
  ecs_json='[]'
  ecs_svcs=("cello-directory-${ENVIRONMENT}" "cello-relay-${ENVIRONMENT}")
  # us-east-1 only: portal and ops-agent are global singletons that run here
  if [[ "${REGION}" == "us-east-1" ]]; then
    ecs_svcs+=("cello-portal-${ENVIRONMENT}" "cello-operations-agent-${ENVIRONMENT}")
  fi
  for svc in "${ecs_svcs[@]}"; do
    desired=$(aws ecs describe-services --cluster "${CLUSTER_NAME}" \
      --services "$svc" --region "${REGION}" \
      --query 'services[0].desiredCount' --output text 2>/dev/null || echo "0")
    [[ "$desired" == "None" ]] && desired=0
    ecs_json=$(echo "$ecs_json" | jq --arg n "$svc" --argjson d "${desired}" \
      '. + [{name:$n, desired:$d}]')
    ok "  ECS ${svc}: desired=${desired}"
  done

  # --- RDS --------------------------------------------------------------------
  rds_id=$(aws rds describe-db-instances \
    --db-instance-identifier "cello-${ENVIRONMENT}" --region "${REGION}" \
    --query 'DBInstances[0].DBInstanceIdentifier' --output text 2>/dev/null || echo "None")
  [[ "$rds_id" != "None" ]] && ok "  RDS: ${rds_id}" || warn "  RDS not found in ${REGION}"

  # us-east-1 only: portal has its own RDS instance
  portal_rds_id="None"
  if [[ "${REGION}" == "us-east-1" ]]; then
    portal_rds_id=$(aws rds describe-db-instances \
      --db-instance-identifier "cello-portal-${ENVIRONMENT}" --region "${REGION}" \
      --query 'DBInstances[0].DBInstanceIdentifier' --output text 2>/dev/null || echo "None")
    [[ "$portal_rds_id" != "None" ]] && ok "  RDS portal: ${portal_rds_id}" || warn "  Portal RDS not found"
  fi

  # --- VPC ssmmessages endpoint -----------------------------------------------
  vpc_id="$nat_vpc"
  if [[ -z "$vpc_id" ]]; then
    vpc_id=$(aws rds describe-db-instances \
      --db-instance-identifier "cello-${ENVIRONMENT}" --region "${REGION}" \
      --query 'DBInstances[0].DBSubnetGroup.VpcId' --output text 2>/dev/null || echo "")
  fi

  ep_id=""
  ep_config='{}'
  if [[ -n "$vpc_id" ]]; then
    ep_raw=$(aws ec2 describe-vpc-endpoints --region "${REGION}" \
      --filters "Name=vpc-id,Values=${vpc_id}" \
                "Name=service-name,Values=com.amazonaws.${REGION}.ssmmessages" \
      --query 'VpcEndpoints[?State==`available`] | [0].{id:VpcEndpointId,subnets:SubnetIds,sgs:Groups[*].GroupId,pdns:PrivateDnsEnabled,tags:Tags}' \
      --output json 2>/dev/null || echo 'null')
    if [[ "$ep_raw" != "null" && -n "$ep_raw" ]]; then
      ep_id=$(echo "$ep_raw" | jq -r '.id // ""')
      ep_config="$ep_raw"
      [[ -n "$ep_id" ]] && ok "  ssmmessages endpoint: ${ep_id}" || warn "  ssmmessages endpoint not found"
    fi
  fi

  # --- Route53 (for ALB alias restoration on wake) ----------------------------
  dir_sub=$(dir_subdomain "${REGION}")
  relay_sub=$(relay_subdomain "${REGION}")

  # Compact all JSON vars before passing to jq -n (multi-line JSON breaks --argjson)
  [[ -z "$nat_json" || "$nat_json" == "null" ]] && nat_json='null'
  [[ "$nat_json" == "null" ]] && nat_json_c="null" || nat_json_c=$(echo "$nat_json" | jq -c .)
  nat_json="$nat_json_c"
  ecs_json=$(echo "${ecs_json}"               | jq -c .)
  nat_tags=$(echo "${nat_tags}"               | jq -c .)
  dir_alb_config=$(echo "${dir_alb_config}"   | jq -c .)
  relay_alb_config=$(echo "${relay_alb_config}" | jq -c .)
  [[ -z "$dir_rules"   || "$dir_rules"   == "null" ]] && dir_rules='[]'
  [[ -z "$relay_rules" || "$relay_rules" == "null" ]] && relay_rules='[]'
  dir_rules=$(echo "${dir_rules}"             | jq -c .)
  relay_rules=$(echo "${relay_rules}"         | jq -c .)
  [[ -z "$ep_config" || "$ep_config" == "null" ]] && ep_config='{}'
  ep_config=$(echo "$ep_config" | jq -c .)
  [[ -z "$portal_alb_config" || "$portal_alb_config" == "null" ]] && portal_alb_config='{}'
  portal_alb_config=$(echo "${portal_alb_config}" | jq -c .)

  # Assemble per-region state
  region_state=$(jq -n \
    --arg region "${REGION}" \
    --arg vpc "${vpc_id}" \
    --argjson nat "${nat_json}" \
    --arg nat_id "${nat_id}" \
    --arg private_rt "${private_rt}" \
    --argjson nat_tags "${nat_tags}" \
    --argjson ecs "${ecs_json}" \
    --arg rds_id "${rds_id}" \
    --arg portal_rds_id "${portal_rds_id}" \
    --arg alb_dir_arn "${alb_dir_arn}" \
    --arg alb_relay_arn "${alb_relay_arn}" \
    --arg portal_alb_arn "${portal_alb_arn}" \
    --argjson dir_alb_config "${dir_alb_config}" \
    --argjson relay_alb_config "${relay_alb_config}" \
    --argjson portal_alb_config "${portal_alb_config}" \
    --arg portal_acm_cert_arn "${portal_acm_cert_arn}" \
    --arg portal_tg_arn "${portal_tg_arn}" \
    --arg demo_ec2_id "${demo_ec2_instance_id}" \
    --argjson dir_rules "${dir_rules}" \
    --argjson relay_rules "${relay_rules}" \
    --arg tg_main "${tg_main_arn}" \
    --arg tg_bootstrap "${tg_bootstrap_arn}" \
    --arg tg_internal "${tg_internal_arn}" \
    --arg tg_relay "${tg_relay_arn}" \
    --arg ep_id "${ep_id}" \
    --argjson ep_config "${ep_config}" \
    --arg dir_sub "${dir_sub}" \
    --arg relay_sub "${relay_sub}" \
    '{
      region: $region,
      vpc_id: $vpc,
      nat: ($nat // {id:$nat_id}),
      nat_id: $nat_id,
      private_route_table: $private_rt,
      nat_tags: $nat_tags,
      ecs_services: $ecs,
      rds_id: $rds_id,
      portal_rds_id: $portal_rds_id,
      alb_dir_arn: $alb_dir_arn,
      alb_relay_arn: $alb_relay_arn,
      portal_alb_arn: $portal_alb_arn,
      dir_alb_config: $dir_alb_config,
      relay_alb_config: $relay_alb_config,
      portal_alb_config: $portal_alb_config,
      portal_acm_cert_arn: $portal_acm_cert_arn,
      portal_tg_arn: $portal_tg_arn,
      demo_ec2_id: $demo_ec2_id,
      dir_listener_rules: $dir_rules,
      relay_listener_rules: $relay_rules,
      target_groups: {
        main: $tg_main,
        bootstrap: $tg_bootstrap,
        internal: $tg_internal,
        relay: $tg_relay
      },
      ssmmessages_endpoint: {id: $ep_id, config: $ep_config},
      route53: {dir_subdomain: $dir_sub, relay_subdomain: $relay_sub}
    }')

  REGION_STATES=$(echo "$REGION_STATES" | jq --argjson rs "$region_state" '. + [$rs]')
done

# --- Write state file ---------------------------------------------------------
step "Writing state file: ${STATE_FILE}"
FULL_STATE=$(jq -n \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg env "${ENVIRONMENT}" \
  --arg cluster "${CLUSTER_NAME}" \
  --arg hz "${HOSTED_ZONE_ID}" \
  --arg domain "${DOMAIN}" \
  --argjson dry "${DRY_RUN}" \
  --argjson regions "${REGION_STATES}" \
  '{
    hibernated_at: $ts,
    environment: $env,
    cluster: $cluster,
    hosted_zone_id: $hz,
    domain: $domain,
    dry_run_capture: ($dry == 1),
    regions: $regions
  }')

if [[ "${DRY_RUN}" == "1" ]]; then
  warn "[dry-run] would write state file:"
  echo "$FULL_STATE" | jq .
else
  echo "$FULL_STATE" | jq . > "${STATE_FILE}"
  ok "State file written: ${STATE_FILE}"
fi

# ==============================================================================
# PHASE 3: TEAR DOWN (compute first, network last)
# ==============================================================================
confirm_execute

TEAR_PIDS=()
for REGION in "${TARGET_REGIONS[@]}"; do
  (
  log ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "  REGION: ${REGION}"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Get per-region state
  R=$(echo "$REGION_STATES" | jq -r --arg r "${REGION}" '.[] | select(.region == $r)')

  # -- 3a. ECS → 0 -------------------------------------------------------------
  step "  [${REGION}] Scale ECS services to 0"
  while read -r svc_entry; do
    svc=$(echo "$svc_entry" | jq -r '.name')
    run aws ecs update-service --cluster "${CLUSTER_NAME}" --service "${svc}" \
      --desired-count 0 --region "${REGION}" \
      --no-cli-pager --query 'service.serviceName' --output text
  done < <(echo "$R" | jq -c '.ecs_services[]')

  # -- 3a2. Demo agent EC2 → stop (us-east-1 only) -----------------------------
  demo_ec2_id=$(echo "$R" | jq -r '.demo_ec2_id // "None"')
  if [[ "$demo_ec2_id" != "None" && -n "$demo_ec2_id" && "${REGION}" == "us-east-1" ]]; then
    step "  [${REGION}] Stopping demo agent EC2 ${demo_ec2_id}"
    run aws ec2 stop-instances --instance-ids "${demo_ec2_id}" \
      --region "${REGION}" --no-cli-pager \
      --query 'StoppingInstances[0].CurrentState.Name' --output text
  fi

  # -- 3b. RDS → stop ----------------------------------------------------------
  rds_id=$(echo "$R" | jq -r '.rds_id')
  if [[ "$rds_id" != "None" && -n "$rds_id" ]]; then
    step "  [${REGION}] Stopping RDS ${rds_id}"
    run aws rds stop-db-instance --db-instance-identifier "${rds_id}" \
      --region "${REGION}" --no-cli-pager \
      --query 'DBInstance.DBInstanceStatus' --output text
  fi

  # -- 3b2. Portal RDS → stop (us-east-1 only) ---------------------------------
  portal_rds_id=$(echo "$R" | jq -r '.portal_rds_id // "None"')
  if [[ "$portal_rds_id" != "None" && -n "$portal_rds_id" && "${REGION}" == "us-east-1" ]]; then
    step "  [${REGION}] Stopping portal RDS ${portal_rds_id}"
    run aws rds stop-db-instance --db-instance-identifier "${portal_rds_id}" \
      --region "${REGION}" --no-cli-pager \
      --query 'DBInstance.DBInstanceStatus' --output text
  fi

  # -- 3c. Delete ALBs ---------------------------------------------------------
  # Delete ALBs BEFORE NAT (ALB deletion is fast; NAT deletion takes time)
  step "  [${REGION}] Deleting ALBs (target groups are KEPT)"
  for alb_key in alb_dir_arn alb_relay_arn portal_alb_arn; do
    alb_arn=$(echo "$R" | jq -r ".${alb_key}")
    if [[ "$alb_arn" != "None" && -n "$alb_arn" ]]; then
      run aws elbv2 delete-load-balancer --load-balancer-arn "${alb_arn}" \
        --region "${REGION}" --no-cli-pager
      ok "  Deleted ALB: ${alb_arn}"
    fi
  done

  # -- 3d. Delete ssmmessages VPC endpoint -------------------------------------
  ep_id=$(echo "$R" | jq -r '.ssmmessages_endpoint.id')
  if [[ -n "$ep_id" && "$ep_id" != "null" ]]; then
    step "  [${REGION}] Deleting ssmmessages endpoint ${ep_id}"
    warn "  NOTE: ECS Exec will be unavailable until wake.sh restores this endpoint"
    run aws ec2 delete-vpc-endpoints --vpc-endpoint-ids "${ep_id}" \
      --region "${REGION}" --no-cli-pager \
      --query 'Unsuccessful' --output text
  fi

  # -- 3e. Delete NAT Gateway (EIP retained) -----------------------------------
  nat_id=$(echo "$R" | jq -r '.nat_id')
  if [[ -n "$nat_id" && "$nat_id" != "null" && "$nat_id" != "" ]]; then
    step "  [${REGION}] Deleting NAT Gateway ${nat_id} (EIP retained)"
    run aws ec2 delete-nat-gateway --nat-gateway-id "${nat_id}" \
      --region "${REGION}" --no-cli-pager \
      --query 'NatGatewayId' --output text
    warn "  NOTE: 0.0.0.0/0 route in $(echo "$R" | jq -r '.private_route_table') will blackhole until wake.sh"
    warn "  NOTE: retained EIP costs ~\$3.65/mo while detached (intentional — stable address for wake)"
  fi
  ) &
  TEAR_PIDS+=($!)
done
for pid in "${TEAR_PIDS[@]}"; do wait "$pid"; done

# ==============================================================================
echo ""
if [[ "${DRY_RUN}" == "1" ]]; then
  banner "DRY-RUN COMPLETE — no changes made. Review the plan above." "${REGIONS_STR}"
  echo "Re-run with ${C_BOLD}--execute${C_RESET} to apply."
else
  banner "HIBERNATION COMPLETE" "${REGIONS_STR}"
  echo "Run ${C_BOLD}./wake.sh --region <region> [--execute]${C_RESET} to restore."
  echo "Before-snapshots saved in: ${SNAPSHOT_DIR}/"
fi
