#!/usr/bin/env bash
# DNX Visitor / User Module – private, unofficial hobby customization
# Independent installer, updater, status check, backup and uninstaller.
# Not an OpenWebRX/OpenWebRX+ project or official plugin. No affiliation or endorsement.
# Use entirely at your own risk. License: MIT
set -Eeuo pipefail

VERSION="1.0.0"
MODULE="dnx-visitor-module"
START_JS="/* DNX_VISITOR_MODULE_START */"
END_JS="/* DNX_VISITOR_MODULE_END */"
DEFAULT_CONTAINER="owrx-8013"
MODE="auto"
EDITION="full"
CONTAINER="$DEFAULT_CONTAINER"
PLUGIN_INIT=""
PYROOT=""
DRY_RUN=0
YES=0

log(){ printf '\033[1;36m[DNX]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[WARNUNG]\033[0m %s\n' "$*" >&2; }
die(){ printf '\033[1;31m[FEHLER]\033[0m %s\n' "$*" >&2; exit 1; }
need_root(){ [[ ${EUID:-$(id -u)} -eq 0 ]] || die "Bitte als root oder mit sudo ausführen."; }
run(){ if ((DRY_RUN)); then printf '[DRY-RUN] '; printf '%q ' "$@"; printf '\n'; else "$@"; fi; }
stamp(){ date +%F-%H%M%S; }

usage(){ cat <<'EOF'
DNX Visitor / User Module – private, inoffizielle Hobby-Anpassung

WICHTIGER HINWEIS:
  Rein privates Hobbyprojekt. Kein Projekt, Produkt oder offizielles Plugin von
  OpenWebRX oder OpenWebRX+. Keine Verbindung, Beauftragung, Unterstützung oder
  Empfehlung durch die OpenWebRX-/OpenWebRX+-Entwickler. Der Autor ist nur
  unabhängiger Hobby-Anwender/Moderator. Nutzung und Änderungen erfolgen
  vollständig auf eigene Gefahr. Soweit gesetzlich zulässig wird keine Haftung
  für Schäden, Ausfälle, Datenverlust, Fehlkonfigurationen oder Rechtsfolgen
  übernommen. Vorher Backups erstellen und zuerst auf einem Testsystem prüfen.

Aufruf:
  sudo ./dnx-visitor-module.sh BEFEHL [OPTIONEN]

Befehle:
  install       Modul installieren
  update        vorhandenes Modul durch diese Version ersetzen
  uninstall     Modul und Backend-Route entfernen
  status        Installation, Dateien und HTTP-Endpunkt prüfen
  backup        nur Backups der betroffenen Dateien erstellen
  restore DATEI ein init.js-Backup wiederherstellen
  reapply       Docker-Backend nach Container-Neuerstellung erneut einspielen
  help          diese Hilfe anzeigen

Optionen:
  --mode auto|docker|native     Installationsart (Standard: auto)
  --edition basic|full          basic: Anzahl/Alarm; full: Tabelle/Frequenz/Modus
  --container NAME              Docker-Container (Standard: owrx-8013)
  --plugin-init DATEI           Pfad zu htdocs/plugins/receiver/init.js
  --python-root VERZEICHNIS     Verzeichnis, das das Python-Paket owrx enthält
  --yes                         Rückfragen automatisch bestätigen
  --dry-run                     nur geplante Aktionen anzeigen
  --version                     Versionsnummer ausgeben

Beispiele:
  sudo ./dnx-visitor-module.sh install --mode docker --container owrx-8013 --edition full
  sudo ./dnx-visitor-module.sh install --mode native --edition basic
  sudo ./dnx-visitor-module.sh status --mode docker --container owrx-8013
  sudo ./dnx-visitor-module.sh uninstall --mode docker --container owrx-8013

Datenschutz:
  Die Vollversion benutzt IP-Adressen serverintern ausschließlich zur Erkennung
  von Mehrfachverbindungen. IP-Adressen und IP-Hashes werden niemals über den
  öffentlichen JSON-Endpunkt ausgegeben. Automatische Namen wie User3 werden
  als „Unbekannt“ angezeigt.

Wichtiger Docker-Hinweis:
  Python-Dateien im Container gehen bei einer Container-Neuerstellung verloren.
  Die persistenten Quelldateien werden unter /opt/dnx-visitor-module abgelegt.
  Danach genügt: sudo ./dnx-visitor-module.sh reapply --mode docker ...
EOF
}

parse(){
  COMMAND="${1:-help}"; [[ $# -gt 0 ]] && shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode) MODE="${2:?}"; shift 2;;
      --edition) EDITION="${2:?}"; shift 2;;
      --container) CONTAINER="${2:?}"; shift 2;;
      --plugin-init) PLUGIN_INIT="${2:?}"; shift 2;;
      --python-root) PYROOT="${2:?}"; shift 2;;
      --yes|-y) YES=1; shift;;
      --dry-run) DRY_RUN=1; shift;;
      --version) echo "$VERSION"; exit 0;;
      -h|--help) usage; exit 0;;
      *) EXTRA_ARGS+=("$1"); shift;;
    esac
  done
  [[ "$MODE" =~ ^(auto|docker|native)$ ]] || die "Ungültiger Modus: $MODE"
  [[ "$EDITION" =~ ^(basic|full)$ ]] || die "Ungültige Edition: $EDITION"
}

EXTRA_ARGS=()

detect_mode(){
  [[ "$MODE" != auto ]] && return
  if command -v docker >/dev/null 2>&1 && docker inspect "$CONTAINER" >/dev/null 2>&1; then MODE=docker; else MODE=native; fi
  log "Erkannter Modus: $MODE"
}

detect_paths(){
  detect_mode
  if [[ "$MODE" == docker ]]; then
    command -v docker >/dev/null || die "Docker fehlt."
    docker inspect "$CONTAINER" >/dev/null 2>&1 || die "Container '$CONTAINER' nicht gefunden."
    if [[ -z "$PLUGIN_INIT" ]]; then
      local source
      source="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/usr/lib/python3/dist-packages/htdocs/plugins"}}{{.Source}}{{end}}{{end}}')"
      [[ -n "$source" ]] || die "Plugin-Bind-Mount nicht gefunden; --plugin-init angeben."
      PLUGIN_INIT="$source/receiver/init.js"
    fi
    PYROOT="/usr/lib/python3/dist-packages"
  else
    if [[ -z "$PLUGIN_INIT" ]]; then
      for p in /usr/lib/python3/dist-packages/htdocs/plugins/receiver/init.js /usr/local/lib/python*/dist-packages/htdocs/plugins/receiver/init.js /opt/openwebrx/htdocs/plugins/receiver/init.js; do
        [[ -f $p ]] && { PLUGIN_INIT="$p"; break; }
      done
    fi
    [[ -n "$PLUGIN_INIT" && -f "$PLUGIN_INIT" ]] || die "Plugin-init.js nicht gefunden; --plugin-init angeben."
    if [[ -z "$PYROOT" ]]; then
      PYROOT="$(python3 - <<'PY' 2>/dev/null || true
import pathlib, owrx
print(pathlib.Path(owrx.__file__).resolve().parent.parent)
PY
)"
    fi
    [[ -n "$PYROOT" && -d "$PYROOT/owrx" ]] || die "Python-Paket owrx nicht gefunden; --python-root angeben."
  fi
  log "Plugin: $PLUGIN_INIT"
  log "Python: $PYROOT/owrx"
}

backup_file(){
  local f="$1"; [[ -e "$f" ]] || return 0
  local b="${f}.backup-${MODULE}-$(stamp)"
  run cp -a "$f" "$b"; log "Backup: $b"
}

write_controller(){
  local out="$1"
  cat >"$out" <<'PY'
from owrx.controllers.template import WebpageController
from owrx.client import ClientRegistry
from collections import Counter
import json, re

class DnxVisitorStatusController(WebpageController):
    @staticmethod
    def prop(props, key, default=None):
        try:
            return props[key] if props is not None and key in props and props[key] is not None else default
        except Exception:
            return default

    @classmethod
    def frequency(cls, client):
        try:
            props = client.dsp.props if client.dsp is not None else None
            center = cls.prop(props, "center_freq")
            offset = cls.prop(props, "offset_freq")
            if center is not None and offset is not None: return int(center) + int(offset)
            start = cls.prop(props, "start_freq")
            return int(start if start is not None else center) if (start is not None or center is not None) else None
        except Exception:
            return None

    @classmethod
    def mode(cls, client):
        try:
            props = client.dsp.props if client.dsp is not None else None
            return str(cls.prop(props,"mod",cls.prop(props,"start_mod","")) or "").upper()[:16]
        except Exception:
            return ""

    @staticmethod
    def profile(client):
        try:
            sdr=client.sdr
            if sdr is None: return "Profil noch nicht bekannt"
            a=str(sdr.getName() or "")[:60]; b=str(sdr.getProfileName() or "")[:80]
            return " / ".join(x for x in (a,b) if x) or "Profil noch nicht bekannt"
        except Exception:
            return "Profil noch nicht bekannt"

    def indexAction(self):
        reg=ClientRegistry.getSharedInstance(); rows=[]
        for client in list(reg.clients):
            try: ip=str(reg.getIp(client.conn.handler))
            except Exception: ip=""
            try: name=str(reg.chat.get(client,{}).get("name","")).strip()[:32]
            except Exception: name=""
            if re.fullmatch(r"User\d+",name,re.I): name=""
            rows.append({"client":client,"ip":ip,"name":name})
        counts=Counter(r["ip"] for r in rows if r["ip"])
        dup_ips=sorted(ip for ip,n in counts.items() if n>1)
        groups={ip:i+1 for i,ip in enumerate(dup_ips)}
        sessions=[]
        for i,r in enumerate(rows,1):
            n=counts.get(r["ip"],1); c=r["client"]
            sessions.append({"number":i,"name":r["name"] or "Unbekannt","profile":self.profile(c),
              "frequency":self.frequency(c),"mode":self.mode(c) or "—","duplicate":n>1,
              "duplicate_count":n if n>1 else 1,"group":groups.get(r["ip"]) if n>1 else None})
        payload={"count":len(rows),"names":[r["name"] for r in rows if r["name"]],
          "unknown":sum(1 for r in rows if not r["name"]),
          "duplicate_connections":sorted([n for n in counts.values() if n>1],reverse=True),"sessions":sessions}
        self.send_response(json.dumps(payload,ensure_ascii=False,separators=(",",":")),content_type="application/json",code=200)
PY
}

write_frontend(){
  local out="$1"
  cat >"$out" <<'JS'
/* DNX_VISITOR_MODULE_START */
(function(){"use strict";
if(window.__dnxVisitorPublicModule)return; window.__dnxVisitorPublicModule=true;
var FULL=__DNX_FULL__, URL="/dnx-visitor-status.json", previous=null, timer=null;
var settings={enabled:true,sound:true,overlay:true,volume:35,tone:"Soft",opacity:88};
try{Object.assign(settings,JSON.parse(localStorage.getItem("dnx.visitor.public.v1")||"{}"));}catch(e){}
settings.enabled=settings.sound=settings.overlay=true;
function save(){try{localStorage.setItem("dnx.visitor.public.v1",JSON.stringify(settings));}catch(e){}}
function style(){if(document.getElementById("dnx-visitor-public-style"))return;var s=document.createElement("style");s.id="dnx-visitor-public-style";s.textContent=`
#dnx-visitor-public{margin:0 0 8px;padding:8px;border:1px solid #38eaff;border-radius:9px;background:#24343bdd;color:#fff;font:12px Arial;box-sizing:border-box}
#dnx-visitor-public *{box-sizing:border-box}.dvp-title{font-weight:900;cursor:pointer}.dvp-body{margin-top:7px}.dvp-controls{display:flex;flex-wrap:wrap;gap:5px}.dvp-controls label{padding:4px;background:#0004;border-radius:5px}.dvp-display{text-align:center;margin-top:7px;padding:8px;background:#0006;border-radius:7px}.dvp-big{font-size:19px;font-weight:900}.dvp-table-scroll{overflow:auto;max-height:190px;margin-top:7px}.dvp-table{border-collapse:collapse;width:620px;font-size:10px}.dvp-table th,.dvp-table td{padding:4px;border-bottom:1px solid #ffffff22;white-space:nowrap;text-align:left}.dvp-table th{color:#9eefff}.dvp-dup{color:#ff9b9b;font-weight:900}
#dnx-visitor-public-overlay{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;width:min(88vw,680px);padding:25px;border:3px solid #37eaff;border-radius:20px;background:#062f3ff2;color:#fff;text-align:center;font-family:Arial;box-shadow:0 0 40px #20ddffbb;display:none;cursor:pointer}.dvp-o-user{font-size:27px;font-weight:900;color:#8fffb2}.dvp-o-action{font-size:30px;font-weight:900;margin-top:8px}.dvp-o-freq{font-size:34px;font-weight:900;color:#fff36a;margin-top:8px}.dvp-o-mode{font-size:22px;font-weight:900;color:#8feaff;margin-top:7px}
`;document.head.appendChild(s)}
function fmt(v){v=parseInt(v,10);return Number.isFinite(v)&&v>0?v.toLocaleString("de-DE")+" Hz":"—"}
function audio(kind){if(!settings.sound)return;try{var A=window.AudioContext||window.webkitAudioContext,c=new A(),o=c.createOscillator(),g=c.createGain();o.type=settings.tone==="Digital"?"sawtooth":settings.tone==="Click"?"square":settings.tone==="Retro"?"triangle":"sine";o.frequency.value=kind==="leave"?440:880;g.gain.value=Math.max(.001,settings.volume/100*.12);o.connect(g);g.connect(c.destination);o.start();g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.25);o.stop(c.currentTime+.27)}catch(e){}}
function ensure(){var panel=document.getElementById("openwebrx-panel-receiver");if(!panel)return null;var b=document.getElementById("dnx-visitor-public");if(b)return b;b=document.createElement("div");b.id="dnx-visitor-public";b.innerHTML='<div class="dvp-title">▾ Besucher / User</div><div class="dvp-body"><div class="dvp-controls"><label><input class="dvp-enable" type="checkbox" checked> Anzeige</label><label><input class="dvp-sound" type="checkbox" checked> Ton</label><label><input class="dvp-overlay" type="checkbox" checked> Bildschirm</label><label>Lautst. <input class="dvp-volume" type="range" min="0" max="100" value="35"></label><label>Sound <select class="dvp-tone"><option>Soft</option><option>Click</option><option>Digital</option><option>Retro</option></select></label></div><div class="dvp-display"><div class="dvp-big">Besucheranzeige aktiv</div><div class="dvp-count">Nutzerzahl wird ermittelt</div></div><div class="dvp-table-scroll"></div></div>';
var fx=document.getElementById("dnx-fx-box-inline")||document.getElementById("dnx-fx-box");panel.insertBefore(b,fx&&fx.parentNode===panel?fx:panel.firstChild);var body=b.querySelector(".dvp-body"),title=b.querySelector(".dvp-title");title.onclick=function(){var hide=body.style.display!=="none";body.style.display=hide?"none":"";title.textContent=(hide?"▸":"▾")+" Besucher / User"};
[[".dvp-enable","enabled"],[".dvp-sound","sound"],[".dvp-overlay","overlay"]].forEach(function(x){var e=b.querySelector(x[0]);e.checked=settings[x[1]];e.onchange=function(){settings[x[1]]=e.checked;save()}});var v=b.querySelector(".dvp-volume");v.value=settings.volume;v.oninput=function(){settings.volume=+v.value;save()};var t=b.querySelector(".dvp-tone");t.value=settings.tone;t.onchange=function(){settings.tone=t.value;save();audio("join")};return b}
function overlay(session,action){if(!settings.enabled||!settings.overlay)return;var o=document.getElementById("dnx-visitor-public-overlay");if(!o){o=document.createElement("div");o.id="dnx-visitor-public-overlay";o.onclick=function(){o.style.display="none"};document.body.appendChild(o)}o.style.opacity=settings.opacity/100;o.innerHTML='<div class="dvp-o-user"></div><div class="dvp-o-action"></div><div class="dvp-o-freq"></div><div class="dvp-o-mode"></div>';o.querySelector(".dvp-o-user").textContent=session.name||"Unbekannt";o.querySelector(".dvp-o-action").textContent=action;o.querySelector(".dvp-o-freq").textContent=fmt(session.frequency);o.querySelector(".dvp-o-mode").textContent=session.mode||"—";o.style.display="block";clearTimeout(timer);timer=setTimeout(function(){o.style.display="none"},4000)}
function render(data){var b=ensure();if(!b)return;b.querySelector(".dvp-count").textContent="Jetzt "+data.count+" Nutzer";if(!FULL)return;var holder=b.querySelector(".dvp-table-scroll"),table=document.createElement("table");table.className="dvp-table";table.innerHTML="<thead><tr><th>Nr.</th><th>Name</th><th>Profil</th><th>Frequenz</th><th>Modus</th><th>Status</th></tr></thead><tbody></tbody>";var tb=table.querySelector("tbody");(data.sessions||[]).forEach(function(s){var tr=document.createElement("tr");[s.number,s.name,s.profile,fmt(s.frequency),s.mode,s.duplicate?("Gr."+s.group+" · "+s.duplicate_count+"×"):"Einzeln"].forEach(function(v,i){var td=document.createElement("td");td.textContent=v;if(i===5&&s.duplicate)td.className="dvp-dup";tr.appendChild(td)});tb.appendChild(tr)});holder.textContent="";holder.appendChild(table);
var now={};(data.sessions||[]).forEach(function(s){now[s.number]=s});if(previous){Object.keys(now).some(function(k){var a=previous[k],n=now[k];if(!a)return false;if(a.frequency!==n.frequency||a.mode!==n.mode){overlay(n,a.frequency!==n.frequency&&a.mode!==n.mode?"FREQUENZ UND MODUS GEÄNDERT":a.mode!==n.mode?"MODUS GEÄNDERT":"FREQUENZ GEÄNDERT");return true}return false})}previous=now}
async function poll(){ensure();if(!FULL){var e=document.querySelector("#openwebrx-bar-clients .openwebrx-progressbar-text")||document.getElementById("openwebrx-bar-clients");if(e){var m=e.textContent.match(/\[\s*(\d+)\s*\]|(?:clients?|users?|nutzer)\D*(\d+)/i);if(m)render({count:+(m[1]||m[2])})}return}try{var r=await fetch(URL+"?t="+Date.now(),{cache:"no-store"});if(r.ok)render(await r.json())}catch(e){console.debug("DNX visitor",e)}}
style();if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){poll();setInterval(poll,2000)},{once:true});else{poll();setInterval(poll,2000)}})();
/* DNX_VISITOR_MODULE_END */
JS
  sed -i "s/__DNX_FULL__/$([[ "$EDITION" == full ]] && echo true || echo false)/" "$out"
}

patch_text_file(){
  local file="$1" kind="$2"; backup_file "$file"
  python3 - "$file" "$kind" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); kind=sys.argv[2]; t=p.read_text()
if kind=="remove-js":
 a="/* DNX_VISITOR_MODULE_START */"; b="/* DNX_VISITOR_MODULE_END */"
 if a in t and b in t:
  x,y=t.split(a,1); _,z=y.split(b,1); t=x+z
elif kind=="remove-http":
 t=t.replace("from owrx.controllers.dnxvisitorstatus import DnxVisitorStatusController\n","")
 t=t.replace('            StaticRoute("/dnx-visitor-status.json", DnxVisitorStatusController),\n',"")
p.write_text(t)
PY
}

install_frontend(){
  local tmp; tmp=$(mktemp); write_frontend "$tmp"
  patch_text_file "$PLUGIN_INIT" remove-js
  run sh -c 'cat "$1" >> "$2"' sh "$tmp" "$PLUGIN_INIT"
  rm -f "$tmp"
  command -v node >/dev/null 2>&1 && node --check "$PLUGIN_INIT"
}

install_backend_native(){
  local ctrl="$PYROOT/owrx/controllers/dnxvisitorstatus.py" http="$PYROOT/owrx/http.py" tmp; tmp=$(mktemp); write_controller "$tmp"
  backup_file "$ctrl"; backup_file "$http"; run install -m 0644 "$tmp" "$ctrl"; rm -f "$tmp"
  python3 - "$http" <<'PY'
from pathlib import Path
p=Path(__import__('sys').argv[1]);t=p.read_text();imp='from owrx.controllers.dnxvisitorstatus import DnxVisitorStatusController';route='            StaticRoute("/dnx-visitor-status.json", DnxVisitorStatusController),'
if imp not in t:t=t.replace('from owrx.controllers.clients import ClientController','from owrx.controllers.clients import ClientController\n'+imp,1)
if route not in t:t=t.replace('            StaticRoute("/clients", ClientController),',route+'\n            StaticRoute("/clients", ClientController),',1)
p.write_text(t)
PY
  python3 -m py_compile "$ctrl" "$http"
}

persist_dir(){ echo "/opt/dnx-visitor-module"; }
install_backend_docker(){
  local dir tmp; dir=$(persist_dir); run mkdir -p "$dir"; tmp=$(mktemp); write_controller "$tmp"; run cp "$tmp" "$dir/dnxvisitorstatus.py"; rm -f "$tmp"
  run docker cp "$dir/dnxvisitorstatus.py" "$CONTAINER:$PYROOT/owrx/controllers/dnxvisitorstatus.py"
  docker exec -i "$CONTAINER" python3 - <<'PY'
from pathlib import Path
p=Path('/usr/lib/python3/dist-packages/owrx/http.py');t=p.read_text();imp='from owrx.controllers.dnxvisitorstatus import DnxVisitorStatusController';route='            StaticRoute("/dnx-visitor-status.json", DnxVisitorStatusController),'
if imp not in t:t=t.replace('from owrx.controllers.clients import ClientController','from owrx.controllers.clients import ClientController\n'+imp,1)
if route not in t:t=t.replace('            StaticRoute("/clients", ClientController),',route+'\n            StaticRoute("/clients", ClientController),',1)
p.write_text(t)
PY
  run docker exec "$CONTAINER" python3 -m py_compile "$PYROOT/owrx/controllers/dnxvisitorstatus.py" "$PYROOT/owrx/http.py"
}

restart_owrx(){
  if [[ "$MODE" == docker ]]; then run docker restart "$CONTAINER"; log "Docker kann 60–90 Sekunden bis healthy benötigen.";
  else
    if command -v systemctl >/dev/null && systemctl list-unit-files | grep -q '^openwebrx'; then run systemctl restart openwebrx; else warn "OpenWebRX bitte manuell neu starten."; fi
  fi
}

install_cmd(){ need_root; detect_paths; install_frontend; if [[ "$EDITION" == full ]]; then [[ "$MODE" == docker ]] && install_backend_docker || install_backend_native; fi; restart_owrx; log "Installation abgeschlossen: Edition $EDITION, Version $VERSION"; }

uninstall_cmd(){
  need_root; detect_paths; patch_text_file "$PLUGIN_INIT" remove-js
  if [[ "$MODE" == docker ]]; then
    docker exec -i "$CONTAINER" python3 - <<'PY'
from pathlib import Path
p=Path('/usr/lib/python3/dist-packages/owrx/http.py');t=p.read_text();t=t.replace('from owrx.controllers.dnxvisitorstatus import DnxVisitorStatusController\n','').replace('            StaticRoute("/dnx-visitor-status.json", DnxVisitorStatusController),\n','');p.write_text(t)
PY
    run docker exec "$CONTAINER" rm -f "$PYROOT/owrx/controllers/dnxvisitorstatus.py"; run rm -rf "$(persist_dir)"
  else
    patch_text_file "$PYROOT/owrx/http.py" remove-http; run rm -f "$PYROOT/owrx/controllers/dnxvisitorstatus.py"
  fi
  restart_owrx; log "Modul entfernt. Backups bleiben erhalten."
}

status_cmd(){
  detect_paths; echo "Version: $VERSION"; echo "Modus: $MODE"; echo "Plugin: $PLUGIN_INIT"; grep -qF "$START_JS" "$PLUGIN_INIT" && echo "Frontend: installiert" || echo "Frontend: nicht installiert"
  if [[ "$MODE" == docker ]]; then docker exec "$CONTAINER" grep -q DnxVisitorStatusController "$PYROOT/owrx/http.py" && echo "Backend: installiert" || echo "Backend: nicht installiert"; docker ps --filter name="$CONTAINER" --format 'Container: {{.Status}}'; else grep -q DnxVisitorStatusController "$PYROOT/owrx/http.py" && echo "Backend: installiert" || echo "Backend: nicht installiert"; fi
}

backup_cmd(){ need_root; detect_paths; backup_file "$PLUGIN_INIT"; if [[ "$MODE" == native ]]; then backup_file "$PYROOT/owrx/http.py"; fi; }
restore_cmd(){ need_root; detect_paths; [[ ${#EXTRA_ARGS[@]} -ge 1 ]] || die "restore benötigt eine Backup-Datei."; [[ -f ${EXTRA_ARGS[0]} ]] || die "Backup nicht gefunden."; backup_file "$PLUGIN_INIT"; run cp -a "${EXTRA_ARGS[0]}" "$PLUGIN_INIT"; restart_owrx; }
reapply_cmd(){ need_root; detect_paths; [[ "$MODE" == docker ]] || die "reapply ist nur für Docker."; install_backend_docker; restart_owrx; }

parse "$@"
case "$COMMAND" in
  install) install_cmd;; update) install_cmd;; uninstall) uninstall_cmd;; status) status_cmd;; backup) backup_cmd;; restore) restore_cmd;; reapply) reapply_cmd;; help) usage;; *) usage; die "Unbekannter Befehl: $COMMAND";;
esac
