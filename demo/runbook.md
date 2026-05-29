# CELLO Demo Agent — EC2 Provisioning Runbook

This runbook documents the exact steps to provision the CELLO demo agent EC2 instance from scratch.
All resource IDs are verified against the live AWS account (257394457473) as of 2026-05-29.

## Architecture decisions

- Region: us-east-1
- VPC: **default VPC** (`vpc-09a0338d25550f292`, `172.31.0.0/16`) — public subnets, internet gateway attached.
  NOT `cello-vpc-dev` — that VPC has private subnets and is missing the `ec2messages` VPC endpoint
  required for SSM Session Manager. The demo agent is an external CELLO client, not an infrastructure
  component; it belongs in the same VPC as the other agent instances.
- Subnet: `subnet-00b93e4a3f6ce8c07` (us-east-1a) — public, same subnet as openclaw-agent
- Instance type: t3.micro
- AMI: `ami-08e6829e013be2292` (Amazon Linux 2023, 2026-05-21) — verified available
- Access: SSM Session Manager only — NO port 22, NO key pair, NO inbound SG rules
- IAM: instance profile with `AmazonSSMManagedInstanceCore` + Secrets Manager inline policy
- Elastic IP: yes — all existing EIPs are associated; allocate a new one
- SG outbound: HTTPS (443) to 0.0.0.0/0 only
- SSM VPC endpoints: NOT needed — public subnet + internet gateway means SSM reaches its
  endpoints over the public internet on port 443 outbound (no VPC endpoints required)
- Port 4000 is NOT opened — that is the relay's internal VPC health check port, inaccessible
  from outside the VPC

---

## Step 1: Check existing IAM instance profile

An instance profile named `cello-agent-ssm-role` already exists. Check if it can be reused
before creating a new one.

```bash
# Check attached policies on the existing role
aws iam list-attached-role-policies \
  --role-name cello-agent-ssm-role

# Check trust policy — must allow ec2.amazonaws.com
aws iam get-role \
  --role-name cello-agent-ssm-role \
  --query 'Role.AssumeRolePolicyDocument' \
  --output json
```

**Decision:**
- If `AmazonSSMManagedInstanceCore` is attached AND trust policy includes `ec2.amazonaws.com`
  → set `ROLE_NAME=cello-agent-ssm-role` and `INSTANCE_PROFILE_NAME=cello-agent-ssm-role`, skip Step 2
- Otherwise → proceed to Step 2 to create a dedicated role

```bash
# Set these variables based on decision above:
# Option A — reuse existing:
ROLE_NAME=cello-agent-ssm-role
INSTANCE_PROFILE_NAME=cello-agent-ssm-role

# Option B — new role (created in Step 2):
# ROLE_NAME=cello-demo-agent-role
# INSTANCE_PROFILE_NAME=cello-demo-agent-profile
```

---

## Step 2: Create IAM role and instance profile (only if Step 1 shows existing cannot be reused)

```bash
cat > /tmp/ec2-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name cello-demo-agent-role \
  --assume-role-policy-document file:///tmp/ec2-trust-policy.json

aws iam attach-role-policy \
  --role-name cello-demo-agent-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam create-instance-profile \
  --instance-profile-name cello-demo-agent-profile

aws iam add-role-to-instance-profile \
  --instance-profile-name cello-demo-agent-profile \
  --role-name cello-demo-agent-role

ROLE_NAME=cello-demo-agent-role
INSTANCE_PROFILE_NAME=cello-demo-agent-profile
```

---

## Step 3: Add Secrets Manager inline policy to the role

`AmazonSSMManagedInstanceCore` does not include Secrets Manager permissions. This inline policy
is required for Step 9e (key backup from the instance). Apply regardless of whether you reused
the existing role or created a new one.

```bash
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name cello-demo-secrets-manager \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "secretsmanager:CreateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ],
        "Resource": "arn:aws:secretsmanager:us-east-1:257394457473:secret:cello/dev/demo-agent/identity-key*"
      }
    ]
  }'
```

---

## Step 4: Create security group

The security group goes in the default VPC (`vpc-09a0338d25550f292`).

**Important:** AWS automatically adds an allow-all egress rule when a security group is created.
You must revoke it before adding the HTTPS-only rule, otherwise both rules exist simultaneously.

```bash
SG_ID=$(aws ec2 create-security-group \
  --group-name cello-demo-sg \
  --description "CELLO demo agent — SSM + outbound HTTPS only" \
  --vpc-id vpc-09a0338d25550f292 \
  --region us-east-1 \
  --query 'GroupId' \
  --output text)

echo "Security Group ID: $SG_ID"

# REQUIRED: revoke the default allow-all egress rule AWS adds automatically
aws ec2 revoke-security-group-egress \
  --group-id "$SG_ID" \
  --ip-permissions '[{"IpProtocol":"-1","IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]' \
  --region us-east-1

# Add HTTPS-only egress (directory ALB, relay circuit relay path, SSM endpoints — all port 443)
aws ec2 authorize-security-group-egress \
  --group-id "$SG_ID" \
  --ip-permissions '[{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0","Description":"CELLO directory ALB + relay via circuit relay + SSM endpoints"}]}]' \
  --region us-east-1

# No inbound rules. SSM Session Manager is control-plane only (outbound 443 to SSM endpoints).
echo "Security group $SG_ID: zero inbound, HTTPS-443 outbound only"
```

---

## Step 5: Allocate Elastic IP

All existing EIPs in the account are associated — a new one must be allocated.

```bash
EIP_JSON=$(aws ec2 allocate-address \
  --domain vpc \
  --region us-east-1 \
  --output json)

EIP_ALLOCATION_ID=$(echo "$EIP_JSON" | jq -r '.AllocationId')
EIP_PUBLIC_IP=$(echo "$EIP_JSON" | jq -r '.PublicIp')

echo "Elastic IP Allocation ID: $EIP_ALLOCATION_ID"
echo "Elastic IP: $EIP_PUBLIC_IP"
```

---

## Step 6: Write user-data script

The user-data installs Node.js 24, creates the `cello-demo` system user, installs
`@cello-protocol/connect`, writes the systemd unit, and enables (but does NOT start) the service.

**Note:** The compiled demo agent (`dist/index.js`) is NOT included in user-data — it must be
uploaded separately in Step 8 after the instance is running.

```bash
cat > /tmp/cello-demo-user-data.sh << 'USERDATA'
#!/bin/bash
set -euo pipefail
exec > /var/log/cello-demo-user-data.log 2>&1

# Install Node.js 24 via nvm (run as root)
export HOME=/root
curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
nvm alias default 24

# Symlink node/npm for system-wide use (required by systemd ExecStart)
NODE_BIN=$(which node)
NPM_BIN=$(which npm)
ln -sf "$NODE_BIN" /usr/bin/node
ln -sf "$NPM_BIN" /usr/bin/npm

# Create cello-demo system user with home /opt/cello-demo
useradd --system --home-dir /opt/cello-demo --create-home --shell /sbin/nologin cello-demo

# Create keys directory (chmod 700 — only cello-demo can read)
mkdir -p /opt/cello-demo/keys
chmod 700 /opt/cello-demo/keys

# Bootstrap package.json
cat > /opt/cello-demo/package.json << 'PKG'
{
  "name": "cello-demo-agent",
  "version": "1.0.0",
  "private": true,
  "type": "module"
}
PKG

# Install @cello-protocol/connect (brings in @modelcontextprotocol/sdk transitively)
cd /opt/cello-demo
npm install @cello-protocol/connect@0.0.3

# Install systemd unit
# dist/ is uploaded separately in Step 8 — do NOT start until after upload + registration
cat > /etc/systemd/system/cello-demo.service << 'SVCFILE'
[Unit]
Description=CELLO Demo Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=cello-demo
WorkingDirectory=/opt/cello-demo
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
# Required: create /etc/systemd/system/cello-demo.service.d/env.conf before starting.
# It must set CELLO_DIRECTORY_MULTIADDR, CELLO_KEY_FILE, and CELLO_ENV.
# See Step 9f below. Without this override the agent will exit on startup.

[Install]
WantedBy=multi-user.target
SVCFILE

systemctl daemon-reload
systemctl enable cello-demo
# NOT started — dist/ must be uploaded and registration must happen first

chown -R cello-demo:cello-demo /opt/cello-demo
echo "CELLO demo user-data complete"
USERDATA
```

---

## Step 7: Launch EC2 instance

Use the confirmed AMI `ami-08e6829e013be2292` (Amazon Linux 2023, 2026-05-21) and subnet
`subnet-00b93e4a3f6ce8c07` (us-east-1a, default VPC public subnet).

Do NOT pass `--no-associate-public-ip-address` — the EIP replaces the auto-assigned public IP
and the instance needs internet access for SSM and outbound HTTPS.

```bash
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-08e6829e013be2292 \
  --instance-type t3.micro \
  --iam-instance-profile Name="$INSTANCE_PROFILE_NAME" \
  --security-group-ids "$SG_ID" \
  --subnet-id subnet-00b93e4a3f6ce8c07 \
  --user-data file:///tmp/cello-demo-user-data.sh \
  --tag-specifications \
    'ResourceType=instance,Tags=[{Key=Name,Value=cello-demo-agent},{Key=Project,Value=cello},{Key=Env,Value=dev}]' \
  --region us-east-1 \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "Instance ID: $INSTANCE_ID"

# Wait for running state (~60-90 seconds)
aws ec2 wait instance-running \
  --instance-ids "$INSTANCE_ID" \
  --region us-east-1

echo "Instance is running"

# Associate the Elastic IP
aws ec2 associate-address \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$EIP_ALLOCATION_ID" \
  --region us-east-1

echo "EIP $EIP_PUBLIC_IP associated with $INSTANCE_ID"
echo "Connect via SSM: aws ssm start-session --target $INSTANCE_ID --region us-east-1"
```

---

## Step 7b: Verify SSM connectivity (~3-5 minutes after launch)

The SSM agent starts automatically on Amazon Linux 2023. Wait for user-data to complete,
then verify SSM registration:

```bash
# Check SSM managed instance status (retry for up to 5 minutes)
aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
  --region us-east-1 \
  --query 'InstanceInformationList[0].{PingStatus:PingStatus,AgentVersion:AgentVersion}'
# Expected: PingStatus=Online

# Open an SSM session
aws ssm start-session \
  --target "$INSTANCE_ID" \
  --region us-east-1
```

If SSM does not register within 5 minutes, check the user-data log:

```bash
# Inside SSM session (once it's up), or via CloudWatch Logs:
sudo cat /var/log/cello-demo-user-data.log
sudo cat /var/log/cloud-init-output.log
```

---

## Step 8: Build and upload demo agent dist/ (REQUIRED before Step 9)

The demo agent source is in `trustless-cello/demo/`. It must be compiled locally and uploaded
to the instance before the service can start. The user-data does not do this.

**On your local machine:**

```bash
cd /Users/andrep/Documents/code/trustless-cello/demo

# Install dependencies and compile
npm install
npm run build
# Produces: dist/index.js  dist/message-handler.js (and .js.map files)

ls dist/
# Expected: index.js  message-handler.js
```

**Upload via pre-signed S3 URL (no extra IAM permissions required):**

```bash
# Package the dist directory
tar czf /tmp/cello-demo-dist.tar.gz -C /Users/andrep/Documents/code/trustless-cello/demo dist

# Upload to existing S3 bucket (reusing cello-relay-manifest bucket as staging)
aws s3 cp /tmp/cello-demo-dist.tar.gz \
  s3://cello-relay-manifest-dev-us-east-1/cello-demo-dist.tar.gz \
  --region us-east-1

# Generate a pre-signed URL (valid 1 hour)
PRESIGNED_URL=$(aws s3 presign \
  s3://cello-relay-manifest-dev-us-east-1/cello-demo-dist.tar.gz \
  --expires-in 3600 \
  --region us-east-1)

echo "$PRESIGNED_URL"
```

**Inside the SSM session on the instance:**

```bash
# Download and extract dist/
curl -fsSL "$PRESIGNED_URL" -o /tmp/cello-demo-dist.tar.gz
tar xzf /tmp/cello-demo-dist.tar.gz -C /opt/cello-demo/
chown -R cello-demo:cello-demo /opt/cello-demo/dist

# Verify
ls /opt/cello-demo/dist/
# Expected: index.js  message-handler.js

# Clean up staging artifact
aws s3 rm s3://cello-relay-manifest-dev-us-east-1/cello-demo-dist.tar.gz --region us-east-1
```

---

## Step 9: Post-provisioning — register and start

All steps below run inside an SSM session unless noted.

### 9a: Verify Node.js and dist/

```bash
# Inside SSM session
node --version
# Expected: v24.x.x

ls /opt/cello-demo/dist/
# Expected: index.js  message-handler.js

ls /opt/cello-demo/node_modules/@cello-protocol/
# Expected: connect directory
```

### 9b: Get the production directory multiaddr

The multiaddr is the libp2p address of the production directory node. It takes the form:
`/dns4/directory-us1.cello.mygentic.ai/tcp/443/wss/p2p/<peer-id>`

Get it from the CELLO README quick-start docs or from the operations runbook.
Set `DIRECTORY_MULTIADDR=<value>` for use in subsequent steps.

### 9c: Register via the Telegram bot

This step requires OPS-AGENT-005B to be deployed and live.

1. Message **@CelloConnectBot** on Telegram
2. Complete the registration ceremony: phone verification → email OTP
3. Receive the pre-authorization token (`CELLO_REGISTRATION_TOKEN`)

```bash
# Inside SSM session, switch to cello-demo user
sudo -u cello-demo bash

cd /opt/cello-demo

export CELLO_KEY_FILE=/opt/cello-demo/keys/agent.key
export CELLO_DIRECTORY_MULTIADDR="<multiaddr from 9b>"
export CELLO_ENV=production
export CELLO_REGISTRATION_TOKEN="<token from Telegram bot>"

# Start the MCP server — it will load the key file and connect to the directory
node node_modules/@cello-protocol/connect/dist/bin/cello-mcp.js
# In a separate SSM session or pane, use claude mcp add cello and call:
#   cello_register with token=CELLO_REGISTRATION_TOKEN
# After registration, cello_status should return:
#   { registered: true, own_pubkey: "<hex>", directory_reachable: true }
```

Record the `own_pubkey` value — this is the AgentID to publish in the README.

### 9d: Secure the key file

```bash
chmod 600 /opt/cello-demo/keys/agent.key
chown cello-demo:cello-demo /opt/cello-demo/keys/agent.key
ls -la /opt/cello-demo/keys/
# Expected: -rw------- 1 cello-demo cello-demo ... agent.key
```

### 9e: Back up the key to Secrets Manager

Run from inside the SSM session. The instance IAM role has the required permissions from Step 3.
Use the `cello/dev/` namespace to match existing infrastructure conventions.

```bash
aws secretsmanager create-secret \
  --name cello/dev/demo-agent/identity-key \
  --description "CELLO demo agent Ed25519 identity key — back up immediately after registration" \
  --secret-binary fileb:///opt/cello-demo/keys/agent.key \
  --region us-east-1

# Verify
aws secretsmanager describe-secret \
  --secret-id cello/dev/demo-agent/identity-key \
  --region us-east-1
```

### 9f: Create systemd environment drop-in

```bash
sudo mkdir -p /etc/systemd/system/cello-demo.service.d

sudo tee /etc/systemd/system/cello-demo.service.d/env.conf << 'EOF'
[Service]
Environment=CELLO_KEY_FILE=/opt/cello-demo/keys/agent.key
Environment=CELLO_DIRECTORY_MULTIADDR=<multiaddr from 9b>
Environment=CELLO_ENV=production
EOF

sudo systemctl daemon-reload
```

### 9g: Start the demo agent

```bash
sudo systemctl start cello-demo

# Verify active
sudo systemctl is-active cello-demo
# Expected: active

# Check for demo.started log event (JSON to stderr → journalctl)
sudo journalctl -u cello-demo --no-pager | tail -20
# Expected: {"level":"info","event":"demo.started","agentId":"<hex>","directoryUrl":"...","ts":"..."}
```

### 9h: Verify restart behavior (AC-006)

```bash
sudo systemctl kill cello-demo
sleep 6
sudo systemctl is-active cello-demo
# Expected: active

sudo journalctl -u cello-demo --no-pager | grep -E "connection.failed|demo.started" | tail -5
# Expected: demo.connection.failed line followed by demo.started line
```

---

## Step 10: Update STATE.md (mandatory before closing the session)

Add the following section to `infra/STATE.md` under a new `### demo-agent — us-east-1` heading:

```markdown
### demo-agent — us-east-1
*Provisioned: <date>*

| Resource | Value |
|---|---|
| Instance ID | <INSTANCE_ID> |
| Instance Name | cello-demo-agent |
| Instance Type | t3.micro |
| AMI | ami-08e6829e013be2292 (Amazon Linux 2023, 2026-05-21) |
| VPC | vpc-09a0338d25550f292 (default VPC, 172.31.0.0/16) |
| Subnet | subnet-00b93e4a3f6ce8c07 (us-east-1a) |
| EIP Allocation ID | <EIP_ALLOCATION_ID> |
| Elastic IP | <EIP_PUBLIC_IP> |
| Security Group ID | <SG_ID> |
| Security Group Name | cello-demo-sg |
| IAM Instance Profile | <INSTANCE_PROFILE_NAME> |
| IAM Role | <ROLE_NAME> |
| Secrets Manager Key Path | cello/dev/demo-agent/identity-key |
| Agent ID (own_pubkey) | <hex from cello_status after registration> |
| Access | SSM Session Manager only — no key pair, no inbound SG rules |
| Inbound rules | None |
| Outbound rules | TCP 443 to 0.0.0.0/0 only |
```

---

## Step 11: Publish the AgentID (AC-000)

Add the demo agent's AgentID (`own_pubkey` from Step 9c) to the CELLO README quick-start docs.
This is required by AC-000 and enables M6-E2E-001.

---

## Verification checklist

| AC | Test | Command |
|---|---|---|
| AC-001 | `cello_status` returns registered=true, directory_reachable=true | Step 9c |
| AC-004 | SG has zero inbound, HTTPS-443 outbound only | `aws ec2 describe-security-groups --group-ids $SG_ID` |
| AC-006 | systemd restarts on crash | Step 9h |
| SI-001 | Key file chmod 600, no inbound ports | Step 9d + AC-004 |

---

## Key recovery

If the key file is lost and the Secrets Manager backup exists:

```bash
aws secretsmanager get-secret-value \
  --secret-id cello/dev/demo-agent/identity-key \
  --region us-east-1 \
  --query 'SecretBinary' \
  --output text | base64 --decode > /opt/cello-demo/keys/agent.key

chmod 600 /opt/cello-demo/keys/agent.key
chown cello-demo:cello-demo /opt/cello-demo/keys/agent.key
sudo systemctl restart cello-demo
```

If both the key file and backup are lost, re-register via @CelloConnectBot (creates a new agent identity).

---

## Placeholder values

- `<INSTANCE_ID>` — set automatically by Step 7 `run-instances` output
- `<EIP_ALLOCATION_ID>` / `<EIP_PUBLIC_IP>` — set by Step 5 `allocate-address` output
- `<SG_ID>` — set by Step 4 `create-security-group` output
- `<ROLE_NAME>` / `<INSTANCE_PROFILE_NAME>` — set in Step 1 or Step 2
- `<production-directory-multiaddr>` — from CELLO README or ops runbook (Step 9b)
- `<token-from-telegram-bot>` — from @CelloConnectBot registration ceremony (Step 9c)
