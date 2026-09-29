(function () {
  'use strict';

  // Posrednik do ULDK + transakcji (Apps Script). Puste = tryb demo (mapy dzialaja, dane opisowe nie).
  const ULDK_PROXY = 'https://script.google.com/macros/s/AKfycbzMevjlU6LD5YKp37spIFdNf8lEfkUWL03PuK8N2Ey8HqBBjBiPgvJASVGQP1yLp_Tf/exec';

  // Zapis zgloszen z raportu do Google Sheets (ten sam co formularz na stronie glownej).
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyIs7bFdclWzmjsHUbQOEfkKrA83huHCfzr3JUKXMOGyVBmDEhD9Gg0DKYB8oWNUyzM/exec';

  // ⬇️ Statystyki gmin z pliku CSV na Google Drive (opublikowany jako CSV).
  //    Puste = sekcja statystyk gminy ukryta. Patrz INSTRUKCJA-STATYSTYKI.txt
  const STATS_CSV_URL = 'WKLEJ_TUTAJ_LINK_CSV_STATYSTYKI';

  // ⬇️ WLASNA BAZA CEN transakcyjnych (RCN z geoforum, przetworzona do CSV) na Google Drive.
  //    Puste = uzywana jest tylko warstwa WMS cen z Geoportalu. Patrz INSTRUKCJA-CENY-BAZA.txt
  const CENY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQEZXE_tccUW0_ktbxwJW6C2RL1TLSAssbYaWSbNlWX2YTLeMzIIGVCMAD5pA9JwCKdmb-iZvN6A43X/pub?gid=0&single=true&output=csv';

  // ⬇️ BACKEND SQL (opcjonalny). Jesli ustawiony, raport pyta backend zamiast CSV —
  //    szybciej i skalowalnie. Jesli pusty albo backend nie odpowie, uzywa CSV jako zapasu.
  //    Przyklad: 'https://twoj-serwer-lh.pl/ceny'  albo  'http://localhost:5000/ceny' (test)
  const BACKEND_CENY_URL = 'https://sniadecki-development.pl/gruntowo-api/ceny.php';

  const $ = function (id) { return document.getElementById(id); };

  // ===== ZDARZENIA DLA INNYCH SKRYPTOW (np. raport-rozszerzony.js) =====
  // Raport darmowy dziala bez zmian; te zdarzenia tylko "oglaszaja" pobrane dane,
  // zeby raport rozszerzony mogl je wykorzystac bez ponownego pobierania.
  //   gruntowo:dzialka  -> { id, data (odpowiedz ULDK), bbox, centrum }
  //   gruntowo:ceny     -> { zrodlo, rodzaj, liczba, mediana_m2, promien_m, rozszerzony, transakcje }
  //   gruntowo:wymiary  -> { dlugosc, szerokosc, obwod, boki }
  window.gruntowoRaport = window.gruntowoRaport || {};
  function oglos(nazwa, dane) {
    try { document.dispatchEvent(new CustomEvent(nazwa, { detail: dane })); } catch (e) { /* stara przegladarka */ }
  }

  // ===== POCZEKALNIA (ekran ladowania) =====
  let poczekalniaTimer = null;
  function pokazPoczekalnie() {
    const ov = $('loading-overlay');
    if (!ov) return;
    ov.classList.add('show');

    const kroki = [
      'Pobieramy dane dzialki z rejestru GUGiK...',
      'Wczytujemy ortofotomape i granice ewidencyjne...',
      'Nakladamy plan zagospodarowania (MPZP)...',
      'Sprawdzamy ceny transakcyjne w okolicy...',
      'Analizujemy uzbrojenie terenu i sieci...',
      'Sprawdzamy formy ochrony przyrody i zabytki...',
      'Skladamy raport w calosc...'
    ];
    let i = 0;
    const krokEl = $('loading-krok');
    const barEl = $('loading-bar-fill');
    const N = kroki.length;
    if (krokEl) krokEl.textContent = kroki[0];
    if (barEl) barEl.style.width = Math.round(100 / N) + '%';

    poczekalniaTimer = setInterval(function () {
      i++;
      if (i < N) {
        if (krokEl) krokEl.textContent = kroki[i];
        if (barEl) barEl.style.width = Math.round(((i + 1) / N) * 100) + '%';
      }
    }, 6000);

    // Domknij po max 60s (gdyby cos zawieszlo, raport i tak sie pokaze)
    setTimeout(ukryjPoczekalnie, 60000);
  }
  function ukryjPoczekalnie() {
    const ov = $('loading-overlay');
    const barEl = $('loading-bar-fill');
    if (barEl) barEl.style.width = '100%';
    if (poczekalniaTimer) { clearInterval(poczekalniaTimer); poczekalniaTimer = null; }
    if (ov) { setTimeout(function () { ov.classList.remove('show'); }, 400); }
  }
  const start = $('start'), report = $('report');
  const input = $('id-input');
  const btnGen = $('btn-generuj'), btnNowa = $('btn-nowa'), btnPdf = $('btn-pdf');

  document.querySelectorAll('.chip').forEach(function (c) {
    c.addEventListener('click', function () { input.value = c.getAttribute('data-id'); input.focus(); });
  });
  $('btn-pokazmape').addEventListener('click', function () {
    const m = $('pickmap');
    m.classList.toggle('show');
    if (m.classList.contains('show') && !m.dataset.loaded) {
      m.innerHTML = '<iframe src="https://mapy.geoportal.gov.pl/imap/Imgp_2.html?locale=pl&gpmap=gp0" title="Geoportal"></iframe>';
      m.dataset.loaded = '1';
    }
  });

  btnGen.addEventListener('click', function () { generuj(false); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { const em = $('r-email'); if (em) em.focus(); } });
  const emailField = $('r-email');
  if (emailField) emailField.addEventListener('keydown', function (e) { if (e.key === 'Enter') generuj(false); });
  btnNowa.addEventListener('click', function () {
    report.classList.remove('show'); start.style.display = 'flex';
    btnNowa.style.display = 'none'; btnPdf.style.display = 'none';
    input.value = ''; input.focus();
    window.scrollTo(0, 0);
  });
  // PDF = wydruk strony w jasnym ukladzie A4 (raport-druk.css) -> "Zapisz jako PDF".
  // Nic nie jest pobierane ponownie — do PDF trafia to, co juz jest na stronie.
  function drukujRaport() {
    const stary = document.title;
    const rozszerzony = !!document.getElementById('werdykt-gora');
    const t = ($('rep-title') ? $('rep-title').textContent : '').replace(/Dzialka/, 'Działka').trim();
    document.title = (rozszerzony ? 'Raport rozszerzony' : 'Raport o terenie') + ' - ' + t + ' - gruntowo.pl';  // = nazwa pliku PDF
    let toast = document.querySelector('.pdf-toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'pdf-toast'; document.body.appendChild(toast); }
    toast.textContent = 'W oknie drukowania wybierz „Zapisz jako PDF” (Miejsce docelowe).';
    toast.style.display = 'block';
    setTimeout(function () {
      window.print();
      document.title = stary;
      setTimeout(function () { toast.style.display = 'none'; }, 3000);
    }, 300);
  }
  window.gruntowoDrukuj = drukujRaport;
  btnPdf.addEventListener('click', drukujRaport);

  // Wejscie z URL:
  //  ?id=...&ok=1  → dane zebrano na stronie glownej, generuj od razu
  //  ?id=...       → wypelnij ID, ale wymagaj e-maila (klient wszedl bezposrednio)
  (function () {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const ok = params.get('ok');
    if (id) {
      input.value = id;
      if (ok === '1') {
        // Dane juz zebrane i zapisane na stronie glownej — pomijamy walidacje e-maila
        generuj(true);
      } else {
        const emailEl = $('r-email');
        if (emailEl) emailEl.focus();
      }
    }
  })();

  function generuj(pomijEmail) {
    const id = input.value.trim();
    if (!id) { input.style.borderColor = '#b08d3e'; input.focus(); return; }

    const emailEl = $('r-email');
    const telEl = $('r-tel');
    const email = emailEl ? emailEl.value.trim() : '';
    const tel = telEl ? telEl.value.trim() : '';

    // Walidacja e-maila (chyba ze dane juz zebrano na stronie glownej — pomijEmail=true)
    if (!pomijEmail && emailEl) {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailEl.style.borderColor = '#b08d3e';
        emailEl.focus();
        return;
      }
      emailEl.style.borderColor = '';
    }

    // Zapis do Google Sheets — tylko gdy dane wpisano tutaj (nie gdy juz zapisano na stronie glownej)
    if (!pomijEmail && FORM_ENDPOINT && FORM_ENDPOINT !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT' && email) {
      const dane = new FormData();
      dane.append('miejscowosc', '(raport z identyfikatora)');
      dane.append('dzialka', id);
      dane.append('email', email);
      dane.append('telefon', tel);
      dane.append('data', new Date().toLocaleString('pl-PL'));
      fetch(FORM_ENDPOINT, { method: 'POST', body: dane }).catch(function () {});
    }

    start.style.display = 'none';
    report.classList.add('show');
    btnNowa.style.display = 'inline-flex';
    btnPdf.style.display = 'inline-flex';
    window.scrollTo(0, 0);

    // Pokaz poczekalnie na czas ladowania warstw
    pokazPoczekalnie();

    const dzis = new Date().toLocaleDateString('pl-PL');
    $('rep-date').textContent = dzis;
    $('rep-date2').textContent = dzis;
    $('rep-id').textContent = id;
    $('p-id').textContent = id;
    window.gruntowoRaport.id = id;

    if (ULDK_PROXY && ULDK_PROXY !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT_ULDK') {
      pobierzDane(id);
    } else {
      trybDemo(id);
    }
  }

  function pobierzDane(id) {
    $('rep-notice').innerHTML = 'Pobieranie danych z rejestru GUGiK...';
    fetch(ULDK_PROXY + '?id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error || !data.geom_wkt) throw new Error(data.error || 'brak danych');
        renderuj(id, data);
      })
      .catch(function (e) {
        console.warn('ULDK:', e);
        $('rep-notice').innerHTML = '<strong>Nie udalo sie pobrac danych</strong> dla tego identyfikatora. Sprawdz format (TERYT_ARKUSZ.OBREB.NUMER) lub wskaz dzialke na mapie.';
        trybDemo(id, true);
      });
  }

  function renderuj(id, data) {
    const woj = data.voivodeship || '—', powiat = data.county || '—';
    const gmina = data.commune || '—', obreb = data.region || '—';
    const nr = data.parcel || id.split('.').pop();
    const area = data.powierzchnia ? Math.round(data.powierzchnia).toLocaleString('pl-PL') + ' m2' : '—';
    const ha = data.powierzchnia ? (data.powierzchnia / 10000).toFixed(2) + ' ha' : '';

    $('rep-title').textContent = 'Dzialka nr ' + nr;
    $('rep-sub').textContent = (ha ? ha + ' · ' : '') + 'gm. ' + gmina + ', ' + powiat + ', woj. ' + woj;
    $('rep-area').textContent = area;
    $('rep-loc').textContent = woj;
    $('p-obreb').textContent = obreb; $('p-area').textContent = area;
    $('p-gmina').textContent = gmina; $('p-powiat').textContent = powiat; $('p-woj').textContent = woj;

    const bbox = bboxZWKT(data.geom_wkt);
    if (bbox) {
      const c = srodek(bbox);
      $('rep-coords').textContent = coords(c.lat, c.lon);
      rysujMapy(bbox, data.geom_wkt);
      // Zapamietaj parametry do przeliczania wyceny po zmianie typu
      window._wycenaParam = { lat: c.lat, lon: c.lon, powierzchnia: data.powierzchnia };
      // Ustaw przelacznik typu wg wykrycia z ULDK (zabudowa: zabudowana/niezabudowana/nieznana)
      ustawTypPorownania(data.zabudowa);
      // Domyslnie ZAWSZE zaczynamy od niezabudowanych (glowny przypadek analizy — grunt
      // pod inwestycje). Klient moze przelaczyc na zabudowane jednym klikiem, jesli trzeba.
      const rodzajStart = 'niezabudowana';
      pobierzCenyZBazy(c.lat, c.lon, data.powierzchnia, rodzajStart);
      window.gruntowoRaport.mpzp = null;   // wyniki poprzedniej dzialki nieaktualne
      window.gruntowoRaport.pog = null;
      window.gruntowoRaport.dzialka = { id: id, data: data, bbox: bbox, centrum: c };
      oglos('gruntowo:dzialka', window.gruntowoRaport.dzialka);
    }
    $('rep-notice').innerHTML = '<strong>Dane rzeczywiste</strong> z rejestru GUGiK (ULDK) dla ' + id + '.';

    // Streszczenie na gorze — parametry
    if ($('pods-pow')) $('pods-pow').textContent = area;
    if ($('pods-lok')) $('pods-lok').textContent = 'gm. ' + gmina + ', ' + woj;

    // Statystyki gminy z Google Drive (jesli podlaczone)
    pobierzStatystykiGminy(gmina, powiat, woj);

    // Transakcje z pobliza (jesli posrednik zwrocil)
    if (data.transakcje && data.transakcje.length) {
      rysujTransakcje(data.transakcje);
      // Policz orientacyjna wartosc: mediana ceny/m2 x powierzchnia
      wyliczCene(data.transakcje, data.powierzchnia);
    }
  }

  // Ustawia przelacznik typu porownania (niezabudowana/zabudowana) nad wycena.
  // domyslnie ZAWSZE niezabudowana; jesli ULDK wykryl zabudowe, pokazujemy to jako podpowiedz.
  function ustawTypPorownania(zabudowa) {
    const box = document.getElementById('typ-porownania');
    if (!box) return;
    // Domyslny wybor to zawsze niezabudowana (glowny przypadek analizy).
    const domyslny = 'niezabudowana';
    // Podpowiedz: jesli ULDK wykryl ZABUDOWANA, sugerujemy klientowi przelaczenie.
    let hint = 'wybierz typ dzialki';
    if (zabudowa === 'zabudowana') hint = 'ULDK wykryl zabudowe — mozesz przelaczyc';
    else if (zabudowa === 'niezabudowana') hint = 'dzialka niezabudowana';

    box.innerHTML =
      '<span class="typ-label">Porownuj z dzialkami:</span>' +
      '<button class="typ-btn' + (domyslny === 'niezabudowana' ? ' typ-aktywny' : '') + '" data-typ="niezabudowana">niezabudowanymi</button>' +
      '<button class="typ-btn' + (domyslny === 'zabudowana' ? ' typ-aktywny' : '') + '" data-typ="zabudowana">zabudowanymi</button>' +
      '<span class="typ-hint">' + hint + '</span>';
    box.style.display = 'flex';

    box.querySelectorAll('.typ-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        box.querySelectorAll('.typ-btn').forEach(function (b) { b.classList.remove('typ-aktywny'); });
        btn.classList.add('typ-aktywny');
        const nowyTyp = btn.getAttribute('data-typ');
        const p = window._wycenaParam;
        if (p) pobierzCenyZBazy(p.lat, p.lon, p.powierzchnia, nowyTyp);
      });
    });
  }

  // Pobiera WLASNA baze cen (CSV z Google Drive), filtruje po odleglosci od dzialki,
  // liczy mediane i wypelnia liste transakcji + wartosc orientacyjna.
  // Wypelnia pole "Szacunkowa wartosc dzialki" w sekcji cen (pod mapa/suwakiem).
  // Zmienia sie razem z suwakiem niezabudowane/zabudowane.
  function ustawSzacCeneBox(wartosc, opis, rodzaj) {
    const box = $('cena-szac-box');
    if (!box) return;
    if ($('cena-szac-val')) $('cena-szac-val').textContent = wartosc.toLocaleString('pl-PL') + ' zl';
    if ($('cena-szac-sub')) {
      const typ = (rodzaj === 'zabudowana') ? 'dzialki zabudowane' : 'dzialki niezabudowane';
      $('cena-szac-sub').textContent = opis + ' · porownanie: ' + typ;
    }
    box.style.display = 'block';
  }

  function pobierzCenyZBazy(lat, lon, powierzchnia, rodzaj) {
    rodzaj = rodzaj || 'niezabudowana';
    // NAJPIERW sprobuj backend SQL (jesli ustawiony) — szybszy i skalowalny.
    if (BACKEND_CENY_URL && BACKEND_CENY_URL !== 'WKLEJ_TUTAJ_LINK_BACKENDU') {
      const url = BACKEND_CENY_URL + '?lon=' + lon + '&lat=' + lat + '&promien=1500&rodzaj=' + rodzaj;
      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('backend nie odpowiada');
          return r.json();
        })
        .then(function (dane) {
          if (!dane || !dane.transakcje) throw new Error('brak danych z backendu');
          // Przelicz format backendu na to, czego oczekuje reszta raportu
          const bliskie = dane.transakcje.map(function (t) {
            return {
              dist: t.odleglosc_m || 0,
              cena: t.cena || 0,
              cenaM2: t.cena_m2 || 0,
              pow: t.powierzchnia_m2 || 0,
              data: t.data || '',
              rodzaj: t.rodzaj || '',
              mpzp: t.mpzp || '',
              id: t.id_dzialki || '',
              lon: parseFloat(t.lon) || 0,
              lat: parseFloat(t.lat) || 0
            };
          });
          oglos('gruntowo:ceny', {
            zrodlo: 'backend', rodzaj: rodzaj,
            liczba: dane.liczba_transakcji || bliskie.length,
            mediana_m2: dane.mediana_cena_m2 || 0,
            promien_m: dane.promien_m || 1500,
            rozszerzony: !!dane.rozszerzony,
            transakcje: bliskie
          });
          if (!bliskie.length) return;
          // Mediana prosto z backendu (juz policzona po stronie serwera)
          if (dane.mediana_cena_m2 && powierzchnia && $('pods-cena')) {
            const wartosc = Math.round(dane.mediana_cena_m2 * powierzchnia);
            $('pods-cena').textContent = wartosc.toLocaleString('pl-PL') + ' zl';
            const promienKm = ((dane.promien_m || 1500) / 1000).toFixed(1).replace('.0', '');
            let opis = 'mediana ' + Math.round(dane.mediana_cena_m2).toLocaleString('pl-PL') +
              ' zl/m2 z ' + dane.liczba_transakcji + ' transakcji w promieniu ' + promienKm + ' km';
            if (dane.rozszerzony) opis += ' (poszerzony)';
            if ($('pods-cena-sub')) $('pods-cena-sub').textContent = opis;
            // Powtorz wartosc w sekcji cen (aktualizuje sie z suwakiem)
            ustawSzacCeneBox(wartosc, opis, rodzaj);
          }
          rysujTransakcjeZBazy(bliskie.slice(0, 20));
        })
        .catch(function () {
          // Backend nie zadzialal — sprobuj CSV jako zapas
          pobierzCenyZCSV(lat, lon, powierzchnia, rodzaj);
        });
      return;
    }
    // Brak backendu — od razu CSV
    pobierzCenyZCSV(lat, lon, powierzchnia, rodzaj);
  }

  // Zapasowe zrodlo cen: plik CSV z Google Drive (dziala gdy nie ma backendu)
  function pobierzCenyZCSV(lat, lon, powierzchnia, rodzaj) {
    rodzaj = rodzaj || 'niezabudowana';
    if (!CENY_CSV_URL || CENY_CSV_URL === 'WKLEJ_TUTAJ_LINK_CSV_CENY') return;

    fetch(CENY_CSV_URL)
      .then(function (r) { return r.text(); })
      .then(function (csv) {
        const wiersze = parseCSVprosty(csv);
        if (wiersze.length < 2) return;
        const nag = wiersze[0].map(function (h) { return h.trim().toLowerCase(); });
        const iLon = nag.indexOf('lon'), iLat = nag.indexOf('lat');
        const iCena = nag.indexOf('cena'), iM2 = nag.indexOf('cena_m2');
        const iPow = nag.indexOf('powierzchnia_m2'), iData = nag.indexOf('data');
        const iRodzaj = nag.indexOf('rodzaj'), iMpzp = nag.indexOf('przeznaczenie_mpzp');
        const iId = nag.indexOf('id_dzialki');
        if (iLon < 0 || iLat < 0) return;

        // Filtr rodzaju — TYLKO grunty (nie lokale, nie budynki).
        // Suwak niezabudowane/zabudowane dziala tak samo jak w backendzie.
        const pasujeRodzaj = function (r) {
          const low = (r || '').toLowerCase();
          if (rodzaj === 'zabudowana') return low.indexOf('gruntowa zabudowana') !== -1;
          if (rodzaj === 'grunt') return low.indexOf('gruntowa') !== -1;
          return low.indexOf('gruntowa niezabudowana') !== -1;  // domyslnie niezabudowane
        };

        // Policz odleglosc kazdej transakcji od dzialki (przyblizenie plaskie, PL)
        const cosLat = Math.cos(lat * Math.PI / 180);
        const bliskie = [];
        for (let i = 1; i < wiersze.length; i++) {
          const w = wiersze[i];
          // Pomin transakcje niepasujace rodzajem (lokale, budynki, zly typ gruntu)
          if (iRodzaj >= 0 && !pasujeRodzaj(w[iRodzaj])) continue;
          const tlon = parseFloat(w[iLon]), tlat = parseFloat(w[iLat]);
          if (isNaN(tlon) || isNaN(tlat)) continue;
          const dx = (tlon - lon) * 111320 * cosLat;
          const dy = (tlat - lat) * 111320;
          const dist = Math.sqrt(dx * dx + dy * dy);  // metry
          if (dist <= 1500) {  // promien 1.5 km
            const cM2 = iM2 >= 0 ? (parseFloat(w[iM2]) || 0) : 0;
            // Filtr zdroworozsadkowy: odrzuc ceny/m2 poza realnym zakresem
            // (bledne dane: udzialy, ulamki powierzchni daja absurdalne stawki)
            const cM2ok = (cM2 >= 50 && cM2 <= 50000) ? cM2 : 0;
            bliskie.push({
              dist: dist,
              cena: parseFloat(w[iCena]) || 0,
              cenaM2: cM2ok,
              pow: iPow >= 0 ? (parseFloat(w[iPow]) || 0) : 0,
              data: iData >= 0 ? w[iData] : '',
              rodzaj: iRodzaj >= 0 ? w[iRodzaj] : '',
              mpzp: iMpzp >= 0 ? w[iMpzp] : '',
              id: iId >= 0 ? w[iId] : '',
              lon: tlon,   // <- potrzebne do naniesienia punktu na mape
              lat: tlat
            });
          }
        }
        if (!bliskie.length) return;

        // Sortuj po odleglosci
        bliskie.sort(function (a, b) { return a.dist - b.dist; });

        // Mediana ceny/m2 (tylko z cena_m2 > 0)
        const stawki = bliskie.filter(function (t) { return t.cenaM2 > 0; }).map(function (t) { return t.cenaM2; });
        if (stawki.length) {
          stawki.sort(function (a, b) { return a - b; });
          const mediana = stawki[Math.floor(stawki.length / 2)];
          // Wartosc orientacyjna w streszczeniu
          if (powierzchnia && $('pods-cena')) {
            const wartosc = Math.round(mediana * powierzchnia);
            $('pods-cena').textContent = wartosc.toLocaleString('pl-PL') + ' zl';
            if ($('pods-cena-sub')) {
              $('pods-cena-sub').textContent = 'mediana ' + Math.round(mediana).toLocaleString('pl-PL') +
                ' zl/m2 z ' + stawki.length + ' transakcji w promieniu 1,5 km';
            }
          }
        }

        oglos('gruntowo:ceny', {
          zrodlo: 'csv', rodzaj: rodzaj, liczba: stawki.length,
          mediana_m2: stawki.length ? stawki[Math.floor(stawki.length / 2)] : 0,
          promien_m: 1500, rozszerzony: false, transakcje: bliskie
        });

        // Wypelnij liste transakcji (do 20 najblizszych)
        rysujTransakcjeZBazy(bliskie.slice(0, 20));
      })
      .catch(function (e) { console.warn('Baza cen:', e); });
  }

  function rysujTransakcjeZBazy(txs) {
    const table = $('tx-table');
    if (!table) return;
    const empty = $('tx-empty');
    if (empty) empty.remove();
    // Usun ewentualne poprzednie wiersze (poza naglowkiem)
    table.querySelectorAll('.tx-row:not(.tx-head)').forEach(function (el) { el.remove(); });

    const WIDOCZNE = 4;   // ile transakcji widocznych od razu

    txs.forEach(function (t, idx) {
      const nr = idx + 1;
      const row = document.createElement('div');
      row.className = 'tx-row';
      // Ukryj transakcje powyzej progu (rozwijane przyciskiem)
      if (idx >= WIDOCZNE) row.classList.add('tx-ukryta');
      const odl = t.dist < 1000 ? Math.round(t.dist) + ' m' : (t.dist / 1000).toFixed(1) + ' km';
      const opis = (t.rodzaj || 'transakcja') + (t.mpzp ? ' · ' + t.mpzp : '') + ' · ' + odl;
      row.innerHTML =
        '<div class="tx-addr"><span class="tx-nr">' + nr + '.</span>' + opis + '<small>' + (t.id || '') + '</small></div>' +
        '<div class="tx-price">' + (t.cena ? Math.round(t.cena).toLocaleString('pl-PL') + ' zl' : '—') + '</div>' +
        '<div class="tx-perm2">' + (t.cenaM2 ? Math.round(t.cenaM2).toLocaleString('pl-PL') + ' zl/m2' : '—') + '</div>' +
        '<div class="tx-date">' + (t.data || '—') + '</div>';
      table.appendChild(row);
    });

    // Przycisk "Pokaz wszystkie" gdy jest wiecej niz prog
    const staryBtn = table.parentElement && table.parentElement.querySelector('.tx-wiecej');
    if (staryBtn) staryBtn.remove();
    if (txs.length > WIDOCZNE) {
      const btn = document.createElement('button');
      btn.className = 'tx-wiecej';
      btn.textContent = 'Pokaz wszystkie transakcje (' + txs.length + ')';
      btn.addEventListener('click', function () {
        // Przelacz klase 'tx-rozwiniete' na tabeli — CSS pokaze/ukryje wiersze
        const rozwiniete = table.classList.toggle('tx-rozwiniete');
        btn.textContent = rozwiniete ? 'Zwin liste' : 'Pokaz wszystkie transakcje (' + txs.length + ')';
      });
      table.parentElement.appendChild(btn);
    }

    // Nanies transakcje jako punkty na mape cen
    naniesTransakcjeNaMape(txs);
  }

  // Rysuje punkty transakcji na mapie cen — kolor wg ceny za m2 (tanie -> drogie)
  function naniesTransakcjeNaMape(txs) {
    const img = document.getElementById('map-ceny');
    let bbox = window._cenyBbox, wh = window._cenyWH;
    if (!img || !bbox || !wh) return;
    const box = img.parentElement;
    if (!box) return;

    const p = window._wycenaParam;
    const punktyGeo = txs.filter(function (t) { return t.lon && t.lat && t.cenaM2; });

    // DOPASUJ obszar mapy: KWADRAT wysrodkowany na DZIALCE, obejmujacy najdalsza transakcje.
    // Wysrodkowanie na dzialce sprawia, ze jest ona zawsze w centrum mapy, a proporcje
    // sa spojne (te same we wszystkich kierunkach), wiec punkty nie sa przesuniete.
    if (punktyGeo.length && p && p.lon && p.lat) {
      const cosLat = Math.cos(p.lat * Math.PI / 180);
      // Najwieksza odleglosc (w stopniach lon-ekwiwalent) od dzialki do transakcji
      let maxDeg = 0;
      punktyGeo.forEach(function (t) {
        const dLon = (t.lon - p.lon) * cosLat;   // korekta dlugosci geogr.
        const dLat = t.lat - p.lat;
        const d = Math.sqrt(dLon * dLon + dLat * dLat);
        if (d > maxDeg) maxDeg = d;
      });
      // Promien kadru = najdalsza transakcja + 15% marginesu (min. tyle co domyslny)
      const domyslnyPromien = (bbox[3] - bbox[1]) / 2;   // polowa wysokosci domyslnego bbox
      let promienLat = Math.max(maxDeg * 1.15, domyslnyPromien);
      const promienLon = promienLat / cosLat;            // szerszy w lon (bo cos<1)
      bbox = [p.lon - promienLon, p.lat - promienLat, p.lon + promienLon, p.lat + promienLat];
      window._cenyBbox = bbox;
      const nowaWH = wymiary(bbox);
      window._cenyWH = nowaWH; wh = nowaWH;
      setMapa('map-ceny', ortoBaseCeny(bbox.join(','), nowaWH));
    }

    const minLon = bbox[0], minLat = bbox[1], maxLon = bbox[2], maxLat = bbox[3];
    const szerLon = maxLon - minLon, szerLat = maxLat - minLat;
    if (szerLon <= 0 || szerLat <= 0) return;

    const ceny = txs.filter(function (t) { return t.cenaM2 > 0; }).map(function (t) { return t.cenaM2; }).sort(function (a, b) { return a - b; });
    if (!ceny.length) return;
    const cMin = ceny[Math.floor(ceny.length * 0.1)];
    const cMax = ceny[Math.floor(ceny.length * 0.9)] || ceny[ceny.length - 1];

    const kolor = function (c) {
      let t = (c - cMin) / (cMax - cMin || 1);
      t = Math.max(0, Math.min(1, t));
      const r = t < 0.5 ? Math.round(80 + t * 2 * 175) : 255;
      const g = t < 0.5 ? 200 : Math.round(200 - (t - 0.5) * 2 * 160);
      return 'rgb(' + r + ',' + g + ',60)';
    };

    let punkty = '';
    txs.forEach(function (t, idx) {
      if (!t.lon || !t.lat || !t.cenaM2) return;
      const x = ((t.lon - minLon) / szerLon) * wh.W;
      const y = ((maxLat - t.lat) / szerLat) * wh.H;
      if (x < 0 || x > wh.W || y < 0 || y > wh.H) return;
      const nr = idx + 1;
      // Kropka wieksza (r=10), z numerem w srodku — laczy mape z lista
      punkty += '<g>' +
        '<circle cx="' + x.toFixed(0) + '" cy="' + y.toFixed(0) + '" r="10" fill="' + kolor(t.cenaM2) + '" stroke="#0b0c0a" stroke-width="1.5" opacity="0.95"/>' +
        '<text x="' + x.toFixed(0) + '" y="' + (y + 4).toFixed(0) + '" font-family="monospace" font-size="12" font-weight="700" fill="#0b0c0a" text-anchor="middle">' + nr + '</text>' +
        '</g>';
    });

    // MARKER analizowanej dzialki — zloty pin ze srodka obszaru (tam jest dzialka)
    if (p && p.lon && p.lat) {
      const dx = ((p.lon - minLon) / szerLon) * wh.W;
      const dy = ((maxLat - p.lat) / szerLat) * wh.H;
      if (dx >= 0 && dx <= wh.W && dy >= 0 && dy <= wh.H) {
        // Wyrazisty zloty marker z obwodka — wyroznia sie od kropek transakcji
        punkty += '<g>' +
          '<circle cx="' + dx.toFixed(0) + '" cy="' + dy.toFixed(0) + '" r="16" fill="none" stroke="#c9a961" stroke-width="3" opacity="0.9"/>' +
          '<circle cx="' + dx.toFixed(0) + '" cy="' + dy.toFixed(0) + '" r="6" fill="#c9a961" stroke="#0b0c0a" stroke-width="2"/>' +
          '<text x="' + dx.toFixed(0) + '" y="' + (dy - 24).toFixed(0) + '" font-family="monospace" font-size="13" font-weight="700" fill="#c9a961" text-anchor="middle" stroke="#0b0c0a" stroke-width="0.5">TWOJA DZIALKA</text>' +
          '</g>';
      }
    }
    if (!punkty) return;

    const stary = box.querySelector('.ceny-punkty');
    if (stary) stary.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ceny-punkty');
    svg.setAttribute('viewBox', '0 0 ' + wh.W + ' ' + wh.H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;';
    svg.innerHTML = punkty;
    box.appendChild(svg);
  }

  // Wylicza orientacyjna wartosc dzialki z mediany cen/m2 transakcji
  function wyliczCene(txs, powierzchnia) {
    if (!powierzchnia) return;
    const stawki = [];
    txs.forEach(function (t) {
      if (t.cenaM2) {
        const v = parseFloat(String(t.cenaM2).replace(/[^\d.]/g, ''));
        if (v > 0 && v < 100000) stawki.push(v);
      } else if (t.cena && t._pow) {
        const v = t.cena / t._pow;
        if (v > 0) stawki.push(v);
      }
    });
    if (!stawki.length) return;
    stawki.sort(function (a, b) { return a - b; });
    const mediana = stawki[Math.floor(stawki.length / 2)];
    const wartosc = Math.round(mediana * powierzchnia);
    if ($('pods-cena')) {
      $('pods-cena').textContent = wartosc.toLocaleString('pl-PL') + ' zl';
    }
    if ($('pods-cena-sub')) {
      $('pods-cena-sub').textContent = 'mediana ' + Math.round(mediana).toLocaleString('pl-PL') + ' zl/m2 z ' + statTxt(stawki.length) + ' w okolicy';
    }
  }
  function statTxt(n) { return n + ' transakcji'; }

  // Pobiera statystyki gminy z pliku CSV na Google Drive (opcjonalne)
  function pobierzStatystykiGminy(gmina, powiat, woj) {
    if (!STATS_CSV_URL || STATS_CSV_URL === 'WKLEJ_TUTAJ_LINK_CSV_STATYSTYKI') return;
    const box = $('stat-gmina-body');
    if (!box) return;

    fetch(STATS_CSV_URL)
      .then(function (r) { return r.text(); })
      .then(function (csv) {
        const wiersze = parseCSVprosty(csv);
        // Szukaj wiersza gdzie kolumna gmina pasuje
        const naglowek = wiersze[0].map(function (h) { return h.trim().toLowerCase(); });
        const iGmina = naglowek.indexOf('gmina');
        if (iGmina < 0) return;
        const gLow = gmina.toLowerCase().trim();
        let trafienie = null;
        for (let i = 1; i < wiersze.length; i++) {
          if ((wiersze[i][iGmina] || '').toLowerCase().trim() === gLow) { trafienie = wiersze[i]; break; }
        }
        if (!trafienie) {
          box.innerHTML = '<div class="stat-empty">Brak danych dla gminy ' + gmina + ' w bazie statystyk. Uzupelnij plik na Google Drive, aby ta sekcja sie wypelnila.</div>';
          $('sec-statystyki').style.display = 'block';
          return;
        }
        // Zbuduj tabelke z wszystkich kolumn (poza gmina)
        let h = '<div class="stat-grid">';
        naglowek.forEach(function (kol, i) {
          if (i === iGmina || !trafienie[i]) return;
          h += '<div class="stat-item"><div class="stat-k">' + wiersze[0][i] + '</div><div class="stat-v">' + trafienie[i] + '</div></div>';
        });
        h += '</div>';
        box.innerHTML = h;
        $('sec-statystyki').style.display = 'block';
      })
      .catch(function () { /* zostaje ukryte */ });
  }

  function parseCSVprosty(text) {
    return text.split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) {
      // Prosty split po przecinku lub sredniku
      const sep = l.indexOf(';') > -1 && l.indexOf(';') < l.indexOf(',') ? ';' : ',';
      return l.split(sep);
    });
  }

  function trybDemo(id, cichy) {
    if (!cichy) $('rep-notice').innerHTML = '<strong>Tryb demonstracyjny.</strong> Posrednik do GUGiK nie jest podlaczony (patrz INSTRUKCJA-RAPORT.txt). Mapy ponizej sa rzeczywiste; dane opisowe pobiora sie po podlaczeniu.';
    const nr = id.split('.').pop();
    $('rep-title').textContent = 'Dzialka nr ' + nr;
    $('rep-sub').textContent = 'Identyfikator: ' + id;
    $('rep-area').textContent = 'po podlaczeniu';
    $('rep-coords').textContent = 'po podlaczeniu';
    $('rep-loc').textContent = '—';
    ['p-obreb','p-area','p-gmina','p-powiat','p-woj'].forEach(function (x) { $(x).textContent = 'po podlaczeniu'; });
    rysujMapy([16.5298, 52.2221, 16.5330, 52.2235]);
  }

  function rysujMapy(bbox, wkt) {
    // Dopasuj proporcje obrazu do proporcji BBOX (inaczej mapa jest rozciagnieta/rozmazana).
    // W EPSG:4326 1 stopien dlugosci jest krotszy niz szerokosci — korygujemy cos(lat).
    const mb = margines(bbox, 0.5);
    const s = mb.join(',');
    const mbCeny = marginesCeny(bbox);          // obszar ~1 km dla cen
    const sCeny = mbCeny.join(',');

    const orto = wymiary(mb);                    // {W,H} dopasowane do proporcji dzialki
    const ortoC = wymiary(mbCeny);               // {W,H} dla obszaru cen

    // Bazowa ortofotomapa
    const ortoBase = function (bb, wh) {
      return 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=' + wh.W + '&HEIGHT=' + wh.H + '&BBOX=' + bb;
    };
    // Ortofoto dla mapy cen (szeroki obszar 3 km) — piksele ograniczone do max 1024,
    // bo StandardResolution odmawia przy szerokim kadrze + duzych pikselach.
    // ortoBaseCeny — globalna (zdefiniowana nizej), wiec dostepna tez w naniesTransakcjeNaMape

    // Kolejka map — ladowane z opoznieniem, zeby nie uderzac w Geoportal 8 zapytaniami naraz.
    const kolejka = [];

    // MAPA 0: Zaznaczenie dzialki — ciasny widok z ZLOTYM OBRYSEM dzialki (z geometrii ULDK)
    const mbZazn = margines(bbox, 0.6), sZazn = mbZazn.join(','), zazn = wymiary(mbZazn);
    // Mapy z samym ortofoto — od razu, poza kolejka (kafelki WMTS sa szybkie)
    setMapa('map-zaznaczenie', ortoBase(sZazn, zazn));
    rysujObrys('map-zaznaczenie', wkt, mbZazn, zazn, true);

    // MAPA 1: Ortofotomapa + ZLOTY OBRYS dzialki — szerszy widok (okolica)
    // Szerszy kadr liczony w METRACH: min. 300 m od srodka dzialki (albo 3x jej rozmiar dla duzych
    // dzialek). Wczesniej margines byl proporcjonalny do dzialki i dla malych dzialek
    // sekcja 01 wygladala prawie tak samo jak sekcja 00.
    const mbOkolica = marginesMetry(bbox, 300, 3);
    const sOkolica = mbOkolica.join(',');
    const ortoOkolica = wymiary(mbOkolica);
    setMapa('map-orto', ortoBase(sOkolica, ortoOkolica));
    rysujObrys('map-orto', wkt, mbOkolica, ortoOkolica);

    // MAPA: PLAN OGOLNY GMINY (POG). Nazwy warstw w camelCase (wg GetCapabilities),
    // usluga natywnie w EPSG:2180 (jak KIUT) — konwertujemy bbox.
    const mbPog = margines(bbox, 0.3), pogWH = wymiary(mbPog);
    const pp1 = wgs84Do2180(mbPog[0], mbPog[1]);
    const pp2 = wgs84Do2180(mbPog[2], mbPog[3]);
    const pogBbox2180 = Math.min(pp1.x, pp2.x) + ',' + Math.min(pp1.y, pp2.y) + ',' +
                        Math.max(pp1.x, pp2.x) + ',' + Math.max(pp1.y, pp2.y);
    const pogUchwUrl = 'https://mapy.geoportal.gov.pl/wss/ext/PlanyOgolneGmin?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=true&LAYERS=strefaPlanistyczna,obszarUzupelnieniaZabudowy,obszarZabSrodmiejskiej,aktPlanowaniaprzestrzennego&STYLES=,,,&WIDTH=' + pogWH.W + '&HEIGHT=' + pogWH.H + '&BBOX=' + pogBbox2180;
    ustawTloMapy('map-pog', ortoBase(mbPog.join(','), pogWH));        // tlo od razu, warstwa w kolejce
    kolejka.push(function (gotowe) {
      setMapaOverlay('map-pog', ortoBase(mbPog.join(','), pogWH), pogUchwUrl, gotowe);
      rysujObrys('map-pog', wkt, mbPog, pogWH);
      pobierzLegendePOG(bbox, pogWH);
    });

    // MAPA 2: MPZP — poprawne warstwy tresci planu (raster + wektor + granice).
    // Warstwy MPZP renderuja sie tylko przy duzym przyblizeniu (skala < 1:10000),
    // dlatego uzywamy ciasnego widoku dzialki (margines 0.3), nie szerokiego.
    const mbMpzp = margines(bbox, 0.3), sMpzp = mbMpzp.join(','), mpzpWH = wymiary(mbMpzp);
    const mpzpUrl = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=raster,wektor-str,wektor-pow,wektor-lin,wektor-pkt,wektor-lzb,granice&STYLES=,,,,,,&WIDTH=' + mpzpWH.W + '&HEIGHT=' + mpzpWH.H + '&BBOX=' + sMpzp;
    ustawTloMapy('map-mpzp', ortoBase(sMpzp, mpzpWH));
    kolejka.push(function (gotowe) {
      setMapaOverlay('map-mpzp', ortoBase(sMpzp, mpzpWH), mpzpUrl, gotowe);
      rysujObrys('map-mpzp', wkt, mbMpzp, mpzpWH);
      pobierzLegendeMPZP(bbox, mpzpWH, wkt);
    });

    // MAPA 3: Ceny — ortofoto jako podklad + WLASNE punkty transakcji (kolorowane).
    // Obszar szeroki (3 km), wiec ograniczamy piksele — StandardResolution odmawia
    // przy szerokim kadrze + duzych pikselach. Max 1024px po dluzszym boku.
    window._cenyBbox = mbCeny;
    window._cenyWH = ortoC;
    const cenyOrtoUrl = ortoBaseCeny(sCeny, ortoC);
    setMapa('map-ceny', cenyOrtoUrl);

    // MAPA 6: Uzbrojenie terenu (KIUT — poprawne nazwy warstw wg specyfikacji GUGiK).
    // Sieci widoczne w skali ~1:5000-1:10000, wiec uzywamy sredniego widoku (nie 1 km).
    // KIUT (uzbrojenie) wymaga ukladu EPSG:2180 (metry PUWG 1992), nie 4326 (stopnie) —
    // sprawdzone: w 4326 zwraca pusty obraz, w 2180 pokazuje sieci. Konwertujemy bbox.
    const mbUzbr = margines(bbox, 0.2), uzbrWH = wymiary(mbUzbr);
    // Przelicz naroza bbox z lon/lat na EPSG:2180
    const p1 = wgs84Do2180(mbUzbr[0], mbUzbr[1]);   // lewy-dolny
    const p2 = wgs84Do2180(mbUzbr[2], mbUzbr[3]);   // prawy-gorny
    // BBOX w 2180: minX,minY,maxX,maxY (X=easting, Y=northing)
    const bbox2180 = Math.min(p1.x, p2.x) + ',' + Math.min(p1.y, p2.y) + ',' +
                     Math.max(p1.x, p2.x) + ',' + Math.max(p1.y, p2.y);
    const uzbrojenieUrl = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=true&LAYERS=przewod_wodociagowy,przewod_kanalizacyjny,przewod_gazowy,przewod_elektroenergetyczny,przewod_cieplowniczy,przewod_telekomunikacyjny&STYLES=,,,,,&WIDTH=' + uzbrWH.W + '&HEIGHT=' + uzbrWH.H + '&BBOX=' + bbox2180;
    // KIUT rysuje przewody tylko przy duzym przyblizeniu (ok. <= 0,35 m/piksel). Dla wiekszych dzialek
    // jeden obraz 1200 px bylby zbyt "oddalony" i pusty — wtedy skladamy warstwe z kafelkow.
    const uzbrBox = [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)];
    ustawTloMapy('map-energia', ortoBase(mbUzbr.join(','), uzbrWH));
    kolejka.push(function (gotowe) {
      const orto = ortoBase(mbUzbr.join(','), uzbrWH);
      warstwaKIUT(uzbrBox, uzbrWH, uzbrojenieUrl).then(function (warstwa) {
        setMapaOverlay('map-energia', orto, warstwa, gotowe);
      });
      rysujObrys('map-energia', wkt, mbUzbr, uzbrWH);
    });

    // (Formy ochrony przyrody, zabytki i tereny zalewowe przeniesione do raportu platnego —
    //  dzialaly niepewnie na roznych serwerach i spowalnialy darmowy raport.)

    // ZDJECIA HISTORYCZNE — porownanie ortofotomap z roznych lat (osobna sekcja, poza kolejka WMS)
    rysujZdjeciaHistoryczne(bbox);

    // MENEDZER KOLEJKI — laduje mapy z ograniczeniem liczby JEDNOCZESNYCH zapytan.
    // Zamiast odpalac wszystkie naraz (co zasypuje Geoportal i powoduje bledy),
    // trzymamy max 2 aktywne; nastepna startuje gdy poprzednia skonczy (sukces lub porazka).
    // To zgodne z dobra praktyka: concurrency limit + kolejka FIFO.
    // W kolejce zostaly juz tylko 3 warstwy z wolnych serwerow (POG, MPZP, sieci) — mozna je puscic razem
    uruchomKolejkeMap(kolejka, 3);

    // Ukryj poczekalnie gdy kluczowe mapy (zaznaczenie + ortofoto) sie zaladuja.
    let zaladowane = 0;
    const kluczowe = ['map-zaznaczenie', 'map-orto'];
    let ukryto = false;
    const sprawdzGotowosc = function () {
      zaladowane++;
      if (zaladowane >= kluczowe.length && !ukryto) {
        ukryto = true;
        setTimeout(ukryjPoczekalnie, 1500);
      }
    };
    kluczowe.forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener('load', sprawdzGotowosc, { once: true });
        el.addEventListener('error', sprawdzGotowosc, { once: true });
      }
    });
    // Bezpiecznik: gdyby kluczowe mapy nie odpowiedzialy, i tak pokaz raport po 20s
    setTimeout(function () { if (!ukryto) { ukryto = true; ukryjPoczekalnie(); } }, 20000);
  }

  // Warstwa sieci KIUT dla mapy 07: zwykly adres, gdy skala wystarcza; mozaika z kafelkow, gdy dzialka duza.
  // Zwraca adres obrazu (zwykly URL albo blob: z polaczonych kafelkow). Przy bledzie — zwykly URL.
  function warstwaKIUT(bb, wh, zwyklyUrl) {
    const MPP_MAX = 0.3;
    const mpp = Math.max((bb[2] - bb[0]) / wh.W, (bb[3] - bb[1]) / wh.H);
    if (mpp <= 0.33 || !window.createImageBitmap) return Promise.resolve(zwyklyUrl);
    let skala = mpp / MPP_MAX;
    let W = Math.round(wh.W * skala), H = Math.round(wh.H * skala);
    if (W * H > 16e6) { const k = Math.sqrt(W * H / 16e6); W = Math.round(W / k); H = Math.round(H / k); }
    const mx = (bb[2] - bb[0]) / W, my = (bb[3] - bb[1]) / H;
    const KAF = 1200, kafelki = [];
    for (let y = 0; y < H; y += KAF) for (let x = 0; x < W; x += KAF) {
      const w = Math.min(KAF, W - x), h = Math.min(KAF, H - y);
      const b = [bb[0] + x * mx, bb[3] - (y + h) * my, bb[0] + (x + w) * mx, bb[3] - y * my];
      kafelki.push({ x: x, y: y, url: zwyklyUrl.replace(/WIDTH=\d+/, 'WIDTH=' + w).replace(/HEIGHT=\d+/, 'HEIGHT=' + h)
        .replace(/BBOX=[^&]+/, 'BBOX=' + b.map(function (v) { return v.toFixed(2); }).join(',')) });
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const kolejka = kafelki.slice();
    const nastepny = function () {
      const k = kolejka.shift(); if (!k) return Promise.resolve();
      return fetchZPonowieniem(k.url, 2).then(function (r) { return r.blob(); }).then(createImageBitmap)
        .then(function (bmp) { ctx.drawImage(bmp, k.x, k.y); }).then(nastepny);
    };
    return Promise.all([nastepny(), nastepny()])
      .then(function () { return new Promise(function (ok) { cv.toBlob(function (b) { ok(b ? URL.createObjectURL(b) : zwyklyUrl); }, 'image/png'); }); })
      .catch(function () { return zwyklyUrl; });
  }

  // Rysuje siatke zdjec lotniczych z roznych lat (archiwum ortofoto GUGiK).
  // Uzywa uslugi StandardResolutionTime (obsluguje parametr TIME), nie zwyklej ORTO.
  function rysujZdjeciaHistoryczne(bbox) {
    const kontener = document.getElementById('zdjecia-historyczne');
    if (!kontener) return;
    const mb = margines(bbox, 0.4);
    const wh = wymiary(mb);
    const s = mb.join(',');

    // Roczniki do sprawdzenia. Dostepnosc rozni sie per teren — zdjecia bez danych
    // pokaza komunikat. Format TIME: pelna data ISO (rok-01-01/rok-12-31).
    const lata = ['2010', '2015', '2019', '2023'];
    let html = '';
    lata.forEach(function (rok) {
      // StandardResolutionTime — usluga archiwalna z obsluga czasu.
      // TIME jako zakres calego roku: RRRR-01-01/RRRR-12-31
      const url = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolutionTime'
        + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg'
        + '&LAYERS=Raster&STYLES='
        + '&TIME=' + rok + '-01-01/' + rok + '-12-31'
        + '&WIDTH=' + wh.W + '&HEIGHT=' + wh.H + '&BBOX=' + s;
      html += '<div class="zdj-item">' +
        '<div class="zdj-rok">' + rok + '</div>' +
        '<div class="zdj-mapbox"><img data-rok="' + rok + '" src="' + url + '" alt="Ortofotomapa ' + rok + '" ' +
        'onload="this.dataset.ok=1" ' +
        'onerror="var p=this.parentElement; if(!this.dataset.r){this.dataset.r=1; var self=this; setTimeout(function(){self.src=self.src+\'&_r=\'+Date.now();},1500);} else {p.innerHTML=\'<div class=zdj-brak>Brak zdjecia z \' + ' + rok + ' + \' dla tego terenu</div>\';}" /></div>' +
        '</div>';
    });
    kontener.innerHTML = html;
    const sekcja = document.getElementById('sec-zdjecia');
    if (sekcja) sekcja.style.display = 'block';
  }

  // ===== ORTOFOTO Z KAFELKOW WMTS (szybkie) =====
  // GUGiK udostepnia ortofotomape takze jako GOTOWE, zapisane kafelki (WMTS). Sa podawane w ~0,2 s,
  // podczas gdy WMS rysuje kazdy obrazek od zera (sekundy, czesto blad 404 pod obciazeniem).
  // Skladamy potrzebny kadr z kafelkow na plotnie. Gdy sie nie uda — zostaje dotychczasowy WMS.
  // Zestaw kafelkow EPSG:3857 (Web Mercator, kafelek 256 px) — zgodny co do metra z WMS.
  // (Zestaw EPSG:4326 z tej uslugi jest przesuniety o ok. 20 m — nie uzywamy go.)
  const WMTS_ORTO = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution';
  const WMTS_O = 20037508.342787;                    // pol obwodu w metrach Mercatora
  const WMTS_ZMAX = 19;
  function wmtsRes(z) { return 559082264.0287178 / Math.pow(2, z) * 0.00028; }   // m Mercatora na piksel
  function merc(lon, lat) {
    return [lon * 20037508.342789244 / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137];
  }
  const wmtsPamiec = {};                             // ten sam kafelek w kilku mapach — pobierany raz

  // Wszystkie kafelki ze wszystkich map ida przez jedna kolejke: max 8 naraz (serwer GUGiK przy
  // kilkudziesieciu rownoczesnych zapytaniach zaczyna odrzucac czesc z nich).
  let wmtsAktywne = 0;
  const wmtsCzeka = [];
  function wmtsSlot(fn) {
    return new Promise(function (ok, nie) {
      const start = function () {
        wmtsAktywne++;
        fn().then(ok, nie).then(function () {
          wmtsAktywne--;
          const nast = wmtsCzeka.shift(); if (nast) nast();
        });
      };
      if (wmtsAktywne < 8) start(); else wmtsCzeka.push(start);
    });
  }
  function kafelekWMTS(z, row, col) {
    const url = WMTS_ORTO + '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg' +
      '&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:' + z + '&TILEROW=' + row + '&TILECOL=' + col;
    if (wmtsPamiec[url]) return wmtsPamiec[url];
    const jeden = function () {
      const ctrl = window.AbortController ? new AbortController() : null;
      const t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
      return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
        clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(createImageBitmap, function (e) { clearTimeout(t); throw e; });
    };
    // 3 proby: od razu, po 0,7 s, po 2 s
    const proba = function (n) {
      return wmtsSlot(jeden).catch(function (e) {
        if (n >= 2) throw e;
        return new Promise(function (ok) { setTimeout(ok, n ? 2000 : 700); }).then(function () { return proba(n + 1); });
      });
    };
    wmtsPamiec[url] = proba(0).catch(function (e) { delete wmtsPamiec[url]; throw e; });
    return wmtsPamiec[url];
  }
  // Brakujacy kafelek zastepujemy powiekszona czwartka kafelka z poziomu wyzej
  function kafelekZastepczy(z, row, col, ctx, x, y) {
    if (z < 1) return Promise.reject(new Error('brak'));
    return kafelekWMTS(z - 1, Math.floor(row / 2), Math.floor(col / 2)).then(function (bmp) {
      ctx.drawImage(bmp, (col % 2) * 128, (row % 2) * 128, 128, 128, x, y, 256, 256);
    });
  }

  // Kadr bb=[minLon,minLat,maxLon,maxLat] w rozmiarze W x H -> adres obrazu (blob:)
  function ortoWMTS(bb, W, H) {
    if (!window.createImageBitmap || !window.fetch) return Promise.reject(new Error('stara przegladarka'));
    const a = merc(bb[0], bb[1]), b = merc(bb[2], bb[3]);   // lewy dolny, prawy gorny (m Mercatora)
    if (!(b[0] > a[0] && b[1] > a[1])) return Promise.reject(new Error('zly kadr'));
    const potrzebne = Math.min((b[0] - a[0]) / W, (b[1] - a[1]) / H);   // m Mercatora na piksel
    let z = WMTS_ZMAX;
    for (let k = 10; k <= WMTS_ZMAX; k++) { if (wmtsRes(k) <= potrzebne * 1.25) { z = k; break; } }
    let res, kaf, c0, c1, r0, r1;
    for (;;) {
      res = wmtsRes(z); kaf = 256 * res;
      c0 = Math.floor((a[0] + WMTS_O) / kaf); c1 = Math.floor((b[0] + WMTS_O) / kaf);
      r0 = Math.floor((WMTS_O - b[1]) / kaf); r1 = Math.floor((WMTS_O - a[1]) / kaf);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) <= 100 || z <= 10) break;
      z--;                                            // za duzo kafelkow — o poziom mniej szczegolow
    }
    const nc = c1 - c0 + 1, nr = r1 - r0 + 1;
    const duze = document.createElement('canvas');
    duze.width = nc * 256; duze.height = nr * 256;
    const dctx = duze.getContext('2d');
    dctx.fillStyle = '#2a2f2c'; dctx.fillRect(0, 0, duze.width, duze.height);
    const zadania = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) zadania.push({ r: r, c: c });
    let bledy = 0;
    return Promise.all(zadania.map(function (k) {
      const x = (k.c - c0) * 256, y = (k.r - r0) * 256;
      return kafelekWMTS(z, k.r, k.c).then(function (bmp) { dctx.drawImage(bmp, x, y); }, function () {
        return kafelekZastepczy(z, k.r, k.c, dctx, x, y).catch(function () { bledy++; });
      });
    })).then(function () {
      if (bledy > zadania.length * 0.3) throw new Error('za duzo brakujacych kafelkow');
      const lewo = -WMTS_O + c0 * kaf, gora = WMTS_O - r0 * kaf;
      const wyj = document.createElement('canvas'); wyj.width = W; wyj.height = H;
      const wctx = wyj.getContext('2d');
      wctx.imageSmoothingQuality = 'high';
      wctx.drawImage(duze, (a[0] - lewo) / res, (gora - b[1]) / res,
        (b[0] - a[0]) / res, (b[1] - a[1]) / res, 0, 0, W, H);
      return new Promise(function (ok, nie) {
        wyj.toBlob(function (bl) { if (bl) ok(URL.createObjectURL(bl)); else nie(new Error('toBlob')); }, 'image/jpeg', 0.9);
      });
    });
  }
  // Z adresu WMS ortofoto (BBOX, WIDTH, HEIGHT) — kafelki WMTS; przy bledzie null
  function ortoZWMS(url) {
    if (url.indexOf('/ORTO/WMS/') === -1) return Promise.resolve(null);
    const b = url.match(/BBOX=([^&]+)/), w = url.match(/WIDTH=(\d+)/), h = url.match(/HEIGHT=(\d+)/);
    if (!b || !w || !h) return Promise.resolve(null);
    return ortoWMTS(b[1].split(',').map(Number), +w[1], +h[1]).catch(function (e) { console.warn('WMTS -> WMS:', e.message); return null; });
  }

  // Oblicz wymiary obrazu (W x H) dopasowane do proporcji BBOX w danej szerokosci.
  // Utrzymuje ~1200px po dluzszym boku dla ostrosci.
  // Ortofoto dla mapy cen — piksele ograniczone do max 1024 (szeroki obszar).
  function ortoBaseCeny(bb, wh) {
    let W = wh.W, H = wh.H;
    const max = 1024;
    if (W > max || H > max) {
      const skala = max / Math.max(W, H);
      W = Math.round(W * skala); H = Math.round(H * skala);
    }
    return 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=' + W + '&HEIGHT=' + H + '&BBOX=' + bb;
  }

  function wymiary(bb) {    const lonSpan = (bb[2] - bb[0]);
    const latSpan = (bb[3] - bb[1]);
    const latSrodek = (bb[1] + bb[3]) / 2;
    const cos = Math.cos(latSrodek * Math.PI / 180);
    // Rzeczywista szerokosc w metrach proporcjonalna do lonSpan*cos, wysokosc do latSpan
    const wReal = lonSpan * cos;
    const hReal = latSpan;
    const MAX = 1200;
    let W, H;
    if (wReal >= hReal) { W = MAX; H = Math.round(MAX * hReal / wReal); }
    else { H = MAX; W = Math.round(MAX * wReal / hReal); }
    // Zabezpieczenie przed skrajnościami
    W = Math.max(400, Math.min(1600, W));
    H = Math.max(400, Math.min(1600, H));
    return { W: W, H: H };
  }

  // Obszar ~1 km wokol dzialki dla mapy cen
  function marginesCeny(bbox) {
    const cLon = (bbox[0] + bbox[2]) / 2, cLat = (bbox[1] + bbox[3]) / 2;
    // Obszar spojny z promieniem szukania transakcji (1.5 km promien = 3 km srednica),
    // zeby wszystkie znalezione punkty zmiescily sie na mapie.
    const dLat = 1.5 / 111.0;
    const dLon = 1.5 / (111.0 * 0.62);
    return [cLon - dLon, cLat - dLat, cLon + dLon, cLat + dLat];
  }

  // Pojedyncza mapa (jeden obraz)
  // Generuje alternatywne adresy ortofoto (fallback) dla tego samego obszaru.
  // Gdy glowne zrodlo (StandardResolution) zawiedzie, probujemy kolejnych serwerow GUGiK.
  function ortoZrodla(bbox, W, H) {
    return [
      // 1. Glowne: StandardResolution (najlepsza jakosc)
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=' + W + '&HEIGHT=' + H + '&BBOX=' + bbox,
      // 2. Zapas: usluga img/guest/ORTO (inny endpoint GUGiK, czesto dziala gdy glowny nie)
      'https://mapy.geoportal.gov.pl/wss/service/img/guest/ORTO/MapServer/WMSServer?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=' + W + '&HEIGHT=' + H + '&BBOX=' + bbox,
      // 3. Zapas: HighResolution (inna warstwa tego samego serwera)
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=' + W + '&HEIGHT=' + H + '&BBOX=' + bbox
    ];
  }

  // Laduje obraz z listy zrodel: kazde probuje 2x, potem przechodzi do nastepnego.
  // Exponential backoff z jitterem miedzy probami (nie stały odstep — inaczej wszystkie
  // retry uderzaja naraz, "thundering herd"). onDone wywolywane ZAWSZE na koncu
  // (sukces lub porazka), zeby menedzer kolejki zwolnil slot.
  function ladujZFallbackiem(img, zrodla, opts) {
    opts = opts || {};
    let zi = 0;    // index zrodla
    let proba = 0; // proba w obrebie zrodla
    const MAX_PROB = 2;
    let zakonczone = false;
    const zakoncz = function () {
      if (zakonczone) return; zakonczone = true;
      if (opts.onDone) opts.onDone();
    };
    // Backoff: 800ms, 1600ms... + losowy jitter 0-400ms
    const opoznienie = function (nrProby) {
      return 800 * Math.pow(2, nrProby) + Math.random() * 400;
    };
    const sprobuj = function () {
      if (zi >= zrodla.length) {
        // Wszystkie zrodla wyczerpane
        if (opts.onFail) opts.onFail(img);
        else { img.style.opacity = '0.3'; img.alt = 'Podklad chwilowo niedostepny'; }
        zakoncz();
        return;
      }
      img.src = zrodla[zi] + (zrodla[zi].indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now();
    };
    img.onerror = function () {
      if (proba < MAX_PROB - 1) {
        const d = opoznienie(proba); proba++;
        setTimeout(sprobuj, d);       // ponow to samo zrodlo (backoff)
      } else {
        zi++; proba = 0;              // przejdz do nastepnego zrodla
        setTimeout(sprobuj, 300 + Math.random() * 300);
      }
    };
    img.onload = function () {
      img.style.opacity = '1';
      if (opts.onLoad) opts.onLoad(img);
      zakoncz();
    };
    sprobuj();
  }

  function setMapa(id, url, gotowe) {
    const img = $(id);
    if (!img) { if (gotowe) gotowe(); return; }
    // Ortofoto: najpierw szybkie kafelki WMTS, dopiero przy bledzie dotychczasowa droga (WMS + zapasowe serwery)
    if (url.indexOf('/ORTO/WMS/') > -1 && !img.dataset.bezWmts) {
      ortoZWMS(url).then(function (blobUrl) {
        if (!blobUrl) { img.dataset.bezWmts = '1'; setMapa(id, url, gotowe); delete img.dataset.bezWmts; return; }
        img.onerror = null;
        img.onload = function () { img.style.opacity = '1'; if (gotowe) gotowe(); };
        img.src = blobUrl;
      });
      return;
    }
    // Wyciagnij bbox i wymiary z url, zeby zbudowac zrodla zapasowe
    const bboxM = url.match(/BBOX=([^&]+)/);
    const wM = url.match(/WIDTH=(\d+)/), hM = url.match(/HEIGHT=(\d+)/);
    if (bboxM && wM && hM) {
      // Ortofoto — uzyj fallbacku na kilka zrodel GUGiK
      ladujZFallbackiem(img, ortoZrodla(bboxM[1], wM[1], hM[1]), { onDone: gotowe });
    } else {
      // Nie-ortofoto (np. warstwa) — proste ponawianie jednego url z backoffem
      let proba = 0;
      let done = false;
      const zakoncz = function () { if (!done) { done = true; if (gotowe) gotowe(); } };
      img.onerror = function () {
        if (proba < 2) { proba++; const self = this; setTimeout(function () { self.src = url + '&_r=' + Date.now(); }, 800 * Math.pow(2, proba) + Math.random() * 400); }
        else { this.style.opacity = '0.3'; this.alt = 'Podklad chwilowo niedostepny'; zakoncz(); }
      };
      img.onload = function () { this.style.opacity = '1'; zakoncz(); };
      img.src = url;
    }
  }

  // Mapa z warstwa nalozona: ortofoto (tlo, z fallbackiem) + warstwa przezroczysta na wierzchu.
  // gotowe() wywolywane gdy warstwa skonczy — zwalnia slot w kolejce.
  function setMapaOverlay(id, bazaUrl, warstwaUrl, gotowe) {
    const img = $(id);
    if (!img) { if (gotowe) gotowe(); return; }
    const box = img.parentElement;
    if (!box) { setMapa(id, warstwaUrl, gotowe); return; }

    ustawTloMapy(id, bazaUrl);

    // Warstwa na wierzchu; ponawianie z backoffem. gotowe() gdy warstwa skonczy.
    img.style.mixBlendMode = 'normal';
    let proba = 0;
    let done = false;
    const zakoncz = function () { if (!done) { done = true; if (gotowe) gotowe(); } };
    img.onerror = function () {
      if (proba < 2) { proba++; const self = this; setTimeout(function () { self.src = warstwaUrl + '&_r=' + Date.now(); }, 800 * Math.pow(2, proba) + Math.random() * 400); }
      else { this.style.display = 'none'; zakoncz(); }
    };
    img.onload = function () { this.style.display = 'block'; zakoncz(); };
    img.src = warstwaUrl;
  }

  // Tlo mapy (ortofoto) — mozna je uruchomic od razu, zanim warstwa doczeka sie w kolejce.
  // Drugie wywolanie z tym samym adresem nic nie robi.
  function ustawTloMapy(id, bazaUrl) {
    const img = $(id);
    const box = img && img.parentElement;
    if (!box || box.dataset.tlo === bazaUrl) return;
    box.dataset.tlo = bazaUrl;
    const ustaw = function (u) { box.style.backgroundImage = 'url("' + u + '")'; box.style.backgroundSize = 'cover'; box.style.backgroundPosition = 'center'; };
    ortoZWMS(bazaUrl).then(function (blobUrl) {
      if (blobUrl) { ustaw(blobUrl); return; }
      tloZWMS(box, bazaUrl, ustaw);
    });
  }
  function tloZWMS(box, bazaUrl, ustaw) {
    // Ortofoto jako tlo — z fallbackiem na kilka zrodel GUGiK (w tle, nie blokuje).
    const bboxM = bazaUrl.match(/BBOX=([^&]+)/);
    const wM = bazaUrl.match(/WIDTH=(\d+)/), hM = bazaUrl.match(/HEIGHT=(\d+)/);
    if (bboxM && wM && hM) {
      const tester = new Image();
      ladujZFallbackiem(tester, ortoZrodla(bboxM[1], wM[1], hM[1]), {
        onLoad: function (i) {
          box.style.backgroundImage = 'url("' + i.src + '")';
          box.style.backgroundSize = 'cover';
          box.style.backgroundPosition = 'center';
        }
      });
    } else {
      ustaw(bazaUrl);
    }
  }

  // MENEDZER KOLEJKI MAP — laduje z ograniczeniem liczby jednoczesnych zapytan.
  // zadania: tablica funkcji postaci function(gotowe){...}. Kazda MOZE wywolac gotowe();
  // jesli nie zdazy w 4s, slot i tak sie zwalnia (bezpiecznik) — kolejka NIGDY sie nie zacina.
  function uruchomKolejkeMap(zadania, limit) {
    limit = limit || 3;
    let i = 0, aktywne = 0;
    const nastepne = function () {
      while (aktywne < limit && i < zadania.length) {
        const fn = zadania[i++];
        aktywne++;
        let zwolnione = false;
        const gotowe = function () {
          if (zwolnione) return; zwolnione = true;
          aktywne--;
          nastepne();
        };
        // Bezpiecznik: zwolnij slot po 4s niezaleznie od tego, czy mapa skonczyla.
        // Warstwa moze dogrywac sie w tle — nie blokujemy kolejki na wolnych serwerach.
        setTimeout(gotowe, 4000);
        try { fn(gotowe); } catch (e) { gotowe(); }
      }
    };
    nastepne();
  }

  function rysujTransakcje(txs) {
    const table = $('tx-table');
    const empty = $('tx-empty');
    if (empty) empty.remove();
    txs.slice(0, 20).forEach(function (t) {
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML =
        '<div class="tx-addr">' + (t.adres || '—') + '<small>' + (t.id || '') + '</small></div>' +
        '<div class="tx-price">' + (t.cena ? Number(t.cena).toLocaleString('pl-PL') + ' zl' : '—') + '</div>' +
        '<div class="tx-perm2">' + (t.cenaM2 || '—') + '</div>' +
        '<div class="tx-date">' + (t.data || '—') + '</div>';
      table.appendChild(row);
    });
  }

  // Slownik stref planistycznych POG (kod -> pelna nazwa)
  var STREFY_POG = {
    'SW': 'wielofunkcyjna z zabudowa mieszkaniowa wielorodzinna',
    'SJ': 'wielofunkcyjna z zabudowa mieszkaniowa jednorodzinna',
    'SZ': 'wielofunkcyjna z zabudowa zagrodowa',
    'SU': 'uslugowa',
    'SP': 'produkcyjna',
    'SR': 'gospodarki rolnej',
    'SI': 'infrastrukturalna',
    'SN': 'zieleni i rekreacji',
    'SC': 'cmentarzy',
    'SG': 'gornictwa',
    'SO': 'otwarta',
    'SK': 'komunikacyjna',
    'SH': 'handlu wielkopowierzchniowego'
  };

  // Pobiera strefe POG przez GetFeatureInfo w EPSG:2180 (w 4326 usluga czesto nic nie zwraca).
  // Wynik: legenda pod mapa + ZNAK WODNY gdy planu brak + zdarzenie gruntowo:pog (dla raportu rozszerzonego).
  function pobierzLegendePOG(bbox, wh) {
    const box = document.getElementById('pog-legenda');
    const c = srodek(bbox);
    const p = wgs84Do2180(c.lon, c.lat);
    const d = 25;
    const warstwy = 'strefaPlanistyczna,obszarUzupelnieniaZabudowy,obszarZabSrodmiejskiej';
    const url = 'https://mapy.geoportal.gov.pl/wss/ext/PlanyOgolneGmin'
      + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&SRS=EPSG:2180'
      + '&BBOX=' + [p.x - d, p.y - d, p.x + d, p.y + d].map(function (v) { return v.toFixed(1); }).join(',')
      + '&WIDTH=101&HEIGHT=101&LAYERS=' + warstwy + '&QUERY_LAYERS=' + warstwy + '&STYLES=,,&FORMAT=image/png'
      + '&INFO_FORMAT=text/xml&FEATURE_COUNT=10&X=50&Y=50';
    const zakoncz = function (wynik) {
      window.gruntowoRaport.pog = wynik;
      oglos('gruntowo:pog', wynik);
      if (wynik.status !== 'jest') {
        znakWodny('map-pog', 'Nie znaleziono planu ogólnego', 'dla działki nie znaleziono planu ogólnego — zweryfikować w gminie', 'brak');
      }
    };
    fetchZPonowieniem(url, 2)
      .then(function (r) { return r.text(); })
      .then(function (xml) {
        const tresc = xml.replace(/<\?xml[^>]*>/, '').replace(/<\/?FeatureCollection[^>]*>/g, '').trim();
        if (!tresc) { zakoncz({ status: 'brak' }); return; }
        let kod = '';
        const re = />\s*(S[A-Z]{1,2})\s*</g; let mm;
        while ((mm = re.exec(xml))) { if (STREFY_POG[mm[1]]) { kod = mm[1]; break; } }
        const wynik = { status: 'jest', kod: kod, ouz: /UzupelnieniaZabudowy|OUZ/i.test(xml), xml: xml };
        zakoncz(wynik);
        if (box && kod) {
          box.innerHTML =
            '<div class="legenda-title">Strefa planistyczna (POG)</div>' +
            '<div class="legenda-body">' +
            '<div class="legenda-row"><span>Kod strefy</span><strong>' + kod + '</strong></div>' +
            '<div class="legenda-row"><span>Przeznaczenie</span><strong>strefa ' + STREFY_POG[kod] + '</strong></div>' +
            (wynik.ouz ? '<div class="legenda-row"><span>Obszar uzupełnienia zabudowy</span><strong>tak</strong></div>' : '') +
            '</div>';
          box.style.display = 'block';
        }
      })
      .catch(function () { zakoncz({ status: 'blad' }); });
  }

  // fetch z ponowieniem (Geoportal bywa zawodny): proby co 1.5 s, 4 s...
  function fetchZPonowieniem(url, ileRazy) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    }).catch(function (e) {
      if (!ileRazy) throw e;
      return new Promise(function (ok) { setTimeout(ok, ileRazy > 1 ? 1500 : 4000); })
        .then(function () { return fetchZPonowieniem(url, ileRazy - 1); });
    });
  }

  // Pobiera legende MPZP (symbol strefy + link do uchwaly) przez GetFeatureInfo.
  // MPZP dla dzialki — DWA niezalezne zrodla:
  //  1) GetFeatureInfo (dane opisowe: uchwala, data, link) — bywa zawodny: np. dla Lubonia zwraca
  //     "brak wyniku", choc plan jest na mapie;
  //  2) POKRYCIE MAPY: pobieramy obraz warstw planu i liczymy, jaka czesc dzialki jest pod planem.
  //     Jesli mapa pokazuje plan na dzialce — plan JEST, niezaleznie od odpowiedzi opisowej.
  const URL_KIMPZP = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego';
  const ZNAK_MPZP = ['Nie znaleziono MPZP', 'dla działki nie znaleziono planu miejscowego — zweryfikować w gminie'];
  const LINKI_MPZP = '<div class="legenda-linki">Gdzie sprawdzić:' +
    '<a href="https://krajowa.geoportal.gov.pl" target="_blank" rel="noopener">KIMPZP (portal krajowy) →</a>' +
    '<a href="https://www.e-mapa.net" target="_blank" rel="noopener">e-mapa.net (wykaz planów gminy) →</a>' +
    '</div>';

  function pobierzLegendeMPZP(bbox, wh, wkt) {
    const box = document.getElementById('mpzp-legenda');
    if (!box) return;
    const c = srodek(bbox), d = 0.0004;
    const urlFI = URL_KIMPZP + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo'
      + '&SRS=EPSG:4326&BBOX=' + [c.lon - d, c.lat - d, c.lon + d, c.lat + d].join(',')
      + '&WIDTH=101&HEIGHT=101&STYLES=&FORMAT=image/png'
      + '&LAYERS=plany_granice,wektor-str&QUERY_LAYERS=plany_granice,wektor-str'
      + '&INFO_FORMAT=text/html&FEATURE_COUNT=5&X=50&Y=50';

    const opis = fetchZPonowieniem(urlFI, 2).then(function (r) { return r.text(); }).catch(function () { return null; });
    const mapa = pokrycieMPZP(bbox, wkt).catch(function () { return null; });

    Promise.all([opis, mapa]).then(function (w) {
      const html = w[0], pokrycie = w[1];     // pokrycie: % dzialki pod planem (null = nie udalo sie)
      const tekst = (html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<head[\s\S]*?<\/head>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      // Odpowiedz ma czesci (rejestr planow + usluga gminy); "Gmina: brak wyniku" dotyczy tylko czesci
      const reszta = tekst.replace(/[^:]{0,80}:\s*brak wyniku dla wskazanego obszaru/gi, ' ').trim();
      const opisJest = reszta.length >= 5 && !planUchylony(html || '');
      const mapaJest = pokrycie !== null && pokrycie >= 5;

      let status;
      if (opisJest || mapaJest) status = 'jest';
      else if (html === null && pokrycie === null) status = 'blad';
      else if (tekst.length >= 5 || pokrycie === 0) status = 'brak';
      else status = 'nieznany';

      const wynik = { status: status, html: opisJest ? html : '', pokrycie: pokrycie, zrodlo: opisJest ? 'opis' : (mapaJest ? 'mapa' : '') };
      window.gruntowoRaport.mpzp = wynik;
      oglos('gruntowo:mpzp', wynik);

      if (status !== 'jest') {
        znakWodny('map-mpzp', ZNAK_MPZP[0], ZNAK_MPZP[1], 'brak');
        box.innerHTML = '<div class="legenda-note"><strong>Nie znaleziono planu miejscowego dla działki</strong> w Krajowej Integracji MPZP. ' +
          'Usługa krajowa nie obejmuje wszystkich gmin i planów — przed decyzją zweryfikuj w gminie (wypis i wyrys z planu). Jeśli planu nie ma, zabudowa jest możliwa na podstawie decyzji o warunkach zabudowy (WZ).' +
          LINKI_MPZP + '</div>';
        box.style.display = 'block';
        return;
      }
      znakWodny('map-mpzp', '');
      const dane = opisJest ? parsujLegendeMPZP(html) : { symbol: '', uchwala: '', data: '', link: '' };
      const nazwaPlanu = opisJest ? poleTabeli(html, /^nazwa planu$/i).replace(/^w sprawie uchwalenia\s+/i, '').replace(/^(miejscowego\s+)?planu\s+zagospodarowania\s+przestrzennego\s+/i, '') : '';
      if (dane.symbol || dane.uchwala || dane.link) {
        let h = '<div class="legenda-title">Zapisy planu dla działki</div><div class="legenda-body">';
        if (dane.symbol) h += '<div class="legenda-row"><span>Symbol / przeznaczenie</span><strong>' + dane.symbol + '</strong></div>';
        if (dane.uchwala) h += '<div class="legenda-row"><span>Uchwała</span><strong>' + dane.uchwala + '</strong></div>';
        if (dane.data) h += '<div class="legenda-row"><span>Data uchwalenia</span><strong>' + dane.data + '</strong></div>';
        if (nazwaPlanu) h += '<div class="legenda-row"><span>Plan</span><strong>' + nazwaPlanu.replace(/</g, '&lt;') + '</strong></div>';
        h += dane.link
          ? '<a class="legenda-link" href="' + dane.link + '" target="_blank" rel="noopener">Otwórz treść uchwały →</a>'
          : '<a class="legenda-link" href="https://krajowa.geoportal.gov.pl" target="_blank" rel="noopener">Znajdź treść uchwały w KIMPZP →</a>';
        h += '</div>';
        box.innerHTML = h;
      } else {
        box.innerHTML = '<div class="legenda-note"><strong>Działka jest objęta planem miejscowym</strong>' +
          (pokrycie !== null ? ' (plan na mapie obejmuje ok. ' + Math.round(pokrycie) + '% działki)' : '') +
          '. Usługa krajowa nie udostępnia dla tej gminy numeru uchwały ani przeznaczenia w formie danych — odczytaj je z rysunku planu powyżej lub z uchwały.' +
          LINKI_MPZP + '</div>';
      }
      box.style.display = 'block';
    });
  }

  // Jaki % dzialki przykrywa warstwa planu na mapie (piksele obrazu WMS w granicach dzialki)
  function pokrycieMPZP(bbox, wkt) {
    if (!wkt || !window.createImageBitmap) return Promise.reject(new Error('brak danych'));
    const mb = margines(bbox, 0.3), wh = wymiary(mb);
    const warstwy = ['raster', 'wektor-str', 'wektor-pow'];
    const url = URL_KIMPZP + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true'
      + '&LAYERS=' + warstwy.join(',') + '&STYLES=,,&WIDTH=' + wh.W + '&HEIGHT=' + wh.H + '&BBOX=' + mb.join(',');
    return fetchZPonowieniem(url, 2).then(function (r) {
      if ((r.headers.get('content-type') || '').indexOf('image') === -1) throw new Error('nie obraz');
      return r.blob();
    }).then(createImageBitmap).then(function (bmp) {
      const W = bmp.width, H = bmp.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;
      // maska dzialki
      const mk = document.createElement('canvas'); mk.width = W; mk.height = H;
      const mctx = mk.getContext('2d');
      mctx.beginPath();
      (wkt.match(/\(([^()]+)\)/g) || []).forEach(function (r) {
        r.replace(/[()]/g, '').split(',').forEach(function (para, i) {
          const xy = para.trim().split(/\s+/).map(Number);
          const x = (xy[0] - mb[0]) / (mb[2] - mb[0]) * W, y = (mb[3] - xy[1]) / (mb[3] - mb[1]) * H;
          if (i === 0) mctx.moveTo(x, y); else mctx.lineTo(x, y);
        });
        mctx.closePath();
      });
      mctx.fill('evenodd');
      const m = mctx.getImageData(0, 0, W, H).data;
      let wDzialce = 0, pokryte = 0;
      for (let i = 3; i < m.length; i += 4) {
        if (m[i] > 127) { wDzialce++; if (px[i] > 40) pokryte++; }
      }
      return wDzialce ? 100 * pokryte / wDzialce : 0;
    });
  }

  // Wartosc z tabeli <th>klucz</th><td>wartosc</td> (bez znacznikow HTML)
  function poleTabeli(html, wzorKlucza) {
    const re = /<th[^>]*>([^<]{1,60})<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi; let mm;
    while ((mm = re.exec(html))) {
      if (wzorKlucza.test(mm[1].trim())) return mm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return '';
  }
  // Plan z data "wazny_do" w przeszlosci = uchylony / nieobowiazujacy
  function planUchylony(html) {
    const d = poleTabeli(html, /^wazny_do$/i);
    return !!(d && /^\d{4}-\d{2}-\d{2}/.test(d) && new Date(d.slice(0, 10)) < new Date());
  }

  function parsujLegendeMPZP(html) {
    const wynik = { symbol: '', uchwala: '', data: '', link: '' };
    if (!html) return wynik;
    const plain = html.replace(/<[^>]+>/g, ' \n ').replace(/&nbsp;/g, ' ');

    // LINK do uchwaly — szukamy w kolejnosci pewnosci:
    // 1) link w atrybutach wskazujacy dziennik urzedowy / edziennik / PDF planu
    let linkM = html.match(/(https?:\/\/[^\s"'<>]*(?:edziennik|dziennik|dzienniki|monitorpolski)[^\s"'<>]*)/i);
    // 2) dowolny link do PDF (czesto to skan uchwaly)
    if (!linkM) linkM = html.match(/(https?:\/\/[^\s"'<>]+\.pdf)/i);
    // 3) href z pola "uchwala"/"akt"/"plan"
    if (!linkM) {
      const m = plain.match(/(?:uchwa[łl]|akt|plan)[\s\S]{0,80}?(https?:\/\/[^\s"'<>]+)/i);
      if (m) linkM = [m[1], m[1]];
    }
    if (linkM) wynik.link = (linkM[1] || linkM[0]);

    // SYMBOL strefy (MN, MN2, 5MN.3, U, RM, ZL, MN/U...) — wg konwencji MPZP
    const symM = plain.match(/\b(\d{0,2}[A-Z]{1,3}\d{0,2}(?:[\.\/][A-Z0-9]{1,4})?)\b(?=[\s\n]*[-–:]?\s*(?:tereny|zabudow|przeznacz|funkcj))/i)
      || plain.match(/(?:symbol|oznaczenie|przeznaczenie|funkcja)[\s:\n]+(\d{0,2}[A-Z]{1,3}\d{0,2}(?:[\.\/][A-Z0-9]{1,4})?)/i);
    if (symM) wynik.symbol = symM[1];
    // Format tabelaryczny/XML uslug gminnych (np. FUN_SYMB, numer_uchwaly)
    const fs = html.match(/<FUN_SYMB>([^<]+)<\/FUN_SYMB>/i) || html.match(/>\s*(?:symbol|fun_symb)\s*<\/t[hd]>\s*<td[^>]*>([^<]+)</i);
    if (fs) wynik.symbol = fs[1].trim();
    const nu = html.match(/>\s*numer_uchwaly\s*<\/t[hd]>\s*<td[^>]*>([^<]+)</i);
    if (nu && !wynik.uchwala) wynik.uchwala = nu[1].trim();
    // Rejestr planow GUGiK: "Uchwała", "Data uchwały"
    const u2 = poleTabeli(html, /^uchwa[łl]a$/i); if (u2) wynik.uchwala = u2;
    const d2 = poleTabeli(html, /^data uchwa[łl]y$/i); if (d2) wynik.data = d2;

    // NUMER UCHWALY — rzymskie/arabskie, np. "nr XLII/348/2018" albo "nr 348/2018"
    const uchM = plain.match(/(?:uchwa[łl][aey])[\s\S]{0,40}?(nr\.?\s*[IVXLCDM]+\/\d+\/\d{2,4})/i)
      || plain.match(/(nr\.?\s*[IVXLCDM]+\/\d+\/\d{2,4})/i)
      || plain.match(/(?:uchwa[łl][aey])[\s\S]{0,40}?(nr\.?\s*\d+\/\d{2,4})/i);
    if (uchM) wynik.uchwala = uchM[1].replace(/\s+/g, ' ').trim();

    // DATA uchwalenia
    const dataM = plain.match(/\d{4}-\d{2}-\d{2}/) || plain.match(/\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|pazdziernika|listopada|grudnia)\s+\d{4}/i);
    if (dataM) wynik.data = dataM[0];

    return wynik;
  }

  // Rysuje ZLOTY OBRYS dzialki (z geometrii WKT) nalozony na mape.
  // KLUCZOWE: obraz WMS ma proporcje wg wymiary() (dopasowane do metrow, z korekta cos),
  // a nie proporcje bbox w stopniach. SVG musi miec te same proporcje co obraz
  // i byc przyciety tak samo (object-fit:cover -> preserveAspectRatio slice).
  // Etykieta wymiaru — zlote tlo, wieksza i wyrazniejsza (bo tylko dwie na mape)
  function etykietaWymiar(mx, my, tekst) {
    const szer = tekst.length * 13 + 24;
    return '<g>' +
      '<rect x="' + (mx - szer / 2).toFixed(1) + '" y="' + (my - 17).toFixed(1) + '" width="' + szer + '" height="30" rx="6" fill="rgba(176,141,62,0.95)" stroke="#0b0c0a" stroke-width="1"/>' +
      '<text x="' + mx.toFixed(1) + '" y="' + (my + 4).toFixed(1) + '" font-family="monospace" font-size="21" font-weight="600" fill="#14181a" text-anchor="middle">' + tekst + '</text>' +
      '</g>';
  }

  // Rysuje LINIE WYMIAROWA (styl geodezyjny, jak OnGeo): linia od (x1,y1) do
  // (x2,y2) z kreseczkami prostopadlymi na koncach i liczba na srodku.
  function liniaWymiarowa(x1, y1, x2, y2, tekst) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;   // prostopadly jednostkowy
    const k = 7;                            // dlugosc kreseczki koncowej

    const kres1 = 'M' + (x1 + nx * k).toFixed(1) + ',' + (y1 + ny * k).toFixed(1) +
                  ' L' + (x1 - nx * k).toFixed(1) + ',' + (y1 - ny * k).toFixed(1);
    const kres2 = 'M' + (x2 + nx * k).toFixed(1) + ',' + (y2 + ny * k).toFixed(1) +
                  ' L' + (x2 - nx * k).toFixed(1) + ',' + (y2 - ny * k).toFixed(1);

    const sx = (x1 + x2) / 2, sy = (y1 + y2) / 2;
    const szer = tekst.length * 11 + 16;

    return '<g>' +
      '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#c9a961" stroke-width="2"/>' +
      '<path d="' + kres1 + '" stroke="#c9a961" stroke-width="2"/>' +
      '<path d="' + kres2 + '" stroke="#c9a961" stroke-width="2"/>' +
      '<rect x="' + (sx - szer / 2).toFixed(1) + '" y="' + (sy - 13).toFixed(1) + '" width="' + szer + '" height="24" rx="4" fill="rgba(11,12,10,0.9)" stroke="#c9a961" stroke-width="1"/>' +
      '<text x="' + sx.toFixed(1) + '" y="' + (sy + 4).toFixed(1) + '" font-family="monospace" font-size="17" font-weight="600" fill="#dfc090" text-anchor="middle">' + tekst + '</text>' +
      '</g>';
  }

  // Oblicz obwod dzialki w metrach
  function obliczObwod(punkty, mLon, mLat) {
    let obw = 0;
    for (let i = 0; i < punkty.length - 1; i++) {
      const dLon = (punkty[i + 1].lon - punkty[i].lon) * mLon;
      const dLat = (punkty[i + 1].lat - punkty[i].lat) * mLat;
      obw += Math.hypot(dLon, dLat);
    }
    return Math.round(obw);
  }

  // Wypelnij sekcje wymiarow pod mapa zaznaczenia
  function wypelnijWymiaryPodMapa(w) {
    const box = document.getElementById('wymiary-dane');
    if (!box) return;
    box.innerHTML =
      '<div class="wym-item"><span class="wym-label">Dlugosc (gabaryt)</span><span class="wym-val">' + w.dlugosc + ' m</span></div>' +
      '<div class="wym-item"><span class="wym-label">Szerokosc (gabaryt)</span><span class="wym-val">' + w.szerokosc + ' m</span></div>' +
      '<div class="wym-item"><span class="wym-label">Obwod dzialki</span><span class="wym-val">' + w.obwod + ' m</span></div>' +
      '<div class="wym-item"><span class="wym-label">Liczba bokow</span><span class="wym-val">' + w.boki + '</span></div>';
    const sekcja = document.getElementById('sec-wymiary');
    if (sekcja) sekcja.style.display = 'block';
  }

  function rysujObrys(idMapy, wkt, bboxMapy, wh, pokazWymiary) {
    const img = $(idMapy);
    if (!img || !wkt) return;
    const box = img.parentElement;
    if (!box) return;

    const pierscienie = wkt.match(/\(([^()]+)\)/g);
    if (!pierscienie || !pierscienie.length) return;

    const minLon = bboxMapy[0], minLat = bboxMapy[1], maxLon = bboxMapy[2], maxLat = bboxMapy[3];
    const szerLon = maxLon - minLon, szerLat = maxLat - minLat;
    if (szerLon <= 0 || szerLat <= 0) return;

    const W = (wh && wh.W) ? wh.W : 1000;
    const H = (wh && wh.H) ? wh.H : 1000;

    // Wspolczynnik metrow na stopien dla szerokosci Polski
    const latSrodek = (minLat + maxLat) / 2;
    const M_NA_STOPIEN_LAT = 111132;                          // metry na 1 stopien szerokosci
    const M_NA_STOPIEN_LON = 111320 * Math.cos(latSrodek * Math.PI / 180); // dlugosci (krotsze)

    let paths = '';
    let etykiety = '';

    pierscienie.forEach(function (p) {
      const wsp = p.replace(/[()]/g, '').trim().split(',');
      // Zbierz punkty jako {lon,lat,x,y}
      const punkty = [];
      wsp.forEach(function (para) {
        const xy = para.trim().split(/\s+/).map(Number);
        if (xy.length < 2 || isNaN(xy[0]) || isNaN(xy[1])) return;
        const lon = xy[0], lat = xy[1];
        punkty.push({
          lon: lon, lat: lat,
          x: ((lon - minLon) / szerLon) * W,
          y: ((maxLat - lat) / szerLat) * H
        });
      });
      if (punkty.length < 2) return;

      // Sciezka obrysu
      let d = '';
      punkty.forEach(function (pt, i) { d += (i === 0 ? 'M' : 'L') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ' '; });
      paths += '<path d="' + d + 'Z" fill="rgba(201,169,110,0.18)" stroke="#c9a961" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';

      // WYMIARY jako LINIE WYMIAROWE na krawedziach prostokata otaczajacego dzialke.
      // Prostokat zorientowany wzdluz najdluzszego boku — linie zawsze rownolegle do dzialki.
      if (pokazWymiary && punkty.length >= 3) {
        const lonSr = (minLon + maxLon) / 2, latSr = (minLat + maxLat) / 2;
        const mp = punkty.map(function (pt) {
          return {
            mx: (pt.lon - lonSr) * M_NA_STOPIEN_LON,
            my: (pt.lat - latSr) * M_NA_STOPIEN_LAT,
            x: pt.x, y: pt.y
          };
        });

        // === WYMIARY: linie leza WZDLUZ dwoch najdluzszych bokow samej dzialki ===
        // (nie wzdluz prostokata otaczajacego — to eliminuje przesuniecie).

        // Srodek dzialki w pikselach (do odsuniecia linii na wlasciwa strone)
        const cx = mp.reduce(function (s, m) { return s + m.x; }, 0) / mp.length;
        const cy = mp.reduce(function (s, m) { return s + m.y; }, 0) / mp.length;

        // Dlugosc kazdego boku (w metrach) + zapamietaj indeksy
        const boki = [];
        for (let i = 0; i < mp.length - 1; i++) {
          const dmx = mp[i + 1].mx - mp[i].mx, dmy = mp[i + 1].my - mp[i].my;
          boki.push({ i: i, dlug: Math.hypot(dmx, dmy), kat: Math.atan2(dmy, dmx) });
        }
        boki.sort(function (a, b) { return b.dlug - a.dlug; });

        // BOK 1 = najdluzszy (to bedzie "dlugosc")
        const bok1 = boki[0];
        // BOK 2 = najdluzszy bok najbardziej PROSTOPADLY do bok1 (to "szerokosc")
        let bok2 = null, bestPerp = -1;
        for (let k = 1; k < boki.length; k++) {
          let dk = Math.abs(boki[k].kat - bok1.kat);
          while (dk > Math.PI) dk -= Math.PI;             // roznica katow 0..PI
          const perp = Math.abs(Math.sin(dk)) * boki[k].dlug; // im blizej 90°, tym wieksza
          if (perp > bestPerp) { bestPerp = perp; bok2 = boki[k]; }
        }
        if (!bok2) bok2 = boki[1] || boki[0];

        // Gabaryty (dlugosc x szerokosc) — rzuty na osie bok1
        const uMx = Math.cos(bok1.kat), uMy = Math.sin(bok1.kat);
        const pMx = -uMy, pMy = uMx;
        let minU = 1e9, maxU = -1e9, minP = 1e9, maxP = -1e9;
        mp.forEach(function (m) {
          const u = m.mx * uMx + m.my * uMy, pr = m.mx * pMx + m.my * pMy;
          if (u < minU) minU = u; if (u > maxU) maxU = u;
          if (pr < minP) minP = pr; if (pr > maxP) maxP = pr;
        });
        const dlugosc = maxU - minU, szerokosc = maxP - minP;

        window._wymiaryDzialki = {
          dlugosc: Math.round(dlugosc),
          szerokosc: Math.round(szerokosc),
          obwod: obliczObwod(punkty, M_NA_STOPIEN_LON, M_NA_STOPIEN_LAT),
          boki: punkty.length - 1
        };

        // Rysuje linie wymiarowa wzdluz danego BOKU dzialki (w pikselach),
        // odsunieta prostopadle NA ZEWNATRZ (od srodka dzialki), z podana etykieta.
        const liniaWzdluzBoku = function (bok, etykieta) {
          const p1 = mp[bok.i], p2 = mp[bok.i + 1];
          // wektor boku w pikselach + normalna
          const bdx = p2.x - p1.x, bdy = p2.y - p1.y;
          const blen = Math.hypot(bdx, bdy) || 1;
          let nx = -bdy / blen, ny = bdx / blen;       // normalna
          // skieruj normalna NA ZEWNATRZ (od srodka dzialki)
          const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
          if ((midX + nx - cx) * nx + (midY + ny - cy) * ny < 0) { nx = -nx; ny = -ny; }
          const off = 16;
          return liniaWymiarowa(
            p1.x + nx * off, p1.y + ny * off,
            p2.x + nx * off, p2.y + ny * off,
            etykieta
          );
        };

        // Linia dlugosci wzdluz najdluzszego boku; szerokosci wzdluz boku prostopadlego.
        etykiety += liniaWzdluzBoku(bok1, Math.round(dlugosc) + ' m');
        etykiety += liniaWzdluzBoku(bok2, Math.round(szerokosc) + ' m');
      }
    });
    if (!paths) return;

    // Po narysowaniu — wypelnij wymiary pod mapa (jesli sekcja istnieje)
    if (pokazWymiary && window._wymiaryDzialki) {
      wypelnijWymiaryPodMapa(window._wymiaryDzialki);
      oglos('gruntowo:wymiary', window._wymiaryDzialki);
    }

    const stary = box.querySelector('.obrys-svg');
    if (stary) stary.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'obrys-svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    svg.innerHTML = paths + etykiety;
    box.appendChild(svg);
  }

  // Narzedzia geometryczne
  function bboxZWKT(wkt) {
    const n = (wkt.match(/-?\d+\.\d+/g) || []).map(Number);
    if (n.length < 4) return null;
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (let i = 0; i < n.length - 1; i += 2) {
      if (n[i] < a) a = n[i]; if (n[i] > c) c = n[i];
      if (n[i+1] < b) b = n[i+1]; if (n[i+1] > d) d = n[i+1];
    }
    return [a, b, c, d];
  }
  function margines(b, f) {
    const dx = (b[2]-b[0])*f, dy = (b[3]-b[1])*f, m = Math.max(dx, dy, 0.0008);
    return [b[0]-m, b[1]-m, b[2]+m, b[3]+m];
  }
  function srodek(b) { return { lon:(b[0]+b[2])/2, lat:(b[1]+b[3])/2 }; }

  // Kadr kwadratowy wokol srodka dzialki: promien = max(minMetry, krotnosc x polowa rozmiaru dzialki)
  function marginesMetry(b, minMetry, krotnosc) {
    const c = srodek(b);
    const mLat = 111132, mLon = 111320 * Math.cos(c.lat * Math.PI / 180);
    const polowa = Math.max((b[2] - b[0]) * mLon, (b[3] - b[1]) * mLat) / 2;
    const r = Math.max(minMetry, polowa * (krotnosc || 3));
    return [c.lon - r / mLon, c.lat - r / mLat, c.lon + r / mLon, c.lat + r / mLat];
  }

  // ZNAK WODNY na mapie — np. gdy nie znaleziono planu (MPZP/POG) albo form ochrony przyrody.
  // typ: 'brak' (szary, neutralny) | 'ok' (zielonkawy) | 'uwaga' (zloty)
  function znakWodny(idMapy, tytul, podtytul, typ) {
    const img = $(idMapy);
    const box = img && img.parentElement;
    if (!box) return;
    const stary = box.querySelector('.znak-wodny');
    if (stary) stary.remove();
    if (!tytul) return;
    const el = document.createElement('div');
    el.className = 'znak-wodny znak-' + (typ || 'brak');
    const t = document.createElement('div'); t.className = 'zw-tytul'; t.textContent = tytul; el.appendChild(t);
    if (podtytul) { const p = document.createElement('div'); p.className = 'zw-pod'; p.textContent = podtytul; el.appendChild(p); }
    box.appendChild(el);
  }

  // Konwersja WGS84 (lon,lat w stopniach) -> EPSG:2180 (PUWG 1992, metry).
  // Odwzorowanie poprzeczne Merkatora (Gauss-Kruger), poludnik srodkowy 19°E.
  // Potrzebne dla warstwy KIUT (uzbrojenie), ktora nie obsluguje 4326.
  function wgs84Do2180(lon, lat) {
    const a = 6378137.0, f = 1 / 298.257223563;   // elipsoida GRS80/WGS84
    const e2 = f * (2 - f);
    const k0 = 0.9993, lon0 = 19 * Math.PI / 180;
    const x0 = 500000, y0 = -5300000;             // przesuniecia dla PL-1992
    const rad = Math.PI / 180;
    const phi = lat * rad, lam = lon * rad;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    const t = Math.tan(phi), t2 = t * t;
    const ep2 = e2 / (1 - e2);
    const eta2 = ep2 * Math.cos(phi) * Math.cos(phi);
    const dl = lam - lon0;
    // Dlugosc luku poludnika
    const e4 = e2 * e2, e6 = e4 * e2;
    const A0 = 1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256;
    const A2 = (3 / 8) * (e2 + e4 / 4 + 15 * e6 / 128);
    const A4 = (15 / 256) * (e4 + 3 * e6 / 4);
    const A6 = 35 * e6 / 3072;
    const M = a * (A0 * phi - A2 * Math.sin(2 * phi) + A4 * Math.sin(4 * phi) - A6 * Math.sin(6 * phi));
    const c = Math.cos(phi);
    const x = M + N * t * (dl * dl / 2 * c * c
      + dl * dl * dl * dl / 24 * c * c * c * c * (5 - t2 + 9 * eta2 + 4 * eta2 * eta2)
      + dl * dl * dl * dl * dl * dl / 720 * c * c * c * c * c * c * (61 - 58 * t2 + t2 * t2));
    const y = N * (dl * c
      + dl * dl * dl / 6 * c * c * c * (1 - t2 + eta2)
      + dl * dl * dl * dl * dl / 120 * c * c * c * c * c * (5 - 18 * t2 + t2 * t2 + 14 * eta2 - 58 * t2 * eta2));
    // W PUWG 1992: X = northing (na polnoc), Y = easting (na wschod)
    const northing = k0 * x + y0;
    const easting = k0 * y + x0;
    return { x: easting, y: northing };
  }

  function coords(lat, lon) { return dms(lat,'NS') + ' · ' + dms(lon,'EW'); }
  function dms(v, ax) {
    const dir = v>=0?ax[0]:ax[1]; v=Math.abs(v);
    const d=Math.floor(v), m=Math.floor((v-d)*60), s=Math.round(((v-d)*60-m)*60);
    return d+'°'+String(m).padStart(2,'0')+"'"+String(s).padStart(2,'0')+'"'+dir;
  }

  // Narzedzia map udostepnione innym skryptom (raport rozszerzony uzywa tych samych
  // podkladow, fallbacku ortofoto i obrysu dzialki — bez kopiowania kodu).
  window.GruntowoMapy = {
    setMapa: setMapa,
    setMapaOverlay: setMapaOverlay,
    ustawTloMapy: ustawTloMapy,
    ortoWMTS: ortoWMTS,
    rysujObrys: rysujObrys,
    znakWodny: znakWodny,
    margines: margines,
    wymiary: wymiary,
    wgs84Do2180: wgs84Do2180,
    bboxZWKT: bboxZWKT,
    ortoZrodla: ortoZrodla
  };
})();
