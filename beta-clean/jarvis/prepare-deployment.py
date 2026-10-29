"""Prepare candidate files only. Never deploys or changes the active configuration."""
import argparse, hashlib, json, os
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--caddy", required=True)
p.add_argument("--compose", required=True)
p.add_argument("--output", required=True)
a = p.parse_args()
source = Path(a.caddy).read_text()
marker = "@projectsSource path /projects/* /db/* /tests/* /package* /deploy-*"
if source.count(marker) != 1:
    raise SystemExit("Caddy configuration changed: review the source protection manually")
out = Path(a.output)
out.mkdir(mode=0o700, parents=True, exist_ok=False)
os.chmod(out, 0o700)
(out / "Caddyfile.candidate").write_text(source.replace(marker, marker.replace("/db/*", "/jarvis/* /db/*")))
for mode in ("observe", "required"):
    override = {"services": {"api": {
        "environment": {"BOOKSHELL_WEB_AUTH_MODE": mode, "BOOKSHELL_JARVIS_V2_ENABLED": "1" if mode == "required" else "0"},
        "volumes": ["/opt/bookshell/beta-clean/jarvis:/app/jarvis:ro"]
    }}}
    (out / ("compose." + mode + ".json")).write_text(json.dumps(override, indent=2))
manifest = {"sourceSha256": {str(Path(f)): hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (a.caddy, a.compose)}, "productionApplied": False}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2))
print("Candidate files prepared; no service, database or active configuration was changed.")
