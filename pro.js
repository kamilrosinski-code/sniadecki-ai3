/*
 * gruntowo.pl PRO - panel konta (pro.html): logowanie / rejestracja, wybor dzialek na mapie,
 * zapisane dzialki, tereny, historia, abonament. Serwer: pro.php (LH). Wspolne funkcje: pro-sledz.js.
 */
(function () {
  'use strict';
  var PRO = window.GruntowoPRO;
  var ULDK_PROXY = 'https://script.google.com/macros/s/AKfycbzMevjlU6LD5YKp37spIFdNf8lEfkUWL03PuK8N2Ey8HqBBjBiPgvJASVGQP1yLp_Tf/exec';
  var API_PLATNOSC = 'https://sniadecki-development.pl/gruntowo-api/pro-platnosc.php';
  var MAKS = 8;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var par = new URLSearchParams(location.search);
  var konto = null, mapa = null, wybrane = [], warstwy = {}, zapisane = {};

  function msg(form, tekst, ok) { var m = form.querySelector('[data-msg]'); if (m) { m.textContent = tekst || ''; m.className = 'pro-msg ' + (ok ? 'ok' : 'zle'); } }
  function dane(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = v; }); form.querySelectorAll('input[type=checkbox]').forEach(function (c) { o[c.name] = c.checked ? 1 : 0; }); return o; }
  function zajety(form, tak) { form.querySelectorAll('button').forEach(function (b) { b.disabled = tak; }); }

  // ---------------- logowanie / rejestracja ----------------
  function pokazFormularz(nazwa) {
    ['logowanie', 'rejestracja', 'reset-start', 'reset'].forEach(function (n) { $('f-' + n).style.display = n === nazwa ? '' : 'none'; });
    document.querySelectorAll('#zakladki button').forEach(function (b) { b.classList.toggle('on', b.dataset.z === nazwa); });
  }
  function zalogowano(j) { PRO.ustawSesje(j.sesja); konto = j.konto; history.replaceState(null, '', location.pathname); start(); }

  function podepnijAuth() {
    document.querySelectorAll('#zakladki button').forEach(function (b) { b.onclick = function () { pokazFormularz(b.dataset.z); }; });
    $('pokaz-reset').onclick = function () { pokazFormularz('reset-start'); };
    $('f-logowanie').onsubmit = function (e) {
      e.preventDefault(); var f = this; zajety(f, true); msg(f, 'Logowanie…', true);
      PRO.api('logowanie', dane(f)).then(function (j) { zajety(f, false); if (j.ok) zalogowano(j); else msg(f, j.blad || 'Nie udało się zalogować.'); })
        .catch(function () { zajety(f, false); msg(f, 'Brak połączenia z serwerem. Spróbuj ponownie.'); });
    };
    $('f-rejestracja').onsubmit = function (e) {
      e.preventDefault(); var f = this; zajety(f, true); msg(f, 'Zakładamy konto…', true);
      PRO.api('rejestracja', dane(f)).then(function (j) {
        zajety(f, false);
        if (j.ok) { f.reset(); msg(f, 'Gotowe! Sprawdź skrzynkę e-mail i kliknij link potwierdzający – wtedy ruszy 3-dniowy okres próbny. (Sprawdź też SPAM.)', true); }
        else msg(f, j.blad || 'Nie udało się założyć konta.');
      }).catch(function () { zajety(f, false); msg(f, 'Brak połączenia z serwerem. Spróbuj ponownie.'); });
    };
    $('f-reset-start').onsubmit = function (e) {
      e.preventDefault(); var f = this; zajety(f, true);
      PRO.api('reset_start', dane(f)).then(function (j) { zajety(f, false); msg(f, j.ok ? 'Jeśli konto istnieje, wysłaliśmy link na ten adres (ważny 2 godziny).' : (j.blad || 'Błąd.'), j.ok); })
        .catch(function () { zajety(f, false); msg(f, 'Brak połączenia z serwerem.'); });
    };
    $('f-reset').onsubmit = function (e) {
      e.preventDefault(); var f = this; var d = dane(f); d.token = par.get('reset'); zajety(f, true);
      PRO.api('reset', d).then(function (j) { zajety(f, false); if (j.ok) zalogowano(j); else msg(f, j.blad || 'Błąd.'); })
        .catch(function () { zajety(f, false); msg(f, 'Brak połączenia z serwerem.'); });
    };
  }

  // ---------------- panel ----------------
  function rysujStatus() {
    var s = konto, el = $('status'), h = '';
    el.className = 'pro-status ' + s.plan;
    if (s.plan === 'proba') h = '<div><span class="pro-znaczek">Okres próbny</span><div>Zostało <strong>' + s.dni + ' ' + (s.dni === 1 ? 'dzień' : 'dni') + '</strong> (do ' + esc(s.do) + ').</div></div>';
    else if (s.plan === 'aktywny') h = '<div><span class="pro-znaczek">Abonament aktywny</span><div>Opłacony do <strong>' + esc(s.do) + '</strong>' + (s.auto ? ' · odnawia się automatycznie' : '') + '.</div></div>';
    else h = '<div><span class="pro-znaczek">Dostęp PRO wygasł</span><div>Zapisane działki i tereny są bezpieczne – włącz abonament, aby dalej analizować.</div></div>';
    h += '<div style="font-size:.85rem;color:var(--sage)">' + esc(s.imie || s.email) + (s.firma ? ' · ' + esc(s.firma) : '') + '</div>';
    el.innerHTML = h;
  }

  function start() {
    $('widok-auth').style.display = 'none'; $('widok-panel').style.display = ''; $('btn-wyloguj').style.display = '';
    rysujStatus(); rysujAbonament();
    var fk = $('f-konto'); fk.imie.value = konto.imie || ''; fk.firma.value = konto.firma || '';
    if (konto.plan !== 'wygasl') PRO.zapewnijDostep();
    startMapy(); odswiezListy();
  }

  // --- mapa i wybor dzialek ---
  // Klikniecie od razu zaznacza miejsce (numerowana pinezka); numer dzialki ustalamy w tle (ULDK),
  // wiec mozna szybko klikac kolejne dzialki. Klikniecie w zaznaczona dzialke - odznacza ja.
  var licznik = 0;
  function startMapy() {
    if (mapa || typeof L === 'undefined') { if (typeof L === 'undefined') $('mapa').innerHTML = '<p class="pro-pusto" style="padding:1rem">Mapa chwilowo niedostępna – dodawaj działki identyfikatorem.</p>'; return; }
    mapa = L.map('mapa', { center: [52.40, 16.92], zoom: 11 });
    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">autorzy OpenStreetMap</a>' }).addTo(mapa);
    var orto = L.tileLayer('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}', { maxNativeZoom: 19, maxZoom: 20, attribution: 'Ortofotomapa: GUGiK' });
    var dz = L.tileLayer.wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow', { layers: 'dzialki,numery_dzialek', format: 'image/png', transparent: true, minZoom: 15, maxZoom: 20, tileSize: 512, attribution: 'Działki: GUGiK' }).addTo(mapa);
    L.control.layers({ 'Mapa': osm, 'Ortofotomapa': orto }, { 'Granice działek': dz }, { collapsed: false }).addTo(mapa);
    // pojedyncze klikniecie = zaznaczenie; podwojne (przyblizanie) nie zaznacza
    var oczekujace = [];   // klikniecia czekajace 300 ms - podwojne klikniecie w tym samym miejscu je anuluje
    mapa.on('dblclick', function (e) {
      oczekujace = oczekujace.filter(function (o) { if (o.p.distanceTo(e.containerPoint) < 12) { clearTimeout(o.t); return false; } return true; });
    });
    mapa.on('click', function (e) {
      var o = { p: e.containerPoint }; o.t = setTimeout(function () { oczekujace = oczekujace.filter(function (x) { return x !== o; }); klik(e); }, 300);
      oczekujace.push(o);
    });
    var klik = function (e) {
      if (mapa.getZoom() < 15) { info('Przybliż mapę do granic działek (widoczne od tej skali), potem klikaj działki.'); return; }
      // klikniecie w juz zaznaczona dzialke = odznaczenie
      var traf = wybrane.filter(function (w) { return w.warstwa && wPolygonie(e.latlng, w.warstwa); })[0];
      if (traf) { usun(traf.k); return; }
      dodajPunkt(e.latlng);
    };
  }
  function wPolygonie(ll, warstwa) {
    var x = ll.lng, y = ll.lat, w = false;
    warstwa.getLatLngs().forEach(function (r) { r = Array.isArray(r[0]) ? r[0] : r; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i].lat > y) !== (r[j].lat > y) && x < (r[j].lng - r[i].lng) * (y - r[i].lat) / ((r[j].lat - r[i].lat) || 1e-12) + r[i].lng) w = !w; } });
    return w;
  }
  function info(t, ok) { $('mapa-info').textContent = t || ''; $('mapa-info').className = 'pro-msg ' + (ok ? 'ok' : 'zle'); }
  var KOLORY = ['#c9a961', '#2e8b57', '#3a6fb0', '#d0542f', '#8e5bb8', '#b8860b', '#1f9e9a', '#c2416f'];
  function kolor(w) { return KOLORY[wybrane.indexOf(w) % KOLORY.length]; }
  function ikona(n, kol) { return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div style="width:26px;height:26px;border-radius:50%;background:' + kol + ';color:#fff;font:600 13px Inter,sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">' + n + '</div>' }); }
  function dodajPunkt(ll) {
    if (wybrane.length >= MAKS) { info('Najwyżej ' + MAKS + ' działek naraz.'); return; }
    var w = { k: 'p' + (++licznik), id: '', stan: 'szuka' };
    wybrane.push(w);
    w.znacznik = L.marker(ll, { icon: ikona(wybrane.length, kolor(w)) }).addTo(mapa);
    rysujWybrane(); info('Zaznaczono – możesz klikać kolejne działki. Numery ustalamy w tle.', true);
    w.obietnica = fetch(ULDK_PROXY + '?xy=' + encodeURIComponent(ll.lng.toFixed(6) + ',' + ll.lat.toFixed(6)))
      .then(function (r) { return r.json(); }).then(function (d) {
        if (wybrane.indexOf(w) < 0) return;
        var id = d && d.id ? String(d.id) : '';
        if (!id) { w.stan = 'brak'; rysujWybrane(); return; }
        if (wybrane.some(function (x) { return x !== w && x.id === id; })) { usun(w.k); info('Ta działka jest już zaznaczona (' + id + ').'); return; }
        w.id = id; w.stan = 'ok'; rysujWybrane(); obrysuj(w);
      }).catch(function () { if (wybrane.indexOf(w) >= 0) { w.stan = 'blad'; rysujWybrane(); } });
  }
  function dodajId(id) {
    if (wybrane.some(function (x) { return x.id === id; })) return;
    if (wybrane.length >= MAKS) { info('Najwyżej ' + MAKS + ' działek naraz.'); return; }
    var w = { k: id, id: id, stan: 'ok' }; wybrane.push(w); rysujWybrane(); obrysuj(w, true);
  }
  function usun(k) {
    var w = wybrane.filter(function (x) { return x.k === k; })[0]; if (!w) return;
    if (w.znacznik) mapa.removeLayer(w.znacznik); if (w.warstwa) mapa.removeLayer(w.warstwa);
    wybrane.splice(wybrane.indexOf(w), 1);
    wybrane.forEach(function (x, i) { if (x.znacznik) x.znacznik.setIcon(ikona(i + 1, kolor(x))); if (x.warstwa) x.warstwa.setStyle({ color: kolor(x) }); });
    rysujWybrane();
  }
  function wktNaPierscienie(wkt) {
    return (String(wkt || '').match(/\(([^()]+)\)/g) || []).map(function (r) {
      return r.replace(/[()]/g, '').split(',').map(function (p) { var a = p.trim().split(/\s+/).map(Number); return [a[1], a[0]]; });
    }).filter(function (r) { return r.length >= 3; });
  }
  function obrysuj(w, przybliz) {
    if (!mapa || !w.id) return;
    fetch(ULDK_PROXY + '?id=' + encodeURIComponent(w.id)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.geom_wkt || wybrane.indexOf(w) < 0) return;
      w.warstwa = L.polygon(wktNaPierscienie(d.geom_wkt), { color: kolor(w), weight: 3, fillOpacity: 0.3, interactive: false }).addTo(mapa);
      w.pow = +d.powierzchnia || 0; rysujWybrane();
      if (przybliz) mapa.fitBounds(w.warstwa.getBounds(), { maxZoom: 18 });
    }).catch(function () {});
  }
  function ids() { return wybrane.filter(function (w) { return w.id; }).map(function (w) { return w.id; }); }
  // czeka, az wszystkie zaznaczone punkty dostana numer dzialki (maks. 20 s)
  function gotowe() {
    var czeka = wybrane.filter(function (w) { return w.stan === 'szuka' && w.obietnica; }).map(function (w) { return w.obietnica; });
    if (!czeka.length) return Promise.resolve(ids());
    info('Kończymy ustalanie numerów działek…', true);
    return Promise.race([Promise.all(czeka), new Promise(function (ok) { setTimeout(ok, 20000); })]).then(ids);
  }
  function rysujWybrane() {
    var suma = 0;
    $('wybrane').innerHTML = wybrane.length ? wybrane.map(function (w, i) {
      if (w.pow) suma += w.pow;
      var tekst = w.id ? esc(w.id) + (w.pow ? ' <span style="color:var(--sage)">· ' + Math.round(w.pow).toLocaleString('pl-PL') + ' m²</span>' : '')
        : w.stan === 'szuka' ? '<em style="color:var(--sage)">ustalamy numer…</em>' : '<span style="color:#e08a6a">' + (w.stan === 'brak' ? 'to nie jest działka' : 'brak odpowiedzi GUGiK') + '</span>';
      return '<span class="pro-chip"><b style="color:' + kolor(w) + '">' + (i + 1) + '</b>' + tekst + '<button title="Usuń" data-usun="' + esc(w.k) + '">×</button></span>';
    }).join('') + (suma ? '<span class="pro-pusto" style="align-self:center">razem ' + Math.round(suma).toLocaleString('pl-PL') + ' m²</span>' : '') : '<span class="pro-pusto">Nie wybrano działek – kliknij je na mapie.</span>';
    $('wybrane').querySelectorAll('[data-usun]').forEach(function (b) { b.onclick = function () { usun(b.dataset.usun); }; });
    var n = wybrane.filter(function (w) { return w.stan === 'ok' || w.stan === 'szuka'; }).length;
    $('btn-teren').disabled = n < 2; $('btn-raport').disabled = n !== 1;
    $('btn-zapisz-wybrane').disabled = !n; $('btn-wyczysc').disabled = !wybrane.length;
  }
  function szukajMiejsca() {
    var q = $('szukaj-miejsce').value.trim(); if (!q || !mapa) return;
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=pl&limit=1&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'pl' } })
      .then(function (r) { return r.json(); }).then(function (l) {
        if (!l.length) { info('Nie znaleziono tej miejscowości – dodaj gminę, np. „Janikowo, Swarzędz”.'); return; }
        mapa.setView([+l[0].lat, +l[0].lon], 16); info('Kliknij działki, które chcesz przeanalizować. (Wyszukiwanie: © autorzy OpenStreetMap)', true);
      }).catch(function () { info('Wyszukiwarka chwilowo niedostępna.'); });
  }
  function otworzRaport(id) { PRO.zapewnijDostep().then(function () { location.href = 'raport-rozszerzony.html?id=' + encodeURIComponent(id); }); }
  function otworzTeren(lista, idTerenu) { location.href = 'teren.html?dzialki=' + encodeURIComponent(lista.join(',')) + (idTerenu ? '&teren=' + idTerenu : ''); }

  // --- listy ---
  function odswiezListy() {
    PRO.api('dzialki').then(function (j) {
      if (!j.ok) return;
      zapisane = {};
      var zap = j.dzialki.filter(function (d) { return d.zapisana; }), hist = j.dzialki.slice().sort(function (a, b) { return a.ostatnio < b.ostatnio ? 1 : -1; }).slice(0, 30);
      zap.forEach(function (d) { zapisane[d.dzialka] = d; });
      var wiersz = function (d, zHistorii) {
        return '<li><div><div class="id">' + esc(d.dzialka) + '</div><div class="opis">' + esc(d.nazwa || d.opis || '') + (zHistorii ? ' · ' + esc(String(d.ostatnio).slice(0, 16)) : '') + '</div></div>'
          + '<div class="przyc"><button class="gwiazdka' + (d.zapisana ? ' on' : '') + '" title="' + (d.zapisana ? 'Usuń z zapisanych' : 'Zapisz') + '" data-gw="' + esc(d.dzialka) + '">★</button>'
          + '<button class="btn pro-mini" data-dodaj="' + esc(d.dzialka) + '">+ do wyboru</button>'
          + '<button class="btn pro-mini" data-raport="' + esc(d.dzialka) + '">Raport</button></div></li>';
      };
      $('lista-zapisane').innerHTML = zap.length ? zap.map(function (d) { return wiersz(d, false); }).join('') : '<li class="pro-pusto">Kliknij ★ przy działce, aby ją tu zapisać.</li>';
      $('lista-historia').innerHTML = hist.length ? hist.map(function (d) { return wiersz(d, true); }).join('') : '<li class="pro-pusto">Tu pojawią się działki, które sprawdzasz.</li>';
      podepnijListy();
    });
    PRO.api('tereny').then(function (j) {
      if (!j.ok) return;
      $('lista-tereny').innerHTML = j.tereny.length ? j.tereny.map(function (t) {
        return '<li><div><div>' + esc(t.nazwa || 'Teren bez nazwy') + '</div><div class="opis">' + t.dzialki.length + ' działki · ' + esc(t.dzialki.join(', ')) + '</div></div>'
          + '<div class="przyc"><button class="btn pro-mini" data-teren="' + t.id + '" data-lista="' + esc(t.dzialki.join(',')) + '">Otwórz</button><button class="btn pro-mini" data-usun-teren="' + t.id + '">Usuń</button></div></li>';
      }).join('') : '<li class="pro-pusto">Zapisz analizę kilku działek, aby wrócić do niej później.</li>';
      $('lista-tereny').querySelectorAll('[data-teren]').forEach(function (b) { b.onclick = function () { otworzTeren(b.dataset.lista.split(','), b.dataset.teren); }; });
      $('lista-tereny').querySelectorAll('[data-usun-teren]').forEach(function (b) { b.onclick = function () { if (confirm('Usunąć ten teren z zapisanych?')) PRO.api('teren_usun', { id: +b.dataset.usunTeren }).then(odswiezListy); }; });
    });
  }
  function podepnijListy() {
    document.querySelectorAll('[data-gw]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.gw, jest = !!zapisane[id];
        var nazwa = jest ? '' : (prompt('Nazwa / notatka do działki (opcjonalnie):', '') || '');
        PRO.api('dzialka_zapisz', { dzialka: id, nazwa: jest ? (zapisane[id].nazwa || '') : nazwa, zapisana: jest ? 0 : 1 }).then(odswiezListy);
      };
    });
    document.querySelectorAll('[data-dodaj]').forEach(function (b) { b.onclick = function () { dodajId(b.dataset.dodaj); $('mapa').scrollIntoView({ behavior: 'smooth', block: 'center' }); }; });
    document.querySelectorAll('[data-raport]').forEach(function (b) { b.onclick = function () { otworzRaport(b.dataset.raport); }; });
  }

  // --- abonament (PayU, karta zapisana w PayU) ---
  function rysujAbonament() {
    var s = konto, el = $('abonament'), cena = s.cena ? (s.cena / 100).toFixed(2).replace('.', ',') + ' zł / miesiąc' : '';
    if (s.plan === 'aktywny') {
      el.innerHTML = '<p>Abonament opłacony do <strong>' + esc(s.do) + '</strong>.' + (s.karta ? ' Karta: ' + esc(s.karta) + '.' : '') + '</p>'
        + (s.auto ? '<p style="margin-top:.6rem"><button class="btn" id="btn-auto-off">Wyłącz automatyczne odnowienie</button></p>' : '<p class="pro-pusto">Automatyczne odnowienie wyłączone – dostęp wygaśnie z końcem okresu.</p>');
      if ($('btn-auto-off')) $('btn-auto-off').onclick = function () { if (confirm('Wyłączyć automatyczne pobieranie opłaty? Dostęp zostanie do końca opłaconego okresu.')) PRO.api('odnowienie_wylacz').then(function (j) { if (j.ok) { konto = j.konto; rysujAbonament(); rysujStatus(); } }); };
      return;
    }
    if (!s.cena || !s.cykliczne) { el.innerHTML = '<p>' + (s.plan === 'proba' ? 'Korzystasz z bezpłatnego okresu próbnego.' : 'Okres próbny się zakończył.') + ' Płatny abonament uruchamiamy wkrótce – napisz do nas: <a href="mailto:kontakt@gruntowo.pl">kontakt@gruntowo.pl</a>, przedłużymy dostęp.</p>'; return; }
    el.innerHTML = '<p>Abonament <strong>' + cena + '</strong>, pobierany co miesiąc z karty. Możesz go wyłączyć w każdej chwili. Dane karty podajesz w bezpiecznym formularzu PayU – nie trafiają do nas.</p>'
      + '<button class="btn btn-gold" id="btn-abonament" style="margin-top:.8rem">Włącz abonament</button><div id="karta-box" class="pro-karta-platnosc" style="display:none;max-width:420px;margin-top:1rem"></div>';
    $('btn-abonament').onclick = pokazFormularzKarty;
  }
  function pokazFormularzKarty() {
    var box = $('karta-box'); box.style.display = ''; $('btn-abonament').style.display = 'none';
    box.innerHTML = '<p class="wczyt">Ładujemy bezpieczny formularz PayU…</p>';
    fetch(API_PLATNOSC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ akcja: 'konfiguracja', sesja: PRO.sesja() }) })
      .then(function (r) { return r.json(); }).then(function (c) {
        if (!c.ok || !c.wlaczone) { box.innerHTML = '<p class="pro-msg zle">Płatności chwilowo niedostępne.</p>'; return; }
        var s = document.createElement('script');
        s.src = c.sandbox ? 'https://secure.snd.payu.com/javascript/sdk' : 'https://secure.payu.com/javascript/sdk';
        s.onload = function () { formularzKarty(box, c); };
        s.onerror = function () { box.innerHTML = '<p class="pro-msg zle">Nie udało się wczytać formularza PayU.</p>'; };
        document.head.appendChild(s);
      });
  }
  function formularzKarty(box, c) {
    box.innerHTML = '<label class="pro-pole"><span>Numer karty</span><div class="pole-karty" id="payu-numer"></div></label>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem"><label class="pro-pole"><span>Ważna do</span><div class="pole-karty" id="payu-data"></div></label>'
      + '<label class="pro-pole"><span>CVV</span><div class="pole-karty" id="payu-cvv"></div></label></div>'
      + '<label class="pro-check"><input type="checkbox" id="zgoda-cykliczna"><span>Zgadzam się na comiesięczne obciążanie karty kwotą ' + (c.cena / 100).toFixed(2).replace('.', ',') + ' zł do czasu wyłączenia abonamentu (regulamin).</span></label>'
      + '<button class="btn btn-gold pro-btn-pelny" id="btn-zaplac">Zapłać i włącz abonament</button><p class="pro-msg" id="karta-msg"></p>'
      + '<p style="font-size:.72rem;color:var(--sage)">Płatność obsługuje PayU S.A. Pierwsza płatność może wymagać potwierdzenia w aplikacji banku (3-D Secure).</p>';
    var payu = window.PayU(c.pos_id), forms = payu.secureForms();
    var styl = { style: { basic: { fontSize: '15px' } }, lang: 'pl' };
    forms.add('number', styl).render('#payu-numer'); forms.add('date', styl).render('#payu-data'); forms.add('cvv', styl).render('#payu-cvv');
    $('btn-zaplac').onclick = function () {
      var m = $('karta-msg');
      if (!$('zgoda-cykliczna').checked) { m.textContent = 'Zaznacz zgodę na comiesięczne płatności.'; m.className = 'pro-msg zle'; return; }
      this.disabled = true; m.textContent = 'Przetwarzamy…'; m.className = 'pro-msg ok';
      var btn = this;
      payu.tokenize('MULTI').then(function (w) {
        if (w.status !== 'SUCCESS') { btn.disabled = false; m.textContent = (w.error && w.error.messages && w.error.messages[0] && w.error.messages[0].message) || 'Sprawdź dane karty.'; m.className = 'pro-msg zle'; return; }
        return fetch(API_PLATNOSC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sesja: PRO.sesja(), token_karty: w.body.token, strona: location.origin + location.pathname.replace(/\/[^\/]*$/, '') }) })
          .then(function (r) { return r.json(); }).then(function (j) {
            if (j.ok && j.redirect) { location.href = j.redirect; return; }
            if (j.ok) { location.href = 'pro.html?platnosc=' + j.ext; return; }
            btn.disabled = false; m.textContent = j.blad || 'Płatność nie powiodła się.'; m.className = 'pro-msg zle';
          });
      }).catch(function () { btn.disabled = false; m.textContent = 'Błąd połączenia z PayU.'; m.className = 'pro-msg zle'; });
    };
  }

  // ---------------- start strony ----------------
  document.addEventListener('DOMContentLoaded', function () {
    podepnijAuth();
    $('btn-wyloguj').onclick = function () { PRO.api('wyloguj').finally(function () { PRO.ustawSesje(''); try { var p = JSON.parse(localStorage.getItem('gruntowo_dostep_v2') || '{}'); if (p.haslo && p.haslo.pro) { delete p.haslo; localStorage.setItem('gruntowo_dostep_v2', JSON.stringify(p)); } } catch (e) {} location.href = 'pro.html'; }); };
    $('btn-szukaj-miejsce').onclick = szukajMiejsca; $('szukaj-miejsce').onkeydown = function (e) { if (e.key === 'Enter') szukajMiejsca(); };
    var dodajId = function () { var v = $('dodaj-id').value.trim(); if (!/^\d{6}_\d\.[0-9A-Za-z_]{1,12}\.[0-9A-Za-z_\/.\-]{1,30}$/.test(v)) { info('Nieprawidłowy identyfikator – format: 302116_5.0005.78/3'); return; } dodajId(v); $('dodaj-id').value = ''; };
    $('btn-dodaj-id').onclick = dodajId; $('dodaj-id').onkeydown = function (e) { if (e.key === 'Enter') dodajId(); };
    $('btn-teren').onclick = function () { gotowe().then(function (l) { if (l.length < 2) { info('Potrzebne są co najmniej 2 rozpoznane działki.'); return; } otworzTeren(l); }); };
    $('btn-raport').onclick = function () { gotowe().then(function (l) { if (l[0]) otworzRaport(l[0]); }); };
    $('btn-zapisz-wybrane').onclick = function () { gotowe().then(function (l) { return Promise.all(l.map(function (id) { return PRO.api('dzialka_zapisz', { dzialka: id, nazwa: (zapisane[id] || {}).nazwa || '', zapisana: 1 }); })); }).then(function (r) { info('Zapisano ' + (r || []).length + ' dz.', true); odswiezListy(); }); };
    $('btn-wyczysc').onclick = function () { wybrane.slice().forEach(function (w) { usun(w.k); }); info(''); };
    $('f-konto').onsubmit = function (e) { e.preventDefault(); var f = this; PRO.api('konto_zapisz', dane(f)).then(function (j) { msg(f, j.ok ? 'Zapisano.' : (j.blad || 'Błąd.'), j.ok); }); };
    $('f-haslo').onsubmit = function (e) { e.preventDefault(); var f = this; PRO.api('haslo_zmien', dane(f)).then(function (j) { msg(f, j.ok ? 'Hasło zmienione (inne urządzenia wylogowane).' : (j.blad || 'Błąd.'), j.ok); if (j.ok) f.reset(); }); };
    rysujWybrane();

    if (par.get('potwierdz')) {
      $('widok-auth').style.display = '';
      PRO.api('potwierdz', { token: par.get('potwierdz') }).then(function (j) { if (j.ok) zalogowano(j); else { pokazFormularz('logowanie'); msg($('f-logowanie'), j.blad || 'Link nieprawidłowy.'); } });
      return;
    }
    if (par.get('reset')) { $('widok-auth').style.display = ''; pokazFormularz('reset'); return; }
    if (!PRO.sesja()) { $('widok-auth').style.display = ''; pokazFormularz(par.get('nowe') ? 'rejestracja' : 'logowanie'); return; }
    PRO.api('ja').then(function (j) {
      if (!j.ok) { $('widok-auth').style.display = ''; pokazFormularz('logowanie'); return; }
      konto = j.konto; start();
      if (par.get('platnosc')) info('Dziękujemy! Gdy PayU potwierdzi płatność, abonament włączy się automatycznie (zwykle w ciągu minuty).', true);
      var dz = par.get('dodaj'); if (dz) dz.split(',').forEach(function (id) { if (id) dodajId(id); });
    }).catch(function () { $('widok-auth').style.display = ''; msg($('f-logowanie'), 'Brak połączenia z serwerem.'); });
  });
})();
