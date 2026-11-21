# DNX Besucher-/Benutzertool

Version 1.0.0 · MIT-Lizenz

> **Wichtiger Hinweis / Haftungsausschluss**
>
> Dieses Benutzertool ist ein rein privates, unabhängiges Hobbyprojekt. Es ist **kein Projekt, Produkt oder offizielles Plugin von OpenWebRX oder OpenWebRX+**. Es besteht keine Verbindung, Beauftragung, Partnerschaft, Unterstützung, Prüfung oder Empfehlung durch die Entwickler oder Rechteinhaber von OpenWebRX/OpenWebRX+. Der Autor handelt ausschließlich als privater Hobby-Anwender beziehungsweise unabhängiger Moderator und nicht als Vertreter des OpenWebRX-Projekts.
>
> Installation, Nutzung, Veränderung und Weitergabe erfolgen vollständig auf eigene Gefahr und Verantwortung des jeweiligen Anwenders. Soweit gesetzlich zulässig, übernimmt der Autor keine Haftung für direkte oder indirekte Schäden, Serverausfälle, Datenverlust, Sicherheitsprobleme, Fehlkonfigurationen, Datenschutzverstöße oder sonstige technische beziehungsweise rechtliche Folgen. Vor jeder Installation müssen Backups erstellt und Änderungen zuerst auf einem Testsystem geprüft werden. Dieser Hinweis ist keine Rechtsberatung.

## Beschreibung

Das DNX Besucher-/Benutzertool ist eine private Anpassung für vorhandene OpenWebRX+-Installationen. Es ergänzt das Receiver-Bedienfeld um eine Besucheranzeige und kann aktive Sitzungen mit Chatname, Profil, persönlicher Empfangsfrequenz, Modus und datenschutzfreundlicher Mehrfacherkennung darstellen.

## Funktionen

### Basisversion

- Besucheranzeige im Receiver-Panel
- aktuelle Nutzerzahl
- auf-/zuklappbarer Bereich
- Anzeige AN/AUS
- Ton AN/AUS
- Bildschirmmeldung AN/AUS
- Lautstärkeregler
- Klangwahl: Soft, Click, Digital und Retro
- mittige Meldung für vier Sekunden
- lokale Browser-Einstellungen

### Vollversion

Zusätzlich:

- JSON-Schnittstelle `/dnx-visitor-status.json`
- Tabelle aktiver Sitzungen
- Chatname; automatische Namen wie `User3` erscheinen als `Unbekannt`
- SDR-Gerät und Profil
- persönliche Abstimmfrequenz: `center_freq + offset_freq`
- Demodulationsmodus, beispielsweise NFM, USB oder DMR
- interne Erkennung von Mehrfachverbindungen derselben IP
- öffentliche Anzeige nur als neutrale Gruppe, beispielsweise `Gr.1 · 3×`
- mittige Meldung bei Frequenz- oder Moduswechsel

## Datenschutz

IP-Adressen werden in der Vollversion ausschließlich vorübergehend im Arbeitsspeicher des Servers zur Erkennung von Mehrfachverbindungen verwendet.

Nicht öffentlich ausgegeben werden:

- vollständige IP-Adressen
- gekürzte IP-Adressen
- IP-Hashes
- persistente Besucherkennungen

Mehrere Sitzungen derselben IP sind kein sicherer Beweis für dieselbe Person. Nutzer in einem Haushalt, Firmen- oder Schulnetz beziehungsweise hinter einem Proxy können dieselbe IP verwenden.

## Voraussetzungen

- OpenWebRX+ mit `htdocs/plugins/receiver/init.js`
- Python 3
- Root-Rechte
- für Docker: Docker-CLI und laufender OpenWebRX+-Container
- optional Node.js für JavaScript-Syntaxprüfung

## Installation

Datei ausführbar machen:

```bash
chmod +x DNX-Visitor-Module-All-in-One.sh
```

### Docker – Vollversion

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh install \
  --mode docker \
  --container owrx-8013 \
  --edition full
```

### Docker – Basisversion

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh install \
  --mode docker \
  --container owrx-8013 \
  --edition basic
```

### Native Installation

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh install \
  --mode native \
  --edition full
```

### Automatische Erkennung

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh install \
  --mode auto \
  --edition full
```

Eigene Pfade:

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh install \
  --mode native \
  --edition full \
  --plugin-init /PFAD/htdocs/plugins/receiver/init.js \
  --python-root /usr/lib/python3/dist-packages
```

## Nach der Installation

Docker kann 60–90 Sekunden benötigen, bis OpenWebRX+ wieder bereit ist. Zuerst in einem privaten Browserfenster testen. Bei Problemen Website-Daten und Cache löschen.

Endpunkt testen:

```bash
curl -s http://SERVER:PORT/dnx-visitor-status.json | python3 -m json.tool
```

## Bedienung

- `Besucher / User`: Bereich öffnen oder schließen
- `Anzeige`: Besucheranzeige aktivieren/deaktivieren
- `Ton`: Ereignistöne aktivieren/deaktivieren
- `Bildschirm`: mittige Meldungen aktivieren/deaktivieren
- `Lautst.`: Lautstärke ändern
- `Sound`: Klangcharakter wählen
- Tabelle: bei Bedarf horizontal/vertikal scrollen

Browser können Audio bis zur ersten Benutzerinteraktion blockieren. Ein Klick auf die Seite oder ein Soundwechsel gibt die Wiedergabe normalerweise frei.

## Verwaltung

Status:

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh status \
  --mode docker --container owrx-8013
```

Update:

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh update \
  --mode docker --container owrx-8013 --edition full
```

Backup:

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh backup \
  --mode docker --container owrx-8013
```

Nach einer Docker-Container-Neuerstellung:

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh reapply \
  --mode docker --container owrx-8013
```

## Entfernen

```bash
sudo ./DNX-Visitor-Module-All-in-One.sh uninstall \
  --mode docker --container owrx-8013
```

Backups bleiben erhalten.

## Fehlerdiagnose

### Firefox funktioniert, Chrome/Edge nicht

- privates Fenster testen
- Website-Daten und Cache löschen
- Script-/Werbeblocker deaktivieren
- Entwicklertools auf JavaScript-Fehler prüfen

### Frequenz ist `null`

Die betreffende Sitzung hat den DSP noch nicht gestartet. Nutzer muss Play drücken.

### Mehrfachgruppe enthält mehrere Personen

Das kann bei gemeinsamem Netzwerk, NAT oder Proxy normal sein. Die Gruppe ist keine Identitätsfeststellung.

## Dateien

Frontend:

```text
htdocs/plugins/receiver/init.js
```

Markierungen:

```text
/* DNX_VISITOR_MODULE_START */
/* DNX_VISITOR_MODULE_END */
```

Backend:

```text
owrx/controllers/dnxvisitorstatus.py
```

Öffentlicher Endpunkt:

```text
/dnx-visitor-status.json
```

## Unabhängigkeit

OpenWebRX und OpenWebRX+ sowie zugehörige Namen und Marken gehören den jeweiligen Rechteinhabern. Ihre Erwähnung dient nur zur Beschreibung der technischen Zielumgebung. Das Tool ist kein Bestandteil der offiziellen Distribution.

## Lizenz

MIT-Lizenz. Nutzung, Änderung und Weitergabe sind erlaubt; ohne Gewährleistung oder Haftung.

## Optionale Account-Verknüpfung

Die aktuelle Ausgabe erkennt – falls DNX Receiver Account Control installiert ist – signierte Accountnamen und Rollen. Reihenfolge: Accountname, sonst Chatname, sonst Gast 1/Gast 2/Gast 3. Ohne Account-Modul arbeitet das Besuchertool weiterhin selbstständig.

## Rollenanzeige

Die Besuchertabelle zeigt pro Sitzung die Rolle Gast, Chat, User, Erweitert oder Admin als farbiges Badge. Signierte Receiver-Accounts haben Vorrang vor Chatnamen; ohne Account und Chatname wird Gast N angezeigt.
