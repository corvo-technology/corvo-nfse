#!/usr/bin/env bash
# Creates the local S3 bucket in LocalStack (idempotent).
# Usage: yarn storage:bucket
set -euo pipefail

cd "$(dirname "$0")/.."
# .env is not shell-safe, so read only the keys we need
env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
STORAGE_S3_BUCKET="${STORAGE_S3_BUCKET:-$(env_get STORAGE_S3_BUCKET)}"
STORAGE_S3_ENDPOINT="${STORAGE_S3_ENDPOINT:-$(env_get STORAGE_S3_ENDPOINT)}"
LOCALSTACK_PORT="${LOCALSTACK_PORT:-$(env_get LOCALSTACK_PORT)}"

BUCKET="${STORAGE_S3_BUCKET:-corvo-nfse}"
ENDPOINT="${STORAGE_S3_ENDPOINT:-http://localhost:${LOCALSTACK_PORT:-4566}}"

export AWS_ACCESS_KEY_ID="${STORAGE_S3_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${STORAGE_S3_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${STORAGE_S3_REGION:-us-east-1}"

echo "Waiting for S3 at $ENDPOINT..."
until curl -fs "$ENDPOINT/_localstack/health" | grep -Eq '"s3": "(available|running)"'; do
  sleep 2
done

if docker compose exec -T localstack awslocal s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "Bucket '$BUCKET' already exists"
else
  docker compose exec -T localstack awslocal s3 mb "s3://$BUCKET"
  echo "Bucket '$BUCKET' created"
fi
