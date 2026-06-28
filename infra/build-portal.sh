#!/usr/bin/env bash
#
# build-portal.sh — build the cello-portal image in AWS (CodeBuild) and push to ECR.
#
# The portal lives in a separate repo (Mygentic-AI/cello-portal). This archives the COMMITTED
# git tree (HEAD — no uncommitted files), uploads it to the build-source S3 bucket, and starts
# the CodeBuild project defined in cello-portal-build.yaml. Images are built in AWS, never
# docker-pushed from a developer machine (infra rule). The image is tagged with the short SHA
# (reproducible) and :latest.
#
# Usage:  infra/build-portal.sh [dev|staging|production]
#   env vars:  PORTAL_DIR (default ../cello-portal), AWS_REGION (default us-east-1)
set -euo pipefail

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"
PORTAL_DIR="${PORTAL_DIR:-/Users/andrep/Documents/code/cello-portal}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="cello-portal-build-source-${ACCOUNT}"
PROJECT="cello-portal-build-${ENV}"

cd "$PORTAL_DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
echo "Archiving cello-portal ${BRANCH} @ ${SHA}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git archive --format=zip -o "${TMP}/source.zip" HEAD
aws s3 cp "${TMP}/source.zip" "s3://${BUCKET}/source.zip" --region "$REGION" >/dev/null
echo "Uploaded source.zip to s3://${BUCKET}/source.zip"

BUILD_ID="$(aws codebuild start-build \
  --project-name "$PROJECT" \
  --environment-variables-override "name=IMAGE_TAG,value=${SHORT},type=PLAINTEXT" \
  --region "$REGION" \
  --query 'build.id' --output text)"
echo "Started ${BUILD_ID}"
echo "Image → ${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/cello-portal:${SHORT} (and :latest)"
echo "Watch:  aws codebuild batch-get-builds --ids ${BUILD_ID} --region ${REGION} --query 'builds[0].{phase:currentPhase,status:buildStatus}'"
