/* DNX Update-Wache (v3.12) ----------------------------------------------------
   EINE Meldung fuer alles - egal ob Funkgeraete, Ton, Bedienung oder ein
   neu hinzugebautes Projekt. Wird direkt aus index.html geladen, also auch
   bei Besuchern, bei denen der Styler gar nicht erst ankommt.

   Admin-Bedienung dauerhaft unten links (mit Minimieren):
   - "Bei mir jetzt starten" / "Bei allen jetzt starten"
   - Wahlweise "Ohne Meldung" (sofortiger stiller Reload ohne Serverneustart-Hinweis)
     oder "Mit Meldung" (Hinweis-Karte + optionaler Text + Countdown).

   Gemeinsamer Zustand: Port 8099 wie die Funk-Spalte
   GET  /load_user/dnxupdate      POST /save_user/dnxupdate
   Testhaken: window.__dnxUpdatePruefen()  window.__dnxUpdateFlag()
------------------------------------------------------------------------------ */
(function(){
  "use strict";
  if(window.__dnxUpdateWache){ return; }
  window.__dnxUpdateWache = true;

  var STAND = "/static/plugins/receiver/dnx_stand.txt";
  var WEG = "dnx.update.weg";          /* Stand, den der Besucher weggeklickt hat */
  var GESEHEN = "dnx.update.gesehen";  /* ts des letzten "alle neu laden" */
  var TAKT = 180000;                   /* Stand-Datei alle 3 min */
  var FLAG_TAKT = 10000;               /* Update-Flag alle 10 s (> COUNTDOWN) */
  var STUMM = 20000;                   /* so lange darf der Styler brauchen */
  var COUNTDOWN = 6;                   /* Sekunden Vorlauf vor dem Neuladen */
  var start = Date.now();

  var BASIS = (function(){ try{ return location.protocol + "//" + location.hostname + ":8099"; }catch(e){ return ""; } })();
  var FLAG = "dnxupdate";
  var MIN_KEY = "dnx.update.kasten.min";
  var OHNE_KEY = "dnx.update.ohne_meldung"; /* "1" = Ohne Meldung (Standard), "0" = Mit Meldung */
  var TESTLAUF = false;                 /* eigene Probe: Karte nur hier zeigen */
  var WARTE = null;                     /* eigene Karte kommt nach dem Abschluss */
  var apiPruefungLaeuft = false;
  var istAdminAktiv = false;
  var adminUser = "";

  var karte = null, knopf = null, panel = null;
  var serverStand = "", meldung = "", variante = "", flag = null, ticker = null, flagLaeuft = false;
  var erledigtTs = 0;

  function lesen(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function schreiben(k, v){ try{ if(v === null){ localStorage.removeItem(k); } else { localStorage.setItem(k, v); } }catch(e){} }
  function urlV(){
    try{
      var m = String(location.search || "").match(/[?&]v=([0-9]+)/);
      return m ? (Number(m[1]) || 0) : 0;
    }catch(e){ return 0; }
  }
  function alsGesehenMerken(ts){
    var t = Number(ts || 0) || Date.now();
    if(t > erledigtTs){ erledigtTs = t; }
    schreiben(GESEHEN, String(t));
    try{ sessionStorage.setItem(GESEHEN, String(t)); }catch(e){}
  }
  function istGesehen(ts){
    var t = Number(ts || 0);
    if(!t){ return false; }
    if(erledigtTs && t <= erledigtTs){ return true; }
    if(Number(lesen(GESEHEN) || 0) >= t){ return true; }
    try{ if(Number(sessionStorage.getItem(GESEHEN) || 0) >= t){ return true; } }catch(e){}
    var uv = urlV();
    if(uv && t <= uv){ alsGesehenMerken(t); return true; }
    return false;
  }
  function version(s){ var m = String(s || "").match(/v[0-9]+(\.[0-9]+)?/); return m ? m[0] : ""; }
  function escHtml(s){ return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function istOhneMeldung(){ return lesen(OHNE_KEY) !== "0"; }
  function istMinimiert(){ return lesen(MIN_KEY) === "1"; }

  function weg(){
    if(ticker){ clearInterval(ticker); ticker = null; }
    if(karte && karte.parentNode){ karte.parentNode.removeChild(karte); }
    karte = null;
    if(knopf && knopf.parentNode){ knopf.parentNode.removeChild(knopf); }
    knopf = null;
  }

  /* ---------------------------------------------------------------------
     SPRACHEN: Die Meldung erscheint in der Sprache, aus der der Besucher
     kommt. Reihenfolge: eigene Wahl (Sprachknopf im Kasten) -> Browsersprache
     (navigator.languages) -> Englisch.
     --------------------------------------------------------------------- */
  var SPRACHE = "dnx.update.sprache";   /* eigene Wahl, gilt nur hier */
  var TEXTE = {
    de: { neu:"NEU", titelAlt:"Neue Fassung auf dem Server",
          unterAlt:"Auf dem Server liegt ein neuerer Stand \u2013 bei dir l\u00e4uft noch der alte.",
          titelKein:"Deine Seite ist nicht mehr aktuell",
          unterKein:"Bei dir wurde die Seite ohne den aktuellen Aufbau geladen \u2013 deshalb fehlen dir die neuen Sachen.",
          laden:"Jetzt neu laden", spaeter:"Sp\u00e4ter",
          titelWarten:"Der Server wird aktualisiert",
          unterWarten:"Einen Moment bitte \u2013 sobald es fertig ist, l\u00e4dt deine Seite von selbst neu. Du musst nichts tun.",
          titelFertig:"Update fertig",
          unterFertigA:"Damit du alles Neue siehst, l\u00e4dt deine Seite in ",
          unterFertigB:" Sekunden neu \u2013 von selbst.",
          sofort:"Jetzt sofort", hier:"Hier", server:"Server", meldungKopf:"Meldung vom Betreiber:" },
    en: { neu:"NEW", titelAlt:"New version on the server",
          unterAlt:"A newer version is on the server \u2013 you are still running the old one.",
          titelKein:"Your page is out of date",
          unterKein:"This page was loaded without the current setup \u2013 that is why the new features are missing.",
          laden:"Reload now", spaeter:"Later",
          titelWarten:"The server is being updated",
          unterWarten:"One moment please \u2013 your page will reload by itself as soon as it is done. You do not have to do anything.",
          titelFertig:"Update done",
          unterFertigA:"So you can see everything new, your page reloads in ",
          unterFertigB:" seconds \u2013 automatically.",
          sofort:"Right now", hier:"Here", server:"Server", meldungKopf:"Message from the operator:" },
    fr: { neu:"NOUVEAU", titelAlt:"Nouvelle version sur le serveur",
          unterAlt:"Une version plus r\u00e9cente est sur le serveur \u2013 vous utilisez encore l\u2019ancienne.",
          titelKein:"Votre page n\u2019est plus \u00e0 jour",
          unterKein:"Cette page a \u00e9t\u00e9 charg\u00e9e sans la version actuelle \u2013 c\u2019est pourquoi il manque les nouveaut\u00e9s.",
          laden:"Recharger", spaeter:"Plus tard",
          titelWarten:"Le serveur est en cours de mise \u00e0 jour",
          unterWarten:"Un instant s\u2019il vous pla\u00eet \u2013 votre page se rechargera d\u2019elle-m\u00eame d\u00e8s que ce sera termin\u00e9. Vous n\u2019avez rien \u00e0 faire.",
          titelFertig:"Mise \u00e0 jour termin\u00e9e",
          unterFertigA:"Pour voir toutes les nouveaut\u00e9s, votre page se recharge dans ",
          unterFertigB:" secondes \u2013 automatiquement.",
          sofort:"Tout de suite", hier:"Ici", server:"Serveur", meldungKopf:"Message de l\u2019exploitant\u00a0:" },
    es: { neu:"NUEVO", titelAlt:"Nueva versi\u00f3n en el servidor",
          unterAlt:"En el servidor hay una versi\u00f3n m\u00e1s nueva \u2013 t\u00fa a\u00fan tienes la antigua.",
          titelKein:"Tu p\u00e1gina ya no est\u00e1 actualizada",
          unterKein:"Esta p\u00e1gina se carg\u00f3 sin la versi\u00f3n actual \u2013 por eso te faltan las novedades.",
          laden:"Recargar ahora", spaeter:"M\u00e1s tarde",
          titelWarten:"El servidor se est\u00e1 actualizando",
          unterWarten:"Un momento \u2013 tu p\u00e1gina se recargar\u00e1 sola en cuanto termine. No tienes que hacer nada.",
          titelFertig:"Actualizaci\u00f3n lista",
          unterFertigA:"Para que veas todo lo nuevo, tu p\u00e1gina se recarga en ",
          unterFertigB:" segundos \u2013 autom\u00e1ticamente.",
          sofort:"Ahora", hier:"Aqu\u00ed", server:"Servidor", meldungKopf:"Mensaje del operador:" },
    it: { neu:"NUOVO", titelAlt:"Nuova versione sul server",
          unterAlt:"Sul server c\u2019\u00e8 una versione pi\u00f9 recente \u2013 tu hai ancora quella vecchia.",
          titelKein:"La tua pagina non \u00e8 pi\u00f9 aggiornata",
          unterKein:"Questa pagina \u00e8 stata caricata senza la versione attuale \u2013 per questo mancano le novit\u00e0.",
          laden:"Ricarica ora", spaeter:"Dopo",
          titelWarten:"Il server si sta aggiornando",
          unterWarten:"Un momento \u2013 la tua pagina si ricaricher\u00e0 da sola appena sar\u00e0 pronto. Non devi fare nulla.",
          titelFertig:"Aggiornamento completato",
          unterFertigA:"Per vedere tutte le novit\u00e0, la pagina si ricarica tra ",
          unterFertigB:" secondi \u2013 automaticamente.",
          sofort:"Subito", hier:"Qui", server:"Server", meldungKopf:"Messaggio del gestore:" },
    nl: { neu:"NIEUW", titelAlt:"Nieuwe versie op de server",
          unterAlt:"Er staat een nieuwere versie op de server \u2013 jij hebt nog de oude.",
          titelKein:"Je pagina is niet meer actueel",
          unterKein:"Deze pagina is geladen zonder de huidige opbouw \u2013 daarom mis je de nieuwe dingen.",
          laden:"Nu herladen", spaeter:"Later",
          titelWarten:"De server wordt bijgewerkt",
          unterWarten:"Een moment \u2013 je pagina herlaadt vanzelf zodra het klaar is. Je hoeft niets te doen.",
          titelFertig:"Update klaar",
          unterFertigA:"Om alles nieuws te zien, herlaadt je pagina over ",
          unterFertigB:" seconden \u2013 vanzelf.",
          sofort:"Nu meteen", hier:"Hier", server:"Server", meldungKopf:"Bericht van de beheerder:" },
    pl: { neu:"NOWE", titelAlt:"Nowa wersja na serwerze",
          unterAlt:"Na serwerze jest nowsza wersja \u2013 u Ciebie dzia\u0142a jeszcze stara.",
          titelKein:"Twoja strona nie jest ju\u017c aktualna",
          unterKein:"Ta strona zosta\u0142a wczytana bez aktualnej wersji \u2013 dlatego brakuje nowo\u015bci.",
          laden:"Od\u015bwie\u017c teraz", spaeter:"P\u00f3\u017aniej",
          titelWarten:"Serwer jest aktualizowany",
          unterWarten:"Chwileczk\u0119 \u2013 strona od\u015bwie\u017cy si\u0119 sama, gdy b\u0119dzie gotowe. Nie musisz nic robić.",
          titelFertig:"Aktualizacja gotowa",
          unterFertigA:"Aby zobaczy\u0107 nowo\u015bci, strona od\u015bwie\u017cy si\u0119 za ",
          unterFertigB:" sekund \u2013 automatycznie.",
          sofort:"Od razu", hier:"Tutaj", server:"Serwer", meldungKopf:"Wiadomo\u015b\u0107 od operatora:" },
    tr: { neu:"YEN\u0130", titelAlt:"Sunucuda yeni s\u00fcr\u00fcm var",
          unterAlt:"Sunucuda daha yeni bir s\u00fcr\u00fcm var \u2013 sende h\u00e2l\u00e2 eski s\u00fcr\u00fcm \u00e7al\u0131\u015f\u0131yor.",
          titelKein:"Sayfan art\u0131k g\u00fcncel de\u011fil",
          unterKein:"Bu sayfa g\u00fcncel yap\u0131 olmadan y\u00fcklendi \u2013 bu y\u00fczden yenilikler eksik.",
          laden:"\u015eimdi yenile", spaeter:"Sonra",
          titelWarten:"Sunucu g\u00fcncelleniyor",
          unterWarten:"Bir dakika \u2013 bitti\u011finde sayfan kendili\u011finden yenilenecek. Hi\u00e7bir \u015fey yapman gerekmiyor.",
          titelFertig:"G\u00fcncelleme tamam",
          unterFertigA:"Yenilikleri g\u00f6rmek i\u00e7in sayfan ",
          unterFertigB:" saniye i\u00e7inde yenilenecek \u2013 kendili\u011finden.",
          sofort:"Hemen", hier:"Burada", server:"Sunucu", meldungKopf:"Y\u00f6neticiden mesaj:" },
    ru: { neu:"\u041d\u041e\u0412\u041e\u0415", titelAlt:"\u041d\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 \u043d\u043e\u0432\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f",
          unterAlt:"\u041d\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 \u0431\u043e\u043b\u0435\u0435 \u043d\u043e\u0432\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f \u2013 \u0443 \u0432\u0430\u0441 \u0435\u0449\u0451 \u0441\u0442\u0430\u0440\u0430\u044f.",
          titelKein:"\u0412\u0430\u0448\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0443\u0441\u0442\u0430\u0440\u0435\u043b\u0430",
          unterKein:"\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u0430 \u0431\u0435\u0437 \u0442\u0435\u043a\u0443\u0449\u0435\u0439 \u0432\u0435\u0440\u0441\u0438\u0438 \u2013 \u043f\u043e\u044d\u0442\u043e\u043c\u0443 \u043d\u043e\u0432\u043e\u0433\u043e \u043d\u0435\u0442.",
          laden:"\u041f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c", spaeter:"\u041f\u043e\u0437\u0436\u0435",
          titelWarten:"\u0421\u0435\u0440\u0432\u0435\u0440 \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u0435\u0442\u0441\u044f",
          unterWarten:"\u041c\u0438\u043d\u0443\u0442\u043a\u0443 \u2013 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0441\u044f \u0441\u0430\u043c\u0430, \u043a\u0430\u043a \u0442\u043e\u043b\u044c\u043a\u043e \u0431\u0443\u0434\u0435\u0442 \u0433\u043e\u0442\u043e\u0432\u043e. \u0412\u0430\u043c \u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0443\u0436\u043d\u043e \u0434\u0435\u043b\u0430\u0442\u044c.",
          titelFertig:"\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0433\u043e\u0442\u043e\u0432\u043e",
          unterFertigA:"\u0427\u0442\u043e\u0431\u044b \u0443\u0432\u0438\u0434\u0435\u0442\u044c \u0432\u0441\u0451 \u043d\u043e\u0432\u043e\u0435, \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0441\u044f \u0447\u0435\u0440\u0435\u0437 ",
          unterFertigB:" \u0441\u0435\u043a\u0443\u043d\u0434 \u2013 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438.",
          sofort:"\u0421\u0435\u0439\u0447\u0430\u0441", hier:"\u0417\u0434\u0435\u0441\u044c", server:"\u0421\u0435\u0440\u0432\u0435\u0440", meldungKopf:"\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043e\u0442 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430:" }
  };
  var NAMEN = { de:"Deutsch", en:"English", fr:"Fran\u00e7ais", es:"Espa\u00f1ol", it:"Italiano",
                nl:"Nederlands", pl:"Polski", tr:"T\u00fcrk\u00e7e", ru:"\u0420\u0443\u0441\u0441\u043a\u0438\u0439" };

  function kurzcode(s){
    s = String(s || "").toLowerCase();
    var i = s.indexOf("-");
    return (i > 0 ? s.slice(0, i) : s).slice(0, 2);
  }
  /* Land -> Sprache. Nur fuer den Fall, dass der Browser keine unserer
     Sprachen meldet (z.B. Geraet fest auf Japanisch): dann entscheidet das
     Land, aus dem der Besucher kommt. */
  var LAND_SPRACHE = {
    DE:"de", AT:"de", CH:"de", LI:"de", LU:"de",
    FR:"fr", MC:"fr", BE:"fr",
    ES:"es", MX:"es", AR:"es", CO:"es", CL:"es", PE:"es", VE:"es", UY:"es",
    IT:"it", SM:"it", VA:"it",
    NL:"nl",
    PL:"pl",
    TR:"tr",
    RU:"ru", BY:"ru", KZ:"ru"
  };
  var LAND = "dnx.update.land";

  function landSprache(){
    try{
      var c = localStorage.getItem(LAND);
      if(c && LAND_SPRACHE[String(c).toUpperCase()]){ return LAND_SPRACHE[String(c).toUpperCase()]; }
    }catch(e){}
    return "";
  }
  /* Einmal das Land holen (nur wenn es gebraucht wird), damit jeder Besucher
     die Meldung in seiner Sprache bekommt - ohne dass der Betreiber etwas
     einzeln senden muss. */
  var landGeholt = false;
  function landHolen(){
    if(landGeholt){ return; }
    landGeholt = true;
    try{ if(localStorage.getItem(LAND)){ return; } }catch(e){}
    var dienste = [
      function(){ return fetch("https://ipwho.is/", {cache:"no-store"}).then(function(r){ return r.json(); })
                     .then(function(d){ return d && d.country_code; }); },
      function(){ return fetch("https://ipapi.co/country/", {cache:"no-store"}).then(function(r){ return r.text(); }); }
    ];
    function naechster(i){
      if(i >= dienste.length){ return; }
      dienste[i]().then(function(c){
        c = String(c || "").trim().toUpperCase();
        if(c && c.length === 2){
          try{ localStorage.setItem(LAND, c); }catch(e){}
          /* offene Karte in der neuen Sprache neu aufbauen */
          if(karte){ var art = variante; weg(); if(art === "warten"){ karteWarten(true); } else if(art === "fertig"){ karteNeu(letzteTs, letzteMeldung, true); } else { karteVeraltet(); } }
        }else{ naechster(i + 1); }
      }).catch(function(){ naechster(i + 1); });
    }
    naechster(0);
  }

  var letzteTs = 0, letzteMeldung = "";

  function sprache(){
    var eigene = null;
    try{ eigene = localStorage.getItem(SPRACHE); }catch(e){}
    if(eigene && TEXTE[eigene]){ return eigene; }
    var liste = [];
    try{ if(navigator.languages && navigator.languages.length){ liste = navigator.languages; } }catch(e){}
    if(!liste.length){ try{ if(navigator.language){ liste = [navigator.language]; } }catch(e){} }
    for(var i = 0; i < liste.length; i++){
      var k = kurzcode(liste[i]);
      if(TEXTE[k]){ return k; }
    }
    /* Browser meldet keine bekannte Sprache -> Land fragen */
    var l = landSprache();
    if(l){ return l; }
    landHolen();
    return "en";
  }
  function T(){
    var s = sprache();
    return TEXTE[s] || TEXTE.en;
  }

  function rahmen(){
    var p = document.createElement("div");
    p.id = "dnx-update-karte";
    p.setAttribute("role", "dialog");
    p.style.cssText =
      "position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:2147483647;" +
      "width:min(600px,calc(100vw - 24px));box-sizing:border-box;text-align:left;" +
      "font-family:Arial,Helvetica,sans-serif;background:#20180a;border:2px solid #ffd24a;border-radius:14px;" +
      "box-shadow:0 10px 40px rgba(0,0,0,.85),0 0 26px rgba(255,205,70,.35);padding:14px 16px 12px;color:#fff5d6";
    return p;
  }
  function kopf(titel){
    return '<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">' +
        '<span style="background:#ffd24a;color:#3a2900;font:900 13px Arial;padding:2px 8px;border-radius:6px">' + T().neu + '</span>' +
        '<span style="font:900 20px Arial;color:#fff">' + titel + '</span>' +
      '</div>';
  }
  function knopfReihe(links, rechts){
    return '<div style="margin-top:12px;display:flex;gap:9px;align-items:stretch">' +
        '<div id="dnx-update-laden" style="flex:1;text-align:center;background:#7a5a00;border:2px solid #ffd24a;' +
          'border-radius:10px;padding:11px 10px;cursor:pointer;font:900 17px Arial;color:#fff">' + links + '</div>' +
        (rechts ? '<div id="dnx-update-spaeter" style="text-align:center;background:#2c2415;border:1px solid #6b5a33;' +
          'border-radius:10px;padding:11px 14px;cursor:pointer;font:700 14px Arial;color:#d8c48a">' + rechts + '</div>' : '') +
      '</div>';
  }
  function fuss(){
    return '<div style="margin-top:8px;font:600 11px Arial;color:#b9a878">' + T().hier + ': ' +
      (window.__dnxVersStand || "-") + ' \u00b7 ' + T().server + ': ' + (version(serverStand) || serverStand || "?") + '</div>';
  }
  /* Eigene Zeile des Betreibers (beliebiger Text) - eigene Sprache? */
  function eigenerText(){
    if(flag && flag.text){ return String(flag.text); }
    return meldung || "";
  }
  function eigeneZeile(){
    var tx = eigenerText();
    if(!tx){ return ""; }
    return '<div style="margin-top:9px;padding-top:9px;border-top:1px solid #4a3f22">' +
      '<div style="font:700 10px Arial;color:#8f9a7a;letter-spacing:.4px;text-transform:uppercase;' +
      'margin-bottom:3px">' + T().meldungKopf + '</div>' +
      '<div style="font:600 14px Arial;color:#9dffd0;line-height:1.45">' + escHtml(tx) + '</div></div>';
  }

  /* ---------- A) alter Stand hier, neuer auf dem Server ---------- */
  function karteVeraltet(){
    weg();
    var p = rahmen();
    var titel = variante === "kein-styler" ? T().titelKein : T().titelAlt;
    var unter = variante === "kein-styler" ? T().unterKein : T().unterAlt;
    p.innerHTML = kopf(titel) +
      '<div style="font:600 14px Arial;color:#ffe9b8;line-height:1.45">' + unter + '</div>' +
      eigeneZeile() +
      knopfReihe(T().laden, T().spaeter) + fuss();
    document.body.appendChild(p); karte = p;
    p.querySelector("#dnx-update-laden").onclick = function(){ hartLaden(); };
    p.querySelector("#dnx-update-spaeter").onclick = function(){ schreiben(WEG, serverStand); weg(); knopfBauen("karte"); };
  }

  /* ---------- B) Betreiber kuendigt an ---------- */
  var WARTE_MAX = 180000;   /* nach 3 Minuten gibt die Karte von selbst Ruhe */

  function karteWarten(erzwingen){
    var ts = Number(flag && flag.ts) || Date.now();
    if(!erzwingen && !TESTLAUF && karte && variante === "warten" && Number(letzteTs) === ts){ return; }
    letzteTs = ts;
    variante = "warten";
    weg();
    var p = rahmen();
    p.innerHTML = kopf(T().titelWarten) +
      '<div style="font:600 14px Arial;color:#ffe9b8;line-height:1.45">' + T().unterWarten + '</div>' +
      eigeneZeile() +
      '<div style="margin-top:12px;height:8px;border-radius:99px;overflow:hidden;background:#3a2f18">' +
        '<div id="dnx-update-balken" style="width:35%;height:100%;background:#ffd24a;animation:dnx-update-wandern 1.6s linear infinite"></div>' +
      '</div>' +
      '<div id="dnx-update-warten-zu" style="margin-top:11px;text-align:center;cursor:pointer;padding:9px 10px;' +
        'border-radius:10px;background:#2c2415;border:1px solid #6b5a33;color:#d8c48a;font:700 13px Arial">' +
        T().spaeter + '</div>';
    document.body.appendChild(p); karte = p;

    /* Ausgang: der Besucher kann die Meldung wegklicken */
    p.querySelector("#dnx-update-warten-zu").onclick = function(){
      schreiben(WEG, "warten-" + ts);
      weg();
    };
    /* Sicherheitsnetz: haengt die Karte laenger als 3 Minuten, verschwindet sie
       von selbst - niemand bleibt auf einer Meldung sitzen. */
    if(ticker){ clearInterval(ticker); }
    ticker = setInterval(function(){
      if(!karte){ clearInterval(ticker); ticker = null; return; }
      if(Date.now() - ts > WARTE_MAX){
        clearInterval(ticker); ticker = null;
        schreiben(WEG, "warten-" + ts);
        weg();
      }
    }, 5000);
  }

  /* ---------- C) fertig: alle laden von selbst neu ---------- */
  function karteNeu(ts, text, erzwingen){
    var nTs = Number(ts || 0) || Date.now();
    if(!erzwingen && !TESTLAUF && karte && variante === "fertig" && Number(letzteTs) === nTs){ return; }
    letzteTs = nTs; letzteMeldung = text || "";
    variante = "fertig";
    weg();
    var p = rahmen();
    var rest = COUNTDOWN;
    p.innerHTML = kopf(TESTLAUF ? (T().titelFertig + " (Test)") : T().titelFertig) +
      '<div style="font:600 14px Arial;color:#ffe9b8;line-height:1.45">' + T().unterFertigA +
      '<b id="dnx-update-rest" style="color:#fff">' + rest + '</b>' + T().unterFertigB + '</div>' +
      (function(){ var tx = text || eigenerText();
        if(!tx){ return ""; }
        return '<div style="margin-top:9px;padding-top:9px;border-top:1px solid #4a3f22">' +
          '<div style="font:700 10px Arial;color:#8f9a7a;letter-spacing:.4px;text-transform:uppercase;margin-bottom:3px">' +
          T().meldungKopf + '</div>' +
          '<div style="font:600 14px Arial;color:#9dffd0;line-height:1.45">' + escHtml(tx) + '</div></div>';
      })() +
      knopfReihe(T().sofort, T().spaeter) +
      '<div style="margin-top:8px;height:8px;border-radius:99px;overflow:hidden;background:#3a2f18">' +
        '<div id="dnx-update-balken2" style="width:100%;height:100%;background:#9dffd0;transition:width 1s linear"></div>' +
      '</div>';
    document.body.appendChild(p); karte = p;

    p.querySelector("#dnx-update-laden").onclick = function(){ if(!TESTLAUF){ alsGesehenMerken(nTs); } hartLaden(nTs, true); };
    p.querySelector("#dnx-update-spaeter").onclick = function(){ if(!TESTLAUF){ alsGesehenMerken(nTs); } weg(); knopfBauen("neu", nTs); };

    var balken = p.querySelector("#dnx-update-balken2");
    ticker = setInterval(function(){
      rest--;
      var r = p.querySelector("#dnx-update-rest");
      if(r){ r.textContent = String(rest > 0 ? rest : 0); }
      if(balken){ balken.style.width = Math.max(0, (rest / COUNTDOWN) * 100) + "%"; }
      if(rest <= 0){
        clearInterval(ticker); ticker = null;
        if(!TESTLAUF){ alsGesehenMerken(nTs); }
        weg();
        hartLaden(nTs, !!TESTLAUF);
      }
    }, 1000);
  }

  function hartLaden(ts, erzwingen){
    var zielTs = Number(ts || 0) || Date.now();
    if(!TESTLAUF && ts){ alsGesehenMerken(zielTs); }
    var uv = urlV();
    if(uv && zielTs <= uv){
      if(!erzwingen){
        weg();
        return;
      }
      zielTs = Date.now();
      if(zielTs <= uv){ zielTs = uv + 1; }
    }
    try{
      var u = location.pathname + "?v=" + zielTs;
      location.replace(u);
    }catch(e){ try{ location.reload(); }catch(e2){} }
  }

  function knopfBauen(art, ts){
    if(karte || knopf){ return; }
    var b = document.createElement("div");
    b.id = "dnx-update-knopf";
    b.title = "Es gibt etwas Neues \u2013 hier klicken";
    b.textContent = "\u2191";
    b.style.cssText =
      "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483646;width:46px;height:46px;" +
      "border-radius:50%;background:#ffd24a;color:#2b1f00;border:3px solid #7a5a00;font:900 24px Arial;" +
      "line-height:38px;text-align:center;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.7);" +
      "animation:dnx-update-puls 2s infinite";
    b.onclick = function(){
      knopf = null;
      b.parentNode.removeChild(b);
      if(art === "neu"){ karteNeu(ts, letzteMeldung, true); } else if(art === "warten"){ karteWarten(true); } else { karteVeraltet(); }
    };
    document.body.appendChild(b);
    knopf = b;
  }

  function stil(){
    if(document.getElementById("dnx-update-stil")){ return; }
    var s = document.createElement("style");
    s.id = "dnx-update-stil";
    s.textContent =
      "@keyframes dnx-update-puls{0%,100%{box-shadow:0 4px 18px rgba(0,0,0,.7),0 0 0 0 rgba(255,210,74,.8)}" +
      "70%{box-shadow:0 4px 18px rgba(0,0,0,.7),0 0 0 15px rgba(255,210,74,0)}}" +
      "@keyframes dnx-update-wandern{0%{margin-left:-35%}100%{margin-left:100%}}";
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- Stand-Datei: ist hier alles aktuell? ---------- */
  function standPruefen(){
    /* Eigener Test laeuft: die Karten gehoeren mir, nichts wegwischen. */
    if(TESTLAUF){ return; }
    fetch(STAND + "?ts=" + Date.now(), {cache: "no-store"})
      .then(function(r){ return r.ok ? r.text() : ""; })
      .then(function(t){
        t = String(t || "").trim();
        if(!t){ return; }
        var z = t.split(/\r?\n/);
        serverStand = (z[0] || "").trim();
        meldung = (z[1] || "").trim();
        if(!serverStand){ return; }
        if(flag && (flag.modus === "warten" || flag.modus === "neu")){ return; }  /* Flag hat Vorrang */
        var hier = window.__dnxVersStand || "";
        var neu;
        if(hier){ neu = (version(hier) !== version(serverStand)); variante = "alte-fassung"; }
        else { neu = (Date.now() - start) > STUMM; variante = "kein-styler"; }
        if(!neu){ weg(); return; }
        if(lesen(WEG) === serverStand){ knopfBauen("karte"); return; }
        karteVeraltet();
      })
      .catch(function(){});
  }

  /* ---------- Update-Flag vom Betreiber ---------- */
  function flagHolen(){
    if(flagLaeuft || !BASIS){ return Promise.resolve(); }
    flagLaeuft = true;
    return fetch(BASIS + "/load_user/" + FLAG + "?ts=" + Date.now(), {credentials: "include", cache: "no-store"})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        flagLaeuft = false;
        if(TESTLAUF){ if(d && d.modus){ flag = d; } return; }
        if(!d || !d.modus || d.modus === "aus"){ flag = null; standPruefen(); return; }
        flag = d;
        flagAnwenden();
      })
      .catch(function(){ flagLaeuft = false; });
  }

  function flagAnwenden(){
    if(!flag){ return; }
    var ts = Number(flag.ts || 0);
    /* Eigene Probe laeuft: fremde Meldungen ignorieren, eigene Karte nachreichen */
    if(TESTLAUF){
      if(WARTE && flag.modus === "neu"){
        var w = WARTE; WARTE = null;
        karteNeu(w.ts, w.meldung, true);
      }
      return;
    }
    if(flag.modus === "sofort"){
      if(ts && istGesehen(ts)){ return; }
      if(ts && (Date.now() - ts) > 120000){
        alsGesehenMerken(ts);
        return;
      }
      var sTs = ts || Date.now();
      alsGesehenMerken(sTs);
      hartLaden(sTs);
      return;
    }
    if(flag.modus === "warten"){
      /* schon weggeklickt? Dann nicht wieder aufdraengen. */
      if(lesen(WEG) === "warten-" + ts){ return; }
      if(ts && istGesehen(ts)){ return; }
      karteWarten(); return;
    }
    if(flag.modus === "neu"){
      if(!ts){ return; }
      if(istGesehen(ts)){ return; }        /* schon erledigt (localStorage, sessionStorage oder ?v=) */
      if((Date.now() - ts) > 180000){
        alsGesehenMerken(ts);
        return;
      }
      karteNeu(ts, flag.text || meldung || "");
    }
  }

  /* ---------- Betreiber-Panel (strikt nur authentifizierte Admins) ---------- */
  function altlastenLoeschen(){
    try{
      localStorage.removeItem("dnx.update.kasten.wer");
      localStorage.removeItem("dnx_betreiber");
      localStorage.removeItem("dnx.update.kasten");
      sessionStorage.removeItem("dnx.istAdmin");
    }catch(e){}
  }

  function binAdmin(){
    return !!istAdminAktiv;
  }

  function panelWeg(){
    var p = document.getElementById("dnx-update-panel");
    if(p && p.parentNode){ p.parentNode.removeChild(p); }
    panel = null;
    if(TESTLAUF){ TESTLAUF = false; WARTE = null; }
  }

  function adminStatusSetzen(ja, userName){
    istAdminAktiv = !!ja;
    adminUser = ja ? String(userName || "admin") : "";
    if(istAdminAktiv){
      panelBauen();
    } else {
      altlastenLoeschen();
      panelWeg();
    }
  }

  window.__dnxUpdateKastenAus = function(){
    panelWeg();
  };

  function accKandidaten(){
    var out = [];
    function pushU(u){
      u = String(u || "").replace(/\/+$/, "");
      if(u && out.indexOf(u) < 0){ out.push(u); }
    }
    try{
      if(typeof window.__dnxBasis === "function"){ pushU(window.__dnxBasis()); }
    }catch(e){}
    try{
      pushU(location.protocol + "//" + location.hostname + ":8095");
      pushU(location.protocol + "//" + location.hostname + ":8096");
      pushU(location.protocol + "//" + location.hostname + ":8091");
    }catch(e2){}
    return out;
  }

  function rollePruefen(){
    if(apiPruefungLaeuft){ return; }
    apiPruefungLaeuft = true;
    var ziele = accKandidaten();

    function fallbackPruefen(){
      fetch("/visitor-status.json?t=" + Date.now(), {credentials: "include", cache: "no-store"})
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(d){
          apiPruefungLaeuft = false;
          if(d && d.ist_admin === true){
            adminStatusSetzen(true, "admin");
            return;
          }
          try{
            if(window.__dnxBanZ && window.__dnxBanZ.admin === true){
              adminStatusSetzen(true, "admin");
              return;
            }
          }catch(eB){}
          adminStatusSetzen(false, "");
        })
        .catch(function(){
          apiPruefungLaeuft = false;
          try{
            if(window.__dnxBanZ && window.__dnxBanZ.admin === true){
              adminStatusSetzen(true, "admin");
              return;
            }
          }catch(eB2){}
          adminStatusSetzen(false, "");
        });
    }

    function frage(idx){
      if(idx >= ziele.length){
        fallbackPruefen();
        return;
      }
      var ctrl = null, timer = null;
      var opts = {credentials: "include", cache: "no-store"};
      try{
        if(typeof AbortController !== "undefined"){
          ctrl = new AbortController();
          opts.signal = ctrl.signal;
          timer = setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, 2500);
        }
      }catch(e){}
      fetch(ziele[idx] + "/api/me?t=" + Date.now(), opts)
        .then(function(r){ if(timer){ clearTimeout(timer); } return r.ok ? r.json() : null; })
        .then(function(d){
          if(d && typeof d.role === "string"){
            apiPruefungLaeuft = false;
            var ja = !!(d.user && String(d.role).toLowerCase() === "admin");
            adminStatusSetzen(ja, d.user || "");
          } else {
            frage(idx + 1);
          }
        })
        .catch(function(){
          if(timer){ clearTimeout(timer); }
          frage(idx + 1);
        });
    }

    frage(0);
  }

  function melden(modus, text, still){
    var d = {
      modus: modus,
      ts: Date.now(),
      text: text ? String(text).trim() : "",
      still: !!still,
      von: adminUser || "admin"
    };
    if(!istAdminAktiv){ return Promise.resolve(null); }
    return fetch(BASIS + "/save_user/" + FLAG, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d)
    }).then(function(r){
      if(!r.ok){ throw new Error("HTTP " + r.status); }
      return r.json();
    }).then(function(){
      flag = d;
      if(modus === "sofort"){ alsGesehenMerken(d.ts); }
      else { flagAnwenden(); }
      panelStand();
      return d;
    }).catch(function(){ alert("Konnte die Meldung nicht setzen (Port 8099 nicht erreichbar)."); return null; });
  }

  function panelStand(){
    var s = document.getElementById("dnx-update-stand");
    var ohne = istOhneMeldung();
    var bOhne = document.getElementById("dnx-tat-ohne");
    var bMit = document.getElementById("dnx-tat-mit");
    var txWrap = document.getElementById("dnx-tat-text-wrap");
    if(bOhne){
      bOhne.style.background = ohne ? "#17422a" : "#1a222a";
      bOhne.style.borderColor = ohne ? "#35ff83" : "#3a4a58";
      bOhne.style.color = ohne ? "#d8ffe8" : "#8fa8b8";
    }
    if(bMit){
      bMit.style.background = !ohne ? "#523c00" : "#1a222a";
      bMit.style.borderColor = !ohne ? "#ffd24a" : "#3a4a58";
      bMit.style.color = !ohne ? "#fff3c4" : "#8fa8b8";
    }
    if(txWrap){ txWrap.style.display = ohne ? "none" : "block"; }
    var voll = document.getElementById("dnx-update-voll");
    var mini = document.getElementById("dnx-update-mini");
    var min = istMinimiert();
    if(voll && mini){
      voll.style.display = min ? "none" : "block";
      mini.style.display = min ? "flex" : "none";
      if(panel){
        panel.style.width = min ? "auto" : "262px";
        panel.style.padding = min ? "6px 10px" : "10px 11px 11px";
      }
    }
    if(!s){ return; }
    var tEnde = document.getElementById("dnx-tat-testende");
    if(tEnde){ tEnde.style.display = TESTLAUF ? "block" : "none"; }
    if(TESTLAUF){ s.textContent = "Vorschau l\u00e4uft \u2013 nur bei dir"; return; }
    if(flag && flag.modus === "warten"){
      s.textContent = "Meldung l\u00e4uft (seit " + new Date(Number(flag.ts) || Date.now()).toLocaleTimeString("de-DE") + ")";
      return;
    }
    s.textContent = ohne ? "Ohne Meldung (kein Serverneustart-Hinweis)" : "Mit Hinweis-Meldung vor Neuladen";
  }

  function panelBauen(){
    if(panel){ return; }
    if(!binAdmin()){ return; }
    var p = document.createElement("div");
    p.id = "dnx-update-panel";
    p.style.cssText =
      "position:fixed;left:14px;bottom:14px;z-index:2147483645;background:#141a20;border:2px solid #3a4a58;" +
      "border-radius:12px;padding:10px 11px 11px;font-family:Arial,Helvetica,sans-serif;color:#cfe3ef;" +
      "box-shadow:0 8px 26px rgba(0,0,0,.85);width:262px;box-sizing:border-box;user-select:none";
    p.innerHTML =
      '<div id="dnx-update-mini" title="Bedienfeld aufklappen" ' +
        'style="display:none;align-items:center;gap:8px;cursor:pointer">' +
        '<span style="color:#ffd24a;font:900 13px Arial;white-space:nowrap">\u26a1 Jetzt starten</span>' +
        '<span style="background:#24303a;border:1px solid #4d6274;color:#d8ecf8;border-radius:6px;' +
          'font:900 13px Arial;padding:1px 6px;line-height:1.2">+</span>' +
      '</div>' +
      '<div id="dnx-update-voll">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<span style="color:#ffd24a;font:900 15px Arial">\u26a1 Jetzt starten</span>' +
          '<button id="dnx-update-min" type="button" title="Minimieren (bleibt unten links)" ' +
            'style="cursor:pointer;background:#202a34;color:#cfe3ef;border:1px solid #485b6c;border-radius:6px;' +
            'font:900 15px Arial;width:24px;height:22px;padding:0;line-height:20px">\u2212</button>' +
        '</div>' +
        '<div id="dnx-update-stand" style="font:600 10.5px Arial;color:#8fa8b8;margin-bottom:7px;line-height:1.3"></div>' +
        '<div style="display:flex;gap:5px;margin-bottom:8px">' +
          '<button id="dnx-tat-ohne" type="button" title="Startet sofort neu \u2013 ohne Serverneustart-Meldung" ' +
            'style="flex:1;cursor:pointer;padding:6px 4px;border-radius:8px;border:1.5px solid #35ff83;' +
            'font:800 11px Arial">Ohne Meldung</button>' +
          '<button id="dnx-tat-mit" type="button" title="Zeigt zuerst eine Hinweis-Meldung mit Countdown" ' +
            'style="flex:1;cursor:pointer;padding:6px 4px;border-radius:8px;border:1.5px solid #3a4a58;' +
            'font:800 11px Arial">Mit Meldung</button>' +
        '</div>' +
        '<button id="dnx-tat-mir" type="button" style="display:block;width:100%;cursor:pointer;padding:10px 10px;border-radius:10px;' +
          'background:#24303a;border:2px solid #6b8ea8;color:#d8ecf8;font:900 13.5px Arial;margin-bottom:7px">' +
          'Bei mir jetzt starten</button>' +
        '<button id="dnx-tat-testende" type="button" style="display:none;width:100%;cursor:pointer;padding:8px 10px;border-radius:9px;' +
          'background:#3a2a2a;border:1px solid #8a5a5a;color:#ffd0d0;font:700 12px Arial;margin-bottom:7px">' +
          'Vorschau abbrechen</button>' +
        '<button id="dnx-tat-alle" type="button" style="display:block;width:100%;cursor:pointer;padding:11px 10px;border-radius:10px;' +
          'background:#7a5a00;border:2px solid #ffd24a;color:#fff;font:900 14.5px Arial">' +
          'Bei allen jetzt starten</button>' +
        '<div id="dnx-tat-text-wrap" style="display:none;margin-top:8px">' +
          '<div style="font:700 10px Arial;color:#8fa8b8;margin-bottom:3px">Meldungstext (optional):</div>' +
          '<textarea id="dnx-tat-text" rows="2" maxlength="240" placeholder="z. B. Neues Projekt ist online." ' +
            'style="width:100%;box-sizing:border-box;resize:vertical;padding:6px 7px;border-radius:8px;' +
            'background:#0d1216;color:#dff3ff;border:1px solid #3a4a58;font:600 12px Arial"></textarea>' +
        '</div>' +
      '</div>';
    document.body.appendChild(p);
    panel = p;
    panelStand();

    p.querySelector("#dnx-update-min").onclick = function(){
      schreiben(MIN_KEY, "1");
      panelStand();
    };
    p.querySelector("#dnx-update-mini").onclick = function(){
      schreiben(MIN_KEY, "0");
      panelStand();
    };
    p.querySelector("#dnx-tat-ohne").onclick = function(){
      schreiben(OHNE_KEY, "1");
      panelStand();
    };
    p.querySelector("#dnx-tat-mit").onclick = function(){
      schreiben(OHNE_KEY, "0");
      panelStand();
    };

    function feldText(){
      var f = document.getElementById("dnx-tat-text");
      return f && f.value ? String(f.value).trim() : "";
    }

    p.querySelector("#dnx-tat-mir").onclick = function(){
      if(istOhneMeldung()){
        TESTLAUF = false; WARTE = null;
        hartLaden(Date.now(), true);
        return;
      }
      var tx = feldText();
      TESTLAUF = true; WARTE = null; flag = null;
      if(tx){ meldung = tx; }
      karteWarten(true);
      panelStand();
      WARTE = { ts: Date.now(), meldung: tx || "" };
      setTimeout(function(){
        if(TESTLAUF && WARTE){ var w = WARTE; WARTE = null; karteNeu(w.ts, w.meldung, true); }
      }, 2500);
    };
    p.querySelector("#dnx-tat-testende").onclick = function(){
      TESTLAUF = false; WARTE = null; weg(); panelStand();
    };
    p.querySelector("#dnx-tat-alle").onclick = function(){
      TESTLAUF = false; WARTE = null;
      if(istOhneMeldung()){
        var s = document.getElementById("dnx-update-stand");
        if(s){ s.textContent = "Wird bei allen gestartet\u2026"; }
        melden("sofort", "", true).then(function(d){
          if(!d){ return; }
          setTimeout(function(){ hartLaden(d.ts, true); }, 1200);
        });
        return;
      }
      var tx = feldText();
      melden("warten", tx, false).then(function(d){
        if(!d){ return; }
        setTimeout(function(){ melden("neu", tx, false); }, 2500);
      });
    };
  }

  function starten(){
    stil();
    window.__dnxUpdatePruefen = standPruefen;
    window.__dnxUpdateFlag = flagHolen;
    window.__dnxUpdateMelden = melden;

    setTimeout(standPruefen, 4000);
    setTimeout(standPruefen, 10000);
    setTimeout(function(){ if(!window.__dnxVersStand){ standPruefen(); } }, 22000);
    setInterval(standPruefen, TAKT);

    setTimeout(function(){
      flagHolen();
      setInterval(flagHolen, FLAG_TAKT);
    }, 2500);

    var warten = setInterval(function(){
      if(window.__dnxVersStand){ clearInterval(warten); standPruefen(); }
    }, 1500);
    setTimeout(function(){ clearInterval(warten); }, 60000);

    altlastenLoeschen();
    setTimeout(rollePruefen, 300);
    setTimeout(rollePruefen, 1500);
    setTimeout(rollePruefen, 4000);
    setInterval(rollePruefen, 5000);
    try{ window.addEventListener("dnx:basis", rollePruefen); }catch(e){}
    try{ window.addEventListener("focus", rollePruefen); }catch(e){}
    window.__dnxUpdateStatus = function(){
      return {
        wache: true, stand: window.__dnxVersStand || null, server: serverStand,
        panel: !!document.getElementById("dnx-update-panel"),
        minimiert: istMinimiert(), ohneMeldung: istOhneMeldung(),
        admin: binAdmin(), user: adminUser || null
      };
    };
  }
  if(document.readyState === "loading"){ document.addEventListener("DOMContentLoaded", starten); }
  else { starten(); }
})();
/* DNX_UPDATE_WACHE_END */
