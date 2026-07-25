---
name: cello-ecs-directory-dev is undeployable — ALB drift across hibernate/wake
type: discussion
date: 2026-07-25
topics: [infrastructure, hibernation, cloudformation, drift, directory]
status: open
description: deploy.sh has failed on cello-ecs-directory-dev since at least 2026-07-16 because the stack holds a listener ARN from an ALB that hibernate deleted and wake recreated under a new ARN.
---

# `cello-ecs-directory-dev` cannot be deployed

Found while running `./infra/deploy.sh dev us-east-1` for unrelated M11 work on 2026-07-25. **Not caused
by that work, and not M11.** Raising it because it blocks every CloudFormation change to the protocol
path, and because it is silent — the services are healthy, so nothing surfaces it until someone deploys.

## What happens

```
── Deploying cello-ecs-directory-dev ──────────────────────────────
aws: [ERROR]: Failed to create/update the stack.
ERROR: Stack cello-ecs-directory-dev failed to deploy (exit 255)
```

The failing resource is `RegistryPathRule`:

> Resource handler returned message: "One or more listeners not found
> (Service: ElasticLoadBalancingV2, Status Code: 400)" … HandlerErrorCode: NotFound

**This is the third occurrence, not the first.** `describe-stack-events` shows `UPDATE_FAILED` on the
same resource for the same reason on **2026-07-16**, **2026-07-19**, and **2026-07-25**.

## Root cause — proven, not inferred

The stack's stored physical ID for `HttpListener` names a **different load balancer** from the one that
exists:

| | ALB id | listener |
|---|---|---|
| Live (`describe-load-balancers`) | `cello-dir-dev/d1e5394ec675ac52` | `…/d1e5394ec675ac52/27d86d5ec15bee06` |
| Stack (`describe-stack-resources`) | `cello-dir-dev/9f3cee2f6df31fc9` | `…/9f3cee2f6df31fc9/276eb2ef7ba77735` |

`HttpListener` reports `UPDATE_COMPLETE`. CloudFormation believes it owns a listener that no longer
exists, so it sees no diff for that resource and passes the stale ARN to `RegistryPathRule`, which fails
because the ARN resolves to nothing.

**Hibernate deletes the ALB; wake recreates it.** A recreated ALB gets a new ARN, and every listener under
it does too. Nothing reconciles CloudFormation's stored physical IDs afterwards.

This is the same species as the Route53 drift already documented in `infra/CLAUDE.md` ("Route53 CFN
Drift — Stack Status Is Not Proof the Record Exists"), one layer up: **a stack in `UPDATE_COMPLETE` is
not proof its resources exist.** The difference is that the Route53 case has a documented detection
command and this one does not.

## Why it stayed invisible

- The ECS services are healthy. The pre-change health check passes: all six services 1/1 `COMPLETED`
  across all three regions. Traffic works, because the *live* ALB and its listener are fine — it is only
  CloudFormation's record of them that is stale.
- `deploy.sh` treats directory as critical and exits on its failure, so the run stops there. Everything
  ordered after it — WAF, relay, CloudWatch, Route53, cicd, and (as of this milestone) the waitlist stack
  — is never reached. **The dev environment currently has no working path to deploy any of them.**
- Nothing alarms on it. It surfaces only when a human runs a deploy.

## Detection

```bash
STACK_LISTENER=$(aws cloudformation describe-stack-resources --stack-name cello-ecs-directory-dev \
  --region us-east-1 --query "StackResources[?LogicalResourceId=='HttpListener'].PhysicalResourceId" --output text)
aws elbv2 describe-listeners --listener-arns "$STACK_LISTENER" --region us-east-1 >/dev/null 2>&1 \
  && echo "OK — the stack's listener exists" \
  || echo "DRIFT — the stack references a listener that does not exist"
```

Worth running for all three regions, and for the relay stack too — the same hibernate/wake cycle applies
to `cello-relay-dev`'s ALB, and it was simply never reached by the deploy that failed here.

## Options, not a recommendation

Deliberately not fixed here: this is the protocol path, another agent owned the wake cycle at the time,
and a wrong repair on a drifted stack is worse than a known-broken one.

1. **Delete and recreate the stack.** Cleanest reconciliation, and the most disruptive — it takes the
   directory service down and out of DNS.
2. **`--import-existing-resources` / resource import** to re-point the stack at the live listener. Needs
   `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` on the resource first, per `infra/CLAUDE.md`.
3. **Teach hibernate/wake to preserve ALB identity**, which is the only option that stops it recurring.
   The wake script already restores the NAT gateway's EIP for exactly this reason; the ALB has no
   equivalent, and ALB ARNs cannot be preserved across delete/create — so this likely means the ALB must
   stop being hibernated, or the stacks that reference it must be reconciled by wake.

Option 3 is the one that matters: 1 and 2 both fix today and leave the next hibernate/wake cycle to break
it again, which is what the three-occurrence history shows already happening.

## Consequence for M11

The waitlist stack was deployed directly with `aws cloudformation deploy`, using the same parameters
`deploy.sh` STEP 15 computes, because the script cannot reach STEP 15. It depends only on VPC and
portal-db exports, so it is unaffected by the directory stack's state. Recorded in `infra/STATE.md`.
