#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]]||exit 1
HERE=$(cd "$(dirname "$0")"&&pwd);CONTAINER=${CONTAINER:-owrx-8013};SRC=$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/usr/lib/python3/dist-packages/htdocs/plugins"}}{{.Source}}{{end}}{{end}}');INIT="$SRC/receiver/init.js";DEST="$SRC/receiver/dnx_visitor_roles";mkdir -p "$DEST";cp "$HERE/dnx_visitor_roles.js" "$DEST/"
python3 - "$INIT" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);t=p.read_text();a='/* DNX_VISITOR_ROLES_START */';b='/* DNX_VISITOR_ROLES_END */'
if a in t and b in t:x,y=t.split(a,1);_,z=y.split(b,1);t=x+z
t+='''\n/* DNX_VISITOR_ROLES_START */\n(function(){if(window.__dnxVisitorRolesLoader)return;window.__dnxVisitorRolesLoader=true;var s=document.createElement("script");s.src="/static/plugins/receiver/dnx_visitor_roles/dnx_visitor_roles.js";document.head.appendChild(s)})();\n/* DNX_VISITOR_ROLES_END */\n''';p.write_text(t)
PY
docker restart "$CONTAINER"
