#!/usr/bin/env bash
# One command to run Corvo locally with Docker: ./scripts/self-host.sh
#
# Checks Docker and the free ports, creates the env files with random secrets
# (only when missing), builds and starts everything, waits until it is healthy
# and prints the address and the next steps. Safe to run again.
#
#   ./scripts/self-host.sh            start (or update) the local stack
#   ./scripts/self-host.sh down       stop it (keeps your data)
#   ./scripts/self-host.sh reset      stop it and DELETE its data
#   ./scripts/self-host.sh logs       follow the logs
#
# Optional variables: WEB_PORT (4000), API_PORT (3000), COMPOSE_PROJECT_NAME.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE=deploy/.env.local
PROJECT="${COMPOSE_PROJECT_NAME:-corvo-nfse-local}"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE"
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml)

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

get_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
set_env() {
  local tmp
  tmp="$(mktemp)"
  sed "s#^$1=.*#$1=$2#" "$ENV_FILE" >"$tmp" && cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

ensure_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker Desktop and run this script again."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing. Update Docker or install the compose plugin."
}

case "${1:-up}" in
  down)
    ensure_docker; [ -f "$ENV_FILE" ] || fail "Nothing to stop: $ENV_FILE does not exist."
    "${COMPOSE[@]}" down; exit 0 ;;
  reset)
    ensure_docker; [ -f "$ENV_FILE" ] || fail "Nothing to reset: $ENV_FILE does not exist."
    "${COMPOSE[@]}" down -v; echo "Stack and data removed. $ENV_FILE was kept."; exit 0 ;;
  logs)
    ensure_docker; "${COMPOSE[@]}" logs -f --tail=100; exit 0 ;;
  up) ;;
  *) fail "Unknown command '$1'. Use: up (default), down, reset or logs." ;;
esac

say "Checking Docker"
ensure_docker

say "Preparing configuration"
if [ ! -f "$ENV_FILE" ]; then
  if command -v node >/dev/null 2>&1; then
    node scripts/setup-env.mjs
  else
    echo "Node.js not found; generating the files with Docker instead."
    docker run --rm -v "$PWD":/app -w /app node:24-alpine node scripts/setup-env.mjs
  fi
  [ -f "$ENV_FILE" ] || fail "Could not create $ENV_FILE."
  if [ -n "${WEB_PORT:-}" ]; then
    set_env WEB_PORT "$WEB_PORT"; set_env APP_ORIGIN "http://localhost:$WEB_PORT"
  fi
  if [ -n "${LOCALSTACK_PORT:-}" ]; then echo "LOCALSTACK_PORT=$LOCALSTACK_PORT" >>"$ENV_FILE"; fi
  if [ -n "${API_PORT:-}" ]; then
    set_env API_PORT "$API_PORT"; set_env PUBLIC_API_URL "http://localhost:$API_PORT"
  fi
else
  echo "Using existing $ENV_FILE."
fi

WEB_PORT_NOW="$(get_env WEB_PORT)"; WEB_PORT_NOW="${WEB_PORT_NOW:-4000}"
API_PORT_NOW="$(get_env API_PORT)"; API_PORT_NOW="${API_PORT_NOW:-3000}"
LS_PORT_NOW="$(get_env LOCALSTACK_PORT)"; LS_PORT_NOW="${LS_PORT_NOW:-${LOCALSTACK_PORT:-4566}}"

say "Checking free ports"
# On a re-run our own containers already hold the ports, which is fine.
if [ -z "$("${COMPOSE[@]}" ps -q 2>/dev/null)" ]; then
  busy=""
  for entry in "$WEB_PORT_NOW:WEB_PORT (dashboard)" "$API_PORT_NOW:API_PORT (API)" "$LS_PORT_NOW:LOCALSTACK_PORT (S3 storage)"; do
    port="${entry%%:*}"
    if port_in_use "$port"; then busy="$busy\n  - port $port is busy: ${entry#*:}"; fi
  done
  if [ -n "$busy" ]; then
    printf 'These ports are already in use:%b\n' "$busy" >&2
    fail "Stop what is using them. For the dashboard/API ports you can instead delete $ENV_FILE and run: WEB_PORT=14000 API_PORT=13000 ./scripts/self-host.sh"
  fi
fi

say "Building and starting (the first run takes several minutes: it compiles the app and the tax calculator)"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 600 || {
  echo >&2
  "${COMPOSE[@]}" ps -a >&2 || true
  fail "Startup failed. See the logs with: ./scripts/self-host.sh logs"
}

WEB_URL="$(get_env APP_ORIGIN)"
API_URL="$(get_env PUBLIC_API_URL)"
cat <<EOF

Corvo is running.

  Dashboard:   $WEB_URL
  API:         $API_URL/v1   (health: $API_URL/v1/health/ready)
  API docs:    $WEB_URL/en/docs

Next steps
  1. Open $WEB_URL and sign in with any email address.
  2. The sign-in code is not sent by email (no email provider is configured).
     It is printed in the logs; read it with:
       docker compose -p $PROJECT --env-file $ENV_FILE -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml logs --tail=20 worker
     To send real emails, set RESEND_API_KEY and EMAIL_FROM in $ENV_FILE and run this script again.
  3. Create a company in the TEST environment and issue a test invoice.

Other commands: ./scripts/self-host.sh logs | down | reset
Back up $ENV_FILE: it holds the keys that protect stored certificates.
EOF
