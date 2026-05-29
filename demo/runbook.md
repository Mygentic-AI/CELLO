# CELLO Demo Agent — EC2 Provisioning Runbook

This runbook documents the exact steps to provision the CELLO demo agent EC2 instance from scratch.

## Architecture decisions

- Region: us-east-1
- Instance type: t3.micro
- Access: SSM Session Manager only — NO port 22, NO key pair attached to instance, NO inbound SG rules
- IAM: instance profile with AmazonSSMManagedInstanceCore policy
- Elastic IP: yes (stable address for DNS)
- SG outbound: HTTPS (443) to 0.0.0.0/0 only — all CELLO connectivity goes over HTTPS (443)
- Port 4000 is NOT opened — that is the relay's internal VPC health check port, inaccessible from EC2 outside the VPC

---

## Step 1: Create IAM role and instance profile

```bash
# Create trust policy document
cat > /tmp/ec2-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the IAM role
aws iam create-role \
  --role-name cello-demo-agent-role \
  --assume-role-policy-document file:///tmp/ec2-trust-policy.json \
  --region us-east-1

# Attach AmazonSSMManagedInstanceCore policy (required for SSM Session Manager)
aws iam attach-role-policy \
  --role-name cello-demo-agent-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore \
  --region us-east-1

# Create instance profile
aws iam create-instance-profile \
  --instance-profile-name cello-demo-agent-profile \
  --region us-east-1

# Add role to instance profile
aws iam add-role-to-instance-profile \
  --instance-profile-name cello-demo-agent-profile \
  --role-name cello-demo-agent-role \
  --region us-east-1
```

---

## Step 2: Create security group

```bash
# Create the security group (no inbound rules — SSM only, all CELLO traffic is outbound HTTPS)
SG_ID=$(aws ec2 create-security-group \
  --group-name cello-demo-sg \
  --description "CELLO demo agent — SSM access only, HTTPS outbound" \
  --region us-east-1 \
  --query 'GroupId' \
  --output text)

echo "Security Group ID: $SG_ID"

# Add HTTPS outbound rule only (port 443 to anywhere)
aws ec2 authorize-security-group-egress \
  --group-id "$SG_ID" \
  --ip-permissions '[{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0","Description":"CELLO directory ALB and relay via circuit relay path over HTTPS"}]}]' \
  --region us-east-1

# NOTE: No inbound rules needed. SSM Session Manager communicates via the outbound HTTPS connection
# to the SSM endpoint, so no inbound SSH (port 22) is required.
# The management IP placeholder below is purely informational — with SSM, no inbound is needed.
# YOUR_MANAGEMENT_IP/32 is noted here only if you later decide to add SSH for emergency access.
```

---

## Step 3: Allocate Elastic IP

```bash
# Allocate an Elastic IP
EIP_ALLOCATION=$(aws ec2 allocate-address \
  --domain vpc \
  --region us-east-1 \
  --output json)

EIP_ALLOCATION_ID=$(echo "$EIP_ALLOCATION" | jq -r '.AllocationId')
EIP_PUBLIC_IP=$(echo "$EIP_ALLOCATION" | jq -r '.PublicIp')

echo "Elastic IP Allocation ID: $EIP_ALLOCATION_ID"
echo "Elastic IP: $EIP_PUBLIC_IP"
```

---

## Step 4: Create user-data script

```bash
cat > /tmp/cello-demo-user-data.sh << 'USERDATA'
#!/bin/bash
set -euo pipefail

# Install Node.js 24 via nvm
export HOME=/root
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
nvm alias default 24

# Make node available system-wide
NODE_PATH=$(which node)
ln -sf "$NODE_PATH" /usr/bin/node
NPM_PATH=$(which npm)
ln -sf "$NPM_PATH" /usr/bin/npm

# Create system user for the demo agent
useradd --system --home-dir /opt/cello-demo --create-home --shell /sbin/nologin cello-demo

# Create keys directory with restricted permissions
mkdir -p /opt/cello-demo/keys
chmod 700 /opt/cello-demo/keys
chown cello-demo:cello-demo /opt/cello-demo/keys

# Install @cello-protocol/connect
mkdir -p /opt/cello-demo
cd /opt/cello-demo

# Create package.json for the demo agent
cat > /opt/cello-demo/package.json << 'PKG'
{
  "name": "cello-demo-agent",
  "version": "1.0.0",
  "private": true,
  "type": "module"
}
PKG

npm install @cello-protocol/connect@0.0.3

# Copy the compiled demo agent (built from this repo's demo/ directory)
# The dist/ directory should be uploaded via SSM or built on the instance.
# If building on the instance, install TypeScript and build:
# npm install -g typescript && tsc

# Install and enable systemd service
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

[Install]
WantedBy=multi-user.target
SVCFILE

systemctl daemon-reload
systemctl enable cello-demo
# DO NOT start yet — registration must happen first (see post-provisioning steps below)

chown -R cello-demo:cello-demo /opt/cello-demo
USERDATA
```

---

## Step 5: Launch EC2 instance

```bash
# Get the latest Amazon Linux 2023 AMI
AL2023_AMI=$(aws ec2 describe-images \
  --owners amazon \
  --filters \
    "Name=name,Values=al2023-ami-*-x86_64" \
    "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text \
  --region us-east-1)

echo "Amazon Linux 2023 AMI: $AL2023_AMI"

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AL2023_AMI" \
  --instance-type t3.micro \
  --iam-instance-profile Name=cello-demo-agent-profile \
  --security-group-ids "$SG_ID" \
  --user-data file:///tmp/cello-demo-user-data.sh \
  --no-associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=cello-demo-agent}]' \
  --region us-east-1 \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "Instance ID: $INSTANCE_ID"

# Wait for the instance to be running
aws ec2 wait instance-running \
  --instance-ids "$INSTANCE_ID" \
  --region us-east-1

# Associate the Elastic IP
aws ec2 associate-address \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$EIP_ALLOCATION_ID" \
  --region us-east-1

echo "Instance $INSTANCE_ID is running with Elastic IP $EIP_PUBLIC_IP"
echo "Connect via: aws ssm start-session --target $INSTANCE_ID --region us-east-1"
```

---

## Step 6: Post-provisioning manual steps

These steps must be performed after the instance is running and the user-data script has completed.

### 6a: Wait for user-data to complete

Connect via SSM Session Manager and check user-data status:

```bash
aws ssm start-session --target $INSTANCE_ID --region us-east-1

# Inside the SSM session:
sudo systemctl status cello-demo
# Expected: inactive (dead) — not started yet, waiting for registration
```

### 6b: Register the demo agent via the Telegram bot

1. Message the CELLO production Telegram bot
2. Complete the registration ceremony: phone verification, email OTP
3. Receive the pre-auth token (CELLO_REGISTRATION_TOKEN)

### 6c: Set environment and run registration

```bash
# Inside the SSM session on the EC2 instance:
sudo -u cello-demo bash

# Set the pre-auth token received from the Telegram bot
export CELLO_REGISTRATION_TOKEN="<token-from-telegram-bot>"
export CELLO_KEY_FILE=/opt/cello-demo/keys/agent.key
export CELLO_DIRECTORY_MULTIADDR="<production-directory-multiaddr>"
export CELLO_ENV=production

# Run cello_register via the connect binary
# The binary handles the full DKG ceremony
node node_modules/@cello-protocol/connect/dist/bin/cello-mcp.js
# In a separate terminal, call cello_register via MCP client or use the npx helper:
# npx @cello-protocol/connect register --token "$CELLO_REGISTRATION_TOKEN"
```

### 6d: Secure the key file

```bash
# Set restrictive permissions on the key file (SI-001)
chmod 600 /opt/cello-demo/keys/agent.key
chown cello-demo:cello-demo /opt/cello-demo/keys/agent.key
```

### 6e: Back up the key to Secrets Manager

```bash
# IAM role needs secretsmanager:CreateSecret and secretsmanager:PutSecretValue
# (add these manually or via an updated policy after registration)
aws secretsmanager create-secret \
  --name cello-demo-agent-key \
  --description "CELLO demo agent Ed25519 identity key" \
  --secret-binary fileb:///opt/cello-demo/keys/agent.key \
  --region us-east-1

# Verify the backup
aws secretsmanager describe-secret \
  --secret-id cello-demo-agent-key \
  --region us-east-1
```

### 6f: Configure the systemd unit with environment

```bash
# Create an environment override file
sudo mkdir -p /etc/systemd/system/cello-demo.service.d
sudo tee /etc/systemd/system/cello-demo.service.d/env.conf << 'EOF'
[Service]
Environment=CELLO_KEY_FILE=/opt/cello-demo/keys/agent.key
Environment=CELLO_DIRECTORY_MULTIADDR=<production-directory-multiaddr>
Environment=CELLO_ENV=production
EOF

sudo systemctl daemon-reload
```

### 6g: Start the demo agent

```bash
sudo systemctl start cello-demo
```

---

## Step 7: Verification

```bash
# Check the service is running
sudo systemctl is-active cello-demo
# Expected output: active

# Check the logs for demo.started event
sudo journalctl -u cello-demo --no-pager | tail -20
# Expected: JSON log line with event=demo.started, agentId=<hex>, directoryUrl=<url>

# If it fails, check for demo.connection.failed event
sudo journalctl -u cello-demo --no-pager | grep connection.failed
```

---

## Restart test (AC-006 verification)

```bash
# Kill the service to test automatic restart
sudo systemctl kill cello-demo

# Wait 6 seconds (RestartSec=5 + buffer)
sleep 6

# Verify it restarted automatically
sudo systemctl is-active cello-demo
# Expected: active

# Check logs for reconnect sequence
sudo journalctl -u cello-demo --no-pager | tail -30
# Expected: demo.connection.failed (from kill) then demo.started (from reconnect)
```

---

## Key recovery

If the key file is lost and the Secrets Manager backup exists:

```bash
# Retrieve from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id cello-demo-agent-key \
  --region us-east-1 \
  --query 'SecretBinary' \
  --output text | base64 --decode > /opt/cello-demo/keys/agent.key

chmod 600 /opt/cello-demo/keys/agent.key
chown cello-demo:cello-demo /opt/cello-demo/keys/agent.key
sudo systemctl restart cello-demo
```

If both the key file and backup are lost, re-registration via the Telegram bot is the recovery path (creates a new agent identity).

---

## Placeholder values

- `YOUR_AWS_ACCOUNT_ID` — your 12-digit AWS account ID
- `YOUR_MANAGEMENT_IP/32` — your management IP if adding emergency SSH (not needed with SSM)
- `<production-directory-multiaddr>` — the production CELLO directory libp2p multiaddr (from the CELLO README or ops runbook)
- `<token-from-telegram-bot>` — the pre-auth token received during Telegram registration
