from owrx.controllers.template import WebpageController
from owrx.client import ClientRegistry
try:
    from owrx.dnx_access_verify import verify_identity
except Exception:
    def verify_identity(token):
        return None, 'guest'

from collections import Counter
import json
import re


class VisitorStatusController(WebpageController):
    """
    Öffentliche, datensparsame Besucherübersicht.

    IP-Adressen werden ausschließlich intern verwendet, um
    Mehrfachverbindungen zu erkennen. Sie werden weder direkt
    noch als Hashwert an den Browser übertragen.
    """

    @staticmethod
    def get_property(props, key, default=None):
        try:
            if props is not None and key in props:
                value = props[key]
                if value is not None:
                    return value
        except Exception:
            pass

        return default

    @staticmethod
    def get_frequency(client):
        """
        Persönliche Empfangsfrequenz des Clients:

            center_freq + offset_freq

        Solange offset_freq noch nicht gesetzt wurde, wird
        start_freq als Ausgangswert verwendet.
        """
        try:
            dsp = getattr(client, "dsp", None)

            if dsp is None:
                return None

            props = getattr(dsp, "props", None)

            if props is None:
                return None

            center = VisitorStatusController.get_property(
                props,
                "center_freq"
            )

            offset = VisitorStatusController.get_property(
                props,
                "offset_freq"
            )

            if center is not None and offset is not None:
                return int(center) + int(offset)

            start = VisitorStatusController.get_property(
                props,
                "start_freq"
            )

            if start is not None:
                return int(start)

            if center is not None:
                return int(center)

        except Exception:
            pass

        return None

    @staticmethod
    def get_mode(client):
        try:
            dsp = getattr(client, "dsp", None)

            if dsp is None:
                return ""

            props = getattr(dsp, "props", None)

            mode = VisitorStatusController.get_property(
                props,
                "mod"
            )

            if not mode:
                mode = VisitorStatusController.get_property(
                    props,
                    "start_mod"
                )

            mode = str(mode or "").strip().upper()

            # Für eine kompakte öffentliche Tabelle begrenzen.
            return mode[:16]

        except Exception:
            return ""

    @staticmethod
    def get_profile(client):
        try:
            sdr = getattr(client, "sdr", None)

            if sdr is None:
                return "Profil noch nicht bekannt"

            sdr_name = str(sdr.getName() or "").strip()[:60]
            profile_name = str(
                sdr.getProfileName() or ""
            ).strip()[:80]

            if sdr_name and profile_name:
                return sdr_name + " / " + profile_name

            if profile_name:
                return profile_name

            if sdr_name:
                return sdr_name

        except Exception:
            pass

        return "Profil noch nicht bekannt"

    def indexAction(self):
        registry = ClientRegistry.getSharedInstance()

        # Direkter Zugriff auf aktive Receiver-Clients ist nötig,
        # weil listAll() keine individuellen DSP-Werte enthält.
        clients = list(registry.clients)

        client_data = []

        for client in clients:
            try:
                ip = str(
                    registry.getIp(client.conn.handler)
                )
            except Exception:
                ip = ""

            account_name = None
            account_role = "guest"

            try:
                properties = getattr(
                    client,
                    "connectionProperties",
                    {}
                )

                account_name, account_role = verify_identity(
                    properties.get(
                        "dnx_account_token",
                        ""
                    )
                )
            except Exception:
                account_name = None
                account_role = "guest"

            chat_name = ""

            try:
                chat_entry = registry.chat.get(client, {})
                chat_name = str(
                    chat_entry.get("name", "")
                ).strip()[:32]
            except Exception:
                chat_name = ""

            if re.fullmatch(
                r"User\d+",
                chat_name,
                re.IGNORECASE
            ):
                chat_name = ""

            if account_name:
                name = account_name
                display_role = account_role
                name_source = "account"
            elif chat_name:
                name = chat_name
                display_role = "chat"
                name_source = "chat"
            else:
                name = ""
                display_role = "guest"
                name_source = "guest"

            client_data.append({
                "client": client,
                "ip": ip,
                "name": name,
                "role": display_role,
                "name_source": name_source,
                "profile": self.get_profile(client),
                "frequency": self.get_frequency(client),
                "mode": self.get_mode(client)
            })

        ip_counts = Counter(
            entry["ip"]
            for entry in client_data
            if entry["ip"]
        )

        duplicate_ips = sorted(
            [
                ip
                for ip, count in ip_counts.items()
                if count > 1
            ]
        )

        group_numbers = {
            ip: index + 1
            for index, ip in enumerate(duplicate_ips)
        }

        sessions = []
        public_names = []
        unknown = 0

        for index, entry in enumerate(
            client_data,
            start=1
        ):
            name = entry["name"]

            if name:
                public_names.append(name)
            else:
                unknown += 1
                name = "Gast " + str(unknown)

            ip = entry["ip"]
            duplicate_count = ip_counts.get(ip, 1)

            frequency = entry["frequency"]

            sessions.append({
                "number": index,
                "name": name,
                "role": entry.get("role", "guest"),
                "name_source": entry.get(
                    "name_source",
                    "guest"
                ),
                "profile": entry["profile"],
                "frequency": frequency,
                "mode": entry["mode"] or "—",
                "duplicate": duplicate_count > 1,
                "duplicate_count": (
                    duplicate_count
                    if duplicate_count > 1
                    else 1
                ),
                "group": (
                    group_numbers.get(ip)
                    if duplicate_count > 1
                    else None
                )
            })

        duplicate_connections = sorted(
            [
                count
                for count in ip_counts.values()
                if count > 1
            ],
            reverse=True
        )

        payload = {
            "count": len(client_data),
            "names": public_names,
            "unknown": unknown,
            "duplicate_connections": duplicate_connections,
            "sessions": sessions
        }

        self.send_response(
            json.dumps(
                payload,
                ensure_ascii=False,
                separators=(",", ":")
            ),
            content_type="application/json",
            code=200
        )
