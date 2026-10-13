(function () {
  'use strict';

  // ⬇️ Link do Apps Script zapisujący zgłoszenia do Google Sheets (patrz INSTRUKCJA-FORMULARZ.txt)
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyIs7bFdclWzmjsHUbQOEfkKrA83huHCfzr3JUKXMOGyVBmDEhD9Gg0DKYB8oWNUyzM/exec';

  // ⬇️ CRM gruntowo (panel na LH) - tu trafiaja wszystkie zgloszenia ze strony
  const CRM_ENDPOINT = 'https://sniadecki-development.pl/gruntowo-api/zgloszenie.php';
  // ⬇️ Strona rezerwacji konsultacji w Zencal (zespol Kamil + Marcin). Puste = przycisk prowadzi do formularza kontaktowego.
  const ZENCAL_URL = 'https://app.zencal.io/o/gruntowo/kamilrosinski/konsultacja-z-ekspertem';
  const API_GRUNTOWO = 'https://sniadecki-development.pl/gruntowo-api';
  const CENA_KONSULTACJI = 499;
  function doCRM(dane) {
    return fetch(CRM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dane) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }
  // Konsultacja: najpierw krotki formularz u nas (zgloszenie trafia do CRM), potem wybor terminu w Zencal.
  // Dzieki temu CRM zna klienta i dzialke nawet bez platnych webhookow Zencal.
  if (ZENCAL_URL) document.querySelectorAll('[data-zencal]').forEach(function (a) {
    a.href = ZENCAL_URL;
    a.addEventListener('click', function (e) { e.preventDefault(); okienkoKonsultacji(''); });
  });
  function okienkoKonsultacji(dzialka) {
    let m = document.getElementById('konsult-modal');
    if (!m) {
      const st = document.createElement('style');
      st.textContent = '#konsult-modal{position:fixed;inset:0;z-index:2000;background:rgba(5,6,5,.78);display:flex;align-items:center;justify-content:center;padding:16px}' +
        '#konsult-modal form{width:100%;max-width:440px;background:#131410;border:1px solid rgba(201,169,110,.35);border-radius:14px;padding:1.6rem;color:#f2f0eb;position:relative;max-height:92vh;overflow:auto}' +
        '#konsult-modal h3{font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:1.7rem;margin:.2rem 0 .4rem;color:#dfc090}' +
        '#konsult-modal p{font-size:.88rem;color:#8a9a93;margin:0 0 1rem}#konsult-modal label{display:block;font-size:.78rem;color:#8a9a93;margin:.6rem 0 .25rem}' +
        '#konsult-modal .km-zgoda{display:flex;gap:.55rem;align-items:flex-start;font-size:.76rem;line-height:1.5;color:#b9c2bc;margin:.9rem 0 .3rem;cursor:pointer}#konsult-modal .km-zgoda input{width:auto;margin-top:.2rem;accent-color:#c9a96e}' +
        '#konsult-modal .km-rodo{font-size:.72rem;line-height:1.5;margin:.2rem 0 .8rem}#konsult-modal .km-rodo a{color:#c9a96e}' +
        '#konsult-modal input{width:100%;box-sizing:border-box;background:#1a1c17;border:1px solid #2a2c26;border-radius:8px;color:#f2f0eb;padding:.65rem .75rem;font:inherit}' +
        '#konsult-modal button[type=submit]{margin-top:1.1rem;width:100%;background:#c9a96e;color:#14181a;border:0;border-radius:8px;padding:.8rem;font-weight:600;font:inherit;cursor:pointer}' +
        '#konsult-modal .km-mapa-btn{margin-top:.5rem;background:none;border:0;color:#c9a96e;font:inherit;font-size:.8rem;text-decoration:underline;cursor:pointer;padding:0}' +
        '#konsult-modal .km-mapa{margin-top:.6rem;border:1px solid #2a2c26;border-radius:8px;overflow:hidden;flex-shrink:0}#konsult-modal .km-mapa-btn{flex-shrink:0}' +
        '#konsult-modal .km-szukaj{display:flex;gap:.4rem;padding:.4rem}#konsult-modal .km-szukaj input{flex:1;min-width:0;width:auto}' +
        '#konsult-modal .km-szukaj button{background:#c9a96e;color:#14181a;border:0;border-radius:6px;padding:0 .8rem;font:inherit;font-size:.8rem;cursor:pointer}' +
        '#konsult-modal form.km-start{max-width:560px}#konsult-modal .km-krok{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#c9a96e;margin:1rem 0 .35rem}' +
        '#konsult-modal .km-mapa-box{position:relative;height:300px}#konsult-modal .km-mapa-box .km-mapa-el{height:100%}' +
        '#konsult-modal .km-pin{position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);z-index:600;pointer-events:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}' +
        '#konsult-modal .km-dz{display:flex;justify-content:space-between;gap:.5rem;align-items:center;padding:.5rem .6rem;font-size:.8rem;color:#b9c2bc;border-top:1px solid #2a2c26}#konsult-modal .km-dz strong{color:#dfc090}' +
        '#konsult-modal .km-id-btn{background:none;border:0;color:#c9a96e;font:inherit;font-size:.76rem;text-decoration:underline;cursor:pointer;padding:0;white-space:nowrap}' +
        '#konsult-modal .km-id-pole[hidden]{display:none}#konsult-modal .km-id-pole{margin-top:.5rem}' +
        '#konsult-modal .km-dane{display:grid;grid-template-columns:1fr 1fr;gap:0 .6rem}#konsult-modal .km-dane .km-cala{grid-column:1/-1}@media(max-width:520px){#konsult-modal .km-dane{grid-template-columns:1fr}#konsult-modal .km-mapa-box{height:250px}}' +
        '#konsult-modal .km-mapa-el{height:260px}#konsult-modal .km-info{margin:0;padding:.45rem .6rem;font-size:.78rem;color:#8a9a93}#konsult-modal .km-info strong{color:#dfc090}' +
        '#konsult-modal form.km-szeroki{max-width:1000px;padding:1.1rem 1.2rem 1.2rem}#konsult-modal .km-ramka{width:100%;height:min(72vh,760px);border:0;border-radius:10px;background:#fff;display:block;margin-top:.6rem}' +
        '#konsult-modal .km-pod{display:flex;gap:.6rem;flex-wrap:wrap}#konsult-modal .km-pod>*{flex:1 1 220px}#konsult-modal .km-pod.km-wyroznij .km-gotowe{box-shadow:0 0 0 3px rgba(201,169,110,.55);animation:kmPuls 1.2s ease-in-out 3}' +
        '@keyframes kmPuls{50%{transform:scale(1.03)}}@media(max-width:640px){#konsult-modal{padding:6px}#konsult-modal form.km-szeroki{padding:.8rem;max-height:98vh}#konsult-modal .km-ramka{height:70vh}}' +
        '#konsult-modal .x{position:absolute;top:.6rem;right:.8rem;background:none;border:0;color:#8a9a93;font-size:1.6rem;cursor:pointer}#konsult-modal .msg{color:#ff9a7a;font-size:.85rem;min-height:1.2em;margin-top:.5rem}';
      document.head.appendChild(st);
      m = document.createElement('div'); m.id = 'konsult-modal';
      m.innerHTML = '<form novalidate><button type="button" class="x" aria-label="Zamknij">×</button>' +
        '<div style="font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e">Konsultacja z ekspertem · 499 zł</div>' +
        '<h3>Umów konsultację</h3><p>Wskaż działkę i zostaw dane. Po opłaceniu (PayU) od razu wybierzesz termin w kalendarzu, a raport rozszerzony działki dostaniesz w cenie konsultacji.</p>' +
        '<div class="km-krok">1 · Wskaż działkę</div>' +
        '<div class="km-mapa"><div class="km-szukaj"><input type="text" placeholder="Miejscowość, np. Janikowo, Komorniki" autocomplete="off"><button type="button">Szukaj</button></div>' +
        '<div class="km-mapa-box"><div class="km-mapa-el"></div><svg class="km-pin" width="34" height="44" viewBox="0 0 44 56" aria-hidden="true"><path d="M22 0C9.85 0 0 9.85 0 22c0 15.4 22 34 22 34s22-18.6 22-34C44 9.85 34.15 0 22 0z" fill="#c9a96e"/><circle cx="22" cy="21" r="9" fill="#0b0c0a"/></svg></div>' +
        '<div class="km-dz"><span class="km-info">Wyszukaj miejscowość i przesuń mapę tak, aby pinezka wskazała działkę.</span><button type="button" class="km-id-btn">Mam identyfikator</button></div></div>' +
        '<div class="km-id-pole" hidden><label>Identyfikator działki</label><input name="dzialka" placeholder="np. 302116_5.0005.78/3"></div>' +
        '<div class="km-krok">2 · Twoje dane</div><div class="km-dane">' +
        '<div><label>Imię i nazwisko</label><input name="imie" autocomplete="name" required></div>' +
        '<div><label>Telefon</label><input name="telefon" type="tel" autocomplete="tel"></div>' +
        '<div class="km-cala"><label>E-mail</label><input name="email" type="email" autocomplete="email" required></div></div>' +
        '<input name="strona_www" tabindex="-1" autocomplete="off" style="position:absolute;left:-5000px" aria-hidden="true">' +
        '<label class="km-zgoda"><input type="checkbox" name="zgoda_kontakt"> <span>Chcę otrzymywać od Śniadecki S.A. informacje o usługach gruntowo.pl (oferty, nowości) e-mailem i telefonicznie. Zgoda jest dobrowolna - możesz ją w każdej chwili wycofać.</span></label>' +
        '<p class="km-rodo">Administratorem Twoich danych jest Śniadecki S.A. Wykorzystamy je, aby umówić i przeprowadzić konsultację. Szczegóły w <a href="klauzula.html" target="_blank" rel="noopener">klauzuli informacyjnej</a>.</p>' +
        '<div class="msg" role="status"></div><button type="submit">Zapłać ' + CENA_KONSULTACJI + ' zł i wybierz termin →</button></form>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m || e.target.classList.contains('x')) m.style.display = 'none'; });
      // Mapa od razu (jak w raporcie bezplatnym): pinezka na srodku. Numer dzialki szukamy W TLE -
      // klient nie czeka; gdy numeru jeszcze nie ma, wysylamy wspolrzedne, a serwer ustali dzialke sam.
      const kmStan = { id: '', szukane: '', szuka: null, wsp: null };
      const kmMapaBox = m.querySelector('.km-mapa'), kmInfo = m.querySelector('.km-info'), kmPole = m.querySelector('input[name=dzialka]');
      let kmMapa = null, kmTimer = null;
      const kmUstalDzialke = function () {
        if (!kmMapa) return;
        const c = kmMapa.getCenter(), z = kmMapa.getZoom();
        kmStan.wsp = z >= 15 ? { lat: c.lat, lon: c.lng } : null;
        if (z < 15) { kmStan.id = ''; kmInfo.textContent = 'Przybliż mapę na swoją działkę (pinezka na środku).'; return; }
        const klucz = c.lng.toFixed(6) + ',' + c.lat.toFixed(6);
        kmInfo.innerHTML = 'Pinezka wskazuje działkę - <em>ustalamy numer…</em> (możesz już wypełniać dane)';
        kmStan.szukane = klucz; kmStan.id = '';
        kmStan.szuka = fetch(ULDK_PROXY + '?xy=' + encodeURIComponent(klucz)).then(function (r) { return r.json(); }).then(function (d) {
          const idP = d && d.id ? String(d.id) : '';
          if (kmStan.szukane !== klucz) return idP;   // klient w miedzyczasie przesunal mape - wynik dotyczy starego punktu
          if (idP) { kmStan.id = idP; kmInfo.innerHTML = 'Działka: <strong>' + idP.replace(/[<>&"]/g, '') + '</strong>'; }
          else kmInfo.textContent = 'Pinezka nie trafia w działkę ewidencyjną - przesuń mapę.';
          return idP;
        }).catch(function () { if (kmStan.szukane === klucz) kmInfo.textContent = 'Pinezka wskazuje działkę (numer ustalimy po zgłoszeniu).'; return ''; });
      };
      const kmStartMapy = function () {
        if (kmMapa) { setTimeout(function () { kmMapa.invalidateSize(); }, 50); return; }
        const el = m.querySelector('.km-mapa-el');
        if (typeof L === 'undefined') { el.innerHTML = '<p style="padding:1rem;font-size:.8rem;color:#8a9a93">Mapa chwilowo niedostępna - kliknij „Mam identyfikator” i wpisz numer działki.</p>'; return; }
        kmMapa = L.map(el, { center: [52.40, 16.92], zoom: 10 });
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(kmMapa);
        const orto = L.tileLayer('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}', { maxNativeZoom: 19, maxZoom: 20, attribution: 'GUGiK' });
        const dz = L.tileLayer.wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow', { layers: 'dzialki,numery_dzialek', format: 'image/png', transparent: true, minZoom: 16, maxZoom: 20, tileSize: 512 }).addTo(kmMapa);
        L.control.layers({ 'Mapa': osm, 'Ortofotomapa': orto }, { 'Granice działek': dz }, { collapsed: true }).addTo(kmMapa);
        kmMapa.on('movestart', function () { clearTimeout(kmTimer); kmStan.szukane = ''; kmStan.id = ''; });
        kmMapa.on('moveend', function () { clearTimeout(kmTimer); kmTimer = setTimeout(kmUstalDzialke, 450); });
        setTimeout(function () { kmMapa.invalidateSize(); }, 80);
      };
      m._kmStartMapy = kmStartMapy; m._kmStan = kmStan;
      const szukajPole = m.querySelector('.km-szukaj input');
      const szukaj = function () {
        const q = szukajPole.value.trim(); if (!q || !kmMapa) return;
        kmInfo.textContent = 'Szukamy…';
        szukajMiejscowosci(q).then(function (lista) {
          if (!lista.length) { kmInfo.textContent = 'Nie znaleźliśmy tej miejscowości - wpisz ją z gminą, np. „Janikowo, Swarzędz”.'; return; }
          kmMapa.setView([lista[0].lat, lista[0].lon], lista.length > 1 ? 12 : 16);
          if (lista.length > 1) pokazWyborMiejscowosci(lista, function (x) { kmMapa.setView([x.lat, x.lon], 16); },
            { box: m.querySelector('.km-mapa-box'), podpowiedz: function (t) { kmInfo.textContent = t; }, zmianaPo: m.querySelector('.km-dz') });
          else kmInfo.textContent = 'Przesuń mapę tak, aby pinezka wskazała Twoją działkę.';
        }).catch(function () { kmInfo.textContent = 'Wyszukiwarka chwilowo nie działa - przesuń mapę ręcznie.'; });
      };
      m.querySelector('.km-szukaj button').addEventListener('click', szukaj);
      szukajPole.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); szukaj(); } });
      m.querySelector('.km-id-btn').addEventListener('click', function () {
        const p = m.querySelector('.km-id-pole'); p.hidden = !p.hidden; if (!p.hidden) kmPole.focus();
      });
      m.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        const f = e.target, msg = f.querySelector('.msg'), btn = f.querySelector('button[type=submit]');
        const v = function (n) { return f.elements[n].value.trim(); };
        if (!v('imie') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) { msg.textContent = 'Podaj imię i poprawny e-mail.'; return; }
        // dzialka WYMAGANA (raport rozszerzony w cenie konsultacji) - identyfikator jak w raporcie bezplatnym
        // dzialka: wpisany identyfikator ALBO pinezka na mapie (numer moze sie jeszcze ustalac - nie czekamy)
        const wpisany = /^[0-9]{6}_[0-9]\.[0-9A-Za-z_]{1,12}\.[0-9A-Za-z_\/.\-]{1,30}$/.test(v('dzialka')) ? v('dzialka') : '';
        if (!wpisany && v('dzialka') && !kmStan.wsp) { msg.textContent = 'Identyfikator wygląda na niepełny (np. 302116_5.0005.78/3) - popraw go albo wskaż działkę na mapie.'; return; }
        if (!wpisany && !kmStan.wsp) { msg.textContent = 'Wskaż działkę: wyszukaj miejscowość i przybliż mapę tak, aby pinezka stała na działce.'; return; }
        btn.disabled = true; btn.textContent = 'Przechodzimy do płatności…';
        const dz0 = wpisany || kmStan.id, zgoda0 = !!(m.querySelector('[name=zgoda_kontakt]') && m.querySelector('[name=zgoda_kontakt]').checked);
        const wsp0 = !wpisany && kmStan.wsp ? kmStan.wsp.lat.toFixed(6) + ',' + kmStan.wsp.lon.toFixed(6) : '';
        const szuka0 = kmStan.szuka;
        // 1) platnosc PayU (zgloszenie w CRM zapisuje serwer); po zaplaceniu PayU wraca na gruntowo.pl/?konsultacja=oplacona
        fetch(API_GRUNTOWO + '/konsultacja-start.php', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imie: v('imie'), email: v('email'), telefon: v('telefon'), dzialka: dz0, wsp: wsp0, zgoda_kontakt: zgoda0 ? 'TAK' : 'NIE', strona_www: v('strona_www') }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok && d.redirect) {
              window.gruntowoZdarzenie && window.gruntowoZdarzenie('begin_checkout', { currency: 'PLN', value: CENA_KONSULTACJI, items: [{ item_name: 'Konsultacja z ekspertem' }] });
              window.location.href = d.redirect; return;
            }
            if (d && d.wylaczone) { kalendarzBezPlatnosci(); return; }   // platnosci online jeszcze nie wlaczone - jak dotad
            msg.textContent = (d && d.blad) || 'Nie udało się rozpocząć płatności. Spróbuj ponownie.';
            btn.disabled = false; btn.textContent = 'Zapłać ' + CENA_KONSULTACJI + ' zł i wybierz termin →';
          })
          .catch(function () {
            msg.textContent = 'Brak połączenia z serwerem płatności. Spróbuj ponownie za chwilę.';
            btn.disabled = false; btn.textContent = 'Zapłać ' + CENA_KONSULTACJI + ' zł i wybierz termin →';
          });
        // Dotychczasowa droga (bez platnosci online): CRM + kalendarz w nowej karcie
        function kalendarzBezPlatnosci() {
        // Kalendarz Zencal w NOWEJ karcie (otwarta od razu przy kliknieciu - inaczej przegladarka ja zablokuje);
        // gruntowo.pl zostaje w tej karcie z podziekowaniem, wiec po rezerwacji klient wraca na strone
        const zgodaK = !!(m.querySelector('[name=zgoda_kontakt]') && m.querySelector('[name=zgoda_kontakt]').checked);
        window.gruntowoZdarzenie && window.gruntowoZdarzenie('generate_lead', { formularz: 'konsultacja' });
        // kalendarz od razu; zgloszenie do CRM, gdy numer dzialki sie ustali (najwyzej 8 s czekania w tle)
        const daneCRM = { zrodlo: 'konsultacja', imie: v('imie'), email: v('email'), telefon: v('telefon'), zgoda_kontakt: zgodaK ? 'TAK' : 'NIE',
          temat: 'Konsultacja z ekspertem (bez płatności online) - WYŚLIJ klientowi raport rozszerzony działki', strona_www: v('strona_www'), strona: location.href };
        if (wsp0) { daneCRM.wspolrzedne = wsp0; daneCRM.mapa_link = 'https://www.google.com/maps?q=' + encodeURIComponent(wsp0); }
        Promise.race([dz0 ? Promise.resolve(dz0) : (szuka0 || Promise.resolve('')), new Promise(function (ok) { setTimeout(function () { ok(''); }, 8000); })])
          .then(function (idDz) { daneCRM.dzialka = dz0 || idDz || ''; return doCRM(daneCRM); });
        Promise.resolve()
          .then(function () {   // w Zencal i tak wybiera termin, nawet gdy CRM nie odpowie
            const imie = v('imie').split(' ')[0].replace(/[<>&"]/g, '');
            kalendarzNaStronie(function () {
              // bez platnosci online nie ma zamowienia, wiec dostep do raportu rozszerzonego nadajemy recznie (link e-mailem);
              // od razu pokazujemy bezplatny raport wskazanej dzialki
              const idR = dz0 || kmStan.id;
              komunikatKonsultacji('Dziękujemy' + (imie ? ', ' + imie : '') + '!',
                '<p>Potwierdzenie spotkania przyjdzie na e-mail. Raport rozszerzony ' + (idR ? 'działki <strong style="color:#dfc090">' + String(idR).replace(/[<>&"]/g, '') + '</strong> ' : 'wskazanej działki ') +
                'prześlemy Ci e-mailem przed spotkaniem.</p>' + (idR ? '<p>Już teraz możesz zobaczyć bezpłatny raport tej działki.</p>' : ''),
                (idR ? '<a href="raport.html?id=' + encodeURIComponent(idR) + '&ok=1" style="' + PRZYCISK_ZLOTY + '">Zobacz raport działki →</a>' : '') +
                '<button type="button" class="km-wroc" style="' + PRZYCISK_JASNY + '">Wróć na stronę</button>')
                .querySelector('.km-wroc').addEventListener('click', function () { document.getElementById('konsult-modal').style.display = 'none'; });
            });
          });
        }
      });
    }
    m.style.display = 'flex';
    const fm = m.querySelector('form');
    if (fm && fm.querySelector('.km-mapa')) {
      fm.classList.add('km-start');
      if (dzialka && fm.querySelector('input[name=dzialka]')) { fm.querySelector('input[name=dzialka]').value = dzialka; fm.querySelector('.km-id-pole').hidden = false; }
      if (m._kmStartMapy) m._kmStartMapy();
      setTimeout(function () { const p = fm.querySelector(dzialka ? 'input[name=imie]' : '.km-szukaj input'); if (p) p.focus(); }, 60);
    }
  }
  // Komunikat w okienku konsultacji (powrot z PayU / z kalendarza)
  function komunikatKonsultacji(tytul, tresc, przyciski) {
    okienkoKonsultacji('');
    const m = document.getElementById('konsult-modal'), f = m.querySelector('form');
    f.classList.remove('km-szeroki'); f.classList.remove('km-start');
    f.innerHTML = '<button type="button" class="x" aria-label="Zamknij">×</button>' +
      '<div style="font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e">Konsultacja z ekspertem · ' + CENA_KONSULTACJI + ' zł</div>' +
      '<h3>' + tytul + '</h3>' + tresc + (przyciski || '');
    return f;
  }
  const PRZYCISK_ZLOTY = 'display:block;width:100%;box-sizing:border-box;text-align:center;margin-top:1rem;background:#c9a96e;color:#14181a;border:0;border-radius:8px;padding:.8rem;font-weight:600;text-decoration:none;font:inherit;cursor:pointer';
  const PRZYCISK_JASNY = 'display:block;width:100%;margin-top:.6rem;background:none;border:1px solid #2a2c26;border-radius:8px;color:#f2f0eb;padding:.7rem;font:inherit;cursor:pointer';
  // 2) Powrot z PayU: sprawdzamy platnosc, potem kalendarz Zencal w TEJ karcie (po rezerwacji Zencal wraca na gruntowo.pl)
  function adresRaportuKonsultacji(ext, id) { return 'raport-rozszerzony.html?id=' + encodeURIComponent(id) + '&ok=1&zamowienie=' + ext; }
  function poPlatnosciKonsultacji(ext, id) {
    if (!/^[a-f0-9]{32}$/.test(ext)) return;
    if (!id) { try { const z = JSON.parse(localStorage.getItem('gruntowo_konsultacja') || 'null'); if (z && z.ext === ext) id = z.id; } catch (e) {} }
    komunikatKonsultacji('Sprawdzamy płatność…', '<p>To potrwa kilka sekund.</p>');
    let proby = 0;
    const sprawdz = function () {
      fetch(API_GRUNTOWO + '/platnosc-status.php?zamowienie=' + ext + '&id=' + encodeURIComponent(id || ''), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.dzialka && !id) id = d.dzialka;   // dzialka ustalona przez serwer ze wskazanego punktu
          if (d && d.oplacone) {
            try { if (!localStorage.getItem('gruntowo_kons_' + ext)) { localStorage.setItem('gruntowo_kons_' + ext, '1');
              window.gruntowoZdarzenie && window.gruntowoZdarzenie('purchase', { transaction_id: ext, currency: 'PLN', value: CENA_KONSULTACJI, items: [{ item_name: 'Konsultacja z ekspertem' }] }); } } catch (e) {}
            try { localStorage.setItem('gruntowo_konsultacja', JSON.stringify({ ext: ext, id: id })); } catch (e) {}
            const fp = komunikatKonsultacji('Płatność przyjęta - dziękujemy!',
              '<p>Teraz wybierz dogodny termin konsultacji w kalendarzu. ' + (id ? 'Po rezerwacji od razu otworzysz raport rozszerzony działki <strong style="color:#dfc090">' + String(id).replace(/[<>&"]/g, '') + '</strong>.' : 'Raport rozszerzony wskazanej działki prześlemy przed spotkaniem.') + '</p>',
              '<a href="' + ZENCAL_URL + '" class="km-kalendarz" style="' + PRZYCISK_ZLOTY + '">Wybierz termin →</a>' +
              (id ? '<a href="' + adresRaportuKonsultacji(ext, id) + '" target="_blank" rel="noopener" style="' + PRZYCISK_JASNY + ';text-align:center;text-decoration:none;box-sizing:border-box">Raport rozszerzony już teraz (nowa karta)</a>' : ''));
            podepnijKalendarz(fp.querySelector('.km-kalendarz'));
            return;
          }
          if (d && /CANCELED|REJECTED/.test(d.status || '')) {
            komunikatKonsultacji('Płatność nie została zrealizowana', '<p>Płatność została anulowana. Możesz spróbować ponownie - nic nie zostało pobrane.</p>',
              '<button type="button" class="km-ponow" style="' + PRZYCISK_ZLOTY + '">Spróbuj ponownie</button>')
              .querySelector('.km-ponow').addEventListener('click', function () { document.getElementById('konsult-modal').remove(); okienkoKonsultacji(''); });
            return;
          }
          if (++proby < 10) { setTimeout(sprawdz, 3000); return; }
          komunikatKonsultacji('Czekamy na potwierdzenie płatności', '<p>PayU jeszcze nie potwierdziło płatności. Zwykle trwa to chwilę - odśwież stronę za minutę. ' +
            'Jeśli płatność została pobrana, a problem się powtarza, napisz na <a href="mailto:kontakt@gruntowo.pl" style="color:#c9a96e">kontakt@gruntowo.pl</a>.</p>',
            '<button type="button" class="km-odswiez" style="' + PRZYCISK_ZLOTY + '">Sprawdź ponownie</button>')
            .querySelector('.km-odswiez').addEventListener('click', function () { poPlatnosciKonsultacji(ext); });
        })
        .catch(function () { if (++proby < 10) setTimeout(sprawdz, 4000); });
    };
    sprawdz();
  }
  // Kalendarz Zencal w OKNIE nad strona: gruntowo.pl zostaje pod spodem, wiec klient zawsze do niej wraca.
  // Gdy Zencal ma ustawiona strone podziekowania (?konsultacja=umowiona), okno samo sie zamyka
  // i strona pod spodem pokazuje potwierdzenie. Gdy przegladarka zablokuje okno - kalendarz w tej karcie.
  let oknoKalendarza = null;
  // Kalendarz Zencal OSADZONY w okienku na gruntowo.pl (iframe) - klient w ogole nie opuszcza strony.
  // sandbox BEZ allow-top-navigation: Zencal po rezerwacji probuje przeniesc cala karte na swoja strone potwierdzenia - blokujemy to,
  // wiec nie potrzeba strony podziekowania w Zencal. Po rezerwacji klika "Zarezerwowalem termin".
  function kalendarzNaStronie(poRezerwacji) {
    const f = komunikatKonsultacji('Wybierz termin konsultacji',
      '<p style="margin:0">Wybierz dzień i godzinę w kalendarzu poniżej. Po potwierdzeniu rezerwacji w kalendarzu kliknij <strong style="color:#dfc090">„Zarezerwowałem termin”</strong>.</p>' +
      '<iframe class="km-ramka" src="' + ZENCAL_URL + '" title="Kalendarz konsultacji" allow="payment; clipboard-write" loading="eager" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"></iframe>',
      '<div class="km-pod"><button type="button" class="km-gotowe" style="' + PRZYCISK_ZLOTY + '">Zarezerwowałem termin →</button>' +
      '<a href="' + ZENCAL_URL + '" target="_blank" rel="noopener" class="km-nowa" style="' + PRZYCISK_JASNY + ';margin-top:1rem;text-align:center;text-decoration:none;box-sizing:border-box">Kalendarz się nie wyświetla? Otwórz w nowej karcie</a></div>');
    f.classList.add('km-szeroki');
    const ramka = f.querySelector('.km-ramka'); let ladowania = 0;
    // kolejne zaladowanie ramki = klient przeszedl dalej w kalendarzu (zwykle potwierdzenie) -> wyrozniamy przycisk
    ramka.addEventListener('load', function () { if (++ladowania >= 2) { const p = f.querySelector('.km-pod'); if (p) p.classList.add('km-wyroznij'); } });
    f.querySelector('.km-gotowe').addEventListener('click', function () { f.classList.remove('km-szeroki'); (poRezerwacji || poRezerwacjiKonsultacji)(); });
    f.querySelector('.km-nowa').addEventListener('click', function () { const p = f.querySelector('.km-pod'); if (p) p.classList.add('km-wyroznij'); });
  }
  function podepnijKalendarz(a) {
    if (!a) return;
    a.addEventListener('click', function (e) { e.preventDefault(); kalendarzNaStronie(); });
  }
  // Gdyby Zencal przesylal z ramki informacje o rezerwacji - wylapujemy ja (bez szkody, gdy nie przesyla)
  window.addEventListener('message', function (e) {
    if (!/^https:\/\/([a-z0-9-]+\.)*zencal\.io$/.test(e.origin || '')) return;
    let t = ''; try { t = typeof e.data === 'string' ? e.data : JSON.stringify(e.data); } catch (e2) {}
    if (/confirm|booked|scheduled|meeting_created/i.test(t) && document.querySelector('#konsult-modal .km-ramka')) {
      const p = document.querySelector('#konsult-modal .km-pod'); if (p) p.classList.add('km-wyroznij');
    }
  });
  // Wiadomosc z okna kalendarza (strona podziekowania Zencal otwarta w oknie): rezerwacja zrobiona
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.gruntowo !== 'konsultacja_umowiona') return;
    try { if (oknoKalendarza && !oknoKalendarza.closed) oknoKalendarza.close(); } catch (e2) {}
    poRezerwacjiKonsultacji();
  });
  // To samo przez localStorage - dziala tez, gdy Zencal odetnie polaczenie okna ze strona (window.opener)
  window.addEventListener('storage', function (e) {
    if (e.key !== 'gruntowo_umowiona' || !oknoKalendarza) return;
    try { if (!oknoKalendarza.closed) oknoKalendarza.close(); } catch (e2) {}
    oknoKalendarza = null;
    poRezerwacjiKonsultacji();
  });
  // 3) Powrot z kalendarza Zencal po rezerwacji (adres ustawiony w Zencal jako strona podziekowania)
  function poRezerwacjiKonsultacji() {
    window.gruntowoZdarzenie && window.gruntowoZdarzenie('konsultacja_umowiona', {});
    let z = null; try { z = JSON.parse(localStorage.getItem('gruntowo_konsultacja') || 'null'); } catch (e) {}
    const raport = z && z.ext && z.id ? adresRaportuKonsultacji(z.ext, z.id) : '';
    const f = komunikatKonsultacji('Termin zarezerwowany - do zobaczenia!',
      '<p>Potwierdzenie spotkania i link do rozmowy wysłaliśmy na Twój e-mail.' + (raport ? ' Raport rozszerzony Twojej działki jest gotowy - otwórz go poniżej (dostęp przez 30 dni).' : ' Przed konsultacją przygotujemy analizę Twojej działki.') + '</p>',
      (raport ? '<a href="' + raport + '" style="' + PRZYCISK_ZLOTY + '">Otwórz raport rozszerzony →</a>' : '') +
      '<button type="button" class="km-wroc" style="' + PRZYCISK_JASNY + '">Wróć na stronę</button>');
    f.querySelector('.km-wroc').addEventListener('click', function () { document.getElementById('konsult-modal').style.display = 'none'; });
  }
  // Wejscie z raportu (przycisk "Umow konsultacje") -> od razu okienko konsultacji z numerem dzialki
  (function () {
    const p = new URLSearchParams(location.search);
    if (p.get('konsultacja') === 'oplacona' || p.get('konsultacja') === 'umowiona') {
      if (p.get('konsultacja') === 'oplacona') poPlatnosciKonsultacji(p.get('zamowienie') || '', p.get('dzialka') || '');
      else {
        // strona podziekowania otwarta w OKNIE kalendarza -> powiadom strone pod spodem i zamknij okno
        try { localStorage.setItem('gruntowo_umowiona', String(Date.now())); } catch (e) {}
        let wOknie = false;
        try { wOknie = !!(window.opener && !window.opener.closed && window.opener.location.origin === location.origin); } catch (e) { wOknie = false; }
        if (wOknie) { try { window.opener.postMessage({ gruntowo: 'konsultacja_umowiona' }, location.origin); window.opener.focus(); } catch (e) {} }
        if (window.name === 'gruntowo_zencal') setTimeout(function () { window.close(); }, 400);   // nasze okno kalendarza
        poRezerwacjiKonsultacji();
      }
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* bez znaczenia */ }
      return;
    }
    if (ZENCAL_URL && p.get('konsultacja') === '1') {
      okienkoKonsultacji(p.get('dzialka') || '');
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* bez znaczenia */ }
    }
  })();
  // "Sprawdz dzialke za darmo" -> wyszukiwarka na gorze strony + kursor w polu miejscowosci
  document.querySelectorAll('[data-do-wyszukiwarki]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      plynnieDo(0);
      setTimeout(function () { const i = document.getElementById('s-miasto'); if (i && i.offsetParent) i.focus({ preventScroll: true }); }, 600);
    });
  });

  // ===== HERO: film przewijany kolkiem; wyszukiwarka pojawia sie razem z przewijaniem =====
  (function () {
    // FILM = false: statyczne zdjecie hero.jpeg w tle (film z lotem nad polem wylaczony 13.10.2026; true = wlacza z powrotem)
    const FILM = false;
    const hero = document.querySelector('.hero');
    const sb = document.getElementById('search-box');
    if (!hero || !sb) return;
    const bg = hero.querySelector('.hero-bg');
    const malo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mysz = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let wysunieta = false, filmSteruje = false, wymusPelna = false;
    const wysun = function () {
      if (filmSteruje) { wymusPelna = true; return; }        // przy filmie wyszukiwarka idzie za kolkiem
      if (wysunieta) return; wysunieta = true;
      hero.classList.remove('hero-czeka'); sb.classList.add('wysuwa');
    };
    // Bez myszy (telefon), przy ograniczonym ruchu albo gdy ktos wchodzi z linku do wyszukiwarki - od razu
    // Wyszukiwarka widoczna od razu (ramka pod skosem, prostuje sie po najechaniu - hero-raport.css)
    if (!FILM || !mysz || malo || /#szukaj|#search-box/.test(location.hash)) { wysun(); }
    else {
      hero.classList.add('hero-czeka');
      window.addEventListener('scroll', function () { if (window.scrollY > 40 && !filmSteruje) wysun(); }, { passive: true });
      document.addEventListener('keydown', function (e) { if (e.key === 'Tab') wysun(); });
      document.querySelectorAll('[data-do-wyszukiwarki]').forEach(function (a) { a.addEventListener('click', wysun); });
    }
    if (!mysz || malo || !bg) return;

    // Film hero: strona stoi w miejscu, a kolko myszy najpierw wysuwa wyszukiwarke i prowadzi kamere w pole;
    // dopiero po dojechaniu do konca filmu strona przewija sie dalej. W gore - film cofa sie.
    // Tylko komputer; telefon, oszczedzanie danych albo blad pobierania = zostaje zdjecie i zwykle przewijanie.
    const film = bg.querySelector('.hero-film');
    const oszczedza = navigator.connection && navigator.connection.saveData;
    if (FILM && film && window.innerWidth >= 900 && !oszczedza && window.fetch && window.URL) {
      fetch(film.canPlayType('video/mp4; codecs="avc1.42E01E"') ? 'hero-pole.mp4?v=5' : 'hero-pole.webm?v=5')
        .then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (b) {
        film.src = URL.createObjectURL(b);
        film.addEventListener('loadeddata', function () {
          // Przebudowa hero (przeniesienie do sceny) restartuje animacje wejscia napisow - dlatego czekamy,
          // az napisy sie pojawia (ok. 1,7 s od wejscia), a potem wylaczamy ich animacje, zeby nie pojawily sie drugi raz
          setTimeout(function () {
          hero.classList.add('wejscie-zrobione');
          const dl = film.duration || 5.875;
          // Scena: hero przyklejone do gory ekranu przez dodatkowy odcinek przewijania
          const scena = document.createElement('div');
          scena.className = 'hero-scena';
          hero.parentNode.insertBefore(scena, hero); scena.appendChild(hero);
          hero.classList.add('hero-przyklejone');
          let droga = 0, gora = 0;
          const uloz = function () {
            droga = Math.round(window.innerHeight * 1.2);            // ile przewijania hero stoi (lot nad polem)
            const hH = hero.offsetHeight;
            // wyszukiwarka ma byc w calosci widoczna, gdy hero stoi
            const sbDol = sb.getBoundingClientRect().bottom - hero.getBoundingClientRect().top + 24;
            gora = Math.min(0, window.innerHeight - Math.max(sbDol, Math.min(hH, window.innerHeight)));
            hero.style.top = gora + 'px';
            scena.style.height = (hH + droga) + 'px';
          };
          uloz(); window.addEventListener('resize', uloz);
          if (window.ResizeObserver) new ResizeObserver(function () { uloz(); }).observe(hero);
          let cel = 0, cur = 0, petla = null, szuka = false, sw = 0;
          // Od teraz wyszukiwarka wyjezdza plynnie razem z filmem (kolko w dol), chowa sie przy powrocie na sama gore
          filmSteruje = true;
          // Stala warstwa pod cala strona: najpierw film (hero stoi), potem za liczbami i sekcja "Doswiadczenie..."
          // przenika w przekroj gleby, ktory przy przewijaniu przesuwa sie w gore (schodzimy w glab) i ciemnieje do czerni
          const warstwa = document.createElement('div'); warstwa.className = 'film-tlo'; warstwa.setAttribute('aria-hidden', 'true');
          warstwa.appendChild(film);
          const gleba = document.createElement('div'); gleba.className = 'gleba-tlo'; warstwa.appendChild(gleba);
          const cien = document.createElement('div'); cien.className = 'hero-cien'; warstwa.appendChild(cien);
          document.body.insertBefore(warstwa, document.body.firstChild);
          document.body.classList.add('film-aktywny');               // wylacza rozmycia tla nad filmem (oszczedza GPU)
          const sekcja = document.querySelector('.sekcja-film');
          // gleba trwa za sekcja "Doswiadczenie..." i "Zaawansowany model analityczny...", potem przechodzi w czern
          const koniec = document.getElementById('sourcing') || sekcja;
          if (wysunieta) { wymusPelna = true; }
          hero.classList.remove('hero-czeka'); hero.classList.add('hero-sterowane'); sb.classList.remove('wysuwa');
          let ostO = -1;
          const pokazSzukaj = function (o) {
            if (o === ostO) return; ostO = o;
            if (o >= 1) {
              // w pelni widoczna: bez transformacji i warstwy GPU - inaczej tekst bywa rozmyty
              // (zwlaszcza przy skalowaniu ekranu 125%/150% w Windows)
              sb.style.opacity = '1'; sb.style.transform = 'none'; sb.style.willChange = 'auto';   // jawnie 1 - dziala tez ze starszym style.css
            } else {
              sb.style.willChange = 'opacity, transform';
              sb.style.opacity = o.toFixed(3);
              sb.style.transform = 'translate3d(0,' + Math.round((1 - o) * 46) + 'px,0)';
            }
            sb.style.pointerEvents = o > 0.4 ? 'auto' : 'none';
            hero.classList.toggle('szukaj-widac', o > 0.02);
          };
          const t0 = performance.now();
          const zakres = function () {
            const y0 = scena.offsetTop - gora, y1 = y0 + droga;                // hero stoi: y0..y1
            const y2 = koniec ? Math.max(y1 + 200, koniec.offsetTop + koniec.offsetHeight - window.innerHeight) : y1 + window.innerHeight;
            return { y0: y0, y1: y1, y2: y2, y3: y2 + window.innerHeight * 0.7 };     // y2..y3: gasniecie do czerni
          };
          const postep = function () {                               // film gra tylko, gdy hero stoi
            const z = zakres();
            return Math.max(0, Math.min(1, (window.scrollY - z.y0) / droga));
          };
          let ostatniKrok = 0, ostKlatka = -1;
          const KL = 24;                                             // klatek na sekunde w filmie
          const krok = function (now) {
            // wygladzanie zalezne od czasu (tak samo plynnie na monitorach 60 Hz i 144 Hz)
            const dt = ostatniKrok ? Math.min(64, now - ostatniKrok) : 16; ostatniKrok = now;
            const k = 1 - Math.exp(-dt / (window.__lenis ? 50 : 140));   // przy plynnym przewijaniu strony mniejsze opoznienie filmu
            const a = Math.min(1, (now - t0) / 2600);
            const intro = 0;                                           // bez samoczynnego ruchu - kamera rusza dopiero od kolka
            const p = postep();
            const ps = Math.max(0, Math.min(1, (window.scrollY - scena.offsetTop) / droga));   // od pierwszego ruchu kolkiem
            if (window.scrollY > 2) pokazFilm();
            sw += (ps - sw) * 0.14; if (Math.abs(ps - sw) < 0.0008) sw = ps;
            pokazSzukaj(wymusPelna ? 1 : Math.max(0, Math.min(1, (sw - 0.01) / 0.15)));
            cel = Math.max(intro, p);
            cur += (cel - cur) * k;
            if (Math.abs(cel - cur) < 0.0008) cur = cel;
            const t = Math.min(dl - 0.04, cur * dl);
            const z = zakres(), y = window.scrollY, vh = window.innerHeight;
            // przekroj gleby zaczyna sie dokladnie pod paskiem z liczbami (dolna krawedz hero) - nad ta linia pole,
            // pod nia ziemia; gdy linia zniknie u gory ekranu, ziemia jedzie dalej wolniej (schodzimy w glab)
            ustawGlebe();
            // za tekstem sekcji "Doswiadczenie..." lekkie przyciemnienie dla czytelnosci, a nizej coraz ciemniej
            const ps2 = sekcja ? Math.max(0, Math.min(1, (y + vh - sekcja.offsetTop) / (vh * 0.8))) : 0;
            cien.style.opacity = (0.32 * ps2).toFixed(3);   // tekst ma juz wlasny kafelek, wiec tlo tylko lekko przyciemnione
            warstwa.style.opacity = (1 - Math.max(0, Math.min(1, (y - z.y2) / (z.y3 - z.y2)))).toFixed(3);
            // przewijamy film tylko, gdy zmienia sie klatka, i nigdy dwa przewiniecia naraz
            const kl = Math.round(t * KL);
            if (!szuka && kl !== ostKlatka) { ostKlatka = kl; szuka = true; film.currentTime = kl / KL; }
            if (cur === cel && sw === ps && a >= 1 && !szuka) { petla = null; ostatniKrok = 0; return; }
            petla = requestAnimationFrame(krok);
          };
          const budz = function () { if (!petla) petla = requestAnimationFrame(krok); };
          let filmWidac = false;
          function pokazFilm() { if (filmWidac) return; filmWidac = true; hero.classList.add('film-na-tle'); }
          // Granica pole/gleba musi isc dokladnie z przewijaniem - ustawiamy ja w TEJ SAMEJ klatce co przewiniecie
          // (zdarzenie Lenis / scroll), a nie w nastepnej klatce petli, bo wtedy przy szybkim przewijaniu robila sie szpara
          let glebaH = 0;
          function ustawGlebe() {
            const vh = window.innerHeight;
            const B = hero.getBoundingClientRect().bottom;
            if (!glebaH) glebaH = gleba.offsetHeight;
            gleba.style.opacity = B < vh ? '1' : '0';
            // po zniknieciu granicy zdjecie jedzie wolniej niz strona - dobrane tak, by dol zdjecia
            // dojechal do dolu ekranu dokladnie na koncu sekcji "Zaawansowany model analityczny"
            let k = 0.75;
            if (koniec) {
              const droga2 = (koniec.getBoundingClientRect().bottom - vh) - B;
              if (droga2 > 0) k = Math.max(0.25, Math.min(0.9, (glebaH - vh) / droga2));
            }
            const ty = B >= 0 ? B : Math.max(vh - glebaH, B * k);
            gleba.style.transform = 'translate3d(0,' + ty.toFixed(1) + 'px,0)';
          }
          window.addEventListener('resize', function () { glebaH = 0; ustawGlebe(); });
          if (window.__lenis) window.__lenis.on('scroll', ustawGlebe);
          window.addEventListener('scroll', ustawGlebe, { passive: true });
          ustawGlebe();
          film.addEventListener('seeked', function () { szuka = false; budz(); });
          window.addEventListener('scroll', function () { if (window.scrollY < zakres().y3 + window.innerHeight) budz(); }, { passive: true });
          film.currentTime = 0;
          pokazSzukaj(wymusPelna ? 1 : 0);
          film.classList.add('gotowy');
          // Warstwa z filmem stoi od razu POD zdjeciem hero (niewidoczna). Zdjecie znika dopiero przy pierwszym ruchu
          // kolkiem - wtedy kamera i tak rusza, wiec zamiana zdjecie -> film jest niezauwazalna (bez przyciemnienia).
          warstwa.classList.add('widac'); warstwa.style.opacity = '1';
          if (window.scrollY > 5) pokazFilm();
          budz();
          }, Math.max(0, (document.getElementById('hero-wizual') ? 3700 : 1700) - performance.now()));   // czekamy tez na animacje podgladu raportu
        }, { once: true });
      }).catch(function () { /* zostaje zdjecie */ });
    }

    // Tlo w osobnej warstwie (pod filmem); bez zblizenia za kursorem
    hero.classList.add('hero-ruch');
  })();

  // Pośrednik ULDK - ustala identyfikator działki z współrzędnych pinezki (ten sam co w raport.js)
  const ULDK_PROXY = 'https://script.google.com/macros/s/AKfycbzMevjlU6LD5YKp37spIFdNf8lEfkUWL03PuK8N2Ey8HqBBjBiPgvJASVGQP1yLp_Tf/exec';

  /* ---------- NAV ---------- */
  const nav = document.getElementById('nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });
  }

  /* ---------- MOBILE MENU ---------- */
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobile-menu');
  if (burger && menu) {
    const spans = burger.querySelectorAll('span');
    let open = false;
    const setMenu = (state) => {
      open = state;
      menu.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
      spans[0].style.transform = open ? 'translateY(6px) rotate(45deg)' : '';
      spans[1].style.opacity   = open ? '0' : '';
      spans[2].style.transform = open ? 'translateY(-6px) rotate(-45deg)' : '';
    };
    burger.addEventListener('click', () => setMenu(!open));
    document.querySelectorAll('.mm-link').forEach(l =>
      l.addEventListener('click', () => setMenu(false))
    );
  }

  /* ---------- SCROLL REVEAL ---------- */
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.card, .fmt, .eco-node, .rm, .pillar, .photo-frame, .dataroom')
    .forEach(el => { el.classList.add('reveal'); obs.observe(el); });

  /* ---------- SMOOTH ANCHORS ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (href === '#') return;
      const t = document.querySelector(href);
      if (t) {
        e.preventDefault();
        plynnieDo(t.getBoundingClientRect().top + window.scrollY - 90);
      }
    });
  });

  /* ---------- WYSZUKIWARKA: 3 KROKI + GOOGLE MAPS ---------- */
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step3 = document.getElementById('step-3');
  const btnNext = document.getElementById('btn-next');
  const btnBack = document.getElementById('btn-back');
  const btnSubmit = document.getElementById('btn-submit');

  function flashRow(el) {
    if (!el) return;
    const row = el.closest('.search-row');
    if (row) { row.style.borderColor = '#c9a96e'; setTimeout(function(){ row.style.borderColor=''; }, 1600); }
    el.focus();
  }

  // Zmienna przechowująca instancję mapy Leaflet i aktualne współrzędne środka
  let leafletMap = null;
  let aktualneWspolrzedne = { lat: null, lng: null };

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const miasto = document.getElementById('s-miasto').value.trim();
      if (!miasto) { flash(document.getElementById('s-miasto')); return; }

      step1.classList.add('hidden');
      step2.classList.remove('hidden');

      // Przewin do mapy (na telefonie klient od razu widzi mapę wyśrodkowaną)
      const box = document.getElementById('search-box');
      if (box) {
        setTimeout(function () {
          box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      }

      // Inicjalizuj mapę Leaflet (raz) i wyśrodkuj na miejscowości
      setTimeout(function () { inicjalizujMape(miasto); }, 150);
    });
    document.getElementById('s-miasto').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') btnNext.click();
    });
  }

  function inicjalizujMape(miasto) {
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl) return;

    // Bezpiecznik: jeśli Leaflet się nie załadował (blokada CDN), pokaż komunikat
    if (typeof L === 'undefined') {
      mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:2rem;text-align:center;color:var(--m);font-size:.85rem;">Mapa chwilowo niedostępna. Możesz kontynuować - podaj e-mail, a my zlokalizujemy działkę po numerze i miejscowości.</div>';
      const pin = document.getElementById('map-arrow');
      if (pin) pin.style.display = 'none';
      const hint = document.getElementById('map-coords-hint');
      if (hint) hint.textContent = '';
      return;
    }

    if (!leafletMap) {
      // Domyślnie środek Polski; zaraz przesuniemy na miejscowość
      leafletMap = L.map('leaflet-map', {
        center: [52.11, 19.42],
        zoom: 6,
        zoomControl: true,
        attributionControl: true
      });
      const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(leafletMap);
      // Te same przelaczniki co w mapie raportu: ortofotomapa GUGiK i granice dzialek (KIEG, od duzego przyblizenia)
      const orto = L.tileLayer('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}', { maxNativeZoom: 19, maxZoom: 20, attribution: 'GUGiK' })   // gotowe kafelki WMTS - kilka razy szybsze niz WMS;
      const dzialki = L.tileLayer.wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow', { layers: 'dzialki,numery_dzialek', format: 'image/png', transparent: true, minZoom: 16, maxZoom: 20, tileSize: 512 }).addTo(leafletMap);
      L.control.layers({ 'Mapa': osm, 'Ortofotomapa': orto }, { 'Granice działek': dzialki }, { collapsed: false }).addTo(leafletMap);

      // Zapisuj współrzędne środka przy każdym przesunięciu mapy
      const aktualizujWsp = function () {
        const c = leafletMap.getCenter();
        aktualneWspolrzedne = { lat: c.lat, lng: c.lng };
        const hint = document.getElementById('map-coords-hint');
        if (hint) {
          hint.textContent = 'Pinezka wskazuje: ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) +
            ' - przesuń mapę, aby dostosować.';
        }
      };
      leafletMap.on('move', aktualizujWsp);
      leafletMap.on('moveend', aktualizujWsp);
      aktualizujWsp();
    } else {
      leafletMap.invalidateSize();
    }

    // Geokoduj miejscowość przez Nominatim (OpenStreetMap) - darmowe, bez klucza.
    // Gdy w Polsce jest kilka miejscowości o tej nazwie - klient wybiera właściwą (gmina, powiat, województwo).
    const stary = document.getElementById('miejsca-wybor'); if (stary) stary.remove();
    const zm = document.getElementById('miejsca-zmien'); if (zm) zm.remove();
    szukajMiejscowosci(miasto)
      .then(function (lista) {
        if (!lista.length) { podpowiedzMapy('Nie znaleźliśmy tej miejscowości - przesuń i przybliż mapę ręcznie albo wpisz nazwę z gminą, np. „Janikowo, Swarzędz”.'); return; }
        leafletMap.setView([lista[0].lat, lista[0].lon], lista.length > 1 ? 12 : 16);
        if (lista.length > 1) pokazWyborMiejscowosci(lista, function (m) { leafletMap.setView([m.lat, m.lon], 16); });
      })
      .catch(function () { /* zostaje domyślny widok */ })
      .finally(function () { leafletMap.invalidateSize(); });
  }

  // Wyszukanie miejscowości: do 10 wyników z Nominatim, tylko miejscowości/części miast, bez powtórzeń
  function szukajMiejscowosci(nazwa) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=12&countrycodes=pl&q=' + encodeURIComponent(nazwa);
    return fetch(url, { headers: { 'Accept-Language': 'pl' } }).then(function (r) { return r.json(); }).then(function (w) {
      const typy = /^(city|town|village|hamlet|suburb|quarter|neighbourhood|isolated_dwelling|locality|borough|administrative)$/;
      const widziane = {}, lista = [];
      (w || []).forEach(function (x) {
        if (!typy.test(x.type || x.addresstype || '') && !typy.test(x.addresstype || '')) return;
        const a = x.address || {};
        const nazwaM = a.village || a.town || a.hamlet || a.suburb || a.quarter || a.neighbourhood || a.isolated_dwelling || a.city || (x.name || x.display_name.split(',')[0]);
        const gmina = (a.municipality || '').replace(/^gmina\s+/i, '');
        const powiat = (a.county || '').replace(/^powiat\s+/i, '');
        const woj = (a.state || '').replace(/^województwo\s+/i, '');
        const klucz = (nazwaM + '|' + gmina + '|' + powiat).toLowerCase();
        if (widziane[klucz]) return; widziane[klucz] = 1;
        const opis = [a.city && a.city !== nazwaM ? 'część m. ' + a.city : '', gmina ? 'gm. ' + gmina : '', powiat ? 'pow. ' + powiat : '', woj ? 'woj. ' + woj : ''].filter(Boolean).join(', ');
        lista.push({ nazwa: x.name || nazwaM, opis: opis || x.display_name, lat: +x.lat, lon: +x.lon });
      });
      // gdy nic nie pasuje do typów miejscowości (np. wpisano adres z ulicą) - bierzemy pierwszy wynik jak dotąd
      if (!lista.length && w && w.length) lista.push({ nazwa: w[0].name || nazwa, opis: w[0].display_name, lat: +w[0].lat, lon: +w[0].lon });
      return lista;
    });
  }
  function podpowiedzMapy(t) { const h = document.getElementById('map-coords-hint'); if (h) h.textContent = t; }
  // Okienko na mapie: "Która miejscowość?" z listą (gmina, powiat, województwo)
  function pokazWyborMiejscowosci(lista, poWyborze, opcje) {
    opcje = opcje || {};
    const box = opcje.box || document.querySelector('#step-2 .map-box'); if (!box) return;
    const podp = opcje.podpowiedz || podpowiedzMapy;
    if (!document.getElementById('mw-styl')) {
      const st = document.createElement('style'); st.id = 'mw-styl';
      st.textContent = '#miejsca-wybor{position:absolute;inset:10px;z-index:1200;background:rgba(14,15,12,.96);border:1px solid rgba(201,169,110,.45);border-radius:10px;display:flex;flex-direction:column;padding:.8rem;color:#f2f0eb;text-align:left}' +
        '#miejsca-wybor .mw-glowa{margin-bottom:.55rem}#miejsca-wybor .mw-glowa strong{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:1.35rem;color:#dfc090}#miejsca-wybor .mw-glowa span{font-size:.78rem;color:#8a9a93}' +
        '#miejsca-wybor .mw-lista{flex:1;overflow:auto;display:flex;flex-direction:column;gap:.35rem;min-height:0}' +
        '#miejsca-wybor .mw-lista button{background:#1a1c17;border:1px solid #2a2c26;border-radius:8px;color:#f2f0eb;padding:.4rem .7rem;text-align:left;cursor:pointer;font:inherit}#miejsca-wybor .mw-lista button:hover{border-color:#c9a96e}' +
        '#miejsca-wybor .mw-lista b{display:block;font-size:.9rem}#miejsca-wybor .mw-lista small{display:block;font-size:.74rem;color:#8a9a93;margin-top:.1rem}' +
        '#miejsca-wybor .mw-zamknij{margin-top:.55rem;background:none;border:0;color:#c9a96e;font:inherit;font-size:.78rem;text-decoration:underline;cursor:pointer;align-self:flex-start;padding:0}' +
        '#miejsca-zmien-k{margin:.4rem .6rem!important}#miejsca-zmien,#miejsca-zmien-k{background:none;border:0;color:#c9a96e;font:inherit;font-size:.78rem;text-decoration:underline;cursor:pointer;padding:0;margin:-.4rem 0 .8rem;display:block}';
      document.head.appendChild(st);
    }
    let p = document.getElementById('miejsca-wybor'); if (p) p.remove();
    p = document.createElement('div'); p.id = 'miejsca-wybor';
    p.innerHTML = '<div class="mw-glowa"><strong>Która miejscowość?</strong><span>Znaleźliśmy ' + lista.length + ' miejsc o tej nazwie - wybierz właściwe</span></div>' +
      '<div class="mw-lista">' + lista.map(function (m, i) {
        const e = function (t) { return String(t).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); };
        return '<button type="button" data-i="' + i + '"><b>' + e(m.nazwa) + '</b><small>' + e(m.opis) + '</small></button>';
      }).join('') + '</div><button type="button" class="mw-zamknij">Żadna z nich - przesunę mapę sam</button>';
    box.appendChild(p);
    p.querySelectorAll('.mw-lista button').forEach(function (b) {
      b.addEventListener('click', function () {
        const m = lista[+b.getAttribute('data-i')];
        p.remove(); poWyborze(m);
        podp('Wybrano: ' + m.nazwa + ' (' + m.opis + '). Przesuń mapę tak, aby pinezka wskazała Twoją działkę.');
        dodajZmiane(lista, poWyborze, opcje);
      });
    });
    p.querySelector('.mw-zamknij').addEventListener('click', function () { p.remove(); dodajZmiane(lista, poWyborze, opcje); });
    ['mousedown', 'touchstart', 'wheel', 'dblclick'].forEach(function (ev) { p.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
  }
  // Link pod mapą "Inna miejscowość o tej nazwie?" - otwiera listę ponownie
  function dodajZmiane(lista, poWyborze, opcje) {
    opcje = opcje || {};
    const id = opcje.zmianaPo ? 'miejsca-zmien-k' : 'miejsca-zmien';
    let a = document.getElementById(id);
    if (!a) {
      a = document.createElement('button'); a.type = 'button'; a.id = id; a.className = 'mw-zmien';
      const h = opcje.zmianaPo || document.getElementById('map-coords-hint'); if (h && h.parentNode) h.parentNode.insertBefore(a, h.nextSibling);
    }
    a.textContent = 'Inna miejscowość o tej nazwie? Zmień →';
    a.onclick = function () { pokazWyborMiejscowosci(lista, poWyborze, opcje); };
  }

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      step2.classList.add('hidden');
      step1.classList.remove('hidden');
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', () => {
      const emailEl = document.getElementById('s-email');
      const email = emailEl.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        flash(emailEl);
        return;
      }

      const miasto = document.getElementById('s-miasto') ? document.getElementById('s-miasto').value.trim() : '';
      const telefon = document.getElementById('s-telefon') ? document.getElementById('s-telefon').value.trim() : '';

      // Odczytaj współrzędne środka mapy (pod pinezką)
      let lat = null, lon = null;
      if (leafletMap) {
        const c = leafletMap.getCenter();
        lat = c.lat; lon = c.lng;
      } else if (aktualneWspolrzedne.lat) {
        lat = aktualneWspolrzedne.lat; lon = aktualneWspolrzedne.lng;
      }
      if (lat === null) { flash(emailEl); return; }
      const wsp = lat.toFixed(6) + ', ' + lon.toFixed(6);

      // Pokaż ekran "ustalamy działkę"
      step2.classList.add('hidden');
      step3.classList.remove('hidden');

      // Przewin do ekranu potwierdzenia (na telefonie widok nie skacze poza miejsce)
      const box = document.getElementById('search-box');
      if (box) {
        setTimeout(function () {
          box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }

      // Zapisz zgłoszenie do arkusza (w tle)
      if (FORM_ENDPOINT && FORM_ENDPOINT !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT') {
        const dane = new FormData();
        dane.append('miejscowosc', miasto);
        dane.append('dzialka', '(z mapy)');
        dane.append('email', email);
        dane.append('telefon', telefon);
        dane.append('zgoda_kontakt', document.getElementById('s-zgoda') && document.getElementById('s-zgoda').checked ? 'TAK' : 'NIE');
        dane.append('wspolrzedne', wsp);
        dane.append('mapa_link', 'https://www.google.com/maps?q=' + encodeURIComponent(wsp));
        dane.append('data', new Date().toLocaleString('pl-PL'));
        fetch(FORM_ENDPOINT, { method: 'POST', body: dane }).catch(function () {});
      }
      // ...i do CRM
      const zgodaS = !!(document.getElementById('s-zgoda') && document.getElementById('s-zgoda').checked);
      window.gruntowoZdarzenie && window.gruntowoZdarzenie('generate_lead', { formularz: 'raport_bezplatny_mapa' });
      // CRM dostaje zgloszenie z NUMEREM DZIALKI (gdy uda sie go ustalic) - wtedy klient dostaje e-mail z linkiem do raportu
      const doCRMraport = function (idDz) {
        const wyslij = doCRM({ zrodlo: 'raport_darmowy', email: email, telefon: telefon, miejscowosc: miasto, wspolrzedne: wsp, zgoda_kontakt: zgodaS ? 'TAK' : 'NIE',
          dzialka: idDz || '', mapa_link: 'https://www.google.com/maps?q=' + encodeURIComponent(wsp), strona: location.href });
        return Promise.race([wyslij, new Promise(function (ok) { setTimeout(ok, 3000); })]);   // nie trzymamy klienta dluzej niz 3 s
      };

      // Ustal identyfikator działki z współrzędnych (przez pośrednik ULDK), potem raport
      if (ULDK_PROXY && ULDK_PROXY !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT_ULDK') {
        fetch(ULDK_PROXY + '?xy=' + encodeURIComponent(lon + ',' + lat))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.id) {
              // Mamy identyfikator - zapis do CRM (+ e-mail z linkiem), potem raport (dane już zebrane: ok=1)
              doCRMraport(data.id).then(function () { window.location.href = 'raport.html?id=' + encodeURIComponent(data.id) + '&ok=1'; });
            } else {
              doCRMraport('');
              pokazBlad(data.error || 'Nie udało się ustalić działki w tym punkcie.');
            }
          })
          .catch(function () {
            doCRMraport('');
            pokazBlad('Wystąpił błąd połączenia. Spróbuj ponownie za chwilę.');
          });
      } else {
        doCRMraport('');
        // Brak pośrednika - pokaż komunikat zastępczy
        const ct = document.getElementById('confirm-title');
        const cx = document.getElementById('confirm-text');
        if (ct) ct.textContent = 'Zgłoszenie przyjęte';
        if (cx) cx.innerHTML = 'Otrzymaliśmy Twoje zgłoszenie. Przeanalizujemy działkę i wyślemy raport na e-mail <strong>w ciągu 6 godzin</strong>.';
      }
    });
  }

  function pokazBlad(tekst) {
    const ct = document.getElementById('confirm-title');
    const cx = document.getElementById('confirm-text');
    if (ct) ct.textContent = 'Nie udało się ustalić działki';
    if (cx) {
      cx.innerHTML = tekst + '<br><br><button type="button" onclick="location.reload()" style="background:var(--gold);color:var(--bg);border:none;padding:.6rem 1.4rem;border-radius:4px;font-family:var(--fb);font-weight:500;cursor:pointer;letter-spacing:.05em;">Spróbuj ponownie</button>';
    }
  }

  function flash(el) {
    if (!el) return;
    const row = el.closest('.search-row');
    if (row) {
      row.style.borderColor = '#c9a96e';
      setTimeout(() => { row.style.borderColor = ''; }, 1600);
    }
    el.focus();
  }

  /* ---------- FORMULARZ KONTAKTOWY ---------- */
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const name = document.getElementById('c-name').value.trim();
      const email = document.getElementById('c-email').value.trim();

      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMsg(form, 'Proszę uzupełnić imię i poprawny adres e-mail.', 'error');
        return;
      }

      btn.textContent = 'Wysyłanie…';
      btn.disabled = true;

      const hp = form.querySelector('[name="strona_www"]');
      window.gruntowoZdarzenie && window.gruntowoZdarzenie('generate_lead', { formularz: 'kontakt' });
      doCRM({
        zrodlo: 'kontakt', imie: name, email: email,
        zgoda_kontakt: document.getElementById('c-zgoda') && document.getElementById('c-zgoda').checked ? 'TAK' : 'NIE',
        telefon: document.getElementById('c-tel') ? document.getElementById('c-tel').value.trim() : '',
        temat: document.getElementById('c-topic').value, wiadomosc: document.getElementById('c-msg').value.trim(),
        strona_www: hp ? hp.value : '', strona: location.href
      }).then(function (w) {
        if (w && w.ok) {
          showMsg(form, 'Dziękujemy! Odezwiemy się w ciągu jednego dnia roboczego.', 'success');
          form.reset();
        } else {
          showMsg(form, (w && w.blad) ? w.blad : 'Nie udało się wysłać - napisz do nas: kontakt@gruntowo.pl', 'error');
        }
        btn.textContent = 'Wyślij wiadomość';
        btn.disabled = false;
      });
    });
  }

  function showMsg(form, text, type) {
    const old = form.querySelector('.form-message');
    if (old) old.remove();
    const m = document.createElement('p');
    m.className = 'form-message';
    m.textContent = text;
    const ok = type === 'success';
    m.style.cssText = 'font-size:.82rem;padding:.75rem 1rem;border-radius:3px;border:1px solid ' +
      (ok ? 'rgba(201,169,110,.35)' : 'rgba(220,80,80,.35)') + ';color:' +
      (ok ? '#c9a96e' : '#e07070') + ';background:' +
      (ok ? 'rgba(201,169,110,.08)' : 'rgba(220,80,80,.08)');
    form.appendChild(m);
    setTimeout(() => m.remove(), 6000);
  }
})();

/* ===========================================================
   CMS: TREŚCI Z GOOGLE SHEETS
   -----------------------------------------------------------
   Strona pobiera opublikowany arkusz (CSV) i podstawia teksty
   do elementów oznaczonych atrybutem data-cms.
   Instrukcja publikacji arkusza - w pliku INSTRUKCJA.txt
   =========================================================== */
(function () {
  'use strict';

  // Link do arkusza BEZ gid - Google bierze wtedy pierwsza zakladke (Arkusz1),
  // niezaleznie od jej numeru. Dzieki temu link nie psuje sie przy edycji arkusza
  // (wczesniej gid zmienial sie za kazdym importem, co psulo pobieranie tresci).
  const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRs5AKabD0xvgDy2K4pm1EI9iuO8ZZrDAJOJ9M00UQGjO-3daVSSOcSOwQyh1KQpg/pub?single=true&output=csv';

  // Jeśli link nie został jeszcze ustawiony - nie rób nic (strona pokaże domyślne teksty z HTML)
  if (!SHEET_CSV_URL) return;

  fetch(SHEET_CSV_URL)
    .then(function (r) { return r.text(); })
    .then(function (csv) {
      const data = parseCSV(csv);
      // data to tablica wierszy; oczekujemy kolumn: klucz, tresc
      const map = {};
      data.forEach(function (row) {
        if (row.length >= 2 && row[0]) {
          map[row[0].trim()] = row[1];
        }
      });
      // Podstaw treści
      document.querySelectorAll('[data-cms]').forEach(function (el) {
        const key = el.getAttribute('data-cms');
        if (map[key] !== undefined && map[key] !== '') {
          // Pozwól na <br> i <em> w treści z arkusza; ceny "69.0" -> "69", dlugie myslniki -> krotkie
          let v = String(map[key]).replace(/^(\d+)\.0+$/, '$1').replace(/\s*—\s*/g, ' - ');
          const norm = function (x) { return x.replace(/\s+/g, ' ').replace(/<br\s*\/?>/gi, '<br>').trim(); };
          // podmieniamy tylko, gdy tresc naprawde sie rozni - inaczej napis "mrugal" po wczytaniu
          if (norm(el.innerHTML) !== norm(v)) el.innerHTML = v;
        }
      });
      // Listy wyboru z arkusza (np. tematy w formularzu kontaktowym): pozycje rozdzielone znakiem | albo ;
      document.querySelectorAll('select[data-cms-lista]').forEach(function (sel) {
        const v = map[sel.getAttribute('data-cms-lista')];
        if (!v || !String(v).trim()) return;
        const pozycje = String(v).split(/\s*[|;\n]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (!pozycje.length) return;
        const obecne = Array.prototype.slice.call(sel.options).filter(function (o) { return o.value !== ''; }).map(function (o) { return o.text; });
        if (obecne.join('|') === pozycje.join('|')) return;   // bez zmian - nie przebudowujemy
        const wybrane = sel.value, pierwsza = sel.options[0] && sel.options[0].value === '' ? sel.options[0].text : 'Wybierz…';
        sel.innerHTML = '';
        sel.appendChild(new Option(pierwsza, ''));
        pozycje.forEach(function (t) { sel.appendChild(new Option(t, t)); });
        if (wybrane && pozycje.indexOf(wybrane) > -1) sel.value = wybrane;
      });
    })
    .catch(function (e) {
      console.warn('CMS: nie udało się pobrać arkusza -', e);
      // Strona pokaże domyślne teksty z HTML
    });

  // Prosty parser CSV (obsługuje cudzysłowy i przecinki w treści)
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (inQuotes) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* ignoruj */ }
        else { field += c; }
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ---------- ANIMOWANE LICZNIKI (statystyki hero) ---------- */
  // Rozpoznaje liczbe w tekscie (np. "80 mln zl", "12 lat", "44 180 m2")
  // i animuje ja od zera do wartosci, gdy uzytkownik doscrolluje.
  function animujLiczniki() {
    const staty = document.querySelectorAll('.hstat-n');
    if (!staty.length) return;

    const animuj = function (el) {
      if (el.dataset.animowane) return;   // animuj tylko raz
      const oryginal = el.textContent.trim();
      // Pomin formaty typu "24/7" (ukosnik) - to nie liczba do nabijania
      if (oryginal.indexOf('/') !== -1) return;
      // Znajdz pierwsza liczbe (moze miec spacje jako separatory tysiecy)
      const match = oryginal.match(/[\d\s]*\d/);
      if (!match) return;
      const liczbaTekst = match[0];
      const cel = parseInt(liczbaTekst.replace(/\s/g, ''), 10);
      if (isNaN(cel) || cel === 0) return;

      el.dataset.animowane = '1';
      const przed = oryginal.slice(0, match.index);
      const po = oryginal.slice(match.index + liczbaTekst.length);
      const czas = 2400;                  // czas animacji w ms
      const start = performance.now();

      const krok = function (teraz) {
        const post = Math.min((teraz - start) / czas, 1);
        // Lagodne wyhamowanie na koncu (easeOutCubic)
        const e = 1 - Math.pow(1 - post, 3);
        const wartosc = Math.round(cel * e);
        // Formatuj z separatorem tysiecy (spacja), jak w oryginale
        const sform = wartosc.toLocaleString('pl-PL').replace(/,/g, ' ');
        el.textContent = przed + sform + po;
        if (post < 1) requestAnimationFrame(krok);
        else el.textContent = oryginal;   // na koncu przywroc dokladny oryginal
      };
      requestAnimationFrame(krok);
    };

    // Uruchom animacje gdy statystyki wejda w widok
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(function (wpisy) {
        wpisy.forEach(function (w) {
          if (w.isIntersecting) animuj(w.target);
        });
      }, { threshold: 0.5 });
      staty.forEach(function (el) { obs.observe(el); });
    } else {
      // Starsze przegladarki - animuj od razu
      staty.forEach(animuj);
    }
  }

  // Interaktywna sekcja modeli - najechanie na karte pokazuje inne zdjecie + panel analizy.
  (function () {
    const karty = document.querySelectorAll('.src-card');
    const visual = document.getElementById('src-visual');
    if (!karty.length || !visual) return;
    const pokaz = function (nr) {
      visual.querySelectorAll('.src-foto').forEach(function (f) {
        f.classList.toggle('aktywne', f.classList.contains('src-foto-' + nr));
      });
      visual.querySelectorAll('.src-panel').forEach(function (p) {
        p.classList.toggle('aktywne', p.classList.contains('src-panel-' + nr));
      });
      visual.querySelectorAll('.hwm').forEach(function (p) {          // karty-ekrany modeli (hero-raport.css)
        if (p.classList.contains('hwm-' + nr) !== p.classList.contains('aktywne')) p.classList.toggle('aktywne');
      });
      karty.forEach(function (k) {
        k.classList.toggle('card-hi', k.getAttribute('data-model') === String(nr));
      });
    };
    karty.forEach(function (k) {
      const nr = k.getAttribute('data-model');
      k.addEventListener('mouseenter', function () { pokaz(nr); });
      k.addEventListener('click', function () { pokaz(nr); });  // klik na mobile
    });
  })();

  // Animacja etapow konsultacji - strzalka przechodzi przez kolejne etapy.
  // Wariant B - sekcja przyklejana. Postep scrolla przez wysoki kontener (etapy-pin)
  // napedza strzalke i etapy. Strona "stoi" (sticky), a scroll przewija etapy.
  (function () {
    const pin = document.getElementById('etapy-pin');
    const strzalka = document.getElementById('etapy-strzalka');
    const linia = document.querySelector('.etapy-linia');
    const etapy = document.querySelectorAll('.etap');
    if (!pin || !strzalka || !linia || !etapy.length) return;

    let tick = false;
    const aktualizuj = function () {
      tick = false;
      const pinBox = pin.getBoundingClientRect();
      const vh = window.innerHeight;
      // Postep 0..1: 0 gdy gora kontenera dochodzi do gory ekranu,
      // 1 gdy przewinelismy caly "zapas" (wysokosc kontenera - ekran).
      const przewijalne = pinBox.height - vh;   // ile scrolla "pochlania" przyklejanie
      let postep = (-pinBox.top) / przewijalne;
      postep = Math.max(0, Math.min(1, postep));

      const liniaBox = linia.getBoundingClientRect();
      const zakres = liniaBox.height - 32;
      strzalka.style.top = (postep * zakres) + 'px';

      const aktywny = Math.min(etapy.length - 1, Math.floor(postep * etapy.length + 0.12));
      etapy.forEach(function (e, idx) {
        e.classList.toggle('etap-aktywny', idx <= aktywny);
      });
    };

    const onScroll = function () {
      if (!tick) { tick = true; requestAnimationFrame(aktualizuj); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    aktualizuj();
  })();

  // Uruchom liczniki - z opoznieniem, zeby tresci z arkusza zdazyly sie wczytac
  setTimeout(animujLiczniki, 1200);
  // I jeszcze raz po dluzszym czasie, na wypadek wolnego wczytania CMS
  setTimeout(function () {
    document.querySelectorAll('.hstat-n').forEach(function (el) {
      if (!el.dataset.animowane) {
        // jesli tresc sie zmienila po pierwszej probie, animuj teraz
        el.dataset.animowane = '';
      }
    });
    animujLiczniki();
  }, 2500);
})();

// Plynne przewijanie calej strony (jak na olchowezacisze.pl): kolko myszy przesuwa strone z lekkim "poslizgiem".
// Biblioteka Lenis (licencja MIT, plik lenis.min.js w repo). Tylko komputer z myszka; telefon i ograniczony ruch - zwykle przewijanie.
function plynnieDo(top) {
  if (window.__lenis) window.__lenis.scrollTo(top, { duration: 1.2 });
  else window.scrollTo({ top: top, behavior: 'smooth' });
}
(function () {
  if (!window.Lenis || !window.matchMedia) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    window.__lenis = new Lenis({
      lerp: 0.08,                 // im mniej, tym dluzszy poslizg
      wheelMultiplier: 0.9,
      autoRaf: true,
      // w okienku konsultacji, na mapach i w menu kolko dziala normalnie (przewijanie listy, zoom mapy)
      prevent: function (n) { return !!(n && n.closest && n.closest('#konsult-modal, .leaflet-container, .mobile-menu, [data-lenis-prevent]')); }
    });
    // Po zatrzymaniu przewijania ustawiamy strone na pelny piksel. Plynne przewijanie konczy sie czasem
    // na ulamku piksela (np. przy skalowaniu ekranu 125%) i wtedy tekst w przyklejonym hero byl lekko rozmyty.
    let tPiksel = null;
    window.__lenis.on('scroll', function () {
      clearTimeout(tPiksel);
      tPiksel = setTimeout(function () {
        const y = window.scrollY;
        if (Math.abs(y - Math.round(y)) > 0.01 && window.__lenis) window.__lenis.scrollTo(Math.round(y), { immediate: true, force: true });
      }, 150);
    });
  } catch (e) { window.__lenis = null; }
})();
