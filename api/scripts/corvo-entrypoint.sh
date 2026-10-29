#!/bin/sh
set -eu

# A command passed to the container (e.g. the migrations job) wins over the role.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

case "${CORVO_RUNTIME_ROLE:-api}" in
  api)
    # Applies pending migrations before the API accepts traffic. Only runs when
    # MIGRATION_DATABASE_URL is set (a user allowed to change the schema); the
    # Compose setup applies migrations in its own `migrations` service instead.
    if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
      node node_modules/typeorm/cli.js migration:run -d dist/infra/database/data-source.js
    fi
    exec node dist/main.js
    ;;
  worker)
    exec node dist/main.worker.js
    ;;
  *)
    echo "CORVO_RUNTIME_ROLE must be api or worker; received: ${CORVO_RUNTIME_ROLE:-<empty>}" >&2
    exit 64
    ;;
esac
