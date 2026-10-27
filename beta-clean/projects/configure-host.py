"""Run as root on the inspected host, after its code/DB/Caddy/compose backup."""
from pathlib import Path
import subprocess

compose = Path('/opt/bookshell-api/docker-compose.yml')
source = compose.read_text()
mount = '      - /opt/bookshell/beta-clean/projects:/app/projects:ro\n'
if mount not in source:
    anchor = '      - /opt/bookshell/beta-clean/db/migrations:/app/db/migrations:ro\n'
    if anchor not in source:
        raise SystemExit('Unexpected compose layout; no changes applied')
    compose.write_text(source.replace(anchor, anchor + mount))

caddy = Path('/etc/caddy/Caddyfile')
source = caddy.read_text()
anchor = 'bookshell.charlydob.com {\n    root * /opt/bookshell/beta-clean\n'
routes = '''
    handle_path /projects-api/* {
        request_header X-Real-IP {remote_host}
        reverse_proxy 127.0.0.1:3002
    }
    @projectsSource path /projects/* /db/* /tests/* /package* /deploy-*
    respond @projectsSource 404
'''
if 'handle_path /projects-api/*' not in source:
    if anchor not in source:
        raise SystemExit('Unexpected Caddy layout; no changes applied')
    source = source.replace(anchor, anchor + routes)
if '\nmcp-bookshell.charlydob.com {' not in source:
    source += '''
# Bookshell Projects: direct single-owner Bookshell module and OAuth MCP.
mcp-bookshell.charlydob.com {
    encode gzip
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        Strict-Transport-Security "max-age=31536000"
    }
    @mcpRoutes path /mcp /oauth/* /.well-known/oauth-*
    handle @mcpRoutes {
        request_header X-Real-IP {remote_host}
        reverse_proxy 127.0.0.1:3002
    }
    handle {
        respond 404
    }
}
'''
staged = Path('/etc/caddy/Caddyfile.projects-staged')
staged.write_text(source)
subprocess.run(['caddy','validate','--config',str(staged),'--adapter','caddyfile'],check=True)
caddy.write_text(source)
print('Existing compose and Caddy extended; DNS unchanged.')
