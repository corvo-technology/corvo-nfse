#!/bin/bash
set -e

# The official image already creates POSTGRES_USER and POSTGRES_DB.
# Only provision the separate database used by integration tests.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v test_db="${POSTGRES_TEST_DB:-corvo_test}" <<-'EOSQL'
    SELECT format('CREATE DATABASE %I', :'test_db')
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'test_db')
    \gexec
EOSQL
