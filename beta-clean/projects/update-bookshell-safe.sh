#!/usr/bin/env bash
# Single-host deployment: retain active Compose overrides and additive DB changes.
set -euo pipefail
TASK_REPO=/opt/bookshell
TASK_API=/opt/bookshell-api
TASK_CONTAINER=bookshell-api-api-1
TASK_TARGET=origin/main
TASK_CHECK=0
while (($#)); do
  case "$1" in
    --ref) TASK_TARGET="$2"; shift 2 ;;
    --check) TASK_CHECK=1; shift ;;
    *) echo 'Use update-bookshell [--ref existing-ref] [--check]' >&2; exit 2 ;;
  esac
done
cd "$TASK_REPO"
test -z "$(git status --porcelain)" || { echo 'Uncommitted production changes: inspect before deploying.' >&2; exit 1; }
git fetch origin main
TASK_BEFORE=$(git rev-parse HEAD)
TASK_AFTER=$(git rev-parse --verify "$TASK_TARGET^{commit}")
git merge-base --is-ancestor "$TASK_BEFORE" "$TASK_AFTER" || { echo 'Refusing an implicit rollback. Preserve the deployed branch and review the target.' >&2; exit 1; }
test -z "$(git diff --name-only "$TASK_BEFORE" "$TASK_AFTER" -- beta-clean/db/migrations)" || { echo 'Migration changes require an explicit reviewed migration step; no migration was replayed.' >&2; exit 1; }
TASK_FILES=$(docker inspect "$TASK_CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
TASK_PROJECT=$(docker inspect "$TASK_CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
test -n "$TASK_PROJECT" && test -n "$TASK_FILES"
TASK_COMPOSE=(docker compose -p "$TASK_PROJECT")
IFS=',' read -r -a TASK_CONFIGS <<< "$TASK_FILES"
for TASK_FILE in "${TASK_CONFIGS[@]}"; do test -f "$TASK_FILE"; TASK_COMPOSE+=(-f "$TASK_FILE"); done
# Compare resolved flags to the running API without printing environment secrets.
TASK_CONFIG_TMP=$(mktemp)
TASK_INSPECT_TMP=$(mktemp)
trap 'rm -f "$TASK_CONFIG_TMP" "$TASK_INSPECT_TMP"' EXIT
"${TASK_COMPOSE[@]}" config --format json > "$TASK_CONFIG_TMP"
docker inspect "$TASK_CONTAINER" > "$TASK_INSPECT_TMP"
python3 - "$TASK_CONFIG_TMP" "$TASK_INSPECT_TMP" <<'PY'
import json,sys
desired=json.load(open(sys.argv[1]))['services']['api']['environment']
actual=dict(v.split('=',1) for v in json.load(open(sys.argv[2]))[0]['Config']['Env'])
for key in ['BOOKSHELL_WEB_AUTH_MODE','BOOKSHELL_JARVIS_V2_ENABLED','BOOKSHELL_TELEGRAM_RETIRED','BOOKSHELL_EXPLICIT_NOTIFICATION_CHANNELS']:
    assert str(desired.get(key,'') or '')==actual.get(key,''),'Active service flag drift: '+key
PY
if ((TASK_CHECK)); then echo 'Deployment checks passed; code and database unchanged.'; exit 0; fi
TASK_BACKUP="$TASK_API/backups-deploy-$(date -u +%Y%m%dT%H%M%SZ)"
install -m 700 -d "$TASK_BACKUP"
docker exec charly-stack-postgres-1 pg_dump -U n8n -d bookshell -Fc > "$TASK_BACKUP/bookshell.dump"
docker exec -i charly-stack-postgres-1 pg_restore --list < "$TASK_BACKUP/bookshell.dump" > /dev/null
git branch "rollback/deploy-$(date -u +%Y%m%dT%H%M%SZ)" "$TASK_BEFORE"
printf '%s\n' "$TASK_BEFORE" > "$TASK_BACKUP/previous-commit"
printf '%s\n' "$TASK_FILES" > "$TASK_BACKUP/compose-files"
git switch --detach "$TASK_AFTER"
if ! git diff --quiet "$TASK_BEFORE" "$TASK_AFTER" -- beta-clean/package-lock.json; then
  "${TASK_COMPOSE[@]}" run --rm --no-deps api npm ci --ignore-scripts --no-audit --no-fund
fi
"${TASK_COMPOSE[@]}" run --rm --no-deps api node --check server.js
"${TASK_COMPOSE[@]}" up -d --force-recreate --no-deps --no-build --pull never api
for TASK_ATTEMPT in {1..40}; do
  if curl -fsS http://127.0.0.1:3002/health > "$TASK_BACKUP/health.json"; then
    if python3 -c 'import json,sys;h=json.load(open(sys.argv[1]));assert h.get("ok") and h.get("auth")=="required"' "$TASK_BACKUP/health.json"; then
      echo "Bookshell deployed: $TASK_AFTER; prior commit: $TASK_BEFORE; active overrides retained; migrations unchanged."
      exit 0
    fi
  fi
  sleep 1
done
echo "Health verification failed. Roll back code to $TASK_BEFORE with the same Compose files; preserve current database writes. Backup: $TASK_BACKUP" >&2
exit 1
