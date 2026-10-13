#!/usr/bin/env bash
set -euo pipefail

if ! awslocal s3api head-bucket --bucket corvo-nfse >/dev/null 2>&1; then
  awslocal s3api create-bucket --bucket corvo-nfse
fi
