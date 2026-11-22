# DNX OWRX Besuchertool (`v1.3.2`)

<!-- DNX-DISCLAIMER-START -->
> **Wichtiger Hinweis / Vollständige Distanzierung (Hobby-Mod-Mode)**
>
> - **Vollständige Distanzierung:** Ich distanziere mich in jeder Hinsicht vollständig vom Projekt **OpenWebRX / OpenWebRX+** sowie dessen Entwicklern und Betreibern. Es besteht keinerlei Verbindung, Zusammenarbeit, Prüfung, Befürwortung oder Partnerschaft.
> - **Keine öffentlichen/offiziellen OpenWebRX-Plugins (nur Mod-Mode):** Bei diesem Projekt handelt es sich ausdrücklich **nicht** um ein öffentliches oder offizielles Plugin von OpenWebRX, sondern ausschließlich um einen privaten, inoffiziellen **Mod-Mode** (Eigenmodifikation).
> - **Warum bewusst kein reines Browser-JavaScript (Mod-Mode-Architektur):** Viele Funktionen (z. B. serverseitige Speicherung, Konten-/Rollenverwaltung, Profil-Synchronisation, VNC-/websockify-Brücken, geschützte Schnittstellen, Docker-/Systemintegration und stabile UI-Anpassungen) lassen sich sauber und sicher nicht allein über simples Client-JavaScript umsetzen, ohne den OpenWebRX-Kern umzubauen oder Browsergrenzen zu umgehen. Deshalb setzt dieses Projekt bewusst auf getrennte Begleitmodule, Shell-Installer und Dienste im **Mod-Mode** statt alles künstlich in reines JavaScript zu pressen.
> - **Kein öffentlicher Support & keine Haftung:** Es gibt **keinen öffentlichen Support**, keine Garantie und keine Haftung. Nutzung, Installation und Anpassung erfolgen vollständig auf eigene Gefahr (immer vorher Backups anlegen und zunächst im eigenen Testsystem prüfen).
> - **Reines Hobbyprojekt – frei nutzbar, änderbar & verbreitbar:** Dieses Projekt entsteht ausschließlich aus reinem Hobby und Interesse am gemeinsamen Funk-/SDR-Hobby. Es steht ausdrücklich frei zur Verfügung und darf frei genutzt, weiterverbreitet, verändert und verbessert werden.
<!-- DNX-DISCLAIMER-END -->

<!-- DNX-PREVIEW-START -->
## Live-Vorschau

![Live-Vorschau — DNX OWRX Besuchertool](docs/preview.png)
<!-- DNX-PREVIEW-END -->

Besucheranzeige mit Accountname/Rolle, Marker-Spalte, Live-Funkgerät-Spalte sowie gehärteter `DNX Update-Wache v3.12` (9 Sprachen, strikt servergeprüftes Admin-Update-Panel).

## Neu in v1.3.2

- **`dnx_styler.js` (`v6.10`) + `dnx_stand.txt` (`v6.10 1001775`):** Unterstützung der 3-Geräte-Umschaltung (`Funkgerät 1 / 2 / 3` + Mausradtausch `1 ⇄ 2 ⇄ 3`) auf dem aktuellen Serverstand.
- **`dnx_update_wache.js` (`v3.12`):**
  - Streng serverseitige Admin-Prüfung über `api/me` (`:8095 / :8096 / :8091`); entfernte URL-/LocalStorage-Hintertüren (`?updateadmin=1`, `dnx.update.kasten.wer`, `dnx_betreiber`) werden aktiv bereinigt — Gäste und normale User können das `⚡ Jetzt starten`-Bedienfeld nie mehr sehen.
  - Automatische Re-Prüfung bei Fokus/Seitenwechsel (bei Abmeldung verschwindet das Admin-Panel sofort).
  - Besucher-Update-Karten (`Neue Fassung verfügbar`, `Update fertig`, Countdown + Betreibertext in 9 Sprachen) bleiben für alle Besucher voll aktiv.
- **`visitorstatus.py`:**
  - Lock-freies Lesen von `getattr(c, "dsp", None)` verhindert seltene Server-Deadlocks beim Auslesen aktiver Empfänger.
  - Zusätzlicher `Cookie`-Header-Fallback für `dnx-kennung` bei WebSocket-Handshakes, damit die eigene Zeile (`eigene`) auf allen Browsern zuverlässig erkannt wird.

## Dateien im Paket (`besuchertool/`)

| Datei | Ziel | Zweck |
|---|---|---|
| `visitorstatus.py` | `/usr/lib/python3/dist-packages/owrx/controllers/visitorstatus.py` (im Container/System) | Besucherliste + Feld `eigene` + Cookie-Fallback |
| `dnx_update_wache.js` | `…/htdocs/plugins/receiver/dnx_update_wache.js` | Update-Wache `v3.12` (Admin-gesichert) |
| `dnx_styler.js` | `…/htdocs/plugins/receiver/dnx_styler.js` | Anzeige der Besucherliste, Kennungswort (`v6.10`) |
| `dnx_stand.txt` | `…/htdocs/plugins/receiver/dnx_stand.txt` | Versions-/Größenstempel (`v6.10 1001775`) |
| `index.html` | `…/htdocs/index.html` (Vorlage) | Lädt `dnx_update_wache.js?v=20261121b` |

**Wichtig:** Nach Austausch von `visitorstatus.py` den OpenWebRX-Container bzw. Dienst einmal neu starten (`docker restart <container>`). Vorher Sicherungen anlegen (`cp <ziel> <ziel>.bak-<datum>`).

## Voraussetzungen

- Kompatible OpenWebRX+-Installation
- Zustandsdienst auf Port `8099` (`DNX Remote VIEW`) für die Funkgerät-Spalte und globale Update-Flags
- `dnx-access-control` (`api/me`) für Admin-Rollenerkennung im Update-Panel

## Rechtlicher Hinweis / Disclaimer

**DE:** Private, inoffizielle Hobby-Anpassung (Mod-Mode) für OpenWebRX / OpenWebRX+. Kein offizielles OpenWebRX- oder OpenWebRX+-Projekt, keine Verbindung zu oder Unterstützung durch die jeweiligen Entwickler. Nutzung erfolgt vollständig auf eigene Gefahr; soweit gesetzlich zulässig wird jede Haftung ausgeschlossen. Vor dem Einspielen bitte Sicherungen anlegen.

**EN:** Private, unofficial hobby modification (Mod-Mode) for OpenWebRX / OpenWebRX+. Not an official OpenWebRX or OpenWebRX+ project; no affiliation with or support from its maintainers. Use entirely at your own risk; to the extent permitted by law, no liability is accepted. Always create backups before installing.