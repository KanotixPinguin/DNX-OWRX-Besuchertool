#!/usr/bin/env bash
set -Eeuo pipefail
HERE=$(cd "$(dirname "$0")"&&pwd);CMD=${1:-help};CONTAINER=${CONTAINER:-owrx-8013}
"$HERE/DNX-Visitor-Module-Core.sh" "$@"
if [[ "$CMD" == "install" || "$CMD" == "update" || "$CMD" == "reapply" ]]; then "$HERE/install-role-column.sh"; fi
case "$CMD" in
 install|update|reapply)
  if command -v docker>/dev/null&&docker inspect "$CONTAINER">/dev/null 2>&1;then
   docker cp "$HERE/visitorstatus-account-linked.py" "$CONTAINER:/usr/lib/python3/dist-packages/owrx/controllers/visitorstatus.py"
   docker exec "$CONTAINER" python3 -m py_compile /usr/lib/python3/dist-packages/owrx/controllers/visitorstatus.py
   docker restart "$CONTAINER"
   echo 'Account-Verknüpfung für Besucheranzeige installiert (optional, signiert).'
  fi;;
esac
