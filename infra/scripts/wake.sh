#!/usr/bin/env bash
# ==============================================================================
# wake.sh — spin CELLO infrastructure back UP from hibernation
# ==============================================================================
# Reads hibernation-state.json (written by hibernate.sh) and reconstructs the
# environment in dependency order, blocking at each boundary until healthy.
#
# Restoration order (each step waits before the next):
#   1. NAT Gateway        → wait available → rewrite 0.0.0.0/0 route
#   2. ssmmessages endpoint → recreate → wait available
#   3. RDS                → start → wait available
#   4. ALBs (dir + relay) → recreate with saved config → wire listener rules
#   5. Route53            → update A alias records to new ALB DNS names
#   6. ECS services       → restore desiredCount → wait stable
#   7. VERIFY             → client-path (OS resolver) DNS + HTTP checks, HARD-FAIL
#                            on failure + inventory diff vs before-snapshot
#
# Usage:
#   ./wake.sh                                  # DRY-RUN all regions in state file
#   ./wake.sh --region ap-northeast-1          # DRY-RUN single region
#   ./wake.sh --region ap-northeast-1 --execute
#   ./wake.sh --execute                        # live all regions
#   ./wake.sh --execute --yes                  # skip confirmation
# ==============================================================================

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hibernate-common.sh"

# --- Options ------------------------------------------------------------------
TARGET_REGIONS=()
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)  DRY_RUN=0 ;;
    --dry-run)  DRY_RUN=1 ;;
    --region)   shift; TARGET_REGIONS+=("$1") ;;
    --yes|-y)   ASSUME_YES=1 ;;
    -h|--help)  grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fatal "Unknown argument: $1" ;;
  esac
  shift
done

require_tools

[[ -f "${STATE_FILE}" ]] || fatal "State file not found: ${STATE_FILE}. Run hibernate.sh first."
S="$(cat "${STATE_FILE}")"
echo "${S}" | jq -e . >/dev/null 2>&1 || fatal "State file is not valid JSON."

# Filter to requested regions (or all regions in state file)
ALL_STATE_REGIONS=$(echo "$S" | jq -r '.regions[].region')
if [[ ${#TARGET_REGIONS[@]} -eq 0 ]]; then
  mapfile -t TARGET_REGIONS < <(echo "$ALL_STATE_REGIONS")
fi
REGIONS_STR="${TARGET_REGIONS[*]}"

banner "WAKE — CELLO infrastructure" "${REGIONS_STR}"
log "Hibernated at: $(echo "$S" | jq -r '.hibernated_at')"
confirm_execute

SNAPSHOT_DIR="${INFRA_DIR}/hibernation-snapshots"
mkdir -p "${SNAPSHOT_DIR}"
TS=$(date -u +%Y%m%dT%H%M%SZ)

PIDS=()
for REGION in "${TARGET_REGIONS[@]}"; do
  (
  log ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "  REGION: ${REGION}"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  R=$(echo "$S" | jq --arg r "${REGION}" '.regions[] | select(.region == $r)')
  [[ -n "$R" ]] || fatal "Region ${REGION} not found in state file."

  VPC_ID=$(echo "$R" | jq -r '.vpc_id')
  NAT_SUBNET=$(echo "$R" | jq -r '.nat.subnet // .nat.SubnetId // empty')
  NAT_EIP=$(echo "$R"    | jq -r '.nat.eip_alloc // empty')
  PRIVATE_RT=$(echo "$R" | jq -r '.private_route_table')
  NAT_TAGS=$(echo "$R"   | jq -c '.nat_tags // []')
  DIR_SUB=$(echo "$R"    | jq -r '.route53.dir_subdomain')
  RELAY_SUB=$(echo "$R"  | jq -r '.route53.relay_subdomain')

  # ── STEP 0: Kick off RDS immediately — it's the longest wait (~13 min) ───────
  # Fire-and-don't-wait: start all RDS instances now, then do NAT/endpoint/ALB
  # in parallel while RDS warms up. We'll wait for available just before ECS.
  RDS_ID=$(echo "$R" | jq -r '.rds_id')
  PORTAL_RDS_ID=$(echo "$R" | jq -r '.portal_rds_id // "None"')

  _start_rds_nowait() {
    local id="$1" region="$2"
    local st
    st=$(aws rds describe-db-instances --db-instance-identifier "$id" \
      --region "$region" --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "unknown")
    if [[ "$st" == "available" ]]; then
      ok "  RDS ${id} already available"
    elif [[ "$st" == "stopping" ]]; then
      log "  RDS ${id} still stopping — polling until stopped before starting..."
      for i in $(seq 1 90); do
        st=$(aws rds describe-db-instances --db-instance-identifier "$id" \
          --region "$region" --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "unknown")
        [[ "$st" == "stopped" ]] && break
        [[ $((i % 6)) -eq 0 ]] && log "    still ${st}... (${i}×10s)"
        sleep 10
      done
      aws rds start-db-instance --db-instance-identifier "$id" --region "$region" \
        --no-cli-pager --query 'DBInstance.DBInstanceStatus' --output text
      ok "  RDS ${id} start-db-instance issued (waiting later)"
    else
      aws rds start-db-instance --db-instance-identifier "$id" --region "$region" \
        --no-cli-pager --query 'DBInstance.DBInstanceStatus' --output text 2>/dev/null || true
      ok "  RDS ${id} start-db-instance issued (waiting later)"
    fi
  }

  if [[ "$RDS_ID" != "None" && -n "$RDS_ID" && "${DRY_RUN}" != "1" ]]; then
    step "  [${REGION}] 0/7  RDS kick-off (fire-and-continue)"
    _start_rds_nowait "$RDS_ID" "${REGION}"
  fi
  if [[ "$PORTAL_RDS_ID" != "None" && -n "$PORTAL_RDS_ID" && "${REGION}" == "us-east-1" && "${DRY_RUN}" != "1" ]]; then
    _start_rds_nowait "$PORTAL_RDS_ID" "${REGION}"
  fi

  # ── STEP 1: NAT Gateway ──────────────────────────────────────────────────────
  step "  [${REGION}] 1/7  NAT Gateway"

  existing_nat=$(aws ec2 describe-nat-gateways --region "${REGION}" \
    --filter "Name=vpc-id,Values=${VPC_ID}" "Name=state,Values=available,pending" \
    --query 'NatGateways[0].NatGatewayId' --output text 2>/dev/null || echo "None")

  NEW_NAT=""
  if [[ "${existing_nat}" != "None" && -n "${existing_nat}" ]]; then
    NEW_NAT="${existing_nat}"
    ok "  NAT already present (${NEW_NAT}) — skipping creation"
  else
    nat_args=(ec2 create-nat-gateway
      --subnet-id "${NAT_SUBNET}"
      --allocation-id "${NAT_EIP}"
      --region "${REGION}")
    # Filter out aws: reserved tags — AWS rejects them on create-nat-gateway
    CLEAN_NAT_TAGS=$(echo "${NAT_TAGS}" | jq -c '[.[] | select(.Key | startswith("aws:") | not)]')
    if [[ "${CLEAN_NAT_TAGS}" != "[]" && "${CLEAN_NAT_TAGS}" != "null" ]]; then
      nat_args+=(--tag-specifications \
        "$(echo "${CLEAN_NAT_TAGS}" | jq -c '[{ResourceType:"natgateway",Tags:.}]')")
    fi

    if [[ "${DRY_RUN}" == "1" ]]; then
      run aws "${nat_args[@]}" --query 'NatGateway.NatGatewayId' --output text
      NEW_NAT="nat-DRYRUN"
    else
      NEW_NAT=$(aws "${nat_args[@]}" --query 'NatGateway.NatGatewayId' --output text)
      ok "  Creating NAT ${NEW_NAT} — waiting for available (~2 min)..."
      aws ec2 wait nat-gateway-available --nat-gateway-ids "${NEW_NAT}" --region "${REGION}"
      ok "  NAT available: ${NEW_NAT}"
    fi
  fi

  # Rewrite the private route table's default route
  step "  [${REGION}]       Rewriting 0.0.0.0/0 in ${PRIVATE_RT} → ${NEW_NAT}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    warn "  [dry-run] create-route (or replace-route) 0.0.0.0/0 → ${NEW_NAT} in ${PRIVATE_RT}"
  else
    if ! aws ec2 create-route --route-table-id "${PRIVATE_RT}" \
          --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "${NEW_NAT}" \
          --region "${REGION}" >/dev/null 2>&1; then
      aws ec2 replace-route --route-table-id "${PRIVATE_RT}" \
        --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "${NEW_NAT}" \
        --region "${REGION}"
    fi
    ok "  Private route restored."
  fi

  # ── STEP 2: ssmmessages VPC endpoint ─────────────────────────────────────────
  step "  [${REGION}] 2/7  ssmmessages VPC endpoint"

  EP_CONFIG=$(echo "$R" | jq -c '.ssmmessages_endpoint.config')
  EP_SUBNETS=$(echo "$EP_CONFIG" | jq -r '(.subnets // .SubnetIds // []) | join(" ")')
  EP_SGS=$(echo "$EP_CONFIG"     | jq -r '(.sgs // .Groups // []) | map(if type=="string" then . else .GroupId end) | join(" ")')
  EP_PDNS=$(echo "$EP_CONFIG"    | jq -r '.pdns // .PrivateDnsEnabled // "true"')

  # Idempotency check (JMESPath for state filter — aws ec2 describe-vpc-endpoints rejects Name=state)
  existing_ep=$(aws ec2 describe-vpc-endpoints --region "${REGION}" \
    --filters "Name=vpc-id,Values=${VPC_ID}" \
              "Name=service-name,Values=com.amazonaws.${REGION}.ssmmessages" \
    --query 'VpcEndpoints[?State==`available` || State==`pending`] | [0].VpcEndpointId' \
    --output text 2>/dev/null || echo "None")

  if [[ "${existing_ep}" != "None" && -n "${existing_ep}" ]]; then
    ok "  ssmmessages endpoint already exists (${existing_ep}) — skipping"
  else
    ep_args=(ec2 create-vpc-endpoint
      --vpc-id "${VPC_ID}"
      --vpc-endpoint-type Interface
      --service-name "com.amazonaws.${REGION}.ssmmessages"
      --region "${REGION}"
      --no-cli-pager
      --query 'VpcEndpoint.VpcEndpointId' --output text)
    [[ -n "${EP_SUBNETS}" ]] && ep_args+=(--subnet-ids ${EP_SUBNETS})
    [[ -n "${EP_SGS}" ]]     && ep_args+=(--security-group-ids ${EP_SGS})
    [[ "${EP_PDNS}" == "true" ]] && ep_args+=(--private-dns-enabled) || ep_args+=(--no-private-dns-enabled)
    run aws "${ep_args[@]}"
    ok "  ssmmessages endpoint recreated (becomes available in ~1-2 min)."
  fi

  # ── STEP 2b: Demo agent EC2 (us-east-1 only) ─────────────────────────────────
  DEMO_EC2_ID=$(echo "$R" | jq -r '.demo_ec2_id // "None"')
  if [[ "$DEMO_EC2_ID" != "None" && -n "$DEMO_EC2_ID" && "${REGION}" == "us-east-1" ]]; then
    step "  [${REGION}] 2b/7  Demo agent EC2"
    ec2_state=$(aws ec2 describe-instances --instance-ids "${DEMO_EC2_ID}" --region "${REGION}" \
      --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || echo "unknown")
    if [[ "${ec2_state}" == "running" ]]; then
      ok "  Demo EC2 already running — skipping"
    else
      run aws ec2 start-instances --instance-ids "${DEMO_EC2_ID}" \
        --region "${REGION}" --no-cli-pager \
        --query 'StartingInstances[0].CurrentState.Name' --output text
      if [[ "${DRY_RUN}" != "1" ]]; then
        log "  Waiting for demo EC2 to reach running state..."
        aws ec2 wait instance-running --instance-ids "${DEMO_EC2_ID}" --region "${REGION}"
        ok "  Demo EC2 running."
      fi
    fi
  fi

  # ── STEP 3: Wait for RDS (already started in step 0) ────────────────────────
  step "  [${REGION}] 3/7  RDS (wait for available — started earlier)"

  if [[ "$RDS_ID" != "None" && -n "$RDS_ID" ]]; then
    if [[ "${DRY_RUN}" == "1" ]]; then
      warn "  [dry-run] would wait for RDS ${RDS_ID} available"
    else
      rds_status=$(aws rds describe-db-instances \
        --db-instance-identifier "${RDS_ID}" --region "${REGION}" \
        --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "unknown")
      if [[ "${rds_status}" == "available" ]]; then
        ok "  RDS ${RDS_ID} already available"
      else
        log "  Waiting for RDS ${RDS_ID} to become available..."
        aws rds wait db-instance-available \
          --db-instance-identifier "${RDS_ID}" --region "${REGION}"
        ok "  RDS ${RDS_ID} available."
      fi
    fi
  else
    warn "  No RDS recorded for ${REGION} — skipping"
  fi

  if [[ "$PORTAL_RDS_ID" != "None" && -n "$PORTAL_RDS_ID" && "${REGION}" == "us-east-1" ]]; then
    step "  [${REGION}] 3b/7  Portal RDS (wait)"
    if [[ "${DRY_RUN}" != "1" ]]; then
      portal_rds_status=$(aws rds describe-db-instances \
        --db-instance-identifier "${PORTAL_RDS_ID}" --region "${REGION}" \
        --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "unknown")
      if [[ "${portal_rds_status}" == "available" ]]; then
        ok "  Portal RDS ${PORTAL_RDS_ID} already available"
      else
        log "  Waiting for portal RDS ${PORTAL_RDS_ID} to become available..."
        aws rds wait db-instance-available \
          --db-instance-identifier "${PORTAL_RDS_ID}" --region "${REGION}"
        ok "  Portal RDS ${PORTAL_RDS_ID} available."
      fi
    fi
  fi

  # ── STEP 4: ALBs ─────────────────────────────────────────────────────────────
  step "  [${REGION}] 4/7  ALBs"

  # Helper: create an ALB and return its ARN
  create_alb() {
    local name="$1"
    local config="$2"
    local region="$3"
    local idle="$4"

    # Idempotency
    existing=$(aws elbv2 describe-load-balancers --names "$name" --region "$region" \
      --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "None")
    if [[ "$existing" != "None" && -n "$existing" ]]; then
      echo "$existing"
      return 0
    fi

    local subnets sgs
    subnets=$(echo "$config" | jq -r '.subnets | join(" ")')
    sgs=$(echo "$config" | jq -r '.sgs | join(" ")')

    local new_arn
    new_arn=$(aws elbv2 create-load-balancer \
      --name "$name" \
      --subnets ${subnets} \
      --security-groups ${sgs} \
      --scheme internet-facing \
      --type application \
      --region "$region" \
      --no-cli-pager \
      --query 'LoadBalancers[0].LoadBalancerArn' --output text)

    # Restore idle timeout
    aws elbv2 modify-load-balancer-attributes \
      --load-balancer-arn "$new_arn" \
      --attributes "Key=idle_timeout.timeout_seconds,Value=${idle}" \
      --region "$region" --no-cli-pager >/dev/null

    echo "$new_arn"
  }

  NEW_DIR_ARN=""
  NEW_RELAY_ARN=""
  NEW_DIR_DNS=""
  NEW_RELAY_DNS=""

  NEW_PORTAL_ARN=""
  NEW_PORTAL_DNS=""

  if [[ "${DRY_RUN}" == "1" ]]; then
    warn "  [dry-run] would create ALB cello-dir-${ENVIRONMENT} in ${REGION}"
    warn "  [dry-run] would create ALB cello-relay-${ENVIRONMENT} in ${REGION}"
    [[ "${REGION}" == "us-east-1" ]] && \
      warn "  [dry-run] would create ALB cello-portal-${ENVIRONMENT} in ${REGION}"
    NEW_DIR_DNS="cello-dir-${ENVIRONMENT}-DRYRUN.${REGION}.elb.amazonaws.com"
    NEW_RELAY_DNS="cello-relay-${ENVIRONMENT}-DRYRUN.${REGION}.elb.amazonaws.com"
    NEW_PORTAL_DNS="cello-portal-${ENVIRONMENT}-DRYRUN.${REGION}.elb.amazonaws.com"
  else
    DIR_CONFIG=$(echo "$R"   | jq -c '.dir_alb_config')
    RELAY_CONFIG=$(echo "$R" | jq -c '.relay_alb_config')
    DIR_IDLE=$(echo "$R"     | jq -r '.dir_alb_config.idle_timeout_seconds // "300"')
    RELAY_IDLE=$(echo "$R"   | jq -r '.relay_alb_config.idle_timeout_seconds // "300"')

    log "  Creating dir ALB..."
    NEW_DIR_ARN=$(create_alb "cello-dir-${ENVIRONMENT}" "$DIR_CONFIG" "${REGION}" "$DIR_IDLE")
    ok "  Dir ALB: ${NEW_DIR_ARN}"

    log "  Creating relay ALB..."
    NEW_RELAY_ARN=$(create_alb "cello-relay-${ENVIRONMENT}" "$RELAY_CONFIG" "${REGION}" "$RELAY_IDLE")
    ok "  Relay ALB: ${NEW_RELAY_ARN}"

    # Wait for ALBs to become active
    log "  Waiting for ALBs to become active..."
    aws elbv2 wait load-balancer-available \
      --load-balancer-arns "$NEW_DIR_ARN" "$NEW_RELAY_ARN" \
      --region "${REGION}"
    ok "  Both ALBs active."

    # Get new DNS names
    NEW_DIR_DNS=$(aws elbv2 describe-load-balancers \
      --load-balancer-arns "$NEW_DIR_ARN" --region "${REGION}" \
      --query 'LoadBalancers[0].DNSName' --output text)
    NEW_RELAY_DNS=$(aws elbv2 describe-load-balancers \
      --load-balancer-arns "$NEW_RELAY_ARN" --region "${REGION}" \
      --query 'LoadBalancers[0].DNSName' --output text)
    ok "  Dir DNS:   ${NEW_DIR_DNS}"
    ok "  Relay DNS: ${NEW_RELAY_DNS}"

    # ── Recreate listeners + rules ──────────────────────────────────────────
    log "  Recreating directory listener + rules..."

    TG_MAIN=$(echo "$R"      | jq -r '.target_groups.main')
    TG_BOOTSTRAP=$(echo "$R" | jq -r '.target_groups.bootstrap')
    TG_INTERNAL=$(echo "$R"  | jq -r '.target_groups.internal')
    TG_RELAY=$(echo "$R"     | jq -r '.target_groups.relay')

    # Directory listener (default → main/8080)
    DIR_LISTENER_ARN=$(aws elbv2 create-listener \
      --load-balancer-arn "$NEW_DIR_ARN" \
      --protocol HTTP --port 80 \
      --default-actions "Type=forward,TargetGroupArn=${TG_MAIN}" \
      --region "${REGION}" --no-cli-pager \
      --query 'Listeners[0].ListenerArn' --output text)
    ok "  Dir listener: ${DIR_LISTENER_ARN}"

    # Directory path rules
    aws elbv2 create-rule --listener-arn "$DIR_LISTENER_ARN" --priority 3 \
      --conditions 'Field=path-pattern,Values=["/agent-lookup"]' \
      --actions "Type=forward,TargetGroupArn=${TG_BOOTSTRAP}" \
      --region "${REGION}" --no-cli-pager >/dev/null
    aws elbv2 create-rule --listener-arn "$DIR_LISTENER_ARN" --priority 4 \
      --conditions 'Field=path-pattern,Values=["/bootstrap"]' \
      --actions "Type=forward,TargetGroupArn=${TG_BOOTSTRAP}" \
      --region "${REGION}" --no-cli-pager >/dev/null
    aws elbv2 create-rule --listener-arn "$DIR_LISTENER_ARN" --priority 5 \
      --conditions 'Field=path-pattern,Values=["/internal/*"]' \
      --actions "Type=forward,TargetGroupArn=${TG_INTERNAL}" \
      --region "${REGION}" --no-cli-pager >/dev/null
    aws elbv2 create-rule --listener-arn "$DIR_LISTENER_ARN" --priority 6 \
      --conditions 'Field=path-pattern,Values=["/manifest"]' \
      --actions "Type=forward,TargetGroupArn=${TG_BOOTSTRAP}" \
      --region "${REGION}" --no-cli-pager >/dev/null
    ok "  Dir listener rules: /agent-lookup /bootstrap /internal/* /manifest wired."

    # Relay listener (default → relay/4002)
    RELAY_LISTENER_ARN=$(aws elbv2 create-listener \
      --load-balancer-arn "$NEW_RELAY_ARN" \
      --protocol HTTP --port 80 \
      --default-actions "Type=forward,TargetGroupArn=${TG_RELAY}" \
      --region "${REGION}" --no-cli-pager \
      --query 'Listeners[0].ListenerArn' --output text)
    ok "  Relay listener: ${RELAY_LISTENER_ARN}"

    # ── Portal ALB (us-east-1 only) ───────────────────────────────────────────
    if [[ "${REGION}" == "us-east-1" ]]; then
      PORTAL_CONFIG=$(echo "$R"       | jq -c '.portal_alb_config')
      PORTAL_IDLE=$(echo "$R"         | jq -r '.portal_alb_config.idle_timeout_seconds // "60"')
      PORTAL_TG_ARN=$(echo "$R"       | jq -r '.portal_tg_arn')
      PORTAL_ACM_CERT=$(echo "$R"     | jq -r '.portal_acm_cert_arn')

      log "  Creating portal ALB..."
      NEW_PORTAL_ARN=$(create_alb "cello-portal-${ENVIRONMENT}" "$PORTAL_CONFIG" "${REGION}" "$PORTAL_IDLE")
      ok "  Portal ALB: ${NEW_PORTAL_ARN}"

      aws elbv2 wait load-balancer-available \
        --load-balancer-arns "$NEW_PORTAL_ARN" --region "${REGION}"

      NEW_PORTAL_DNS=$(aws elbv2 describe-load-balancers \
        --load-balancer-arns "$NEW_PORTAL_ARN" --region "${REGION}" \
        --query 'LoadBalancers[0].DNSName' --output text)
      ok "  Portal DNS: ${NEW_PORTAL_DNS}"

      # HTTP/80 → redirect to HTTPS
      aws elbv2 create-listener \
        --load-balancer-arn "$NEW_PORTAL_ARN" \
        --protocol HTTP --port 80 \
        --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' \
        --region "${REGION}" --no-cli-pager >/dev/null
      ok "  Portal HTTP→HTTPS redirect listener wired."

      # HTTPS/443 → portal TG with ACM cert
      aws elbv2 create-listener \
        --load-balancer-arn "$NEW_PORTAL_ARN" \
        --protocol HTTPS --port 443 \
        --certificates "CertificateArn=${PORTAL_ACM_CERT}" \
        --default-actions "Type=forward,TargetGroupArn=${PORTAL_TG_ARN}" \
        --region "${REGION}" --no-cli-pager >/dev/null
      ok "  Portal HTTPS listener wired (cert: ${PORTAL_ACM_CERT})."
    fi
  fi

  # ── STEP 5: Route53 ──────────────────────────────────────────────────────────
  step "  [${REGION}] 5/7  Route53 — update A alias records"

  # Get ALB hosted zone ID (same for all ALBs in the region)
  ALB_ZONE=""
  if [[ "${DRY_RUN}" != "1" ]]; then
    ALB_ZONE=$(aws elbv2 describe-load-balancers \
      --load-balancer-arns "$NEW_DIR_ARN" --region "${REGION}" \
      --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)
  fi

  update_r53_alias() {
    local subdomain="$1"
    local alb_dns="$2"
    local alb_zone="$3"
    local action="${4:-UPSERT}"

    if [[ "${DRY_RUN}" == "1" ]]; then
      warn "  [dry-run] would UPSERT ${subdomain}.${DOMAIN} → ${alb_dns}"
      return 0
    fi

    aws route53 change-resource-record-sets \
      --hosted-zone-id "${HOSTED_ZONE_ID}" \
      --change-batch "$(jq -n \
        --arg sub "${subdomain}.${DOMAIN}" \
        --arg dns "${alb_dns}" \
        --arg zone "${alb_zone}" \
        --arg action "${action}" \
        '{Changes:[{
          Action:$action,
          ResourceRecordSet:{
            Name:$sub,
            Type:"A",
            AliasTarget:{
              HostedZoneId:$zone,
              DNSName:$dns,
              EvaluateTargetHealth:true
            }
          }
        }]}')" \
      --no-cli-pager >/dev/null
    ok "  Route53 ${subdomain}.${DOMAIN} → ${alb_dns}"
  }

  update_r53_alias "${DIR_SUB}"   "${NEW_DIR_DNS}"   "${ALB_ZONE}"
  update_r53_alias "${RELAY_SUB}" "${NEW_RELAY_DNS}" "${ALB_ZONE}"
  if [[ "${REGION}" == "us-east-1" && -n "${NEW_PORTAL_DNS}" && "${NEW_PORTAL_DNS}" != "" ]]; then
    PORTAL_ALB_ZONE=""
    if [[ "${DRY_RUN}" != "1" ]]; then
      PORTAL_ALB_ZONE=$(aws elbv2 describe-load-balancers \
        --load-balancer-arns "$NEW_PORTAL_ARN" --region "${REGION}" \
        --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)
    fi
    update_r53_alias "portal" "${NEW_PORTAL_DNS}" "${PORTAL_ALB_ZONE}"
    # operations.* rides the SAME ALB as the portal (a host rule, not its own
    # load balancer — a dedicated ALB is ~$16/mo for a dashboard one person
    # opens a few times a day). So its alias must be re-pointed here too, or it
    # keeps aliasing the ALB that hibernate deleted.
    update_r53_alias "operations" "${NEW_PORTAL_DNS}" "${PORTAL_ALB_ZONE}"
  fi

  # ── STEP 6: ECS services ─────────────────────────────────────────────────────
  step "  [${REGION}] 6/7  ECS services — restore desired counts"
  svc_names=""
  while read -r svc; do
    name=$(echo "$svc"    | jq -r '.name')
    desired=$(echo "$svc" | jq -r '.desired')
    [[ "$desired" -lt 1 ]] && desired=1
    svc_names="${svc_names} ${name}"
    run aws ecs update-service --cluster "${CLUSTER_NAME}" --service "${name}" \
      --desired-count "${desired}" --region "${REGION}" \
      --no-cli-pager --query 'service.serviceName' --output text
  done < <(echo "$R" | jq -c '.ecs_services[]')

  if [[ "${DRY_RUN}" != "1" && -n "${svc_names// }" ]]; then
    log "  Waiting for ECS services to reach steady state..."
    log "  (relay re-registers with directory → directory auto-re-signs S3 manifest)"
    aws ecs wait services-stable \
      --cluster "${CLUSTER_NAME}" \
      --services ${svc_names} \
      --region "${REGION}" || warn "  services-stable wait timed out — check ECS console."
    ok "  ECS services stable."
  fi

  # ── STEP 7: VERIFY ───────────────────────────────────────────────────────────
  step "  [${REGION}] 7/7  Verification"

  VERIFY_FAILED=0
  if [[ "${DRY_RUN}" == "1" ]]; then
    warn "  [dry-run] would verify DNS, HTTP health, and inventory diff"
  else
    # ── Verification runs through the OS RESOLVER — the path real clients use.
    # dig @8.8.8.8 bypasses the local resolver stack entirely and reported
    # success on 2026-07-24 while every real client on this machine failed for
    # ~50 min (negative-cache poisoning; see the incident log). curl resolves
    # via getaddrinfo, exactly like the daemon's fetch. A failure here is a
    # FAILURE — never demote it to a soft warning.
    # Incident: docs/planning/discussion_logs/2026-07-24_1630_post-wake-directory-dns-resolution-incident.md
    verify_dir_http() {
      # Poll /manifest by hostname for up to 5 min (positive TTL 60 s means a
      # freshly-overwritten blackhole/alias record clears within ~1 min).
      local host="${DIR_SUB}.${DOMAIN}" code i
      for i in $(seq 1 20); do
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
          "http://${host}/manifest" 2>/dev/null || echo "000")
        if [[ "${code}" =~ ^(200|301|302)$ ]]; then
          ok "  /manifest HTTP ${code} via OS resolver (attempt ${i})"
          return 0
        fi
        log "  /manifest HTTP ${code} via OS resolver — retrying (${i}/20, 15s)..."
        sleep 15
      done
      return 1
    }
    verify_relay_dns() {
      # Relay serves libp2p/ws, so only prove the NAME RESOLVES on the client
      # path: curl exit code 6 = could not resolve host. Any HTTP outcome or
      # connect-level failure means DNS worked.
      local host="${RELAY_SUB}.${DOMAIN}" i
      for i in $(seq 1 20); do
        curl -s -o /dev/null --max-time 10 "http://${host}/" 2>/dev/null
        if [[ $? -ne 6 ]]; then
          ok "  ${host} resolves via OS resolver (attempt ${i})"
          return 0
        fi
        log "  ${host} not resolving via OS resolver — retrying (${i}/20, 15s)..."
        sleep 15
      done
      return 1
    }

    if ! verify_dir_http; then
      err "  ════════════════════════════════════════════════════════════════"
      err "  VERIFICATION FAILED: ${DIR_SUB}.${DOMAIN}/manifest unreachable"
      err "  via the OS resolver after 5 min. The AWS side may be healthy —"
      err "  real clients on THIS machine still cannot reach the directory."
      err "  Likely: stale negative DNS cache (hibernation NXDOMAIN poisoning)."
      err "  Diagnose (read-only): dig +short ${DIR_SUB}.${DOMAIN}  vs"
      err "    dscacheutil -q host -a name ${DIR_SUB}.${DOMAIN}"
      err "  See: docs/planning/discussion_logs/2026-07-24_1630_post-wake-directory-dns-resolution-incident.md"
      err "  ════════════════════════════════════════════════════════════════"
      VERIFY_FAILED=1
    fi
    if ! verify_relay_dns; then
      err "  VERIFICATION FAILED: ${RELAY_SUB}.${DOMAIN} does not resolve via the OS resolver."
      VERIFY_FAILED=1
    fi

    # After-snapshot + diff
    log "  Taking after-snapshot and comparing with before..."
    AFTER_FILE="${SNAPSHOT_DIR}/${REGION}-after-${TS}.json"
    "${SCRIPT_DIR}/inventory.sh" "${REGION}" "${AFTER_FILE}"

    # Find matching before-snapshot (most recent for this region)
    BEFORE_FILE=$(ls -t "${SNAPSHOT_DIR}/${REGION}-before-"*.json 2>/dev/null | head -1 || echo "")
    if [[ -n "$BEFORE_FILE" ]]; then
      echo ""
      "${SCRIPT_DIR}/inventory.sh" --diff "${BEFORE_FILE}" "${AFTER_FILE}" \
        && ok "  Inventory diff: IDENTICAL (environment fully restored)" \
        || warn "  Inventory diff: differences found — review above"
    else
      warn "  No before-snapshot found in ${SNAPSHOT_DIR}/ — skipping diff"
    fi
  fi

  # Client-path verification failure marks this region failed — the final
  # banner must never print a clean WAKE COMPLETE over an unreachable client path.
  if [[ "${VERIFY_FAILED}" -eq 1 ]]; then
    exit 1
  fi

  ) &
  PIDS+=($!)
done  # end per-region loop

# Wait for all parallel region jobs
FAILED=0
for pid in "${PIDS[@]}"; do
  wait "$pid" || FAILED=$((FAILED + 1))
done

echo ""
if [[ "${DRY_RUN}" == "1" ]]; then
  banner "DRY-RUN COMPLETE — no changes made." "${REGIONS_STR}"
  echo "Re-run with ${C_BOLD}--execute${C_RESET} to apply."
elif [[ "$FAILED" -gt 0 ]]; then
  banner "WAKE FAILED VERIFICATION (${FAILED} region(s) — see errors above)" "${REGIONS_STR}"
  echo ""
  echo "${C_RED}${C_BOLD}Do NOT treat this environment as live until the failed checks pass.${C_RESET}"
  echo "If AWS-side checks look green but the client path fails, suspect stale"
  echo "negative DNS cache on this machine (see the 2026-07-24 incident log)."
  exit 1
else
  banner "WAKE COMPLETE" "${REGIONS_STR}"
  echo ""
  echo "Post-wake checklist:"
  echo "  0. ${C_BOLD}REDEPLOY THE OPS DASHBOARD${C_RESET} — operations.cello.mygentic.ai does NOT"
  echo "     come back on its own. It rides the portal ALB via a host rule, and hibernate"
  echo "     deletes that ALB, taking the rule and its certificate with it. Wake recreates"
  echo "     the listener and re-points the DNS, but not the rule. Until this runs, the"
  echo "     hostname resolves and routes nowhere:"
  echo "       DEPLOY_OPS_DASHBOARD=1 CELLO_IMAGE_TAG=<sha> ./infra/deploy.sh dev us-east-1"
  echo "     (the deploy resolves the NEW listener ARN; the stack still holds the dead one)"
  echo "  1. Verify /manifest endpoints serve a current manifest"
  echo "  2. Relay manifests auto-re-signed when relay re-registered (check CloudWatch logs)"
  echo "  3. ECS Exec available again (ssmmessages endpoint restored)"
  echo "  4. Any client that ran DURING hibernation may hold negative DNS cache for the"
  echo "     resolver chain's negative TTL (minutes → ~1 h on TTL-mangling networks like"
  echo "     phone hotspots). Verify from the CLIENT path before debugging the server."
  echo "     (Blackhole records during hibernate prevent this going forward.)"
fi
