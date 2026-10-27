#!/bin/bash
# Code/config rollback only. Keep all new project data and existing data intact.
set -euo pipefail
backup="${1:-$(cat /opt/backups/bookshell-projects-latest)}"
case "$backup" in /opt/backups/bookshell-projects-*) ;; *) echo "Unexpected backup path" >&2; exit 1;; esac
test -s "$backup/bookshell-code.tgz"
test -s "$backup/Caddyfile"
test -s "$backup/docker-compose.yml"
install -d -m 700 "$backup/pre-rollback"
cp /etc/caddy/Caddyfile "$backup/pre-rollback/Caddyfile"
cp /opt/bookshell-api/docker-compose.yml "$backup/pre-rollback/docker-compose.yml"
docker exec charly-stack-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc bookshell' > "$backup/pre-rollback/bookshell.dump"
caddy validate --config "$backup/Caddyfile" --adapter caddyfile
tar -xzf "$backup/bookshell-code.tgz" -C /opt
cp "$backup/Caddyfile" /etc/caddy/Caddyfile
cp "$backup/docker-compose.yml" /opt/bookshell-api/docker-compose.yml
docker compose -f /opt/bookshell-api/docker-compose.yml up -d --force-recreate --no-deps api
systemctl reload caddy
echo "Code and proxy restored. No database rows or project tables deleted."
