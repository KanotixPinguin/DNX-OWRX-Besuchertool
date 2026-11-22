"""DNX: wer ist gerade da?  (abgeholt als /visitor-status.json)  [DNX-VISITORSTATUS-10]

Gehoert nicht zum Original-Image. Nach jedem Image-Update mit
ein eigenes Update-Skript auf dem Host wieder einsetzen.

Spalten des Blocks im Empfaenger:
    Nr. | Name | Rolle | Profil | Frequenz | Modus | Status
Der Name kommt - wenn angemeldet - aus dem Konto (Token der Zugangskontrolle),
sonst aus dem Chat-Namen, sonst "Gast <Nr.>". IP-Adressen stehen hier
absichtlich nicht: die sieht nur der Admin im Rechtsklick-Menue (aus /api/live).
"""
import base64
import hashlib
import hmac
import json
import logging
import math
import os
import sqlite3
import time
from urllib.parse import unquote as urllib_unquote

from owrx.client import ClientRegistry
from owrx.controllers.template import WebpageController

logger = logging.getLogger(__name__)

KONTEN_DB = "/var/lib/openwebrx/dnx-access-control/accounts.sqlite3"
KONTEN_VERZ = "/var/lib/openwebrx/dnx-access-control"
GEHEIMNIS = os.path.join(KONTEN_VERZ, "secret")

MODEN = {
    "nfm": "NFM", "wfm": "WFM", "am": "AM", "sam": "SAM", "fm": "FM",
    "lsb": "LSB", "usb": "USB", "cw": "CW", "drm": "DRM",
    "dsd": "DSD", "wspr": "WSPR", "ft8": "FT8", "rtty": "RTTY",
}

# Konto-Token -> (Benutzername, Rolle), damit nicht bei jedem Abruf (alle
# 1,5 s pro Besucher) in der Datenbank gewuehlt wird.
_KONTO_CACHE = {}
_KONTO_CACHE_ZEIT = 30.0


def token_pruefen(token):
    """Token der Zugangskontrolle pruefen - genau wie app.py ihn ausstellt.

    Aufbau:  base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))
    Im payload stehen schon Benutzername ("sub") und Rolle ("role").
    Ohne gueltige Unterschrift gilt der Besucher als Gast.
    """
    if not token or not isinstance(token, str) or "." not in token:
        return None
    try:
        raw, sig = token.rsplit(".", 1)
        if not raw or not sig:
            return None
        with open(GEHEIMNIS, "rb") as f:
            secret = f.read()
        erwartet = base64.urlsafe_b64encode(
            hmac.new(secret, raw.encode("utf-8"), hashlib.sha256).digest()
        ).rstrip(b"=")
        if not hmac.compare_digest(erwartet, sig.encode("utf-8")):
            return None
        roh = raw.encode("utf-8") + b"=" * (-len(raw) % 4)
        daten = json.loads(base64.urlsafe_b64decode(roh).decode("utf-8"))
        if int(daten.get("exp") or 0) < time.time():
            return None
        name = str(daten.get("sub") or "").strip()
        if not name:
            return None
        return (name, str(daten.get("role") or "user").strip().lower())
    except Exception as e:
        logger.debug("visitor-status token_pruefen(): " + str(e))
        return None


def rolle_aus_db(name):
    """Aktuelle Rolle aus der Datenbank - sie kann sich geaendert haben."""
    if not name or not os.path.exists(KONTEN_DB):
        return None
    try:
        db = sqlite3.connect("file:%s?mode=ro" % KONTEN_DB, uri=True, timeout=1.0)
        try:
            row = db.execute(
                "select role, status from users where username = ?", (name,)).fetchone()
            if row:
                if str(row[1] or "").lower() != "active":
                    return "guest"
                return str(row[0] or "").strip().lower() or None
        finally:
            db.close()
    except Exception as e:
        logger.debug("visitor-status rolle_aus_db(): " + str(e))
    return None


def konto(token):
    """Token der Zugangskontrolle in Benutzername und Rolle aufloesen."""
    if not token:
        return None
    jetzt = time.time()
    alt = _KONTO_CACHE.get(token)
    if alt and jetzt - alt[1] < _KONTO_CACHE_ZEIT:
        return alt[0]

    erg = token_pruefen(token)
    if erg:
        name, rolle = erg
        # Rolle aus der Datenbank hat Vorrang (kann sich geaendert haben)
        db_rolle = rolle_aus_db(name)
        if db_rolle:
            rolle = db_rolle
        if rolle == "guest":
            erg = None
        else:
            erg = (name, rolle)
    else:
        erg = None

    # Fruehere Fassung zur Sicherheit behalten: Token == Sitzungsnummer
    if not erg and os.path.exists(KONTEN_DB):
        try:
            db = sqlite3.connect("file:%s?mode=ro" % KONTEN_DB, uri=True, timeout=1.0)
            try:
                row = db.execute(
                    "select u.username, u.role from sessions s join users u on u.id = s.user_id"
                    " where s.id = ? and (s.expires is null or s.expires > ?)",
                    (token, int(jetzt))).fetchone()
                if row:
                    erg = (row[0], (row[1] or "").lower())
            finally:
                db.close()
        except Exception as e:
            logger.debug("visitor-status konto(): " + str(e))

    _KONTO_CACHE[token] = (erg, jetzt)
    if len(_KONTO_CACHE) > 500:
        _KONTO_CACHE.clear()
    return erg


def modus_von(dem):
    """Modus aus dem Ketten-Objekt ableiten (z.B. NfmChain -> NFM)."""
    m = getattr(dem, "name", None) or getattr(dem, "mode", None) or ""
    if not m:
        m = dem.__class__.__name__
    m = str(m).strip()
    for suf in ("Chain", "Demodulator", "Demod", "Decoder"):
        if m.endswith(suf) and len(m) > len(suf):
            m = m[: -len(suf)]
            break
    m = m.lower().strip("_ ")
    if not m:
        return "-"
    return MODEN.get(m, m.upper())


def in_hz(wert):
    """Manche Quellen rechnen in MHz (14.175), andere in Hz (24940000)."""
    try:
        w = float(wert)
    except Exception:
        return None
    if not math.isfinite(w) or w == 0:
        return None
    # Alles unter 100 MHz-fomartig? Nein: unter 100.000 wird als MHz gelesen.
    # (ULE-Profil 0,3 kHz = 0.0003 -> 300 Hz; 24,94 -> 24.940.000 Hz)
    return w * 1000000.0 if abs(w) < 100000.0 else w


def text_von(wert):
    """Immer eine Zeichenkette - alte Chat-Eintraege tragen auch Objekte."""
    if wert is None:
        return ""
    if isinstance(wert, dict):
        for k in ("text", "name", "username", "value"):
            v = wert.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""
    if isinstance(wert, (list, tuple)):
        for v in wert:
            t = text_von(v)
            if t:
                return t
        return ""
    try:
        return str(wert).strip()
    except Exception:
        return ""


def hz(frequenz):
    """438000000 -> '438.000.000 Hz'  (wie frueher im Block)."""
    try:
        return "{:,.0f} Hz".format(float(frequenz)).replace(",", ".")
    except Exception:
        return "-"



def vergleich_name(x):
    """Namen vergleichbar machen: Leerraum weg, Gross/Klein egal."""
    return "".join(str(x or "").split()).lower()


def vergleich_ip(x):
    """Adressen vergleichbar machen; ::ffff: vorm IPv4-Anteil entfernen."""
    x = str(x or "").strip()
    if x.startswith("::ffff:"):
        x = x[7:]
    return x


def eigene_nummer(sitzungen, request):
    """Welche Zeile gehoert dem Aufrufer dieses Abrufs?

    Ohne diese Zuordnung landet der Geraetestand eines Besuchers unter einem
    Zufallsschluessel und keine Zeile kann ihn finden. Zwei Merkmale helfen:

    1) dnxac_session-Cookie (Konto-Anmeldung) -> Zeile mit "angemeldet"
    2) dnx-sid-Cookie: hinterlaesst dnx_visitor_roles.js. Darin steht der
       Chatname, mit dem der Besucher in der Liste steht.

    Ist beides nicht eindeutig, bleibt es bei None - dann zeigt der Styler
    "kein Geraet", statt eine falsche Zeile zu behaupten.
    """
    # --- 1) Konto-Cookie: nur wenn genau eine Sitzung angemeldet ist -------
    try:
        sid = konto_cookie(request)
    except Exception:
        sid = ""
    if sid:
        angemeldet = [s for s in sitzungen if s.get("angemeldet")]
        if len(angemeldet) == 1:
            return angemeldet[0]["number"]

    # --- 2) dnx-sid-Cookie: enthaelt den Chatnamen -------------------------
    chat = ""
    try:
        roh = request.headers.get("Cookie") or ""
    except Exception:
        roh = ""
    for teil in str(roh).split(";"):
        teil = teil.strip()
        if teil.startswith("dnx-sid="):
            try:
                chat = urllib_unquote(teil.split("=", 1)[1].strip())
            except Exception:
                chat = teil.split("=", 1)[1].strip()
    # --- 3) Kennung aus dem Handshake ------------------------------------
    # Jede Browser-Seite schickt beim Verbinden ein Zufallswort als Cookie
    # "dnx-kennung" mit; connection.py merkt es sich an der Verbindung. Beim
    # Abruf schicken wir dasselbe Wort - damit ist die Zeile eindeutig, auch
    # wenn mehrere Tabs dieselbe Adresse haben.
    kenn = ""
    try:
        for teil in str(roh).split(";"):
            teil = teil.strip()
            if teil.startswith("dnx-kennung="):
                kenn = teil.split("=", 1)[1].strip()
    except Exception:
        kenn = ""
    if kenn:
        gleich = [s for s in sitzungen if str(s.get("_kennung") or "") == kenn]
        if len(gleich) == 1:
            return gleich[0]["number"]

    # --- 4) Verbindungsadresse ------------------------------------------
    # Der Server sieht, von welcher Adresse der Abruf kommt. Ist genau EINE
    # Sitzung von dieser Adresse da, ist das unsere Zeile. (Die Adresse wird
    # nie angezeigt - nur intern verglichen, Gastschutz bleibt.)
    try:
        rip = vergleich_ip(request.headers.get("X-Forwarded-For", "").split(",")[0])
        if not rip or rip == "127.0.0.1":
            rip = vergleich_ip(getattr(getattr(request, "remote", None), "ip", "") or "")
    except Exception:
        rip = ""
    if rip and rip not in ("", "?", "127.0.0.1", "::1"):
        gleich = [s for s in sitzungen
                  if vergleich_ip(s.get("_ip")) == rip]
        if len(gleich) == 1:
            return gleich[0]["number"]

    if chat:
        c = vergleich_name(chat)
        if c and not c.startswith("gast"):
            treffer = [s for s in sitzungen
                       if vergleich_name(s.get("name")) == c]
            if len(treffer) == 1:
                return treffer[0]["number"]
    return None


def konto_cookie(request):
    """Sitzungsnummer (dnxac_session) aus dem Cookie des Aufrufs."""
    roh = ""
    try:
        roh = request.headers.get("Cookie") or ""
    except Exception:
        try:
            roh = request.headers.get("cookie") or ""
        except Exception:
            roh = ""
    if not roh or "dnxac_session" not in roh:
        return ""
    for teil in roh.split(";"):
        teil = teil.strip()
        if teil.startswith("dnxac_session="):
            return teil.split("=", 1)[1].strip()
    return ""


def konto_server():
    """Adresse des Konto-Servers.

    Steht in konto-server.json, damit jeder Empfänger seinen eigenen Eintrag
    haben kann. Ohne Datei gilt der eigene Rechner (das ist 113).
    """
    pfad = os.path.join(KONTEN_VERZ, "konto-server.json")
    try:
        if os.path.exists(pfad):
            with open(pfad, encoding="utf-8") as f:
                d = json.load(f)
            host = str(d.get("host") or "").strip()
            port = int(d.get("port") or 8096)
            if host:
                return "http://%s:%d" % (host, port)
    except Exception as e:
        logger.debug("visitor-status konto_server(): " + str(e))
    return "http://127.0.0.1:8096"


def konto_aus_db(sid):
    """Rolle aus der eigenen Konten-Datenbank (nur 113 hat eine)."""
    if not sid or not os.path.exists(KONTEN_DB):
        return False
    jetzt = int(time.time())
    db = sqlite3.connect("file:%s?mode=ro" % KONTEN_DB, uri=True, timeout=1.0)
    try:
        row = db.execute(
            "select u.role, u.status from sessions s join users u on u.id = s.user_id"
            " where s.id = ? and (s.expires is null or s.expires = 0 or s.expires > ?)",
            (sid, jetzt)).fetchone()
    finally:
        db.close()
    if not row:
        return False
    return (str(row[0] or "").strip().lower() == "admin"
            and str(row[1] or "").strip().lower() == "active")


def konto_frage(sid):
    """Rolle beim Konto-Server erfragen (für Empfänger ohne eigene Datenbank).

    /api/me verlangt keine Grund-Anmeldung, nur ein gültiges Sitzungs-Cookie.
    """
    if not sid:
        return False
    try:
        import urllib.request
        req = urllib.request.Request(
            konto_server() + "/api/me",
            headers={"Cookie": "dnxac_session=" + sid})
        with urllib.request.urlopen(req, timeout=1.5) as antwort:
            d = json.loads(antwort.read().decode("utf-8") or "{}")
        return bool(d.get("user")) and str(d.get("role") or "").strip().lower() == "admin"
    except Exception as e:
        logger.debug("visitor-status konto_frage(): " + str(e))
        return False


_KONTO_ADMIN_CACHE = {}
_KONTO_ADMIN_DAUER = 30.0


def konto_admin(request):
    """Ist der Besucher am Konto-Server als Admin angemeldet?

    Erst die eigene Datenbank (schnell, 113), sonst der Konto-Server.
    Ergebnis wird kurz zwischengespeichert: der Block fragt alle 1,5 s.
    Ohne gültige Admin-Sitzung bleibt die IP-Spalte leer (Gastschutz).
    """
    sid = konto_cookie(request)
    if not sid:
        return False
    jetzt = time.time()
    alt = _KONTO_ADMIN_CACHE.get(sid)
    if alt and jetzt - alt[1] < _KONTO_ADMIN_DAUER:
        return alt[0]
    erg = False
    try:
        erg = konto_aus_db(sid)
    except Exception as e:
        logger.debug("visitor-status konto_aus_db(): " + str(e))
        erg = False
    if not erg:
        erg = konto_frage(sid)
    _KONTO_ADMIN_CACHE[sid] = (erg, jetzt)
    if len(_KONTO_ADMIN_CACHE) > 500:
        _KONTO_ADMIN_CACHE.clear()
    return erg


class VisitorStatusController(WebpageController):
    def indexAction(self):
        # [DNX-IP-SCHUTZ] IP-Adressen nur an angemeldete Admins herausgeben.
        # Gaeste (keine owrx-Session) bekommen das Feld leer - siehe
        # normalizeData()/String(session.ip || "-") im Styler: daraus wird "-".
        zeige_ip = False
        try:
            from owrx.controllers.admin import Authentication
            zeige_ip = Authentication().getUser(self.request) is not None
        except Exception as e:
            logger.debug("visitor-status: Rolle nicht pruefbar: " + str(e))
            zeige_ip = False
        if not zeige_ip:
            # Auch die Anmeldung am Konto-Server (Port 8096) gilt als Admin.
            zeige_ip = konto_admin(self.request)
        try:
            data = self.sammeln(zeige_ip, self.request)
        except Exception as e:
            logger.debug("visitor-status: " + str(e))
            data = {"count": 0, "sessions": []}
        self.send_response(json.dumps(data), content_type="application/json", code=200)

    @staticmethod
    def sammeln(zeige_ip=False, request=None):
        reg = ClientRegistry.getSharedInstance()
        clients = list(getattr(reg, "clients", None) or [])

        def ip_von(c):
            """Adresse des Besuchers; ::ffff: vorm IPv4-Anteil entfernen."""
            try:
                ip = reg.getIp(c.conn.handler)
            except Exception:
                return "?"
            ip = text_von(ip)
            if ip.startswith("::ffff:"):
                ip = ip[7:]
            return ip or "?"

        ips = {}
        for c in clients:
            ip = ip_von(c)
            ips[ip] = ips.get(ip, 0) + 1

        # Mehrfachverbindungen derselben Adresse bekommen eine Gruppennummer,
        # damit der Block wieder "Gr.1 · 3x" zeigen kann.
        gruppen = {}
        nummer_gruppe = 0
        for ip, n in ips.items():
            if n > 1:
                nummer_gruppe += 1
                gruppen[ip] = nummer_gruppe

        sitzungen = []
        nummer = 0
        gast_nr = 0
        for c in clients:
            nummer += 1
            ip = ip_von(c)

            # 1) Name und Rolle aus dem Konto (Token der Zugangskontrolle)
            name, rolle, bekannt = "", "guest", False
            try:
                try:  # DNX_TOKEN_SICHER: fehlt der Schluessel, darf der Ablauf nicht abbrechen
                    token = (getattr(c, "connectionProperties", None) or {}).get("dnx_account_token")
                except Exception:
                    token = None
            except Exception:
                token = None
            konto_daten = konto(token) if token else None
            if konto_daten:
                name, rolle = konto_daten[0], (konto_daten[1] or "user")
                bekannt = True

            # 2) sonst Chat-Name (kann auch ein Objekt sein -> text_von)
            if not name:
                try:
                    if c in reg.chat:
                        name = text_von(reg.chat[c].get("name"))
                        bekannt = bool(name)
                except Exception:
                    pass

            if not name:
                gast_nr += 1
                name = "Gast %d" % gast_nr
            if not rolle:
                rolle = "guest"

            profil = "-"
            try:
                if getattr(c, "sdr", None) is not None:
                    profil = c.sdr.getProfileName() or c.sdr.getName() or "-"
            except Exception:
                pass

            frequenz, modus = "-", "-"
            try:
                dsp = getattr(c, "dsp", None)
                if dsp is not None:
                    props = getattr(dsp, "props", None)
                    kette = getattr(dsp, "chain", None)

                    def wert(name):          # Eigenschaft aus dem Stapel holen
                        if props is None:
                            return None
                        try:
                            return props[name]
                        except Exception:
                            try:
                                return props.get(name)
                            except Exception:
                                return None

                    # --- Modus: gespeicherte Eigenschaft, sonst Klassenname ---
                    m = wert("mod")
                    if m:
                        modus = str(m).upper()
                    else:
                        dem = (getattr(kette, "demodulator", None)
                               or getattr(dsp, "demodulator", None)
                               or getattr(kette, "secondaryDemodulator", None))
                        if dem is not None:
                            modus = modus_von(dem) or "-"

                    # --- DNX_DIGI_MODUS: DIGI-Decoder mit anzeigen -----------------------
                    # Der Client setzt "secondary_mod" (z.B. "packet"), beim
                    # Beenden auf False. Erklaerung siehe digi_modus.py.
                    try:
                        digi = wert("secondary_mod")
                        digi = "" if digi is None else str(digi).strip()
                        if digi and digi.lower() not in ("false", "none", "0", "-"):
                            if modus in ("", "-"):
                                modus = digi.upper()
                            else:
                                modus = modus + " + " + digi.upper()
                            modus = modus[:24]   # DNX_DIGI_MODUS_24: 24 statt 16 Zeichen
                    except Exception:
                        pass

                    # --- Frequenz: Mitte der Quelle + Abstimm-Offset ---
                    mitte = None
                    try:
                        q = c.sdr.getProps()
                        try:
                            mitte = q["center_freq"]
                        except Exception:
                            mitte = q.get("center_freq")
                    except Exception:
                        mitte = None

                    # center_freq der Quelle ist immer Hz (Voreinstellung und
                    # Profile rechnen in Hz) - keine Umrechnung.
                    mitte_hz = None
                    try:
                        mitte_hz = float(mitte)
                        if not math.isfinite(mitte_hz):
                            mitte_hz = None
                    except Exception:
                        mitte_hz = None
                    if mitte_hz:
                        off = wert("offset_freq")
                        if off is None and kette is not None:
                            off = getattr(kette, "frequencyOffset", None)
                        try:
                            off = float(off or 0)
                        except Exception:
                            off = 0.0
                        # rohe Hz-Zahl: der Styler formatiert selbst
                        # (formatFrequency macht daraus "446.150.000 Hz")
                        frequenz = int(round(mitte_hz + off))
                    else:
                        # nur wenn die Quelle nichts liefert: direkt vom Demodulator
                        ab = None
                        for obj in (getattr(kette, "demodulator", None),
                                    getattr(dsp, "demodulator", None)):
                            if obj is not None and getattr(obj, "dialFrequency", None):
                                ab = obj.dialFrequency
                                break
                        ab_hz = in_hz(ab)
                        if ab_hz:
                            frequenz = int(round(ab_hz))
            except Exception:
                pass

            anzahl = ips.get(ip, 0)
            # Achtung: der Styler normalisiert die Daten vor dem Zeichnen
            # (publicName / formatFrequency / normalizeMode). Er erwartet
            # daher Rohwerte:
            #   name            = schlichte Zeichenkette
            #   frequency       = ganze Zahl in Hz
            #   duplicate_count = mit Unterstrich
            # [DNX-EIGENE-NUMMER] Merkmal aus dem WebSocket-Handshake.
            # Der Browser schickt beim Verbinden seine Cookies mit - darunter
            # dnx-kennung (Zufallswort je Browser). Damit ist die Zeile
            # eindeutig, ohne Zusatz-Nachrichten, die der Receiver waehrend
            # des Aufbaus verwerfen koennte.
            kenn = ""
            try:
                kenn = (getattr(c, "connectionProperties", None) or {}).get("dnx_kennung")
            except Exception:
                kenn = ""
            if not kenn:
                try:
                    hdrs = getattr(getattr(getattr(c, "conn", None), "handler", None), "headers", {}) or {}
                    roh_c = hdrs.get("Cookie") or hdrs.get("cookie") or ""
                    for teil in str(roh_c).split(";"):
                        teil = teil.strip()
                        if teil.startswith("dnx-kennung="):
                            kenn = teil.split("=", 1)[1].strip()
                            break
                except Exception:
                    kenn = ""
            kenn = text_von(kenn)
            sitzungen.append({
                "number": nummer,
                "name": text_von(name) or ("Gast %d" % nummer),
                "role": rolle,
                "profile": text_von(profil) or "-",
                "frequency": frequenz,
                "mode": modus,
                # [DNX-IP-SCHUTZ] nur fuer Admins, sonst leer
                "ip": (text_von(ip) or "-") if zeige_ip else "",
                "duplicate": anzahl > 1,
                "duplicate_count": anzahl,
                "duplicateCount": anzahl,
                "group": gruppen.get(ip, 0),
                "angemeldet": bool(token),
                # [DNX-EIGENE-NUMMER] nur intern fuer die Zuordnung
                "_ip": text_von(ip),
                "_kennung": kenn,
            })

        if not zeige_ip:
            # [DNX-STATUS-SCHUTZ] Mehrfachverbindungen sind nur fuer Admins.
            # Gaeste und User bekommen keine Gruppe und keine Anzahl - auch
            # nicht, wenn jemand die Datei direkt abruft.
            for s in sitzungen:
                s["duplicate"] = False
                s["duplicate_count"] = 0
                s["duplicateCount"] = 0
                s["group"] = 0

        # [DNX-EIGENE-NUMMER] Welche Zeile gehoert dem Aufrufer?
        eigene = None
        # Hilfsfeld _ip darf die Antwort nicht verlassen.
        try:
            eigene = eigene_nummer(sitzungen, request)
        except Exception as e:
            logger.debug("visitor-status eigene_nummer(): " + str(e))
        for s in sitzungen:
            s.pop("_ip", None)
            s.pop("_kennung", None)
        return {"count": len(sitzungen), "sessions": sitzungen,
                "ist_admin": bool(zeige_ip), "eigene": eigene}
