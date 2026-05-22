#!/usr/bin/env bash
# build-stubs.sh — Build and push linux/amd64 stub images to seed ECR repos.
#
# Run this ONCE per new environment before deploying CloudFormation stacks.
# ECS requires an image to exist in ECR before a service can start.
# The stub is replaced by the real image once CodeBuild runs.
#
# IMPORTANT: Always build for linux/amd64. ECS Fargate runs linux/amd64.
# Building on Apple Silicon without --platform linux/amd64 produces an
# arm64 image that ECS cannot pull. This flag is mandatory, not optional.
#
# Usage:
#   ./infra/build-stubs.sh <aws-region>
#
# Example:
#   ./infra/build-stubs.sh us-east-1

set -euo pipefail

REGION="${1:?Usage: $0 <aws-region>}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building linux/amd64 stub images for ${REGISTRY}..."

aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin "${REGISTRY}"

docker buildx build \
  --platform linux/amd64 \
  --tag "${REGISTRY}/cello-directory:stub" \
  --tag "${REGISTRY}/cello-relay:stub" \
  --push \
  "${SCRIPT_DIR}/stub"

echo "Done. Stub images pushed:"
echo "  ${REGISTRY}/cello-directory:stub"
echo "  ${REGISTRY}/cello-relay:stub"
