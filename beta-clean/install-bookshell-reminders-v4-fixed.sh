#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: ejecuta como root (sudo -i)"
  exit 1
fi

API_DIR="/opt/bookshell-api"
STACK_DIR="/opt/charly-stack"
N8N_CONTAINER="charly-stack-n8n-1"
V3="$API_DIR/Bookshell-Reminders-v3-PostgreSQL.json"
V4="$API_DIR/Bookshell-Reminders-v4-fixed-PostgreSQL.json"
PATCH_URL="https://raw.githubusercontent.com/Charlydob/bookshell/fff5c0eef1ff0eca9e13f3d80adbd51ca08ae0f0/beta-clean/upgrade-bookshell-reminders-v4.py"
PATCH="/tmp/upgrade-bookshell-reminders-v4.py"

if [ ! -f "$V3" ]; then
  echo "ERROR: no encuentro $V3"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$API_DIR/backups-reminders-v4-fixed"
cp "$V3" "$API_DIR/backups-reminders-v4-fixed/v3-$STAMP.json"
cp "$API_DIR/docker-compose.yml" "$API_DIR/backups-reminders-v4-fixed/bookshell-compose-$STAMP.yml"
cp "$STACK_DIR/docker-compose.yml" "$API_DIR/backups-reminders-v4-fixed/charly-stack-compose-$STAMP.yml"

echo "[1/7] Preparando secret único compartido..."

SECRET="$(
python3 - <<'PY'
from pathlib import Path
import re, secrets
p=Path("/opt/bookshell-api/docker-compose.yml")
t=p.read_text()
m=re.search(r'(?m)^\s*BOOKSHELL_AUTOMATION_SECRET\s*:\s*(.+?)\s*$',t)
if m:
    s=m.group(1).strip().strip('"').strip("'")
    if s:
        print(s)
        raise SystemExit
print(secrets.token_hex(32))
PY
)"

echo "[2/7] Guardando el mismo secret en Bookshell y n8n..."

python3 - "$SECRET" <<'PY'
from pathlib import Path
import re, sys

secret=sys.argv[1]

def patch_compose(path, service):
    p=Path(path)
    lines=p.read_text().splitlines()
    start=None
    svc_indent=None
    for i,line in enumerate(lines):
        m=re.match(r'^(\s*)'+re.escape(service)+r':\s*$', line)
        if m:
            start=i
            svc_indent=len(m.group(1))
            break
    if start is None:
        raise SystemExit(f"No encuentro servicio {service} en {path}")
    end=len(lines)
    for i in range(start+1,len(lines)):
        if not lines[i].strip():
            continue
        indent=len(lines[i])-len(lines[i].lstrip())
        if indent<=svc_indent:
            end=i
            break

    env_idx=None
    for i in range(start+1,end):
        if re.match(r'^\s*environment:\s*$', lines[i]) and (len(lines[i])-len(lines[i].lstrip()) == svc_indent+2):
            env_idx=i
            break

    key="BOOKSHELL_AUTOMATION_SECRET"
    if env_idx is None:
        lines.insert(start+1, " "*(svc_indent+2)+"environment:")
        lines.insert(start+2, " "*(svc_indent+4)+f"{key}: {secret}")
    else:
        env_indent=svc_indent+2
        child_indent=svc_indent+4
        j=env_idx+1
        env_end=end
        while j < len(lines):
            if lines[j].strip():
                indent=len(lines[j])-len(lines[j].lstrip())
                if indent<=env_indent:
                    env_end=j
                    break
            j+=1
        list_style=False
        for i in range(env_idx+1,env_end):
            if re.match(r'^\s*-\s+',lines[i]):
                list_style=True
                break
        found=False
        for i in range(env_idx+1,env_end):
            if list_style:
                if re.match(r'^\s*-\s*'+re.escape(key)+r'=',lines[i]):
                    lines[i]=" "*child_indent+f"- {key}={secret}"
                    found=True
                    break
            else:
                if re.match(r'^\s*'+re.escape(key)+r'\s*:',lines[i]):
                    lines[i]=" "*child_indent+f"{key}: {secret}"
                    found=True
                    break
        if not found:
            lines.insert(env_idx+1, " "*child_indent+(f"- {key}={secret}" if list_style else f"{key}: {secret}"))

    p.write_text("\n".join(lines)+"\n")

patch_compose("/opt/bookshell-api/docker-compose.yml","api")
patch_compose("/opt/charly-stack/docker-compose.yml","n8n")
PY

echo "[3/7] Generando V4 encima del V3 actual..."
curl -fsSL "$PATCH_URL" -o "$PATCH"
python3 "$PATCH" "$V3" "$V4"

python3 - "$V4" <<'PY'
import json,sys
p=sys.argv[1]
wf=json.load(open(p))
wf["name"]="Bookshell - Reminders v4 FIXED PostgreSQL"
wf["active"]=False
for node in wf.get("nodes",[]):
    node.pop("webhookId",None)
    for h in node.get("parameters",{}).get("headerParameters",{}).get("parameters",[]):
        if str(h.get("name","")).strip().lower()=="x-bookshell-automation-secret":
            h["value"]="={{ $env.BOOKSHELL_AUTOMATION_SECRET }}"
wf.pop("id",None)
wf.pop("versionId",None)
json.dump(wf,open(p,"w"),ensure_ascii=False,indent=2)
PY

python3 -m json.tool "$V4" >/dev/null

echo "[4/7] Reiniciando Bookshell y n8n con el secret centralizado..."
cd "$API_DIR"
docker compose up -d --force-recreate api >/dev/null

cd "$STACK_DIR"
docker compose up -d --force-recreate n8n >/dev/null

echo "Esperando servicios..."
for i in $(seq 1 30); do
  if docker exec "$N8N_CONTAINER" sh -lc 'test -n "$BOOKSHELL_AUTOMATION_SECRET"' 2>/dev/null && \
     curl -fsS http://127.0.0.1:3002/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "[5/7] Probando n8n -> Bookshell con la variable compartida..."
docker exec "$N8N_CONTAINER" node -e '
const s=process.env.BOOKSHELL_AUTOMATION_SECRET;
if(!s){console.error("ENV VACÍA");process.exit(2)}
fetch("http://bookshell-api-api-1:3002/automation/reminders?range=all&limit=1",{
  headers:{"X-Bookshell-Automation-Secret":s}
}).then(async r=>{
  console.log("HTTP",r.status);
  console.log(await r.text());
  if(!r.ok) process.exit(1);
}).catch(e=>{console.error(e);process.exit(1)})
'

echo "[6/7] Importando V4 FIXED..."
docker cp "$V4" "$N8N_CONTAINER:/tmp/bookshell-v4-fixed.json" >/dev/null
docker exec -u 0 "$N8N_CONTAINER" sh -c 'chown node:node /tmp/bookshell-v4-fixed.json && chmod 600 /tmp/bookshell-v4-fixed.json'
docker exec -u node "$N8N_CONTAINER" n8n import:workflow --input=/tmp/bookshell-v4-fixed.json
docker exec -u 0 "$N8N_CONTAINER" rm -f /tmp/bookshell-v4-fixed.json

echo "[7/7] Limpieza..."
rm -f "$PATCH"

echo
echo "===================================================="
echo "BOOKSHELL REMINDERS V4 FIXED IMPORTED"
echo "===================================================="
echo "El secret ya NO está incrustado en el workflow."
echo "Bookshell y n8n usan BOOKSHELL_AUTOMATION_SECRET."
echo
echo "En n8n:"
echo "1. Deja V3 desactivado."
echo "2. Activa 'Bookshell - Reminders v4 FIXED PostgreSQL'."
echo "3. Prueba /comandos."
echo
echo "Backup: $API_DIR/backups-reminders-v4-fixed"
