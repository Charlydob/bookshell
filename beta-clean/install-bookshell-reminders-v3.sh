#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Charlydob/bookshell/main/beta-clean"
API_DIR="/opt/bookshell-api"
N8N_CONTAINER="charly-stack-n8n-1"
PG_CONTAINER="charly-stack-postgres-1"
STAMP="$(date +%Y%m%d-%H%M%S)"
SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p -c 64)"

mkdir -p "$API_DIR/backups-reminders-v3"

echo "[1/7] Backup..."
cp "$API_DIR/server.js" "$API_DIR/backups-reminders-v3/server.js.$STAMP.bak"
cp "$API_DIR/docker-compose.yml" "$API_DIR/backups-reminders-v3/docker-compose.yml.$STAMP.bak"

echo "[2/7] Download backend + migration + workflow..."
curl -fsSL "$REPO_RAW/deploy-bookshell-api-server.js" \
  -o "$API_DIR/server.js.new"
curl -fsSL "$REPO_RAW/deploy-bookshell-reminders-migration.sql" \
  -o "$API_DIR/reminders-v3-migration.sql"
curl -fsSL "$REPO_RAW/deploy-bookshell-reminders-v3.json" \
  -o "$API_DIR/Bookshell-Reminders-v3-PostgreSQL.json"

echo "[3/7] Configure automation secret..."
python3 - "$API_DIR/docker-compose.yml" "$SECRET" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
secret = sys.argv[2]
text = path.read_text()

line = f"      BOOKSHELL_AUTOMATION_SECRET: {secret}"

if re.search(r"(?m)^\s*BOOKSHELL_AUTOMATION_SECRET\s*:", text):
    text = re.sub(
        r"(?m)^\s*BOOKSHELL_AUTOMATION_SECRET\s*:.*$",
        line,
        text,
        count=1,
    )
else:
    marker = "    environment:\n"
    if marker not in text:
        raise SystemExit("No encuentro el bloque environment: en docker-compose.yml")
    text = text.replace(marker, marker + line + "\n", 1)

path.write_text(text)
PY

python3 - "$API_DIR/Bookshell-Reminders-v3-PostgreSQL.json" "$SECRET" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
secret = sys.argv[2]
text = path.read_text()

if "__BOOKSHELL_AUTOMATION_SECRET__" not in text:
    raise SystemExit("El workflow no contiene el placeholder del secret")

path.write_text(text.replace("__BOOKSHELL_AUTOMATION_SECRET__", secret))
PY

chmod 600 "$API_DIR/Bookshell-Reminders-v3-PostgreSQL.json"

echo "[4/7] Validate backend JavaScript..."
# Node 22 infers the parser from the extension. Validate a temporary .cjs copy
# because the downloaded staging filename ends in .new.
cp "$API_DIR/server.js.new" "$API_DIR/server-check.cjs"
docker run --rm \
  -v "$API_DIR:/app" \
  -w /app \
  node:22-alpine \
  node --check server-check.cjs
rm -f "$API_DIR/server-check.cjs"

mv "$API_DIR/server.js.new" "$API_DIR/server.js"

echo "[5/7] Apply PostgreSQL migration..."
docker exec -i "$PG_CONTAINER" \
  psql -v ON_ERROR_STOP=1 \
  -U bookshell_app \
  -d bookshell \
  < "$API_DIR/reminders-v3-migration.sql"

echo "[6/7] Restart Bookshell API..."
cd "$API_DIR"
docker compose up -d --force-recreate api

for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3002/health >/tmp/bookshell-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:3002/health
echo

curl -fsS \
  -H "X-Bookshell-Automation-Secret: $SECRET" \
  "http://127.0.0.1:3002/automation/reminders?range=all&limit=1"
echo

echo "[7/7] Import n8n workflow (kept unpublished)..."
docker cp \
  "$API_DIR/Bookshell-Reminders-v3-PostgreSQL.json" \
  "$N8N_CONTAINER:/tmp/bookshell-reminders-v3.json"

docker exec -u node "$N8N_CONTAINER" \
  n8n import:workflow \
  --input=/tmp/bookshell-reminders-v3.json

docker exec "$N8N_CONTAINER" \
  rm -f /tmp/bookshell-reminders-v3.json || true

echo
echo "=============================================="
echo "BOOKSHELL REMINDERS V3 INSTALLED"
echo "=============================================="
echo "Backend: OK"
echo "PostgreSQL migration: OK"
echo "n8n workflow imported: Bookshell - Reminders v3 PostgreSQL"
echo
echo "IMPORTANT:"
echo "1. Open n8n."
echo "2. Open 'Bookshell - Reminders v3 PostgreSQL'."
echo "3. Publish/activate it."
echo "4. Do NOT import the older Reminders JSON."
echo
echo "Backup directory:"
echo "$API_DIR/backups-reminders-v3"
