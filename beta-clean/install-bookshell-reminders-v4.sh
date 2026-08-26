#!/usr/bin/env bash
set -euo pipefail

API_DIR="/opt/bookshell-api"
N8N_CONTAINER="charly-stack-n8n-1"
RAW="https://raw.githubusercontent.com/Charlydob/bookshell/5098dcff356649e6072150513bc4bf0777b6fb05/beta-clean"
SRC="$API_DIR/Bookshell-Reminders-v3-PostgreSQL.json"
DST="$API_DIR/Bookshell-Reminders-v4-PostgreSQL.json"
PATCH="/tmp/upgrade-bookshell-reminders-v4.py"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$SRC" ]; then
  echo "ERROR: no encuentro $SRC"
  exit 1
fi

mkdir -p "$API_DIR/backups-reminders-v4"
cp "$SRC" "$API_DIR/backups-reminders-v4/Bookshell-Reminders-v3.$STAMP.json"

curl -fsSL "$RAW/upgrade-bookshell-reminders-v4.py" -o "$PATCH"
python3 "$PATCH" "$SRC" "$DST"
python3 -m json.tool "$DST" >/dev/null

SECRET="$(python3 - "$DST" <<'PY'
import json, sys
x=json.load(open(sys.argv[1]))
for n in x.get('nodes',[]):
    for h in n.get('parameters',{}).get('headerParameters',{}).get('parameters',[]):
        if str(h.get('name','')).lower() == 'x-bookshell-automation-secret':
            print(str(h.get('value','')).strip())
            raise SystemExit
raise SystemExit('No encuentro el automation secret en el workflow v4')
PY
)"

python3 - "$API_DIR/docker-compose.yml" "$SECRET" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); secret=sys.argv[2]; t=p.read_text()
pat=r'(?m)^(\s*BOOKSHELL_AUTOMATION_SECRET\s*:\s*).*$'
if not re.search(pat,t):
    raise SystemExit('No encuentro BOOKSHELL_AUTOMATION_SECRET en docker-compose.yml')
t=re.sub(pat,lambda m:m.group(1)+secret,t,count=1)
p.write_text(t)
PY

cd "$API_DIR"
docker compose up -d --force-recreate api >/dev/null

for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3002/health >/dev/null 2>&1; then break; fi
  sleep 1
done

docker cp "$DST" "$N8N_CONTAINER:/tmp/bookshell-reminders-v4.json" >/dev/null
docker exec -u 0 "$N8N_CONTAINER" sh -c 'chown node:node /tmp/bookshell-reminders-v4.json && chmod 600 /tmp/bookshell-reminders-v4.json'
docker exec -u node "$N8N_CONTAINER" n8n import:workflow --input=/tmp/bookshell-reminders-v4.json
docker exec -u 0 "$N8N_CONTAINER" rm -f /tmp/bookshell-reminders-v4.json
rm -f "$PATCH"

echo
echo "=============================================="
echo "BOOKSHELL REMINDERS V4 IMPORTED"
echo "=============================================="
echo "No reminder data was deleted or migrated."
echo "1. Desactiva Bookshell - Reminders v3 PostgreSQL"
echo "2. Activa Bookshell - Reminders v4 PostgreSQL"
echo "3. Prueba /comandos en Telegram"
