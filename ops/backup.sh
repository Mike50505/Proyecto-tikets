#!/bin/sh
set -eu
umask 077
mkdir -p /backups
while true; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  target="/backups/tickets-${stamp}.dump"
  if pg_dump --format=custom --file="${target}.tmp" && pg_restore --list "${target}.tmp" >/dev/null; then
    mv "${target}.tmp" "$target"
    date +%s > /backups/last-success
    echo "Respaldo verificado: tickets-${stamp}.dump"
  else
    echo "Falló el respaldo; se reintentará en 60 segundos" >&2
    sleep 60
    continue
  fi
  sleep 86400
done
