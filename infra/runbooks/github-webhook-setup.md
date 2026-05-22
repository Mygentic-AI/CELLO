# GitHub Webhook Setup — CELLO CI/CD

**Prerequisite:** The `cello-cicd-{env}` CloudFormation stack must be deployed
in us-east-1 (status `CREATE_COMPLETE` or `UPDATE_COMPLETE`). Run `./infra/deploy.sh`
first if it is not yet deployed.

---

## Step 1 — Retrieve the Lambda function URL

Query the CloudFormation stack outputs to get the webhook receiver URL.

```bash
ENVIRONMENT=dev   # change to staging or production as needed

aws cloudformation describe-stacks \
  --stack-name "cello-cicd-${ENVIRONMENT}" \
  --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" \
  --output text
```

Save the printed URL — it will look like:
`https://<id>.lambda-url.us-east-1.on.aws/`

---

## Step 2 — Generate a cryptographically random 32-byte HMAC secret

```bash
# Generate 32 random bytes and hex-encode them.
HMAC_SECRET=$(openssl rand -hex 32)
echo "HMAC secret (store this, it cannot be recovered from AWS): $HMAC_SECRET"
```

Store the output of `$HMAC_SECRET` in a password manager or secure note.
You will need it when registering the webhook in GitHub (Step 4).

---

## Step 3 — Store the HMAC secret in Secrets Manager

```bash
ENVIRONMENT=dev   # match the environment from Step 1

aws secretsmanager put-secret-value \
  --secret-id "cello/${ENVIRONMENT}/pipeline/github-hmac-secret" \
  --secret-string "$HMAC_SECRET" \
  --region us-east-1
```

Confirm the command exits with no error and returns the secret ARN.

---

## Step 4 — Register the webhook in GitHub

1. Open the Mygentic-AI/CELLO repository in a browser.
2. Navigate to **Settings** → **Webhooks** → **Add webhook**.
3. Fill in the fields:
   - **Payload URL**: the Lambda function URL from Step 1
   - **Content type**: `application/json`
   - **Secret**: the `$HMAC_SECRET` value from Step 2
   - **Which events would you like to trigger this webhook?**: select **Just the push event**
   - **Active**: checked
4. Click **Add webhook**.

GitHub will immediately send a `ping` event to verify the URL is reachable.
The ping will be rejected with HTTP 401 by the Lambda because it carries no
push payload and no HMAC to match — this is expected. GitHub marks the webhook
as active even when the ping is rejected.

---

## Step 5 — Verify the webhook is wired correctly

Push a test commit to the `main` branch of `Mygentic-AI/CELLO`:

```bash
git commit --allow-empty -m "chore: verify CI/CD webhook wiring"
git push origin main
```

Then confirm a pipeline execution started in CodePipeline within 60 seconds:

```bash
# Replace with the pipeline that should have triggered for your touched path.
PIPELINE=cello-directory-pipeline   # or whichever matches your commit

aws codepipeline list-pipeline-executions \
  --pipeline-name "$PIPELINE" \
  --region us-east-1 \
  --max-results 1
```

The output should show an execution with `status: InProgress` or `Succeeded`
and a `startTime` within the last 2 minutes.

You can also inspect the Lambda logs in CloudWatch Logs under:
`/aws/lambda/cello-github-webhook-receiver-${ENVIRONMENT}`

A successful webhook delivery logs a `pipeline.webhook.received` JSON event.
A rejected delivery logs a `pipeline.webhook.rejected` JSON event with the
reason field.
