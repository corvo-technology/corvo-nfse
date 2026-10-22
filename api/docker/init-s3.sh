#!/bin/bash
set -e

# Create the corvo-nfse S3 bucket using awslocal (LocalStack's AWS CLI wrapper)
awslocal s3 mb s3://corvo-nfse

echo "LocalStack S3 bucket 'corvo-nfse' created successfully"
