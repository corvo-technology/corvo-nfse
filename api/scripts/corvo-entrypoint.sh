#!/bin/sh
set -eu

# A command passed to the container (e.g. the migrations job) wins over the role.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

case "${CORVO_RUNTIME_ROLE:-api}" in
  api)
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
