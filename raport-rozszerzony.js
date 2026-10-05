/*
 * gruntowo.pl - RAPORT ROZSZERZONY
 *
 * Jak to dziala:
 *  1. Bramka hasla (haslo.js). Po odblokowaniu dociagamy raport.js - ten sam co w raporcie
 *     darmowym - ktory buduje czesc A (mapy, parametry, ceny) i oglasza zdarzenia
 *     gruntowo:dzialka / gruntowo:ceny / gruntowo:wymiary.
 *  2. Po zdarzeniu gruntowo:dzialka uruchamiamy analizy czesci B (kazda niezalezna,
 *     z limitem czasu - awaria jednej uslugi nie blokuje reszty):
 *       mpzp      KIMPZP GetFeatureInfo          -> czy jest plan, przeznaczenie
 *       pog       Plany ogolne gmin (EPSG:2180)  -> strefa planistyczna, obszar uzupelnienia zabudowy
 *       powodz    ISOK (Wody Polskie) GetMap+FI  -> % dzialki w strefie zalewowej, scenariusz
 *       przyroda  GDOS GetMap+FI                 -> Natura 2000, parki, rezerwaty...
 *       media     KIUT GetMap (EPSG:2180)        -> czy siec przechodzi przez dzialke / odleglosc
 *       teren     NMT GUGiK                      -> wysokosci, spadek terenu
 *       uzytki    KIEG GetFeatureInfo            -> uzytki gruntowe i klasy gleb
 *       otoczenie OpenStreetMap (Overpass)       -> droga przy granicy, szkoly, sklepy, przystanki
 *       ceny      z raport.js (backend LH)       -> liczba transakcji w okolicy
 *  3. Kazdy wynik zamienia sie na "czynniki" (plus / minus / do sprawdzenia, z waga).
 *     Z czynnikow liczony jest werdykt 0-100, pokazywany na poczatku i na koncu raportu.
 *
 * Reguly werdyktu: funkcja zbierzCzynniki() - tam dopisuje sie nowe plusy/minusy.
 * Wszystkie uslugi sprawdzone 25.09.2026 z domeny gruntowo.pl (CORS dziala).
 */
(function () {
  'use strict';

  var RAPORT_JS = 'raport.js?v=20261002q';

  var URL_KIMPZP = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego';
  var URL_POG = 'https://mapy.geoportal.gov.pl/wss/ext/PlanyOgolneGmin';
  var URL_ISOK = 'https://wody.isok.gov.pl/wss/INSPIRE/INSPIRE_NZ_HY_MZPMRP_WMS';
  var URL_GDOS = 'https://sdi.gdos.gov.pl/wms';
  var URL_KIUT = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu';
  // Czesc powiatow (np. poznanski) odpowiada w KIUT bez naglowka CORS - przegladarka moze obraz
  // POKAZAC (mapa 07), ale nie moze go PRZEANALIZOWAC. Wtedy obraz pobieramy przez posrednika na LH.
  // Puste = bez posrednika (dla takich powiatow raport pokaze wskazowke zamiast analizy).
  var URL_KIUT_PROXY = 'https://sniadecki-development.pl/gruntowo-api/kiut.php';
  var URL_USTALENIA = 'https://sniadecki-development.pl/gruntowo-api/plan-ustalenia.php';
  var URL_POZWOLENIA = 'https://sniadecki-development.pl/gruntowo-api/pozwolenia.php';
  var URL_RWDZ = 'https://wyszukiwarka.gunb.gov.pl/';
  var URL_KIEG = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow';
  var URL_NMT = 'https://services.gugik.gov.pl/nmt/';
  var URL_OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

  var WARSTWY_GDOS = ['GDOS:ParkiNarodowe', 'GDOS:Rezerwaty', 'GDOS:SpecjalneObszaryOchrony', 'GDOS:ObszarySpecjalnejOchrony',
    'GDOS:ParkiKrajobrazowe', 'GDOS:ObszaryChronionegoKrajobrazu', 'GDOS:UzytkiEkologiczne', 'GDOS:ZespolyPrzyrodniczoKrajobrazowe'];
  var WARSTWY_ISOK = ['NZ.Fluvial', 'NZ.SeaWater'];

  // Sieci KIUT - kolory odczytane z uslugi (render domyslny). tol = tolerancja koloru.
  var SIECI = [
    { klucz: 'elektro', nazwa: 'elektroenergetyczna', rgb: [248, 8, 8], css: '#f80808' },
    { klucz: 'gaz', nazwa: 'gazowa', rgb: [248, 152, 8], css: '#f89808' },
    { klucz: 'woda', nazwa: 'wodociągowa', rgb: [8, 8, 248], css: '#0808f8' },
    { klucz: 'kanal', nazwa: 'kanalizacyjna', rgb: [136, 56, 8], css: '#883808' },
    { klucz: 'cieplo', nazwa: 'ciepłownicza', rgb: [216, 8, 216], css: '#d808d8' },
    { klucz: 'telekom', nazwa: 'telekomunikacyjna', rgb: [184, 184, 8], css: '#b8b808' }
  ];

  // Skutki sieci przechodzacej PRZEZ dzialke
  var SKUTEK_SIECI = {
    elektro: 'Linia wymaga pasa technologicznego - dla napowietrznej średniego napięcia ok. 7,5 m od osi, dla 110 kV nawet ok. 20 m; w pasie nie wolno budować. Możliwe przełożenie linii na koszt inwestora.',
    gaz: 'Gazociąg ma strefę kontrolowaną, w której nie wolno budować.',
    cieplo: 'Sieć ciepłownicza zwykle wymaga służebności i odsunięcia zabudowy.',
    woda: 'Przewód przez działkę zwykle wymaga służebności przesyłu i odsunięcia budynku.',
    kanal: 'Przewód przez działkę zwykle wymaga służebności przesyłu i odsunięcia budynku.',
    telekom: 'Zwykle łatwy do przełożenia, ale sprawdź służebność.'
  };
  // Sieci PRZY dzialce: strefa [m] od granicy, w ktorej siec obniza ocene (minus), i dalsza (uwaga).
  // Usluga KIUT nie podaje rodzaju linii (napowietrzna/kablowa) ani napiecia - przyjmujemy wariant ostrozny.
  var STREFY_SIECI = {
    elektro: { strefa: 7.5, waga: -7, dalej: 20,
      opis: 'Jeśli to linia napowietrzna średniego napięcia, jej strefa ok. 7,5 m od osi (bez zabudowy) wchodzi na działkę. Rodzaj linii sprawdź na mapie zasadniczej lub u operatora sieci.',
      opisDalej: 'Jeśli to linia wysokiego napięcia (110 kV), pas technologiczny może sięgać ok. 20 m od osi - sprawdź rodzaj linii.' },
    gaz: { strefa: 5, waga: -5, dalej: 15,
      opis: 'Strefa kontrolowana gazociągu może wchodzić na działkę - szerokość zależy od ciśnienia (od ok. 1 m dla niskiego do kilkunastu m dla wysokiego).',
      opisDalej: 'Przy gazociągu wysokiego ciśnienia strefa kontrolowana może sięgać działki - sprawdź u operatora.' },
    cieplo: { strefa: 2, waga: -2, opis: 'Sieć ciepłownicza tuż przy granicy - możliwa strefa ochronna.' }
  };

  var STREFY_POG = {
    SW: 'wielofunkcyjna z zabudową mieszkaniową wielorodzinną', SJ: 'wielofunkcyjna z zabudową mieszkaniową jednorodzinną',
    SZ: 'wielofunkcyjna z zabudową zagrodową', SU: 'usługowa', SH: 'handlu wielkopowierzchniowego', SP: 'gospodarcza (produkcyjna)',
    SR: 'produkcji rolniczej', SI: 'infrastrukturalna', SN: 'zieleni i rekreacji', SC: 'cmentarzy', SG: 'górnictwa',
    SO: 'otwarta', SK: 'komunikacyjna'
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function m(liczba) { return Math.round(liczba).toLocaleString('pl-PL'); }
  function odl(metry) { return metry < 1000 ? Math.round(metry) + ' m' : (metry / 1000).toFixed(1).replace('.', ',') + ' km'; }

  // =====================================================================
  // 1. BRAMKA HASLA
  // =====================================================================
  var raportZaladowany = false;
  function otworzRaport() {
    document.body.classList.remove('zablokowane');
    var b = $('bramka'); if (b) b.classList.add('ukryta');
    if (raportZaladowany) return;
    raportZaladowany = true;
    var s = document.createElement('script');
    s.src = RAPORT_JS;
    document.body.appendChild(s);
  }
  // PRZYKLADOWY RAPORT (link ze strony glownej): dla JEDNEJ wybranej dzialki raport otwiera sie
  // bez hasla, z paskiem "to jest przyklad". Zmiana dzialki przykladowej: stala PRZYKLAD_ID
  // (i ten sam identyfikator w linku w index.html).
  var PRZYKLAD_ID = '302116_5.0005.78/3';
  var parametry = new URLSearchParams(window.location.search);
  var trybPrzykladu = parametry.get('przyklad') === '1' && parametry.get('id') === PRZYKLAD_ID;
  if (trybPrzykladu) {
    document.body.classList.add('tryb-przykladu');
    var pasek = document.createElement('div');
    pasek.className = 'pasek-przykladu';
    pasek.innerHTML = '<div class="pp-tekst"><strong>To jest przykładowy raport rozszerzony</strong> - dla działki w Janikowie (gm. Swarzędz). ' +
      'Tak samo wygląda raport dla Twojej działki. <a href="raport.html?id=302116_5.0005.78%2F3&ok=1&przyklad=1">Zobacz też raport bezpłatny tej działki</a>, żeby porównać zakres.</div>' +
      '<div class="pp-akcje"><a href="raport.html?kup=1" class="btn btn-gold">Kup raport dla swojej działki - 69 zł</a>' +
      '<a href="index.html#haslo" class="btn">Mam hasło</a></div>';
    var hero = document.querySelector('#report .rep-hero');
    if (hero) hero.parentNode.insertBefore(pasek, hero);
    otworzRaport();
  } else {
    wybierzDostep();
  }

  // Dostep: (1) powrot z PayU z numerem zamowienia, (2) haslo, (3) wczesniej oplacona dzialka, (4) bramka
  function wybierzDostep() {
    var id = parametry.get('id') || '';
    var ext = parametry.get('zamowienie') || '';
    var P = window.GruntowoPlatnosc;
    if (id && ext && P) { zablokuj('Sprawdzamy płatność…'); czekajNaPlatnosc(id, ext, 0); return; }
    if (window.GruntowoHaslo && GruntowoHaslo.czyOdblokowane()) { otworzRaport(); return; }
    var zapisane = id && P ? P.zamowienieDla(id) : '';
    if (zapisane) {
      zablokuj('Sprawdzamy dostęp…');
      P.sprawdz(id, zapisane).then(function (w) { if (w.oplacone) otworzOplacony(id, zapisane); else pokazBramke(id, ''); },
        function () { pokazBramke(id, ''); });
      return;
    }
    pokazBramke(id, '');
  }
  // Po powrocie z PayU powiadomienie moze dojsc z opoznieniem - pytamy kilka razy (co 3 s, do ~30 s)
  function czekajNaPlatnosc(id, ext, proba) {
    window.GruntowoPlatnosc.sprawdz(id, ext).then(function (w) {
      if (w.oplacone) {
        // zakup (raz na zamowienie) - do statystyk Google Analytics, jesli uzytkownik sie zgodzil
        try { const k = 'gruntowo_ga_zakup_' + ext; if (!localStorage.getItem(k)) { localStorage.setItem(k, '1');
          window.gruntowoZdarzenie && window.gruntowoZdarzenie('purchase', { transaction_id: ext, currency: 'PLN', value: 69, items: [{ item_name: 'Raport rozszerzony' }] }); } } catch (e) {}
        otworzOplacony(id, ext); return;
      }
      if (proba < 10 && w.status !== 'CANCELED' && w.status !== 'BRAK') {
        zablokuj('Czekamy na potwierdzenie płatności z PayU… (' + (proba + 1) + ')');
        setTimeout(function () { czekajNaPlatnosc(id, ext, proba + 1); }, 3000);
        return;
      }
      pokazBramke(id, w.status === 'CANCELED' ? 'Płatność została anulowana. Możesz spróbować ponownie.'
        : 'Nie otrzymaliśmy jeszcze potwierdzenia płatności. Jeśli zapłaciłeś, odśwież stronę za minutę - dostęp otworzy się sam.');
    }, function () {
      if (proba < 10) { setTimeout(function () { czekajNaPlatnosc(id, ext, proba + 1); }, 3000); return; }
      pokazBramke(id, 'Nie udało się połączyć z serwerem płatności. Odśwież stronę za chwilę.');
    });
  }
  function otworzOplacony(id, ext) {
    document.body.classList.add('tryb-oplacony');
    var pasek = document.createElement('div');
    pasek.className = 'pasek-przykladu pasek-oplacony';
    pasek.innerHTML = '<div class="pp-tekst"><strong>Dziękujemy - raport opłacony.</strong> Dostęp do raportu tej działki zostaje w tej przeglądarce. ' +
      'Numer zamówienia: <span class="mono">' + ext.slice(0, 8) + '</span></div>';
    var hero = document.querySelector('#report .rep-hero');
    if (hero) hero.parentNode.insertBefore(pasek, hero);
    otworzRaport();
  }
  function zablokuj(tekst) {
    document.body.classList.add('zablokowane');
    var b = $('bramka'); if (b) b.classList.remove('ukryta');
    ustawKomunikat(tekst, true);
  }
  function ustawKomunikat(tekst, czekanie) {
    var form = $('bramka-form'); if (!form) return;
    var k = form.querySelector('.bramka-platnosc');
    if (!k) { k = document.createElement('div'); k.className = 'bramka-platnosc'; form.insertBefore(k, form.querySelector('.eyebrow')); }
    k.textContent = tekst || '';
    k.style.display = tekst ? 'block' : 'none';
    form.classList.toggle('czeka', !!czekanie);
  }
  var bramkaPodlaczona = false;
  function pokazBramke(id, komunikat) {
    document.body.classList.add('zablokowane');
    var b = $('bramka'); if (b) b.classList.remove('ukryta');
    ustawKomunikat(komunikat, false);
    var form = $('bramka-form');
    if (!bramkaPodlaczona && window.GruntowoHaslo) {
      GruntowoHaslo.podlacz(form, { onOk: function () { setTimeout(otworzRaport, 400); } });
      bramkaPodlaczona = true;
    }
    // Zakup dla tej dzialki (gdy znamy identyfikator)
    if (id && window.GruntowoPlatnosc && form && !form.querySelector('.bramka-kup')) {
      var kup = document.createElement('div');
      kup.className = 'bramka-kup';
      kup.innerHTML = '<div class="bramka-albo"><span>albo</span></div>' +
        '<button type="button" class="btn btn-gold bramka-kup-btn" data-kup-raport data-id="' + window.GruntowoPlatnosc.esc(id) + '">Kup raport dla tej działki - 69 zł</button>' +
        '<div class="znaczek-payu">' + '<span>Płatność obsługuje</span>' + window.GruntowoPlatnosc.logoPayU() + '</div>' +
        '<p class="bramka-kup-info">Działka ' + window.GruntowoPlatnosc.esc(id) + ' · BLIK, karta, przelew</p>';
      var alt = form.querySelector('.bramka-alt');
      form.insertBefore(kup, alt);
    }
    var pole = document.querySelector('#bramka-form [data-haslo-pole]');
    if (pole) pole.focus();
  }

  // =====================================================================
  // 2. STAN + ZDARZENIA Z raport.js
  // =====================================================================
  var ANALIZY = ['mpzp', 'pog', 'powodz', 'przyroda', 'media', 'teren', 'uzytki', 'otoczenie', 'pozwolenia', 'ceny'];
  var stan = {};
  var geo = null;           // geometria dzialki (pierscienie lon/lat, 2180, punkty wewnetrzne)
  var przebieg = 0;         // licznik "przebiegu" - po kliknieciu "Nowa dzialka" stare wyniki sa ignorowane

  // Zapamietaj poczatkowa zawartosc dynamicznych kontenerow (do resetu przy nowej dzialce)
  var POCZATKOWE = {};
  ['plan-szczegoly', 'przyroda-wynik', 'powodz-wynik', 'media-wynik', 'teren-karty', 'teren-wizual', 'uzytki-wynik', 'droga-wynik', 'otoczenie-grid', 'pozwolenia-wynik', 'k-mpzp', 'k-pog', 'k-wz']
    .forEach(function (id) { var el = $(id); if (el) POCZATKOWE[id] = el.innerHTML; });

  document.addEventListener('gruntowo:dzialka', function (e) {
    przebieg++;
    stan = { dzialka: e.detail };
    Object.keys(POCZATKOWE).forEach(function (id) { $(id).innerHTML = POCZATKOWE[id]; });
    geo = przygotujGeometrie(e.detail.data.geom_wkt);
    przelicz();
    if (!geo) { ANALIZY.forEach(function (a) { if (!stan[a]) stan[a] = { blad: 'brak geometrii' }; }); przelicz(); return; }
    uruchomAnalizy(przebieg);
  });
  document.addEventListener('gruntowo:ceny', function (e) {
    // Werdykt ocenia rynek gruntow NIEZABUDOWANYCH (domyslny tryb) - przelaczanie w sekcji cen go nie zmienia
    if (e.detail && e.detail.rodzaj === 'niezabudowana') { stan.ceny = e.detail; przelicz(); }
    var wv = $('wycena-gora-val');
    if (wv && e.detail && !e.detail.liczba && !$('wycena-gora').classList.contains('gotowa')) {
      wv.textContent = 'brak danych';
      $('wycena-gora-sub').textContent = 'w okolicy nie ma wystarczającej liczby transakcji do wyceny';
    }
  });
  document.addEventListener('gruntowo:wymiary', function (e) { stan.wymiary = e.detail; przelicz(); });
  // Wartosc szacunkowa na samej gorze raportu (ta sama co w sekcji cen)
  document.addEventListener('gruntowo:wycena', function (e) {
    var d = e.detail || {}, v = $('wycena-gora-val'), sb = $('wycena-gora-sub');
    if (!v || !d.wartosc) return;
    v.textContent = Math.round(d.wartosc).toLocaleString('pl-PL') + ' zł';
    if (sb) sb.textContent = (d.opis || '') + ' · porównanie: ' + (d.rodzaj === 'zabudowana' ? 'działki zabudowane' : 'działki niezabudowane');
    $('wycena-gora').classList.add('gotowa');
  });

  var FUNKCJE = {};   // klucz -> funkcja analizy (uzupelniane w uruchomAnalizy, uzywane przez przycisk "Sprawdz ponownie")

  function uruchomAnalizy(nr) {
    FUNKCJE = { mpzp: analizaMPZP, pog: analizaPOG, uzytki: analizaUzytki, teren: analizaTeren, otoczenie: analizaOtoczenie,
      media: analizaMedia, powodz: analizaPowodz, przyroda: analizaPrzyroda, pozwolenia: analizaPozwolenia };
    // Lekkie zapytania od razu, ciezsze obrazy z opoznieniem (raport.js laduje wtedy swoje mapy)
    var start = { mpzp: 0, pog: 300, uzytki: 600, teren: 900, otoczenie: 1200, pozwolenia: 1800, media: 2500, powodz: 4000, przyroda: 5500 };
    Object.keys(start).forEach(function (k) { setTimeout(function () { wykonajAnalize(k, nr, 0); }, start[k]); });
    // Ceny przychodza z raport.js; jesli backend milczy - po 45 s uznajemy brak danych
    setTimeout(function () { if (nr === przebieg && !stan.ceny) { stan.ceny = { blad: 'brak odpowiedzi' }; przelicz(); } }, 45000);
  }

  // Wykonuje analize z ponowieniami:
  //  proba 0 -> blad -> po 6 s proba 1 -> blad -> komunikat z przyciskiem + automatycznie po 30 s proba 2
  function wykonajAnalize(klucz, nr, proba) {
    var fn = FUNKCJE[klucz];
    if (!fn || nr !== przebieg) return;
    limitCzasu(fn(), 60000).then(function (wynik) {
      if (nr !== przebieg) return;
      stan[klucz] = wynik || {}; rysujSekcje(klucz); przelicz();
    }, function (err) {
      if (nr !== przebieg) return;
      console.warn('Analiza ' + klucz + ' (próba ' + (proba + 1) + '):', err);
      if (err && err.niedostepne) { stan[klucz] = { niedostepne: true }; rysujSekcje(klucz); przelicz(); return; }
      if (proba === 0) { setTimeout(function () { wykonajAnalize(klucz, nr, 1); }, 6000); return; }
      stan[klucz] = { blad: (err && err.message) || String(err), klucz: klucz, ponawiane: proba < 2 };
      rysujSekcje(klucz); przelicz();
      if (proba < 2) setTimeout(function () { if (stan[klucz] && stan[klucz].blad) wykonajAnalize(klucz, nr, 2); }, 30000);
    });
  }
  function ponowRecznie(klucz) {
    if (!FUNKCJE[klucz]) return;
    stan[klucz] = null;   // "w toku"
    przelicz();
    document.querySelectorAll('[data-ponow="' + klucz + '"]').forEach(function (b) {
      var box = b.closest('.ocena'); if (box) box.outerHTML = '<span class="roz-lad">Sprawdzamy ponownie…</span>';
    });
    wykonajAnalize(klucz, przebieg, 2);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ponow]');
    if (b) { e.preventDefault(); ponowRecznie(b.getAttribute('data-ponow')); }
  });

  // =====================================================================
  // 3. NARZEDZIA: pobieranie, WMS, geometria, piksele
  // =====================================================================
  function limitCzasu(obietnica, ms) {
    return new Promise(function (ok, nie) {
      var t = setTimeout(function () { nie(new Error('przekroczony czas odpowiedzi')); }, ms);
      obietnica.then(function (w) { clearTimeout(t); ok(w); }, function (e) { clearTimeout(t); nie(e); });
    });
  }
  function pobierz(url, opcje, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var o = opcje || {};
    if (ctrl) o.signal = ctrl.signal;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 20000);
    return fetch(url, o).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    }, function (e) { clearTimeout(t); throw e; });
  }
  function pobierzTekst(url, ms) { return pobierz(url, null, ms).then(function (r) { return r.text(); }); }

  // GetFeatureInfo w EPSG:4326 (WMS 1.1.1: kolejnosc lon,lat) - maly kadr wokol punktu
  function wmsFI(baza, warstwy, lon, lat, format) {
    var d = 0.0004;
    return baza + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&SRS=EPSG:4326' +
      '&BBOX=' + [lon - d, lat - d, lon + d, lat + d].join(',') +
      '&WIDTH=101&HEIGHT=101&LAYERS=' + warstwy + '&QUERY_LAYERS=' + warstwy +
      '&STYLES=&FORMAT=image/png&INFO_FORMAT=' + encodeURIComponent(format) + '&FEATURE_COUNT=10&X=50&Y=50';
  }
  function tekstZHtml(html) {
    return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Geometria dzialki: pierscienie w lon/lat i w EPSG:2180 + punkty wewnatrz dzialki
  function przygotujGeometrie(wkt) {
    if (!wkt || !window.GruntowoMapy) return null;
    var pier = (wkt.match(/\(([^()]+)\)/g) || []).map(function (p) {
      return p.replace(/[()]/g, '').split(',').map(function (para) {
        var xy = para.trim().split(/\s+/).map(Number);
        return [xy[0], xy[1]];
      }).filter(function (xy) { return !isNaN(xy[0]) && !isNaN(xy[1]); });
    }).filter(function (r) { return r.length >= 3; });
    if (!pier.length) return null;
    var p2180 = pier.map(function (r) {
      return r.map(function (xy) { var p = GruntowoMapy.wgs84Do2180(xy[0], xy[1]); return [p.x, p.y]; });
    });
    var bb = [1e12, 1e12, -1e12, -1e12], bb2 = [1e12, 1e12, -1e12, -1e12];
    pier.forEach(function (r) { r.forEach(function (xy) { bb[0] = Math.min(bb[0], xy[0]); bb[1] = Math.min(bb[1], xy[1]); bb[2] = Math.max(bb[2], xy[0]); bb[3] = Math.max(bb[3], xy[1]); }); });
    p2180.forEach(function (r) { r.forEach(function (xy) { bb2[0] = Math.min(bb2[0], xy[0]); bb2[1] = Math.min(bb2[1], xy[1]); bb2[2] = Math.max(bb2[2], xy[0]); bb2[3] = Math.max(bb2[3], xy[1]); }); });

    // Siatka punktow wewnatrz dzialki (w lon/lat) - do zapytan punktowych
    var siatka = [];
    var N = 7;
    for (var i = 0; i < N; i++) for (var j = 0; j < N; j++) {
      var lon = bb[0] + (bb[2] - bb[0]) * (i + 0.5) / N, lat = bb[1] + (bb[3] - bb[1]) * (j + 0.5) / N;
      if (wPoligonie([lon, lat], pier)) siatka.push([lon, lat]);
    }
    var sr = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    // Punkt wewnetrzny: srodek bbox, a gdy wypada poza dzialka (np. ksztalt L) - najblizszy punkt siatki
    var wew = sr;
    if (!wPoligonie(sr, pier) && siatka.length) {
      wew = siatka.slice().sort(function (a, b) {
        return (Math.hypot(a[0] - sr[0], a[1] - sr[1])) - (Math.hypot(b[0] - sr[0], b[1] - sr[1]));
      })[0];
    }
    if (!siatka.length) siatka.push(wew);
    return { wkt: wkt, pier: pier, p2180: p2180, bbox: bb, bbox2180: bb2, srodek: wew, siatka: siatka };
  }

  function wPoligonie(pt, pierscienie) {
    var w = false;
    pierscienie.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
        if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) w = !w;
      }
    });
    return w;
  }

  // Pobiera obraz WMS przez fetch (CORS) - mozna go i pokazac, i przeanalizowac piksel po pikselu
  // Pobiera obraz WMS; przy bledzie ponawia (po 2 s i 5 s) - uslugi panstwowe bywaja chwilowo zawodne
  function pobierzObrazWMS(url, proba) {
    proba = proba || 0;
    return pobierzObrazWMSRaz(url).catch(function (e) {
      if (proba >= 2) throw e;
      return new Promise(function (ok) { setTimeout(ok, proba ? 5000 : 2000); })
        .then(function () { return pobierzObrazWMS(url + (url.indexOf('_r=') === -1 ? '&_r=' + Date.now() : ''), proba + 1); });
    });
  }
  function pobierzObrazWMSRaz(url) {
    return pobierz(url, null, 25000).then(function (r) {
      var typ = r.headers.get('content-type') || '';
      return r.blob().then(function (blob) {
        if (typ.indexOf('image') === -1) throw new Error('usługa zwróciła błąd zamiast obrazu');
        return (window.createImageBitmap ? createImageBitmap(blob) : Promise.reject(new Error('brak createImageBitmap')))
          .then(function (bmp) { return { blob: blob, bmp: bmp, url: URL.createObjectURL(blob) }; });
      });
    });
  }
  function pikseleObrazu(bmp) {
    var c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height).data;
  }
  // Maska dzialki (1 = wewnatrz) w pikselach obrazu; rzut(xy) -> [px, py]
  function maskaDzialki(W, H, pierscienie, rzut) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.beginPath();
    pierscienie.forEach(function (r) {
      r.forEach(function (xy, i) { var p = rzut(xy); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath();
    });
    ctx.fillStyle = '#000';
    ctx.fill('evenodd');
    var d = ctx.getImageData(0, 0, W, H).data;
    var maska = new Uint8Array(W * H), ile = 0;
    for (var i = 0; i < W * H; i++) { if (d[i * 4 + 3] > 127) { maska[i] = 1; ile++; } }
    return { maska: maska, ile: ile };
  }
  // Odleglosc punktu (px) od krawedzi wielokata (px)
  function odlOdKrawedzi(x, y, krawedzie) {
    var min = Infinity;
    for (var k = 0; k < krawedzie.length; k++) {
      var a = krawedzie[k];
      var dx = a[2] - a[0], dy = a[3] - a[1];
      var t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1);
      t = Math.max(0, Math.min(1, t));
      var ex = a[0] + t * dx - x, ey = a[1] + t * dy - y;
      var d = ex * ex + ey * ey;
      if (d < min) min = d;
    }
    return Math.sqrt(min);
  }

  // Wspolny kadr 4326 dla map ISOK / GDOS (podklad ortofoto + warstwa + obrys dzialki)
  function kadr4326(mnoznik) {
    var mb = GruntowoMapy.margines(geo.bbox, mnoznik);
    var wh = GruntowoMapy.wymiary(mb);
    return { bbox: mb, wh: wh, rzut: function (xy) { return [(xy[0] - mb[0]) / (mb[2] - mb[0]) * wh.W, (mb[3] - xy[1]) / (mb[3] - mb[1]) * wh.H]; },
      odrzut: function (px, py) { return [mb[0] + px / wh.W * (mb[2] - mb[0]), mb[3] - py / wh.H * (mb[3] - mb[1])]; } };
  }
  function ortoUrl(k) {
    return 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=' + k.wh.W + '&HEIGHT=' + k.wh.H + '&BBOX=' + k.bbox.join(',');
  }
  function getMap4326(baza, warstwy, k) {
    return baza + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true' +
      '&LAYERS=' + warstwy.join(',') + '&STYLES=' + warstwy.map(function () { return ''; }).join(',') +
      '&WIDTH=' + k.wh.W + '&HEIGHT=' + k.wh.H + '&BBOX=' + k.bbox.join(',');
  }
  // Pokrycie dzialki warstwa: % pikseli dzialki pod kolorem warstwy + przykladowy piksel pokryty
  function pokrycie(obraz, k) {
    var W = k.wh.W, H = k.wh.H;
    var px = pikseleObrazu(obraz.bmp);
    var mk = maskaDzialki(W, H, geo.pier, k.rzut);
    var wDzialce = 0, wKadrze = 0, przyklad = null, przykladKadr = null;
    for (var i = 0; i < W * H; i++) {
      if (px[i * 4 + 3] > 60) {
        wKadrze++;
        if (!przykladKadr) przykladKadr = [i % W, Math.floor(i / W)];
        if (mk.maska[i]) { wDzialce++; if (!przyklad) przyklad = [i % W, Math.floor(i / W)]; }
      }
    }
    return {
      procent: mk.ile ? Math.round(1000 * wDzialce / mk.ile) / 10 : 0,
      wKadrze: wKadrze > 30,
      punkt: przyklad ? k.odrzut(przyklad[0] + 0.5, przyklad[1] + 0.5) : null,
      punktKadr: przykladKadr ? k.odrzut(przykladKadr[0] + 0.5, przykladKadr[1] + 0.5) : null
    };
  }
  function pokazMape(idMapy, k, obrazUrl, krycie) {
    try {
      GruntowoMapy.setMapaOverlay(idMapy, ortoUrl(k), obrazUrl);
      var im = $(idMapy); if (im) im.style.opacity = krycie ? String(krycie) : '';
      GruntowoMapy.rysujObrys(idMapy, geo.wkt, k.bbox, k.wh);
    } catch (e) { console.warn('mapa ' + idMapy, e); }
  }

  // =====================================================================
  // 4. ANALIZY
  // =====================================================================

  // ---- 4.1 MPZP (Krajowa Integracja MPZP) ----
  // Czeka na wynik zapytania wykonanego przez raport.js (window.gruntowoRaport[klucz] / zdarzenie).
  // Gdy raport.js nie zdazy albo zglosi blad - zwraca null i analiza pyta usluge sama.
  function wynikRaportu(klucz, ms) {
    return new Promise(function (ok) {
      var gr = window.gruntowoRaport || {};
      if (gr[klucz]) { ok(gr[klucz]); return; }
      var t = setTimeout(function () { document.removeEventListener('gruntowo:' + klucz, h); ok(null); }, ms);
      var h = function (e) { clearTimeout(t); document.removeEventListener('gruntowo:' + klucz, h); ok(e.detail); };
      document.addEventListener('gruntowo:' + klucz, h);
    });
  }

  function analizaMPZP() {
    var s = geo.srodek;
    return wynikRaportu('mpzp', 45000).then(function (w) {
      // raport.js laczy odpowiedz opisowa i pokrycie mapy - jego werdykt jest nadrzedny
      if (w && w.status === 'jest') {
        var z = zbudujMPZP(w.html || '', w.pokrycie);
        // Rejestr Urbanistyczny: tytul planu i data, gdy usluga krajowa ich nie podala
        // MeSIP (np. Lubon): symbol, przeznaczenie i tekst ustalen terenu prosto z geoportalu gminy
        if (w.mesip && !z.symbol && w.mesip.tereny && w.mesip.tereny.length) {
          var t0 = w.mesip.tereny[0], pl = w.mesip.plan || {};
          z.symbol = t0.symbol; z.funkcja = t0.opis; z.uchwala = z.uchwala || pl.uchwala || t0.uchwala; z.data = z.data || pl.z_dnia;
          z.nazwa = z.nazwa || pl.nazwa; z.przeznaczenie = klasyfikujPrzeznaczenie(z.symbol, z.funkcja);
        }
        if (w.mesip) z.mesip = w.mesip;
        if (w.ru) { z.ru = w.ru; if (!z.nazwa) z.nazwa = w.ru.tytul.replace(/^W sprawie uchwalenia\s+/i, '').replace(/^(miejscowego\s+)?planu\s+zagospodarowania\s+przestrzennego\s+/i, ''); if (!z.stanPlanu && w.ru.od) z.stanPlanu = 'obowiązuje od ' + w.ru.od; }
        return z;
      }
      if (w && (w.status === 'brak' || w.status === 'nieznany')) return { status: w.status };
      // raport.js nie zdazyl / blad - pytamy sami (tylko dane opisowe)
      return pobierzTekst(wmsFI(URL_KIMPZP, 'plany_granice,wektor-str', s[0], s[1], 'text/html'), 20000).then(function (html) {
        var tekst = tekstZHtml(html);
        if (tekst.length < 5) return { status: 'nieznany' };
        var reszta = tekst.replace(/[^:]{0,80}:\s*brak wyniku dla wskazanego obszaru/gi, ' ').trim();
        if (reszta.length < 5) return { status: 'brak' };
        return zbudujMPZP(html, null);
      });
    });
  }
  function zbudujMPZP(html, pokrycie) {
    var pola = polaZOdpowiedzi(html);
    var wynik = { status: 'jest', pola: pola, pokrycie: pokrycie };
    wynik.symbol = pierwszePole(pola, /fun_symb|symbol|oznaczenie|^przeznaczenie_symbol/);
    wynik.funkcja = pierwszePole(pola, /fun_nazwa|przeznaczenie|funkcja|^opis/);
    wynik.nazwa = pierwszePole(pola, /^nazwa planu|^nazwa_plan|^nazwa$|tytul/).replace(/^w sprawie uchwalenia\s+/i, '').replace(/^(miejscowego\s+)?planu\s+zagospodarowania\s+przestrzennego\s+/i, '');
    wynik.uchwala = pierwszePole(pola, /^uchwa[łl]a$|numer_uchwaly|nr_uchwaly|uchwala_nr|^numer$/);
    wynik.data = pierwszePole(pola, /^data uchwa|^data|data_uchw/);
    wynik.stanPlanu = pierwszePole(pola, /^status/);
    var link = html.match(/https?:\/\/[^\s"'<>]+\.pdf/i) || html.match(/https?:\/\/[^\s"'<>]*(?:edziennik|dziennik)[^\s"'<>]*/i);
    wynik.link = link ? link[0] : '';
    wynik.przeznaczenie = klasyfikujPrzeznaczenie(wynik.symbol, wynik.funkcja);
    return wynik;
  }

  // Wyciaga pary pole->wartosc z tabel HTML (<th>k</th><td>v</td>) i z XML (<POLE>v</POLE>)
  function polaZOdpowiedzi(html) {
    var pola = {};
    var re = /<t[hd][^>]*>([^<]{1,60})<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>/gi, mm;
    while ((mm = re.exec(html))) {
      var k = mm[1].trim().toLowerCase(), v = mm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (k && v && v !== 'NULL' && !(k in pola)) pola[k] = v;
    }
    var rx = /<([A-Za-z_][\w\-]*)>([^<]+)<\/\1>/g;
    while ((mm = rx.exec(html))) {
      var k2 = mm[1].toLowerCase(), v2 = mm[2].trim();
      if (v2 && v2 !== 'null' && !(k2 in pola)) pola[k2] = v2;
    }
    return pola;
  }
  function pierwszePole(pola, wzor) {
    var k = Object.keys(pola).filter(function (x) { return wzor.test(x); })[0];
    return k ? pola[k] : '';
  }
  // Symbol MPZP (np. "5MN.3", "20.U", "MN/U") lub opis funkcji -> kategoria przeznaczenia
  function klasyfikujPrzeznaczenie(symbol, funkcja) {
    var sym = String(symbol || '').toUpperCase().replace(/^[\d\s.]+/, '').replace(/[\d.\s]+$/, '');
    var czesci = sym.split(/[\/,\-+]/).map(function (x) { return x.replace(/[\d.]/g, '').trim(); }).filter(Boolean);
    var f = String(funkcja || '').toLowerCase();
    var kat = {};
    czesci.forEach(function (c) {
      if (/^(MN|MW|ML|MR|MNI|MNE|MNJ|MNW|M)$/.test(c) || /^M[NW]/.test(c)) kat.mieszkaniowe = 1;
      else if (/^MU$|^UM$/.test(c)) { kat.mieszkaniowe = 1; kat.uslugowe = 1; }
      else if (/^RM$/.test(c)) kat.zagrodowe = 1;
      else if (/^U/.test(c)) kat.uslugowe = 1;
      else if (/^P/.test(c)) kat.produkcyjne = 1;
      else if (/^(ZL|L|LS)$/.test(c)) kat.lesne = 1;
      else if (/^R/.test(c)) kat.rolne = 1;
      else if (/^Z/.test(c)) kat.zielen = 1;
      else if (/^K/.test(c)) kat.komunikacja = 1;
      else if (/^W/.test(c)) kat.wody = 1;
      else if (/^(E|G|T|IT|I|O|C)/.test(c)) kat.infrastruktura = 1;
    });
    if (/mieszkan/.test(f)) kat.mieszkaniowe = 1;
    if (/us[łl]ug/.test(f)) kat.uslugowe = 1;
    if (/zagrodow/.test(f)) kat.zagrodowe = 1;
    if (/produkc|przemys|sk[łl]ad/.test(f)) kat.produkcyjne = 1;
    if (/le[śs]n/.test(f)) kat.lesne = 1;
    if (/roln/.test(f) && !kat.zagrodowe) kat.rolne = 1;
    if (/ziele[ńn]|park|ogrod/.test(f)) kat.zielen = 1;
    if (/komunikac|drog|ulic/.test(f)) kat.komunikacja = 1;
    if (/wód|wod[ya]? powierzch/.test(f)) kat.wody = 1;
    var klucze = Object.keys(kat);
    if (!klucze.length) return null;
    var etykiety = { mieszkaniowe: 'mieszkaniowe', uslugowe: 'usługowe', zagrodowe: 'zabudowa zagrodowa', produkcyjne: 'produkcyjno-usługowe',
      lesne: 'leśne', rolne: 'rolne', zielen: 'zieleń', komunikacja: 'komunikacja (drogi)', wody: 'wody', infrastruktura: 'infrastruktura techniczna' };
    var budowlane = kat.mieszkaniowe || kat.uslugowe;
    var niebudowlane = kat.lesne || kat.rolne || kat.zielen || kat.komunikacja || kat.wody;
    return {
      kategorie: klucze,
      etykieta: klucze.map(function (x) { return etykiety[x]; }).join(' + '),
      ocena: budowlane ? 'budowlane' : (kat.produkcyjne || kat.zagrodowe) ? 'czesciowo' : niebudowlane ? 'niebudowlane' : 'inne'
    };
  }

  // ---- 4.2 Plan ogolny gminy (POG) - usluga w EPSG:2180 ----
  function analizaPOG() {
    return wynikRaportu('pog', 45000).then(function (w) {
      if (!w || w.status === 'blad') throw new Error('usługa planów ogólnych nie odpowiedziała');
      if (w.status !== 'jest') return { status: 'brak' };
      var r = { status: 'jest', kod: w.kod, nazwa: w.kod ? STREFY_POG[w.kod] : '', ouz: !!w.ouz };
      // Rejestr Urbanistyczny podaje wskazniki strefy - przenosimy je do raportu
      ['oznaczenie', 'nazwaStrefy', 'profilPodst', 'profilDod', 'wysokosc', 'zabudowa', 'pbc', 'intensywnosc', 'ozs', 'plan', 'link'].forEach(function (k) { if (w[k]) r[k] = w[k]; });
      return r;
    });
  }

  // ---- 4.3 Powodz (ISOK) ----
  // UWAGA: domyslny styl warstwy NZ.Fluvial rysuje tylko KONTURY stref - do liczenia pokrycia
  // wysylamy wlasny styl (SLD_BODY) z pelnym wypelnieniem i osobnym kolorem dla kazdego scenariusza.
  var SCEN_POWODZ = [
    { p: '0.1', rgb: [0, 32, 128], opis: 'Q 10% (raz na 10 lat)', css: '#002080' },
    { p: '0.01', rgb: [32, 96, 224], opis: 'Q 1% (raz na 100 lat)', css: '#2060e0' },
    { p: '0.002', rgb: [128, 192, 255], opis: 'Q 0,2% (raz na 500 lat)', css: '#80c0ff' },
    { p: 'morska', rgb: [32, 160, 160], opis: 'powódź od strony morza', css: '#20a0a0' }
  ];
  function sldPowodz() {
    var regula = function (sc) {
      return '<Rule><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>loo_ql_probabilityofoccurrence</ogc:PropertyName><ogc:Literal>' + sc.p +
        '</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter><PolygonSymbolizer><Fill><CssParameter name="fill">' + sc.css +
        '</CssParameter></Fill></PolygonSymbolizer></Rule>';
    };
    // Kolejnosc: najpierw rzadsze (0,2%), na wierzchu czestsze (10%)
    return '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">' +
      '<NamedLayer><Name>NZ.Fluvial</Name><UserStyle>' +
      '<FeatureTypeStyle>' + regula(SCEN_POWODZ[2]) + '</FeatureTypeStyle>' +
      '<FeatureTypeStyle>' + regula(SCEN_POWODZ[1]) + '</FeatureTypeStyle>' +
      '<FeatureTypeStyle>' + regula(SCEN_POWODZ[0]) + '</FeatureTypeStyle>' +
      '</UserStyle></NamedLayer>' +
      '<NamedLayer><Name>NZ.SeaWater</Name><UserStyle><FeatureTypeStyle><Rule><PolygonSymbolizer><Fill><CssParameter name="fill">' + SCEN_POWODZ[3].css +
      '</CssParameter></Fill></PolygonSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>';
  }
  function analizaPowodz() {
    var k = kadr4326(0.8);
    var url = URL_ISOK + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true' +
      '&LAYERS=NZ.Fluvial,NZ.SeaWater&WIDTH=' + k.wh.W + '&HEIGHT=' + k.wh.H + '&BBOX=' + k.bbox.join(',') +
      '&SLD_BODY=' + encodeURIComponent(sldPowodz());
    return pobierzObrazWMS(url).then(function (obraz) {
      pokazMape('map-powodz', k, obraz.url, 0.6);
      var W = k.wh.W, H = k.wh.H;
      var px = pikseleObrazu(obraz.bmp);
      var mk = maskaDzialki(W, H, geo.pier, k.rzut);
      var licz = SCEN_POWODZ.map(function () { return 0; }), wKadrze = 0;
      for (var i = 0; i < W * H; i++) {
        if (px[i * 4 + 3] < 128) continue;
        wKadrze++;
        if (!mk.maska[i]) continue;
        var r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], best = -1, bd = 60 * 60;
        for (var s2 = 0; s2 < SCEN_POWODZ.length; s2++) {
          var c = SCEN_POWODZ[s2].rgb, dd = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]);
          if (dd < bd) { bd = dd; best = s2; }
        }
        if (best >= 0) licz[best]++;
      }
      var proc = function (n) { return mk.ile ? Math.round(1000 * n / mk.ile) / 10 : 0; };
      var scen = [];
      SCEN_POWODZ.forEach(function (sc, idx) { if (licz[idx] > 0) scen.push({ opis: sc.opis, procent: proc(licz[idx]), p: sc.p === 'morska' ? 0.01 : parseFloat(sc.p) }); });
      var razem = proc(licz.reduce(function (a, b) { return a + b; }, 0));
      var maxP = scen.reduce(function (a, x) { return Math.max(a, x.p); }, 0);
      var wynik = { procent: razem, zagrozona: razem > 0, wPoblizu: wKadrze > 30 && !razem, scenariusze: scen, maxP: maxP, metoda: 'mapa' };
      znakPowodz(wynik);
      return wynik;
    }).catch(function (e) {
      // Obraz nie przyszedl (po ponowieniach) - sprawdzamy punktowo kilka miejsc na dzialce
      console.warn('ISOK mapa:', e);
      return powodzPunktowo();
    });
  }
  function powodzPunktowo() {
    var punkty = [geo.srodek].concat(geo.siatka.filter(function (x, i) { return i % Math.max(1, Math.floor(geo.siatka.length / 6)) === 0; })).slice(0, 7);
    return Promise.all(punkty.map(function (pt) {
      return pobierz(wmsFI(URL_ISOK, WARSTWY_ISOK.join(','), pt[0], pt[1], 'application/json'), null, 15000)
        .then(function (r) { return r.json(); });
    })).then(function (listy) {
      var scen = {}, trafione = 0;
      listy.forEach(function (j) {
        var f = j.features || [];
        if (f.length) trafione++;
        f.forEach(function (x) { var pr = x.properties || {}; scen[pr.loo_qualitativelikelihood || 'obszar zagrożenia'] = parseFloat(pr.loo_ql_probabilityofoccurrence) || 0.01; });
      });
      var lista = Object.keys(scen).map(function (k) { return { opis: k, p: scen[k] }; });
      var wynik = { procent: trafione ? Math.round(100 * trafione / punkty.length) : 0, zagrozona: trafione > 0, wPoblizu: false,
        scenariusze: lista, maxP: lista.reduce(function (a, x) { return Math.max(a, x.p); }, 0), metoda: 'punkty' };
      znakPowodz(wynik);
      return wynik;
    });
  }
  function znakPowodz(w) {
    if (!w.zagrozona) GruntowoMapy.znakWodny('map-powodz', 'Brak zagrożenia powodziowego', w.wPoblizu ? 'strefa zalewowa w pobliżu - widoczna na mapie' : 'wg map zagrożenia powodziowego ISOK', 'ok');
    else GruntowoMapy.znakWodny('map-powodz', '');
  }

  // ---- 4.4 Ochrona przyrody (GDOS) ----
  function analizaPrzyroda() {
    var k = kadr4326(1.2);
    return pobierzObrazWMS(getMap4326(URL_GDOS, WARSTWY_GDOS, k)).then(function (obraz) {
      pokazMape('map-przyroda', k, obraz.url);
      var pk = pokrycie(obraz, k);
      var zapytania = [geo.srodek];
      if (pk.punkt) zapytania.push(pk.punkt);
      else if (pk.punktKadr) zapytania.push(pk.punktKadr);
      return Promise.all(zapytania.map(function (pt, idx) {
        return pobierz(wmsFI(URL_GDOS, WARSTWY_GDOS.join(','), pt[0], pt[1], 'application/json'), null, 15000)
          .then(function (r) { return r.json(); })
          .then(function (j) { return (j.features || []).map(function (f) { return { typ: String(f.id || '').split('.')[0], nazwa: (f.properties || {}).nazwa || '', wDzialce: idx === 0 || !!pk.punkt }; }); })
          .catch(function () { return []; });
      })).then(function (listy) {
        var formy = {};
        listy.forEach(function (l) { l.forEach(function (f) {
          var klucz = f.typ + '|' + f.nazwa;
          if (!formy[klucz]) formy[klucz] = f; else formy[klucz].wDzialce = formy[klucz].wDzialce || f.wDzialce;
        }); });
        var lista = Object.keys(formy).map(function (x) { return formy[x]; });
        var naDzialce = pk.procent > 0 || lista.some(function (f) { return f.wDzialce; });
        if (!pk.wKadrze && !lista.length) GruntowoMapy.znakWodny('map-przyroda', 'Brak form ochrony przyrody', 'w otoczeniu działki (GDOŚ)', 'ok');
        else if (!naDzialce) GruntowoMapy.znakWodny('map-przyroda', 'Działka poza formami ochrony', 'forma ochrony przyrody w sąsiedztwie', 'ok');
        else GruntowoMapy.znakWodny('map-przyroda', '');
        return { procent: pk.procent, wPoblizu: pk.wKadrze, formy: lista };
      });
    });
  }
  var NAZWY_FORM = {
    ParkiNarodowe: 'park narodowy', Rezerwaty: 'rezerwat przyrody', SpecjalneObszaryOchrony: 'Natura 2000 (siedliskowy SOO)',
    ObszarySpecjalnejOchrony: 'Natura 2000 (ptasi OSO)', ParkiKrajobrazowe: 'park krajobrazowy',
    ObszaryChronionegoKrajobrazu: 'obszar chronionego krajobrazu', UzytkiEkologiczne: 'użytek ekologiczny',
    ZespolyPrzyrodniczoKrajobrazowe: 'zespół przyrodniczo-krajobrazowy'
  };

  // ---- 4.5 Media (KIUT) - analiza pikseli w EPSG:2180 ----
  function analizaMedia() {
    var BUFOR = 80; // m wokol dzialki
    var b = geo.bbox2180;
    var x0 = b[0] - BUFOR, y0 = b[1] - BUFOR, x1 = b[2] + BUFOR, y1 = b[3] + BUFOR;
    // UWAGA: KIUT rysuje przewody tylko przy duzym przyblizeniu (sprawdzone: 0,35 m/px - sieci sa,
    // 0,43 m/px - pusto). Dlatego trzymamy 0,3 m/px i dla wiekszych dzialek skladamy obraz z kafelkow.
    var mpp = 0.3;
    var W = Math.max(50, Math.round((x1 - x0) / mpp)), H = Math.max(50, Math.round((y1 - y0) / mpp));
    if (W * H > 16e6) { var sk = Math.sqrt(W * H / 16e6); mpp *= sk; W = Math.round(W / sk); H = Math.round(H / sk); }
    var warstwy = ['przewod_elektroenergetyczny', 'przewod_gazowy', 'przewod_wodociagowy', 'przewod_kanalizacyjny', 'przewod_cieplowniczy', 'przewod_telekomunikacyjny'];
    var rzut = function (xy) { return [(xy[0] - x0) / mpp, (y1 - xy[1]) / mpp]; };
    var KAF = 1200, kafelki = [];
    for (var ky = 0; ky < H; ky += KAF) for (var kx = 0; kx < W; kx += KAF) {
      var kw = Math.min(KAF, W - kx), kh = Math.min(KAF, H - ky);
      var bx0 = x0 + kx * mpp, bx1 = x0 + (kx + kw) * mpp, by1 = y1 - ky * mpp, by0 = y1 - (ky + kh) * mpp;
      kafelki.push({ x: kx, y: ky, w: kw, h: kh, url: URL_KIUT + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=true' +
        '&LAYERS=' + warstwy.join(',') + '&STYLES=,,,,,&WIDTH=' + kw + '&HEIGHT=' + kh +
        '&BBOX=' + [bx0, by0, bx1, by1].map(function (v) { return v.toFixed(2); }).join(',') });
    }
    var plotno = document.createElement('canvas'); plotno.width = W; plotno.height = H;
    var pctx = plotno.getContext('2d');
    // kafelki po kolei (max 2 naraz), zeby nie zasypac serwera
    var kolejka = kafelki.slice(), wTrakcie = [];
    var nastepny = function () {
      var kf = kolejka.shift(); if (!kf) return Promise.resolve();
      return obrazKIUT(kf.url).then(function (o) { pctx.drawImage(o.bmp, kf.x, kf.y); }).then(nastepny);
    };
    wTrakcie.push(nastepny()); wTrakcie.push(nastepny());
    return Promise.all(wTrakcie).then(function () {
      var px = pctx.getImageData(0, 0, W, H).data;
      var mk = maskaDzialki(W, H, geo.p2180, rzut);
      var krawedzie = [];
      geo.p2180.forEach(function (r) {
        for (var i = 0; i < r.length - 1; i++) { var a = rzut(r[i]), c = rzut(r[i + 1]); krawedzie.push([a[0], a[1], c[0], c[1]]); }
      });
      var wyn = {};
      SIECI.forEach(function (s) { wyn[s.klucz] = { wewnatrz: 0, minOdl: Infinity }; });
      var wszystkie = 0;
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var i = (y * W + x) * 4;
          if (px[i + 3] < 128) continue;
          var r = px[i], g = px[i + 1], bl = px[i + 2];
          if (r > 200 && g > 200 && bl > 200) continue;               // biale opisy
          var best = null, bestD = 75 * 75;
          for (var s = 0; s < SIECI.length; s++) {
            var c = SIECI[s].rgb, dd = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (bl - c[2]) * (bl - c[2]);
            if (dd < bestD) { bestD = dd; best = SIECI[s].klucz; }
          }
          if (!best) continue;
          wszystkie++;
          if (mk.maska[y * W + x]) { wyn[best].wewnatrz++; wyn[best].minOdl = 0; }
          else if (wyn[best].minOdl > 0 && ((x + y) % 2 === 0)) {     // co drugi piksel wystarczy
            var dm = odlOdKrawedzi(x + 0.5, y + 0.5, krawedzie) * mpp;
            if (dm < wyn[best].minOdl) wyn[best].minOdl = dm;
          }
        }
      }
      // Pojedyncze piksele w dzialce to zwykle szum/wygladzanie - wymagamy kilku
      var progPrzez = Math.max(4, Math.round(2 / mpp));
      SIECI.forEach(function (s) {
        var w = wyn[s.klucz];
        w.przez = w.wewnatrz >= progPrzez;
        if (!w.przez && w.minOdl === 0) w.minOdl = 0.5;
        if (w.minOdl === Infinity) w.minOdl = null;
      });
      return { sieci: wyn, brakDanych: wszystkie < 5, bufor: BUFOR };
    });
  }

  // Obraz KIUT: najpierw bezposrednio (1 proba), potem przez posrednika na LH (z ponowieniami).
  // Gdy oba zawioda - blad "niedostepne" (bez ponawiania: to ograniczenie serwera powiatu, nie chwilowa awaria).
  function obrazKIUT(url) {
    return pobierzObrazWMSRaz(url).catch(function () {
      if (!URL_KIUT_PROXY) throw bladNiedostepne();
      return pobierzObrazWMS(URL_KIUT_PROXY + '?' + url.split('?')[1]).catch(function () { throw bladNiedostepne(); });
    });
  }
  function bladNiedostepne() { var e = new Error('serwer powiatu nie pozwala na analizę'); e.niedostepne = true; return e; }

  // ---- 4.6 Teren (NMT) - wysokosci w siatce punktow + spadek z plaszczyzny ----
  // Wysokosci z NMT GUGiK w siatce punktow (dzialka + margines) - do statystyk, mapy wysokosci i przekroju
  function analizaTeren() {
    var bb = geo.bbox2180;                       // [N min, E min, N max, E max]
    var dN = bb[2] - bb[0], dE = bb[3] - bb[1];
    var bok = Math.max(dN, dE, 20) * 1.3;        // kwadrat z marginesem ~15% z kazdej strony
    var cN = (bb[0] + bb[2]) / 2, cE = (bb[1] + bb[3]) / 2;
    var K = 15, krok = bok / (K - 1);
    var siatka = [];
    for (var r = 0; r < K; r++) for (var c = 0; c < K; c++) {
      var n = cN + bok / 2 - r * krok, e = cE - bok / 2 + c * krok;
      siatka.push({ r: r, c: c, n: n, e: e, w: wPoligonie([n, e], geo.p2180) });
    }
    var porcje = [];
    for (var i = 0; i < siatka.length; i += 75) porcje.push(siatka.slice(i, i + 75));
    // NMT GUGiK: lista "x y" gdzie x = easting, y = northing; odpowiedz "n e h"
    return Promise.all(porcje.map(function (por) {
      var lista = por.map(function (p) { return p.e.toFixed(1) + ' ' + p.n.toFixed(1); }).join(',');
      return pobierzTekst(URL_NMT + '?request=GetHByPointList&list=' + encodeURIComponent(lista), 25000).then(function (t) {
        var v = t.trim().split(',');
        por.forEach(function (p, k) {
          var x = (v[k] || '').trim().split(/\s+/).map(Number);
          p.h = x.length >= 3 && !isNaN(x[2]) && x[2] > -100 ? x[2] : null;
        });
      });
    })).then(function () {
      var wew = siatka.filter(function (p) { return p.w && p.h !== null; });
      if (wew.length < 3) wew = siatka.filter(function (p) { return p.h !== null; });
      if (!wew.length) throw new Error('brak wysokości');
      var hs = wew.map(function (p) { return p.h; });
      var min = Math.min.apply(null, hs), max = Math.max.apply(null, hs);
      var sr = hs.reduce(function (a, b) { return a + b; }, 0) / hs.length;
      var pl = wew.length >= 3 ? plaszczyzna(wew) : null;
      return { min: min, max: max, sr: sr, roznica: max - min, spadek: pl ? pl.proc : null, kierunek: pl,
        punktow: wew.length, siatka: siatka, K: K, krok: krok, cN: cN, cE: cE, bok: bok };
    });
  }
  // Plaszczyzna h = a*e + b*n + c dopasowana do punktow; spadek w % i kierunek spadku (w dol)
  function plaszczyzna(p) {
    var n = p.length, me = 0, mn = 0, mh = 0;
    p.forEach(function (q) { me += q.e; mn += q.n; mh += q.h; });
    me /= n; mn /= n; mh /= n;
    var see = 0, snn = 0, sen = 0, seh = 0, snh = 0;
    p.forEach(function (q) { var e = q.e - me, nn = q.n - mn, h = q.h - mh; see += e * e; snn += nn * nn; sen += e * nn; seh += e * h; snh += nn * h; });
    var det = see * snn - sen * sen;
    if (Math.abs(det) < 1e-6) return null;
    var a = (seh * snn - snh * sen) / det, b = (snh * see - seh * sen) / det;
    var g = Math.sqrt(a * a + b * b);
    return { proc: Math.round(g * 1000) / 10, dE: g ? -a / g : 0, dN: g ? -b / g : 0 };
  }
  function spadekPlaszczyzny(p) {
    var n = p.length, me = 0, mn = 0, mh = 0;
    p.forEach(function (q) { me += q.e; mn += q.n; mh += q.h; });
    me /= n; mn /= n; mh /= n;
    var see = 0, snn = 0, sen = 0, seh = 0, snh = 0;
    p.forEach(function (q) {
      var e = q.e - me, nn = q.n - mn, h = q.h - mh;
      see += e * e; snn += nn * nn; sen += e * nn; seh += e * h; snh += nn * h;
    });
    var det = see * snn - sen * sen;
    if (Math.abs(det) < 1e-6) return null;
    var a = (seh * snn - snh * sen) / det, b = (snh * see - seh * sen) / det;
    return Math.round(Math.sqrt(a * a + b * b) * 1000) / 10;
  }

  // ---- 4.7 Uzytki gruntowe (KIEG) ----
  // ===== Grafika terenu: mapa wysokosci z warstwicami + przekroj wzdluz spadku =====
  function kolorH(t) {   // t 0..1: nisko (zielen) -> srodek (piasek) -> wysoko (braz)
    var st = [[0, [74, 128, 96]], [0.5, [200, 182, 120]], [1, [150, 92, 56]]];
    for (var i = 1; i < st.length; i++) if (t <= st[i][0]) {
      var a = st[i - 1], b = st[i], u = (t - a[0]) / (b[0] - a[0]);
      return 'rgb(' + [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * u); }).join(',') + ')';
    }
    return 'rgb(150,92,56)';
  }
  function liczbaPL(x, m) { return x.toFixed(m === undefined ? 1 : m).replace('.', ','); }
  function rysujTeren(w) {
    var K = w.K, S = w.siatka, H = function (r, c) { var p = S[r * K + c]; return p ? p.h : null; };
    var wszystkie = S.filter(function (p) { return p.h !== null; }).map(function (p) { return p.h; });
    if (wszystkie.length < 4) return '';
    // Skala kolorow i warstwic wg DZIALKI (otoczenie bywa duzo wyzsze/nizsze - np. skarpa obok - i "splaszcza" dzialke)
    var naDz = S.filter(function (p) { return p.w && p.h !== null; }).map(function (p) { return p.h; });
    if (naDz.length < 3) naDz = wszystkie;
    var dMin = Math.min.apply(null, naDz), dMax = Math.max.apply(null, naDz);
    var pad = Math.max(0.4, (dMax - dMin) * 0.25);
    var hMin = dMin - pad, hMax = dMax + pad, zakres = Math.max(hMax - hMin, 0.01);
    var oMin = Math.min.apply(null, wszystkie), oMax = Math.max.apply(null, wszystkie);
    var tH = function (h) { return Math.max(0, Math.min(1, (h - hMin) / zakres)); };
    var W = 340, sk = W / w.bok, pol = w.bok / 2;
    var X = function (e) { return (e - (w.cE - pol)) * sk; }, Y = function (n) { return ((w.cN + pol) - n) * sk; };
    // kolory: siatka zageszczona 3x (interpolacja dwuliniowa) - gladkie przejscia zamiast kratki
    var kom = '', G = 3, kr = w.krok * sk / G;
    for (var gr = 0; gr < (K - 1) * G; gr++) for (var gc = 0; gc < (K - 1) * G; gc++) {
      var r0 = Math.floor(gr / G), c0i = Math.floor(gc / G), fu = (gc % G + 0.5) / G, fv = (gr % G + 0.5) / G;
      var q = [H(r0, c0i), H(r0, c0i + 1), H(r0 + 1, c0i), H(r0 + 1, c0i + 1)];
      if (q.some(function (x) { return x === null; })) continue;
      var hv = q[0] * (1 - fu) * (1 - fv) + q[1] * fu * (1 - fv) + q[2] * (1 - fu) * fv + q[3] * fu * fv;
      var p0 = S[r0 * K + c0i];
      kom += '<rect x="' + (X(p0.e) + (gc % G) * kr).toFixed(1) + '" y="' + (Y(p0.n) + (gr % G) * kr).toFixed(1) + '" width="' + (kr + 0.5).toFixed(1) + '" height="' + (kr + 0.5).toFixed(1) + '" fill="' + kolorH(tH(hv)) + '"/>';
    }
    // warstwice (marching squares) co "co" metrow
    var kroki = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10], co = kroki[kroki.length - 1];
    for (var i = 0; i < kroki.length; i++) if (zakres / kroki[i] <= 8) { co = kroki[i]; break; }
    var linie = '';
    for (var lv = Math.ceil(hMin / co) * co; lv < hMax; lv += co) {
      var d = '';
      for (var r = 0; r < K - 1; r++) for (var c = 0; c < K - 1; c++) {
        var v = [H(r, c), H(r, c + 1), H(r + 1, c + 1), H(r + 1, c)];
        if (v.some(function (x) { return x === null; })) continue;
        var pts = [S[r * K + c], S[r * K + c + 1], S[(r + 1) * K + c + 1], S[(r + 1) * K + c]];
        var cut = [];
        for (var k = 0; k < 4; k++) {
          var a = v[k], b = v[(k + 1) % 4];
          if ((a < lv) !== (b < lv)) {
            var u = (lv - a) / (b - a), pa = pts[k], pb = pts[(k + 1) % 4];
            cut.push([X(pa.e + (pb.e - pa.e) * u), Y(pa.n + (pb.n - pa.n) * u)]);
          }
        }
        if (cut.length >= 2) d += 'M' + cut[0][0].toFixed(1) + ',' + cut[0][1].toFixed(1) + 'L' + cut[1][0].toFixed(1) + ',' + cut[1][1].toFixed(1);
        if (cut.length === 4) d += 'M' + cut[2][0].toFixed(1) + ',' + cut[2][1].toFixed(1) + 'L' + cut[3][0].toFixed(1) + ',' + cut[3][1].toFixed(1);
      }
      if (d) linie += '<path class="tr-warstwica' + (Math.abs(lv / (co * 5) - Math.round(lv / (co * 5))) < 1e-6 ? ' tr-gruba' : '') + '" d="' + d + '"/>';
    }
    // obrys dzialki
    var obrys = geo.p2180.map(function (r) { return 'M' + r.map(function (p) { return X(p[1]).toFixed(1) + ',' + Y(p[0]).toFixed(1); }).join('L') + 'Z'; }).join('');
    // strzalka spadku od srodka dzialki
    var strz = '', kier = w.kierunek, sN = 0, sE = 0, n0 = 0;
    S.forEach(function (p) { if (p.w) { sN += p.n; sE += p.e; n0++; } });
    var c0 = n0 ? [sE / n0, sN / n0] : [w.cE, w.cN];
    if (kier && w.spadek >= 0.5) {
      var dl = Math.min(w.bok * 0.28, 60 / sk), x1 = X(c0[0] - kier.dE * dl / 2), y1 = Y(c0[1] - kier.dN * dl / 2), x2 = X(c0[0] + kier.dE * dl / 2), y2 = Y(c0[1] + kier.dN * dl / 2);
      strz = '<line class="tr-strz-tlo" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>' +
        '<line class="tr-strz" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" marker-end="url(#tr-grot)"/>' +
        '<text class="tr-etyk" x="' + (x1 - kier.dE * 14).toFixed(1) + '" y="' + (y1 + kier.dN * 14 + 4).toFixed(1) + '" text-anchor="middle">' + liczbaPL(w.spadek) + '%</text>';
    }
    // podzialka
    var pd = [5, 10, 20, 25, 50, 100, 200].filter(function (m) { return m * sk <= W * 0.3; }).pop() || 5;
    var mapa = '<svg class="tr-mapa" viewBox="0 0 ' + W + ' ' + W + '" role="img" aria-label="Mapa wysokości terenu działki">' +
      '<defs><clipPath id="tr-clip"><path d="' + obrys + '"/></clipPath><marker id="tr-grot" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#fff"/></marker></defs>' +
      '<g class="tr-poza">' + kom + '</g><g clip-path="url(#tr-clip)">' + kom + '</g>' + linie +
      '<path class="tr-obrys" d="' + obrys + '"/>' + strz +
      '<g class="tr-pn"><text x="' + (W - 14) + '" y="18">N</text><path d="M' + (W - 14) + ',22l-4,10h8z"/></g>' +
      '<g class="tr-podz"><rect x="10" y="' + (W - 16) + '" width="' + (pd * sk).toFixed(1) + '" height="4"/><text x="10" y="' + (W - 20) + '">' + pd + ' m</text></g></svg>';
    var otoczenie = (oMax - dMax > 2 || dMin - oMin > 2) ? ' · w otoczeniu (poza działką) teren od ' + liczbaPL(oMin) + ' do ' + liczbaPL(oMax) + ' m - kolory poza działką są przycięte do skali' : '';
    var legenda = '<div class="tr-legenda"><span>' + liczbaPL(hMin) + ' m</span><i style="background:linear-gradient(90deg,' + kolorH(0) + ',' + kolorH(0.5) + ',' + kolorH(1) + ')"></i><span>' + liczbaPL(hMax) + ' m n.p.m.</span></div>' +
      '<p class="mapbox-cap">Warstwice co ' + liczbaPL(co, co < 1 ? 2 : 0).replace(/,?0+$/, '') + ' m' + (kier && w.spadek >= 0.5 ? ' · strzałka: kierunek spadku terenu' : ' · teren praktycznie płaski') + ' · działka w białym obrysie' + otoczenie + '</p>';
    return '<div class="teren-uklad"><figure class="teren-fig">' + mapa + legenda + '</figure>' + przekroj(w, c0) + '</div>';
  }
  // Przekroj terenu przez srodek dzialki wzdluz kierunku spadku (albo dluzszego boku, gdy plasko)
  function przekroj(w, c0) {
    var K = w.K, S = w.siatka, kier = w.kierunek;
    var dE = kier && w.spadek >= 0.5 ? kier.dE : 1, dN = kier && w.spadek >= 0.5 ? kier.dN : 0;
    var hW = function (e, n) {   // interpolacja dwuliniowa z siatki
      var c = (e - (w.cE - w.bok / 2)) / w.krok, r = ((w.cN + w.bok / 2) - n) / w.krok;
      var c1 = Math.floor(c), r1 = Math.floor(r);
      if (c1 < 0 || r1 < 0 || c1 >= K - 1 || r1 >= K - 1) return null;
      var g = function (rr, cc) { var p = S[rr * K + cc]; return p ? p.h : null; };
      var a = g(r1, c1), b = g(r1, c1 + 1), cc2 = g(r1 + 1, c1), d = g(r1 + 1, c1 + 1);
      if ([a, b, cc2, d].some(function (x) { return x === null; })) return null;
      var u = c - c1, v = r - r1;
      return a * (1 - u) * (1 - v) + b * u * (1 - v) + cc2 * (1 - u) * v + d * u * v;
    };
    var L = w.bok * 0.48, N = 60, pr = [];
    for (var i = 0; i <= N; i++) {
      var t = -L + 2 * L * i / N, e = c0[0] + dE * t, n = c0[1] + dN * t, h = hW(e, n);
      if (h !== null) pr.push({ t: t + L, h: h, w: wPoligonie([n, e], geo.p2180) });
    }
    if (pr.length < 5) return '';
    // przekroj: dzialka + ok. 30% jej dlugosci z kazdej strony (bez dalekiego otoczenia, ktore zaburza skale)
    var iw = pr.map(function (p, i) { return p.w ? i : -1; }).filter(function (i) { return i >= 0; });
    if (iw.length >= 2) {
      var dl0 = pr[iw[iw.length - 1]].t - pr[iw[0]].t, zap = Math.max(dl0 * 0.3, 8);
      var tA = pr[iw[0]].t - zap, tB = pr[iw[iw.length - 1]].t + zap;
      pr = pr.filter(function (p) { return p.t >= tA && p.t <= tB; });
    }
    if (pr.length < 5) return '';
    var t0 = pr[0].t, tMax = pr[pr.length - 1].t - t0;
    var hs = pr.map(function (p) { return p.h; }), lo = Math.min.apply(null, hs), hi = Math.max.apply(null, hs);
    var pad2 = Math.max((hi - lo) * 0.25, 0.5); lo -= pad2; hi += pad2;
    var W = 340, Hh = 200, ml = 44, mr = 10, mt = 14, mb = 30, pw = W - ml - mr, ph = Hh - mt - mb;
    var X = function (t) { return ml + (t - t0) / tMax * pw; }, Y = function (h) { return mt + (hi - h) / (hi - lo) * ph; };
    var linia = pr.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.h).toFixed(1); }).join('');
    var pole = linia + 'L' + X(pr[pr.length - 1].t).toFixed(1) + ',' + (mt + ph) + 'L' + X(pr[0].t).toFixed(1) + ',' + (mt + ph) + 'Z';
    var wd = pr.filter(function (p) { return p.w; }), dz = '';
    if (wd.length > 1) dz = '<rect class="tr-p-dz" x="' + X(wd[0].t).toFixed(1) + '" y="' + mt + '" width="' + (X(wd[wd.length - 1].t) - X(wd[0].t)).toFixed(1) + '" height="' + ph + '"/>' +
      '<text class="tr-p-opis" x="' + ((X(wd[0].t) + X(wd[wd.length - 1].t)) / 2).toFixed(1) + '" y="' + (mt + 11) + '">działka</text>';
    var osY = '', st = (hi - lo) / 4;
    for (var k = 0; k <= 4; k++) { var hv = lo + st * k; osY += '<line class="tr-p-siatka" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(hv).toFixed(1) + '" y2="' + Y(hv).toFixed(1) + '"/><text class="tr-p-os" x="' + (ml - 5) + '" y="' + (Y(hv) + 3).toFixed(1) + '" text-anchor="end">' + liczbaPL(hv) + '</text>'; }
    var osX = '';
    [0, 0.5, 1].forEach(function (f) { osX += '<text class="tr-p-os" x="' + (ml + f * pw).toFixed(1) + '" y="' + (Hh - 12) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '">' + Math.round(f * tMax) + ' m</text>'; });
    var svg = '<svg class="tr-profil" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Przekrój terenu">' + osY + dz +
      '<path class="tr-p-pole" d="' + pole + '"/><path class="tr-p-linia" d="' + linia + '"/>' + osX +
      '<text class="tr-p-os" x="' + (W - mr) + '" y="' + (Hh - 1) + '" text-anchor="end">odległość wzdłuż przekroju</text></svg>';
    var wysP = wd.length > 1 ? Math.abs(wd[0].h - wd[wd.length - 1].h) : null;
    return '<figure class="teren-fig">' + svg + '<p class="mapbox-cap">Przekrój przez środek działki ' + (kier && w.spadek >= 0.5 ? 'wzdłuż kierunku spadku' : 'z zachodu na wschód') +
      (wysP !== null ? ' · różnica wysokości na działce wzdłuż przekroju: ' + liczbaPL(wysP) + ' m' : '') + ' · skala pionowa przewyższona</p></figure>';
  }

  function analizaUzytki() {
    var punkty = [geo.srodek];
    if (geo.siatka.length > 2) { punkty.push(geo.siatka[0]); punkty.push(geo.siatka[geo.siatka.length - 1]); }
    return Promise.all(punkty.map(function (pt) {
      return pobierzTekst(wmsFI(URL_KIEG, 'uzytki,kontury', pt[0], pt[1], 'text/html'), 15000).catch(function () { return ''; });
    })).then(function (odp) {
      var kody = {}, grupa = '', pole = '';
      odp.forEach(function (html) {
        var t = tekstZHtml(html);
        var g = t.match(/Grupa rejestrowa\s+(\d+)/i); if (g && !grupa) grupa = g[1];
        var p = t.match(/Pole pow\. w ewidencji grunt[oó]w \(ha\)\s+([\d.,]+)/i); if (p && !pole) pole = p[1];
        var fr = t.match(/Oznaczenie u[żz]ytku([\s\S]*?)(?:Data publikacji|Informacje o pochodzeniu|$)/i);
        if (fr) {
          fr[1].replace(/Oznaczenie konturu/gi, ' ').split(/[\s,;]+/).forEach(function (x) {
            x = x.trim();
            if (/^[A-Za-zŁłŚśŻż\-]{1,6}(?:I{1,3}|IV|V|VI)?[ab]?$/.test(x) && x.length <= 8) kody[x] = 1;
          });
        }
      });
      var lista = Object.keys(kody);
      if (!lista.length) throw new Error('brak danych o użytkach (powiat poza usługa lub brak warstwy użytków)');
      return { kody: lista, grupa: grupa, pole: pole, opis: lista.map(opisUzytku) };
    });
  }
  function opisUzytku(kod) {
    var baza = kod.replace(/(?:I{1,3}|IV|V|VI)[ab]?$/, '');
    var klasa = kod.slice(baza.length);
    var slownik = { B: 'tereny mieszkaniowe', Bp: 'zurbanizowane tereny niezabudowane', Ba: 'tereny przemysłowe', Bi: 'inne tereny zabudowane',
      Bz: 'tereny rekreacyjno-wypoczynkowe', dr: 'drogi', Tk: 'tereny kolejowe', Ti: 'inne tereny komunikacyjne', Tp: 'grunty pod drogami publicznymi (przeznaczone)',
      R: 'grunty orne', Ł: 'łąki trwałe', Ps: 'pastwiska trwałe', S: 'sady', Br: 'grunty rolne zabudowane', Wsr: 'grunty pod stawami', W: 'grunty pod rowami',
      Lzr: 'grunty zadrzewione i zakrzewione na użytkach rolnych', Ls: 'lasy', Lz: 'grunty zadrzewione i zakrzewione', N: 'nieużytki',
      Wp: 'grunty pod wodami płynącymi', Ws: 'grunty pod wodami stojącymi', K: 'użytki kopalne', Tr: 'tereny różne' };
    var kat = 'inne';
    if (/^(B|Bp|Ba|Bi|Bz)$/.test(baza)) kat = 'budowlane';
    else if (/^(R|Ł|Ps|S|Br|Wsr|W|Lzr)$/.test(baza) || /^(S|Br|W|Lz)-R$/.test(baza)) kat = 'rolne';
    else if (/^(Ls|Lz)$/.test(baza)) kat = 'lesne';
    else if (/^(dr|Tk|Ti|Tp)$/.test(baza)) kat = 'drogi';
    else if (/^(Wp|Ws)$/.test(baza)) kat = 'wody';
    var wysokaKlasa = kat === 'rolne' && /^(I|II|III|IIIa|IIIb)$/.test(klasa);
    return { kod: kod, nazwa: (slownik[baza] || 'użytek ' + baza) + (klasa ? ', klasa ' + klasa : ''), kat: kat, klasa: klasa, wysokaKlasa: wysokaKlasa };
  }

  // ---- 4.8 Otoczenie (OpenStreetMap / Overpass) ----
  // Czy dzialka graniczy z dzialka drogowa (uzytek "dr" w ewidencji)? Pytamy EGiB w punktach
  // 4 m NA ZEWNATRZ srodka kazdego boku dzialki.
  function drogiEGiB() {
    var r = geo.pier[0], n = r.length;
    var cosL = Math.cos(geo.srodek[1] * Math.PI / 180), mx = 111320 * cosL, my = 110574;
    var wewnatrz = function (lon, lat) {
      var jest = false;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) jest = !jest;
      }
      return jest;
    };
    var boki = [];
    for (var i = 0; i < n - 1; i++) {
      var a = r[i], b = r[i + 1];
      var dx = (b[0] - a[0]) * mx, dy = (b[1] - a[1]) * my, dl = Math.hypot(dx, dy);
      if (dl < 3) continue;
      var sx = (a[0] + b[0]) / 2, sy = (a[1] + b[1]) / 2;
      var nx = -dy / dl, ny = dx / dl;               // prostopadla (jednostkowa, w metrach)
      var p1 = [sx + nx * 4 / mx, sy + ny * 4 / my], p2 = [sx - nx * 4 / mx, sy - ny * 4 / my];
      boki.push({ pt: wewnatrz(p1[0], p1[1]) ? p2 : p1, dl: dl });
    }
    boki.sort(function (x, y) { return y.dl - x.dl; });
    boki = boki.slice(0, 10);
    if (!boki.length) return Promise.resolve({ sprawdzone: 0, drogowe: [] });
    return Promise.all(boki.map(function (b) {
      return pobierzTekst(wmsFI(URL_KIEG, 'uzytki,kontury,dzialki', b.pt[0], b.pt[1], 'text/html'), 15000).catch(function () { return null; });
    })).then(function (odp) {
      var drogowe = {}, ok = 0;
      odp.forEach(function (html) {
        if (html === null) return;
        var t = tekstZHtml(html);
        if (t.length < 10) return;
        ok++;
        var u = t.match(/Oznaczenie u[żz]ytku([\s\S]*?)(?:Data publikacji|Informacje o pochodzeniu|$)/i);
        if (u && /(^|[\s,;])dr([\s,;]|$)/.test(u[1])) {
          var id = t.match(/Identyfikator dzia[łl]ki\s+([0-9_.A-Za-z\/\-]+)/i);
          drogowe[id ? id[1] : 'dr' + ok] = 1;
        }
      });
      if (!ok) throw new Error('EGiB nie odpowiedziała');
      return { sprawdzone: ok, drogowe: Object.keys(drogowe) };
    });
  }

  function analizaOtoczenie() {
    var egib = drogiEGiB().catch(function () { return null; });
    return osmOtoczenie().then(function (w) { return egib.then(function (e) { w.egib = e; return w; }); });
  }

  function osmOtoczenie() {
    var r = geo.pier[0];
    var krok = Math.max(1, Math.ceil(r.length / 60));
    var linia = [];
    for (var i = 0; i < r.length; i += krok) linia.push(r[i][1].toFixed(6) + ',' + r[i][0].toFixed(6));
    linia.push(r[0][1].toFixed(6) + ',' + r[0][0].toFixed(6));
    var s = geo.srodek, ll = s[1].toFixed(6) + ',' + s[0].toFixed(6);
    var q = '[out:json][timeout:25];' +
      'way(around:12,' + linia.join(',') + ')[highway][highway!~"^(footway|path|cycleway|steps|bridleway|corridor|proposed|construction|platform)$"];out tags center;' +
      '(nwr(around:1500,' + ll + ')[amenity~"^(school|kindergarten)$"];' +
      'nwr(around:1500,' + ll + ')[shop~"^(supermarket|convenience|general|mall)$"];' +
      'node(around:1500,' + ll + ')[highway=bus_stop];' +
      'nwr(around:1500,' + ll + ')[railway~"^(station|halt|tram_stop)$"];' +
      'nwr(around:1500,' + ll + ')[amenity~"^(pharmacy|doctors|clinic|hospital)$"];);out center tags;';
    var probuj = function (idx) {
      return pobierz(URL_OVERPASS[idx], { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 28000)
        .then(function (res) { return res.json(); })
        .catch(function (e) { if (idx + 1 < URL_OVERPASS.length) return probuj(idx + 1); throw e; });
    };
    return probuj(0).then(function (j) {
      var drogi = [], poi = { szkola: [], przedszkole: [], sklep: [], przystanek: [], kolej: [], zdrowie: [] };
      (j.elements || []).forEach(function (el) {
        var t = el.tags || {};
        if (el.type === 'way' && t.highway && !t.amenity && !t.shop) { drogi.push({ typ: t.highway, nazwa: t.name || t.ref || '', nawierzchnia: t.surface || '' }); return; }
        var lat = el.lat || (el.center && el.center.lat), lon = el.lon || (el.center && el.center.lon);
        if (!lat) return;
        var d = Math.hypot((lon - s[0]) * 111320 * Math.cos(s[1] * Math.PI / 180), (lat - s[1]) * 110574);
        var o = { nazwa: t.name || '', odl: d };
        if (t.amenity === 'school') poi.szkola.push(o);
        else if (t.amenity === 'kindergarten') poi.przedszkole.push(o);
        else if (t.shop) poi.sklep.push(o);
        else if (t.highway === 'bus_stop') poi.przystanek.push(o);
        else if (t.railway) poi.kolej.push(o);
        else if (t.amenity) poi.zdrowie.push(o);
      });
      Object.keys(poi).forEach(function (k) { poi[k].sort(function (a, b) { return a.odl - b.odl; }); });
      var rangi = { motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, unclassified: 4, residential: 4, living_street: 4, service: 2, track: 1 };
      drogi.sort(function (a, b) { return (rangi[b.typ] || 0) - (rangi[a.typ] || 0); });
      return { drogi: drogi, poi: poi };
    });
  }

  // Pozwolenia na budowe w promieniu 1 km (rejestr GUNB w naszej bazie, polozenie dzialek z ULDK).
  // Gdy serwer jeszcze ustala polozenie czesci dzialek (pierwszy raport w okolicy) - pytamy ponownie.
  function analizaPozwolenia() {
    var s = geo.srodek, id = stan.dzialka && stan.dzialka.id;
    var url = URL_POZWOLENIA + '?id=' + encodeURIComponent(id || '') + '&lon=' + s[0].toFixed(6) + '&lat=' + s[1].toFixed(6);
    var nr = przebieg;
    var pytaj = function (proba) {
      return pobierz(url, null, 45000).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.stan === 'ok' && !d.kompletne && proba < 4 && nr === przebieg) {
          return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return pytaj(proba + 1); });
        }
        return d;
      });
    };
    return pytaj(0).then(function (d) {
      if (!d || d.stan === 'blad') throw new Error((d && d.blad) || 'brak odpowiedzi');
      return d;
    });
  }
  var GRUPY_POZW = {
    dom: { n: 'dom jednorodzinny', k: ['I'] },
    mieszk: { n: 'budynek wielorodzinny', k: ['XIII'] },
    uslugi: { n: 'usługi / handel', k: ['V', 'IX', 'X', 'XI', 'XII', 'XIV', 'XV', 'XVI', 'XVII', 'XX'] },
    przem: { n: 'przemysł / magazyn', k: ['XVIII', 'XIX', 'XXII'] },
    infra: { n: 'infrastruktura', k: ['IV', 'VII', 'VIII', 'XXI', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX'] }
  };
  function grupaPozw(kat) {
    for (var g in GRUPY_POZW) if (GRUPY_POZW[g].k.indexOf(kat) >= 0) return g;
    return 'inne';
  }
  var RODZAJ_POZW = ['budowa', 'rozbudowa', 'nadbudowa', 'odbudowa', 'rozbiórka', 'inne roboty'];
  function wielka(t) { t = String(t || '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); }
  function dataPL(d) { return d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : ''; }

  // =====================================================================
  // 5. CZYNNIKI -> WERDYKT
  //    typ: 'plus' | 'minus' | 'uwaga'; waga: wplyw na wynik (plus > 0, minus < 0, uwaga 0)
  // =====================================================================
  function zbierzCzynniki() {
    var c = [];
    var dod = function (typ, waga, tytul, opis, zrodlo, limit) { c.push({ typ: typ, waga: waga, tytul: tytul, opis: opis || '', zrodlo: zrodlo || '', limit: limit || 0 }); };
    var d = stan.dzialka && stan.dzialka.data || {};
    var pow = d.powierzchnia || 0;

    // --- Planowanie: MPZP ---
    var mp = stan.mpzp, planJest = false;
    if (mp && mp.status === 'jest') {
      planJest = true;
      var pz = mp.przeznaczenie;
      if (pz && pz.ocena === 'budowlane') dod('plus', 22, 'Obowiązuje MPZP - przeznaczenie: ' + pz.etykieta, 'Plan miejscowy przesądza o możliwości zabudowy - nie potrzeba decyzji WZ.' + (mp.symbol ? ' Symbol terenu: ' + mp.symbol + '.' : ''), 'KIMPZP');
      else if (pz && pz.ocena === 'czesciowo') dod('plus', 10, 'Obowiązuje MPZP - przeznaczenie ' + pz.etykieta, 'Zabudowa możliwa w zakresie określonym planem (sprawdź dopuszczalne funkcje).', 'KIMPZP');
      else if (pz && pz.ocena === 'niebudowlane') dod('minus', -25, 'MPZP przeznacza teren na: ' + pz.etykieta, 'Plan nie przewiduje zabudowy mieszkaniowej ani usługowej - zmiana wymaga zmiany planu przez gminę.', 'KIMPZP');
      else if (mp.pokrycie !== null && mp.pokrycie !== undefined && mp.pokrycie < 60) dod('plus', 4, 'MPZP obejmuje część działki (ok. ' + Math.round(mp.pokrycie) + '%)', 'Pozostała część może wymagać decyzji WZ. Przeznaczenie odczytaj z rysunku planu lub uchwały.', 'KIMPZP');
      else dod('plus', 8, 'Działka objęta obowiązującym MPZP', 'Jasne zasady zabudowy. Przeznaczenie odczytaj z uchwały lub wypisu i wyrysu z planu' + (mp.uchwala ? ' (uchwała ' + mp.uchwala + ')' : '') + '.', 'KIMPZP');
    } else if (mp && mp.status === 'brak') {
      dod('minus', -10, 'Brak miejscowego planu (MPZP)', 'Zabudowa możliwa tylko na podstawie decyzji o warunkach zabudowy (WZ) - wynik zależy od sąsiedztwa i gminy.', 'KIMPZP');
    }
    if (!planJest && mp && !mp.blad) {
      dod('uwaga', 0, 'Sprawdź, czy wydano warunki zabudowy (WZ)', 'Decyzji WZ nie ma w rejestrach publicznych - ma ją właściciel lub urząd gminy. Zapytaj o jej treść i datę ważności.', '');
    }
    if (mp && (mp.status === 'nieznany' || mp.blad)) {
      dod('uwaga', 0, 'Nie udało się automatycznie potwierdzić MPZP', 'Gmina nie przekazuje danych do usługi krajowej. Sprawdź w urzędzie lub w geoportalu gminy, czy działka jest objęta planem.', 'KIMPZP');
    }

    // --- Planowanie: POG ---
    var pg = stan.pog;
    if (pg && pg.status === 'jest') {
      if (pg.kod && /^(SW|SJ|SU|SH)$/.test(pg.kod)) dod('plus', planJest ? 4 : 10, 'Plan ogólny: strefa ' + pg.nazwa + ' (' + pg.kod + ')', 'Kierunek zgodny z zabudową mieszkaniową/usługową.', 'POG');
      else if (pg.kod && /^(SZ|SP)$/.test(pg.kod)) dod('plus', 3, 'Plan ogólny: strefa ' + pg.nazwa + ' (' + pg.kod + ')', 'Zabudowa możliwa w zakresie tej strefy.', 'POG');
      else if (pg.kod) dod('minus', planJest ? -4 : -12, 'Plan ogólny: strefa ' + pg.nazwa + ' (' + pg.kod + ')', 'Strefa nie przewiduje zabudowy mieszkaniowej - utrudnia nowy plan miejscowy i decyzje WZ.', 'POG');
      if (!planJest && pg.ouz) dod('plus', 6, 'Działka w obszarze uzupełnienia zabudowy (POG)', 'Po wejściu w życie planu ogólnego WZ można wydawać tylko w takich obszarach.', 'POG');
      else if (!planJest && pg.status === 'jest' && !pg.ouz && pg.kod) dod('minus', -6, 'Działka poza obszarem uzupełnienia zabudowy', 'Po wejściu w życie planu ogólnego uzyskanie WZ poza tym obszarem nie będzie możliwe.', 'POG');
    } else if (pg && pg.status === 'brak' && !planJest) {
      dod('uwaga', 0, 'Gmina nie ma jeszcze planu ogólnego w usłudze krajowej', 'Po uchwaleniu POG decyzje WZ będą możliwe tylko w obszarach uzupełnienia zabudowy - warto sprawdzić projekt planu ogólnego w gminie.', 'POG');
    }

    // --- Powodz ---
    var pw = stan.powodz;
    if (pw && !pw.blad) {
      var ileTxt = pw.metoda === 'mapa' && pw.procent > 0 ? ' (' + pw.procent.toLocaleString('pl-PL') + '% powierzchni)' : '';
      if (pw.zagrozona) {
        if (pw.maxP >= 0.01 || !pw.maxP) dod('minus', -25, 'Działka w obszarze szczególnego zagrożenia powodzią' + ileTxt, 'Scenariusz Q 1% lub częstszy - obowiązują zakazy i ograniczenia zabudowy (Prawo wodne).', 'ISOK');
        else dod('minus', -8, 'Działka w obszarze zagrożenia powodzią Q 0,2%' + ileTxt, 'Powódź raz na 500 lat lub zniszczenie wału - ryzyko do uwzględnienia przy projekcie i ubezpieczeniu.', 'ISOK');
      } else {
        dod('plus', 6, 'Działka poza obszarami zagrożenia powodziowego', pw.wPoblizu ? 'Strefa zalewowa jest jednak w pobliżu - widoczna na mapie w sekcji 11.' : 'Brak stref zalewowych na mapach ISOK w okolicy działki.', 'ISOK');
      }
    }

    // --- Przyroda ---
    var pr = stan.przyroda;
    if (pr && !pr.blad) {
      var wDz = (pr.formy || []).filter(function (f) { return f.wDzialce; });
      if (pr.procent > 0 || wDz.length) {
        var twarde = wDz.filter(function (f) { return /ParkiNarodowe|Rezerwaty/.test(f.typ); });
        var nazwy = wDz.map(function (f) { return (NAZWY_FORM[f.typ] || f.typ) + (f.nazwa ? ' „' + f.nazwa + '”' : ''); }).join(', ');
        if (twarde.length) dod('minus', -30, 'Działka w parku narodowym lub rezerwacie', nazwy, 'GDOŚ');
        else dod('minus', -8, 'Działka w obszarze ochrony przyrody', (nazwy || 'forma ochrony przyrody') + ' - możliwe dodatkowe wymogi (np. ocena oddziaływania na środowisko, ograniczenia zabudowy).', 'GDOŚ');
      } else {
        dod('plus', 4, 'Brak form ochrony przyrody na działce', pr.wPoblizu ? 'Forma ochrony przyrody jest jednak w sąsiedztwie (sekcja 10).' : 'Natura 2000, parki, rezerwaty - brak w okolicy.', 'GDOŚ');
      }
    }

    // --- Media ---
    var md = stan.media;
    if (md && md.niedostepne) {
      dod('uwaga', 0, 'Sprawdź na mapie 07, jak biegną sieci względem działki',
        'Dla tego powiatu automatyczna analiza sieci nie jest możliwa, ale przewody widać na mapie. Minus, jeśli sieć przechodzi przez działkę lub biegnie tuż przy granicy - np. linia napowietrzna średniego napięcia ma strefę ok. 7,5 m od osi, w której nie można budować. Plus, jeśli woda, prąd, gaz i kanalizacja są w drodze przy działce.', 'KIUT');
    }
    if (md && !md.blad && !md.niedostepne) {
      if (md.brakDanych) {
        dod('uwaga', 0, 'Brak danych o sieciach uzbrojenia dla tego terenu', 'Powiat nie przekazuje danych GESUT do usługi krajowej. Dostępność mediów sprawdź u gestorów sieci lub na mapie zasadniczej w starostwie.', 'KIUT');
      } else {
        var S = md.sieci;
        var przez = SIECI.filter(function (s) { return S[s.klucz].przez; });
        przez.forEach(function (s) {
          var waga = { elektro: -12, gaz: -12, cieplo: -10, woda: -7, kanal: -7, telekom: -3 }[s.klucz];
          dod('minus', waga, 'Przez działkę przechodzi sieć ' + s.nazwa, SKUTEK_SIECI[s.klucz], 'KIUT');
        });
        SIECI.forEach(function (s) {
          var w = S[s.klucz], st = STREFY_SIECI[s.klucz];
          if (w.przez || w.minOdl === null || !st) return;
          if (w.minOdl <= st.strefa) dod('minus', st.waga, 'Sieć ' + s.nazwa + ' ok. ' + odl(w.minOdl) + ' od granicy działki', st.opis, 'KIUT');
          else if (st.dalej && w.minOdl <= st.dalej) dod('uwaga', 0, 'Sieć ' + s.nazwa + ' ok. ' + odl(w.minOdl) + ' od granicy działki', st.opisDalej, 'KIUT');
        });
        var dostepne = SIECI.filter(function (s) { return /woda|kanal|gaz|elektro/.test(s.klucz) && S[s.klucz].minOdl !== null && S[s.klucz].minOdl <= 50; });
        if (dostepne.length) dod('plus', Math.min(10, 3 * dostepne.length), 'Media w zasięgu: ' + dostepne.map(function (s) { return s.nazwa.replace('elektroenergetyczna', 'prąd').replace('wodociągowa', 'woda').replace('kanalizacyjna', 'kanalizacja').replace('gazowa', 'gaz'); }).join(', '),
          'Najbliższe przewody w odległości do 50 m od działki - ułatwia przyłączenie (potwierdź warunki u gestorów).', 'KIUT');
        else dod('minus', -5, 'Brak sieci wod.-kan., gazu i prądu w promieniu 50 m', 'Przyłączenie może wymagać rozbudowy sieci - koszt i czas po stronie inwestora.', 'KIUT');
      }
    }

    // --- Teren ---
    var tr = stan.teren;
    if (tr && !tr.blad && tr.spadek !== null && tr.spadek !== undefined) {
      if (tr.spadek > 10) dod('minus', -6, 'Duży spadek terenu (ok. ' + tr.spadek.toLocaleString('pl-PL') + '%)', 'Różnica wysokości ' + tr.roznica.toFixed(1).replace('.', ',') + ' m - droższe fundamenty, niwelacja, mury oporowe.', 'NMT');
      else if (tr.spadek > 5) dod('uwaga', 0, 'Umiarkowany spadek terenu (ok. ' + tr.spadek.toLocaleString('pl-PL') + '%)', 'Uwzględnij w projekcie (skarpy, odwodnienie).', 'NMT');
      else dod('plus', 3, 'Teren płaski (spadek ok. ' + tr.spadek.toLocaleString('pl-PL') + '%)', 'Różnica wysokości na działce ok. ' + tr.roznica.toFixed(1).replace('.', ',') + ' m.', 'NMT');
    }

    // --- Uzytki ---
    var uz = stan.uzytki;
    if (uz && !uz.blad) {
      var wys = uz.opis.filter(function (o) { return o.wysokaKlasa; });
      var les = uz.opis.filter(function (o) { return o.kat === 'lesne'; });
      var bud = uz.opis.filter(function (o) { return o.kat === 'budowlane'; });
      if (les.length) dod('minus', planJest ? -6 : -15, 'Na działce są grunty leśne (' + les.map(function (o) { return o.kod; }).join(', ') + ')', 'Zabudowa wymaga zmiany przeznaczenia (MPZP) i wyłączenia z produkcji leśnej - kosztowne i niepewne.', 'EGiB');
      if (wys.length) dod('minus', -8, 'Grunty rolne wysokich klas (' + wys.map(function (o) { return o.kod; }).join(', ') + ')', 'Klasy I-III wymagają zgody na zmianę przeznaczenia i opłat za wyłączenie z produkcji rolnej (poza granicami miast).', 'EGiB');
      if (bud.length && !les.length) dod('plus', 5, 'W ewidencji grunt budowlany/zurbanizowany (' + bud.map(function (o) { return o.kod; }).join(', ') + ')', 'Brak konieczności wyłączania gruntu z produkcji rolnej.', 'EGiB');
    }

    // --- Droga i otoczenie ---
    var ot = stan.otoczenie;
    if (ot && !ot.blad) {
      var publ = ot.drogi.filter(function (x) { return !/^(service|track)$/.test(x.typ); });
      var eg = ot.egib, drEGiB = eg && eg.drogowe && eg.drogowe.length;
      if (drEGiB || publ.length) {
        dod('plus', 6, 'Działka graniczy z drogą' + (publ.length && publ[0].nazwa ? ' (' + publ[0].nazwa + ')' : ''),
          (drEGiB ? 'W ewidencji gruntów przy granicy jest działka drogowa (dr' + (/^\d/.test(eg.drogowe[0]) ? ': ' + eg.drogowe[0] : '') + ')' : 'Wg OpenStreetMap droga biegnie przy granicy działki') +
          '. Potwierdź w gminie, że to droga publiczna (a nie wewnętrzna/prywatna).', drEGiB ? 'EGiB' : 'OSM');
      } else {
        // BRAK potwierdzonego dostepu do drogi publicznej - mocny minus i gorny limit oceny (do weryfikacji: sluzebnosc)
        dod('minus', -18, 'Brak potwierdzonego dostępu do drogi publicznej',
          (ot.drogi.length ? 'Przy działce jest tylko droga dojazdowa/gruntowa, ' : 'Przy granicy działki nie ma drogi ') +
          (eg && eg.sprawdzone ? 'ani działki drogowej w ewidencji. ' : '(wg OpenStreetMap). ') +
          'DO WERYFIKACJI: dojazd może wynikać ze służebności drogowej (dział III księgi wieczystej) albo z udziału w drodze wewnętrznej. Bez dostępu do drogi publicznej nie uzyskasz pozwolenia na budowę.',
          eg && eg.sprawdzone ? 'EGiB/OSM' : 'OSM', 54);
      }
      var p = ot.poi;
      var blisko1km = ['szkola', 'sklep', 'przystanek'].filter(function (k) { return p[k].length && p[k][0].odl <= 1000; });
      if (blisko1km.length >= 2) dod('plus', 4, 'Dobra infrastruktura w promieniu 1 km', blisko1km.map(function (k) { return { szkola: 'szkoła', sklep: 'sklep', przystanek: 'przystanek' }[k] + ' ' + odl(p[k][0].odl); }).join(' · '), 'OSM');
      else if (!p.sklep.length && !p.szkola.length && !p.przystanek.length) dod('minus', -3, 'Słaba infrastruktura w promieniu 1,5 km', 'Brak szkoły, sklepu i przystanku w pobliżu - mniejszy popyt na zabudowę mieszkaniową.', 'OSM');
    }

    if (ot && ot.blad) dod('uwaga', 0, 'Nie udało się sprawdzić dostępu do drogi', 'Serwer OpenStreetMap nie odpowiedział - potwierdź dostęp do drogi publicznej w gminie lub na mapie.', 'OSM');

    // --- Rynek (transakcje) ---
    var ce = stan.ceny;
    if (ce && !ce.blad) {
      var km = (ce.promien_m || 1500) / 1000;
      if (!ce.rozszerzony && ce.liczba >= 5) dod('plus', 8, 'Aktywny rynek gruntów - ' + ce.liczba + ' transakcji w promieniu ' + String(km).replace('.', ',') + ' km', 'Łatwiejsza wycena i sprzedaż; mediana ' + m(ce.mediana_m2) + ' zł/m².', 'RCN');
      else if (ce.liczba >= 3 && km <= 3) dod('plus', 3, 'Transakcje porównawcze w okolicy (' + ce.liczba + ' w promieniu ' + String(km).replace('.', ',') + ' km)', 'Mediana ' + m(ce.mediana_m2) + ' zł/m².', 'RCN');
      else dod('minus', -5, 'Mało transakcji gruntami w okolicy', 'Najbliższe porównania dopiero w promieniu ' + String(km).replace('.', ',') + ' km - wycena mniej pewna, sprzedaż może trwać dłużej.', 'RCN');
    }

    // --- Pozwolenia na budowe w okolicy ---
    var pb = stan.pozwolenia;
    if (pb && pb.stan === 'ok' && pb.lista) {
      var nowe = pb.lista.filter(function (x) { return x.rodzaj === 0 && !x.wlasna; });
      var mieszk = nowe.filter(function (x) { return x.kategoria === 'I' || x.kategoria === 'XIII'; });
      var wielo = mieszk.filter(function (x) { return x.kategoria === 'XIII'; }).length;
      var opisM = mieszk.length + ' pozwoleń na nowe budynki mieszkalne w promieniu 1 km w ostatnich 3 latach' + (wielo ? ' (w tym wielorodzinne: ' + wielo + ')' : '') + '.';
      if (mieszk.length >= 10) dod('plus', 5, 'Okolica aktywnie się zabudowuje', opisM + ' Popyt na grunty budowlane w tym miejscu jest potwierdzony.', 'GUNB');
      else if (mieszk.length >= 3) dod('plus', 3, 'Nowe budynki mieszkalne w okolicy', opisM, 'GUNB');
      var przem = nowe.filter(function (x) { return grupaPozw(x.kategoria) === 'przem' && x.odl <= 500; });
      if (przem.length) dod('uwaga', 0, 'Planowana inwestycja przemysłowa lub magazynowa w pobliżu (' + odl(przem[0].odl) + ')', wielka(przem[0].opis) + (przem.length > 1 ? ' · takich pozwoleń w promieniu 500 m: ' + przem.length : '') + '. Sprawdź, czy nie wpłynie na komfort zamieszkania (ruch ciężarówek, hałas).', 'GUNB');
      var maszt = nowe.filter(function (x) { return x.kategoria === 'XXIX' && x.odl <= 300; });
      if (maszt.length) dod('uwaga', 0, 'Planowany maszt lub wolnostojący komin w pobliżu (' + odl(maszt[0].odl) + ')', wielka(maszt[0].opis), 'GUNB');
      var wlasne = pb.lista.filter(function (x) { return x.wlasna; });
      if (wlasne.length) dod('uwaga', 0, 'Dla tej działki jest sprawa w rejestrze pozwoleń na budowę', wielka(wlasne[0].opis) + ' (' + (wlasne[0].data_decyzji ? 'decyzja ' + dataPL(wlasne[0].data_decyzji) : 'wniosek ' + dataPL(wlasne[0].data_wniosku)) + '). Zapytaj sprzedającego o projekt i decyzję - może przejść na kupującego.', 'GUNB');
    }

    // --- Ksztalt i powierzchnia ---
    var wy = stan.wymiary;
    if (wy && wy.szerokosc) {
      if (wy.szerokosc < 16) dod('minus', -8, 'Wąska działka (ok. ' + wy.szerokosc + ' m szerokości)', 'Przy odległościach 3-4 m od granic zostaje mało miejsca na budynek; możliwe odstępstwa lub zabudowa w granicy.', 'ULDK');
      else if (wy.szerokosc < 20) dod('uwaga', 0, 'Działka dość wąska (ok. ' + wy.szerokosc + ' m)', 'Sprawdź, czy mieści planowany budynek z odległościami od granic.', 'ULDK');
    }
    if (pow && pow < 500) dod('minus', -4, 'Mała powierzchnia (' + m(pow) + ' m²)', 'Może nie spełniać minimalnej powierzchni działki budowlanej z planu/WZ.', 'ULDK');

    return c;
  }

  function wynikZ(c) {
    var s = 50;
    c.forEach(function (x) { s += x.waga; });
    // Czynniki "blokujace" (np. brak dostepu do drogi publicznej) ograniczaja ocene z gory
    c.forEach(function (x) { if (x.limit) s = Math.min(s, x.limit); });
    return Math.max(5, Math.min(95, Math.round(s)));
  }
  function poziom(w) {
    if (w >= 70) return { klucz: 'wysoki', tytul: 'Działka o wysokim potencjale inwestycyjnym' };
    if (w >= 55) return { klucz: 'sredni', tytul: 'Działka z potencjałem - kilka kwestii do potwierdzenia' };
    if (w >= 40) return { klucz: 'niski', tytul: 'Potencjał ograniczony - istotne ryzyka do wyjaśnienia' };
    return { klucz: 'ryzyko', tytul: 'Wysokie ryzyko inwestycyjne' };
  }

  // =====================================================================
  // 6. RYSOWANIE: werdykt (gora + dol), sekcje, lista kontrolna
  // =====================================================================
  function przelicz() {
    var gotowe = ANALIZY.filter(function (a) { return !!stan[a]; }).length;
    var c = stan.dzialka ? zbierzCzynniki() : [];
    var plusy = c.filter(function (x) { return x.typ === 'plus'; }).sort(function (a, b) { return b.waga - a.waga; });
    var minusy = c.filter(function (x) { return x.typ === 'minus'; }).sort(function (a, b) { return a.waga - b.waga; });
    var uwagi = c.filter(function (x) { return x.typ === 'uwaga'; });
    var w = wynikZ(c), pz = poziom(w);
    var koniec = gotowe >= ANALIZY.length;

    var li = function (x) {
      return '<li><strong>' + esc(x.tytul) + '</strong>' + (x.zrodlo ? '<span class="zr">' + esc(x.zrodlo) + '</span>' : '') + (x.opis ? '<small>' + esc(x.opis) + '</small>' : '') + '</li>';
    };
    var pusto = function (t) { return '<li class="wk-pusto">' + t + '</li>'; };
    var lead = '';
    if (stan.dzialka) {
      // pierwsza litera mala, chyba ze to skrot (MPZP, POG...)
      var male = function (t) { return /^[A-ZŁŚŻŹĆŃÓĘĄ]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); };
      var mocne = plusy.slice(0, 2).map(function (x) { return male(x.tytul); });
      var slabe = minusy.slice(0, 2).map(function (x) { return male(x.tytul); });
      lead = (mocne.length ? 'Najmocniejsze strony: ' + mocne.join('; ') + '. ' : '') +
        (slabe.length ? 'Główne ryzyka: ' + slabe.join('; ') + '.' : (koniec ? 'Model nie wykrył istotnych ryzyk w danych publicznych.' : ''));
      if (!lead) lead = 'Zbieramy dane z rejestrów - werdykt uzupełnia się na bieżąco.';
    }

    document.querySelectorAll('.werdykt').forEach(function (box) {
      var q = function (k) { return box.querySelector('[data-w="' + k + '"]'); };
      if (!stan.dzialka) return;
      box.setAttribute('data-poziom', pz.klucz);
      q('punkty').textContent = w;
      q('pasek').style.strokeDasharray = (w / 100 * 326.7).toFixed(1) + ' 327';
      q('tytul').textContent = (koniec ? '' : 'Wstępnie: ') + pz.tytul;
      q('lead').textContent = lead;
      q('postep').innerHTML = koniec ? 'Analiza zakończona · ' + c.length + ' czynników · ' + new Date().toLocaleDateString('pl-PL')
        : '<span class="kropka"></span>Analiza w toku: ' + gotowe + ' z ' + ANALIZY.length + ' źródeł danych';
      q('plusy').innerHTML = plusy.length ? plusy.map(li).join('') : pusto(koniec ? 'brak wyraźnych plusów w danych publicznych' : 'zbieramy dane…');
      q('minusy').innerHTML = minusy.length ? minusy.map(li).join('') : pusto(koniec ? 'nie wykryto istotnych minusów' : 'zbieramy dane…');
      if (q('uwagi')) q('uwagi').innerHTML = uwagi.length ? uwagi.map(li).join('') : pusto(koniec ? 'brak dodatkowych uwag' : 'zbieramy dane…');
      if (q('rekomendacja')) q('rekomendacja').innerHTML = koniec ? rekomendacja(pz, minusy, uwagi) : '';
    });
    if (stan.dzialka) rysujListeKontrolna();
  }

  function rekomendacja(pz, minusy, uwagi) {
    var wstep = {
      wysoki: '<strong>Rekomendacja:</strong> dane publiczne nie wskazują poważnych przeszkód - działka jest dobrym kandydatem do dalszej analizy lub zakupu.',
      sredni: '<strong>Rekomendacja:</strong> działka ma potencjał, ale przed decyzją wyjaśnij punkty oznaczone jako minusy i do sprawdzenia.',
      niski: '<strong>Rekomendacja:</strong> wykryte ograniczenia mogą istotnie wpłynąć na wartość i możliwość zabudowy - decyzję podejmij dopiero po ich wyjaśnieniu.',
      ryzyko: '<strong>Rekomendacja:</strong> dane wskazują na poważne ograniczenia - zakup pod zabudowę jest ryzykowny bez indywidualnej analizy.'
    }[pz.klucz];
    var kroki = [];
    var mp = stan.mpzp;
    if (mp && mp.status === 'jest') kroki.push('Zamów w gminie wypis i wyrys z MPZP - potwierdzi przeznaczenie i parametry zabudowy.');
    else kroki.push('Zapytaj właściciela o decyzję WZ; jeśli jej nie ma - złóż wniosek o WZ lub sprawdź projekt planu ogólnego gminy.');
    if (minusy.some(function (x) { return x.zrodlo === 'KIUT'; })) kroki.push('Poproś gestorów sieci o warunki techniczne i informację o strefach ochronnych / możliwości przełożenia sieci.');
    if (minusy.some(function (x) { return /OSM|EGiB/.test(x.zrodlo) && /drogi publicznej/.test(x.tytul); })) kroki.push('Potwierdź dostęp do drogi publicznej - sprawdź w księdze wieczystej (dział III), czy jest służebność drogowa, albo udział w drodze wewnętrznej.');
    kroki.push('Sprawdź księgę wieczystą: właściciel, hipoteki, służebności, roszczenia.');
    return wstep + '<ol>' + kroki.map(function (k) { return '<li>' + esc(k) + '</li>'; }).join('') + '</ol>';
  }

  function ustawKarte(id, pill, pillKlasa, wartosc, notka) {
    var k = $(id); if (!k) return;
    var p = k.querySelector('[data-k="pill"]');
    p.textContent = pill; p.className = 'pill ' + pillKlasa;
    k.querySelector('[data-k="v"]').textContent = wartosc;
    k.querySelector('[data-k="n"]').textContent = notka;
  }
  function ocena(typ, tytul, opis) {
    var ik = { plus: '+', minus: '−', uwaga: '!' }[typ];
    return '<div class="ocena ocena-' + typ + '"><span class="ocena-ikona">' + ik + '</span><div><strong>' + esc(tytul) + '</strong>' + (opis ? '<small>' + esc(opis) + '</small>' : '') + '</div></div>';
  }
  // Komunikat bledu z przyciskiem "Sprawdz ponownie" (ponawia tylko te jedna analize)
  function bladSekcji(tekst, w) {
    var klucz = w && w.klucz;
    var info = (w && w.ponawiane) ? ' Ponowimy automatycznie za ok. 30 s.' : '';
    var h = ocena('uwaga', 'Usługa chwilowo nie odpowiedziała', (tekst || 'Serwer państwowy nie odpowiedział.') + info);
    if (klucz) h = h.replace(/<\/div><\/div>$/, '<button type="button" class="btn btn-ponow" data-ponow="' + klucz + '">↻ Sprawdź ponownie</button></div></div>');
    return h;
  }

  function rysujSekcje(klucz) {
    var w = stan[klucz] || {};
    if (klucz === 'mpzp' || klucz === 'pog') rysujPlanowanie();
    else if (klucz === 'powodz') {
      if (w.blad) { $('powodz-wynik').innerHTML = bladSekcji('Usługa ISOK (Wody Polskie) nie odpowiedziała.', w); return; }
      var sc = (w.scenariusze || []).map(function (s) { return s.opis + (s.procent ? ' - ' + s.procent.toLocaleString('pl-PL') + '% działki' : ''); });
      var legenda = '<div class="uzbr-legenda" style="margin-bottom:.75rem;">' + SCEN_POWODZ.slice(0, 3).map(function (x) { return '<span class="uzbr-item"><span class="uzbr-kolor" style="background:' + x.css + ';height:10px;"></span>' + x.opis + '</span>'; }).join('') + '</div>';
      $('powodz-wynik').innerHTML = legenda + (w.zagrozona
        ? ocena('minus', 'Działka w obszarze zagrożenia powodziowego' + (w.metoda === 'mapa' && w.procent > 0 ? ' - ' + w.procent.toLocaleString('pl-PL') + '% powierzchni' : ''), sc.length ? 'Scenariusze: ' + sc.join('; ') : 'Szczegóły scenariusza na mapie powyżej.')
        : ocena('plus', 'Działka poza obszarami zagrożenia powodziowego', w.wPoblizu ? 'Obszar zagrożenia jest w pobliżu działki - widoczny na mapie.' : 'Na mapach zagrożenia powodziowego brak stref w otoczeniu działki.'));
    } else if (klucz === 'przyroda') {
      if (w.blad) { $('przyroda-wynik').innerHTML = bladSekcji('Usługa GDOŚ nie odpowiedziała.', w); return; }
      var h = '';
      var wDz = (w.formy || []).filter(function (f) { return f.wDzialce; });
      var obok = (w.formy || []).filter(function (f) { return !f.wDzialce; });
      if (w.procent > 0 || wDz.length) {
        h += ocena('minus', 'Działka w obszarze ochrony przyrody' + (w.procent ? ' (' + w.procent.toLocaleString('pl-PL') + '% powierzchni)' : ''),
          wDz.map(function (f) { return (NAZWY_FORM[f.typ] || f.typ) + (f.nazwa ? ': ' + f.nazwa : ''); }).join(' · '));
      } else h += ocena('plus', 'Działka poza formami ochrony przyrody', '');
      if (obok.length) h += ocena('uwaga', 'W sąsiedztwie', obok.map(function (f) { return (NAZWY_FORM[f.typ] || f.typ) + (f.nazwa ? ': ' + f.nazwa : ''); }).join(' · '));
      $('przyroda-wynik').innerHTML = h;
    } else if (klucz === 'media') rysujMedia(w);
    else if (klucz === 'teren') {
      if (w.blad) { $('teren-karty').innerHTML = bladSekcji('Usługa NMT (wysokości) nie odpowiedziała.', w); return; }
      var karta = function (l, v, n, pill, pk) { return '<div class="scard"><div class="scard-top"><span class="scard-l">' + l + '</span>' + (pill ? '<span class="pill ' + pk + '">' + pill + '</span>' : '') + '</div><div class="scard-v">' + v + '</div><div class="scard-note">' + n + '</div></div>'; };
      var sp = w.spadek, spPill = sp === null ? '' : sp > 10 ? 'duży' : sp > 5 ? 'umiarkowany' : 'płasko', spK = sp > 10 ? 'pill-minus' : sp > 5 ? 'pill-warn' : 'pill-plus';
      $('teren-karty').innerHTML =
        karta('Wysokość terenu', w.sr.toFixed(1).replace('.', ',') + ' m n.p.m.', 'średnia z ' + w.punktow + ' punktów na działce') +
        karta('Różnica wysokości', w.roznica.toFixed(1).replace('.', ',') + ' m', 'od ' + w.min.toFixed(1).replace('.', ',') + ' do ' + w.max.toFixed(1).replace('.', ',') + ' m') +
        karta('Spadek terenu', sp === null ? '-' : sp.toLocaleString('pl-PL') + '%', 'nachylenie płaszczyzny dopasowanej do terenu', spPill, spK);
      if (w.siatka && $('teren-wizual')) $('teren-wizual').innerHTML = rysujTeren(w);
    } else if (klucz === 'uzytki') {
      if (w.blad) { $('uzytki-wynik').innerHTML = ocena('uwaga', 'Brak danych o użytkach dla tej działki', 'Powiat nie udostępnia warstwy użytków w usłudze krajowej. Sprawdź wypis z rejestru gruntów.'); return; }
      var ho = (w.opis || []).map(function (o) {
        var typ = o.kat === 'lesne' || o.wysokaKlasa ? 'minus' : o.kat === 'budowlane' ? 'plus' : 'uwaga';
        var nota = o.kat === 'lesne' ? 'grunt leśny - zabudowa wymaga zmiany przeznaczenia' : o.wysokaKlasa ? 'wysoka klasa gleby - wyłączenie z produkcji rolnej wymaga zgody i opłat' :
          o.kat === 'rolne' ? 'grunt rolny niższej klasy - wyłączenie z produkcji zwykle bez zgody ministra' : o.kat === 'budowlane' ? 'grunt budowlany / zurbanizowany' : '';
        return ocena(typ, o.kod + ' - ' + o.nazwa, nota);
      }).join('');
      $('uzytki-wynik').innerHTML = ho + (w.grupa ? '<p class="mapbox-cap" style="margin-top:.6rem;">Grupa rejestrowa: ' + esc(w.grupa) + (w.pole ? ' · pole w ewidencji: ' + esc(w.pole) + ' ha' : '') + ' · odczyt w punktach wewnątrz działki</p>' : '');
    } else if (klucz === 'otoczenie') rysujOtoczenie(w);
    else if (klucz === 'pozwolenia') rysujPozwolenia(w);
  }

  function rysujPlanowanie() {
    var mp = stan.mpzp, pg = stan.pog;
    if (mp) {
      if (mp.blad) { ustawKarte('k-mpzp', 'brak odpowiedzi', 'pill-info', 'Nie udało się sprawdzić', 'usługa KIMPZP nie odpowiedziała'); $('plan-szczegoly').innerHTML = bladSekcji('Usługa MPZP nie odpowiedziała.', mp); }
      else if (mp.status === 'jest') {
        var pz = mp.przeznaczenie;
        ustawKarte('k-mpzp', 'obowiązuje', pz && pz.ocena === 'niebudowlane' ? 'pill-minus' : 'pill-plus',
          pz ? 'Przeznaczenie: ' + pz.etykieta : 'Plan obowiązuje', (mp.symbol ? 'symbol ' + mp.symbol + ' · ' : '') + (mp.uchwala ? 'uchwała ' + mp.uchwala : (mp.nazwa || (mp.pokrycie ? 'plan na mapie obejmuje ok. ' + Math.round(mp.pokrycie) + '% działki' : 'szczegóły w uchwale'))));
      } else if (mp.status === 'brak') ustawKarte('k-mpzp', 'brak planu', 'pill-minus', 'Brak MPZP', 'zabudowa na podstawie decyzji WZ');
      else ustawKarte('k-mpzp', 'brak danych', 'pill-warn', 'Nie do potwierdzenia', 'gmina nie przekazuje planów do usługi krajowej');
      if (mp.status === 'jest') ustawKarte('k-wz', 'nie dotyczy', 'pill-info', 'Obowiązuje MPZP', 'przy planie miejscowym decyzja WZ nie jest potrzebna');
    }
    if (pg) {
      if (pg.blad) ustawKarte('k-pog', 'brak odpowiedzi', 'pill-info', 'Nie udało się sprawdzić', 'usługa planów ogólnych nie odpowiedziała');
      else if (pg.status === 'jest') ustawKarte('k-pog', pg.oznaczenie || pg.kod || 'uchwalony', pg.kod && /^(SW|SJ|SU|SH)$/.test(pg.kod) ? 'pill-plus' : 'pill-warn',
        pg.kod ? 'Strefa ' + pg.nazwa : 'Plan ogólny obowiązuje', pg.ouz ? 'działka w obszarze uzupełnienia zabudowy' : 'poza obszarem uzupełnienia zabudowy');
      else ustawKarte('k-pog', 'brak POG', 'pill-warn', 'Gmina bez planu ogólnego', 'w usłudze krajowej - sprawdź projekt w gminie');
    }
    var h = '';
    if (mp && mp.status === 'jest') {
      if (mp.nazwa) h += ocena('uwaga', 'Plan: ' + mp.nazwa, [mp.uchwala ? 'uchwała ' + mp.uchwala : '', mp.data ? 'z dnia ' + mp.data : '', mp.stanPlanu || ''].filter(Boolean).join(' · '));
      if (mp.funkcja) h += ocena('uwaga', 'Funkcja terenu: ' + mp.funkcja, mp.symbol ? 'symbol ' + mp.symbol : '');
      if (mp.link) h += '<a class="legenda-link" href="' + esc(mp.link) + '" target="_blank" rel="noopener">Otwórz treść uchwały →</a>';
      else if (mp.ru && mp.ru.link) h += '<a class="legenda-link" href="' + esc(mp.ru.link) + '" target="_blank" rel="noopener">Plan w Rejestrze Urbanistycznym →</a>';
      else if (mp.mesip && mp.mesip.portal) h += '<a class="legenda-link" href="' + esc(mp.mesip.portal) + '" target="_blank" rel="noopener">Plan w geoportalu ' + (mp.mesip.zrodlo === 'MeSIP' ? 'MeSIP' : 'SIP Poznania') + ' →</a>';
      if (mp.mesip && mp.mesip.w_opracowaniu) h += ocena('uwaga', 'Dla tego terenu opracowywany jest nowy plan', mp.mesip.w_opracowaniu + ' - zapisy mogą się zmienić; sprawdź etap procedury w urzędzie.');
      if (mp.mesip && mp.mesip.tereny && mp.mesip.tereny.length > 1) h += ocena('uwaga', 'Na działce jest kilka terenów planu', mp.mesip.tereny.map(function (t) { return t.symbol + (t.opis ? ' (' + t.opis + ')' : ''); }).join(', '));
    }
    // Wskazniki strefy planu ogolnego (z Rejestru Urbanistycznego)
    if (pg && pg.status === 'jest' && (pg.wysokosc || pg.zabudowa || pg.pbc)) {
      h += ocena('uwaga', 'Plan ogólny - strefa ' + (pg.oznaczenie || pg.kod) + (pg.nazwaStrefy ? ' (' + pg.nazwaStrefy.toLowerCase() + ')' : ''),
        [pg.wysokosc ? 'maks. wysokość ' + pg.wysokosc : '', pg.zabudowa ? 'maks. zabudowa ' + pg.zabudowa : '', pg.pbc ? 'min. biologicznie czynna ' + pg.pbc : '',
         pg.intensywnosc ? 'intensywność do ' + pg.intensywnosc : ''].filter(Boolean).join(' · '));
      if (pg.profilPodst) h += '<p class="mapbox-cap">Profil podstawowy strefy: ' + esc(pg.profilPodst.toLowerCase()) + (pg.profilDod ? '. Profil dodatkowy: ' + esc(pg.profilDod.toLowerCase()) : '') + '.</p>';
    }
    $('plan-szczegoly').innerHTML = h;
    if (mp && mp.status === 'jest') wczytajUstalenia(mp);
  }

  // ---- Zapisy szczegolowe MPZP dla terenu (uchwala przerobiona przez AI na serwerze, zapamietana w bazie) ----
  var ustaleniaStart = false;
  function wczytajUstalenia(mp) {
    var box = $('plan-ustalenia'); if (!box || ustaleniaStart) return;
    if (mp.mesip && mp.mesip.tereny && mp.mesip.tereny.some(function (t) { return t.ustalenia; })) { ustaleniaStart = true; rysujUstaleniaMesip(mp.mesip); return; }
    var id = mp.ru && mp.ru.id;
    var pdf = !id && mp.link && /\.pdf(\?|$)/i.test(mp.link) ? mp.link : '';
    if (!id && !pdf) return;          // brak dostepu do tresci uchwaly - zostaje link w sekcji wyzej
    ustaleniaStart = true;
    var url = URL_USTALENIA + (id ? '?id=' + encodeURIComponent(id) : '?pdf=' + encodeURIComponent(pdf));
    var proby = 0;
    var czekaj = function () {
      box.innerHTML = '<div class="ust-czeka"><span class="ust-kropka"></span><div><strong>Czytamy uchwałę planu…</strong>' +
        '<p>Wyciągamy zapisy dla terenu działki (przeznaczenie, wysokość, powierzchnia zabudowy, dachy, minimalna działka). ' +
        'Pierwsze przetworzenie planu trwa zwykle 1-3 minuty - kolejne raporty z tego planu mają je od razu.</p></div></div>';
    };
    var pytaj = function () {
      fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.stan === 'gotowe') { stan.ustalenia = d.wynik; rysujUstalenia(d.wynik, mp.symbol); return; }
        if (d.stan === 'w_toku' && ++proby < 45) { czekaj(); setTimeout(pytaj, 6000); return; }
        if (d.stan === 'wylaczone') { box.innerHTML = ''; return; }
        box.innerHTML = '<p class="mapbox-cap">Nie udało się automatycznie odczytać zapisów planu' + (d.blad ? ' (' + esc(d.blad) + ')' : '') + ' - skorzystaj z linku do uchwały powyżej.</p>';
      }).catch(function () {
        if (++proby < 45) setTimeout(pytaj, 8000);
        else box.innerHTML = '<p class="mapbox-cap">Serwer nie odpowiedział - skorzystaj z linku do uchwały powyżej.</p>';
      });
    };
    czekaj(); pytaj();
  }

  // Do PDF/druku rozwijamy wszystkie tereny planu
  window.addEventListener('beforeprint', function () { document.querySelectorAll('.plan-ustalenia details').forEach(function (d) { d.open = true; }); });

  // Tekst ustalen terenu z MeSIP (fragment uchwaly dla terenu) - pokazujemy jako liste punktow
  function rysujUstaleniaMesip(ms) {
    var box = $('plan-ustalenia'); if (!box) return;
    var punkty = function (txt) {
      var linie = String(txt || '').replace(/\r/g, '').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (!linie.length) return '';
      var naglowek = /^\d+\.\s/.test(linie[0]) && !/^\d+\)/.test(linie[0]) ? linie.shift().replace(/^\d+\.\s*/, '') : '';
      return (naglowek ? '<p class="ust-wstep">' + esc(naglowek) + '</p>' : '') + '<ul class="ust-inne">' + linie.map(function (l) { return '<li>' + esc(l.replace(/^\d+\)\s*/, '').replace(/[\u2013\u2014]/g, '-')) + '</li>'; }).join('') + '</ul>';
    };
    var t0 = ms.tereny[0], pl = ms.plan || {};
    var h = '<div class="legenda-title">Zapisy planu miejscowego dla terenu ' + esc(t0.symbol) + '</div><div class="legenda-body">' +
      (t0.opis ? '<div class="legenda-row"><span>Przeznaczenie</span><strong>' + esc(t0.opis) + '</strong></div>' : '') + punkty(t0.ustalenia);
    ms.tereny.slice(1).forEach(function (t) {
      h += '<details class="ust-teren"><summary><strong>' + esc(t.symbol) + '</strong> - ' + esc(t.opis || '') + ' (także na działce)</summary>' + punkty(t.ustalenia) + '</details>';
    });
    h += '<p class="ust-uwaga">Tekst ustaleń z geoportalu MeSIP' + (pl.uchwala ? ' (uchwała ' + esc(pl.uchwala) + (pl.z_dnia ? ' z ' + esc(pl.z_dnia) : '') + ')' : '') +
      '. Wymiary, linie zabudowy i ustalenia ogólne planu sprawdź w pełnym tekście uchwały i na rysunku. <a href="' + esc(ms.portal) + '" target="_blank" rel="noopener">Geoportal MeSIP →</a></p></div>';
    box.innerHTML = h;
  }
  function normSymbol(s) { return String(s || '').toUpperCase().replace(/[\s.]/g, ''); }
  function rysujUstalenia(d, symbol) {
    var box = $('plan-ustalenia'); if (!box || !d || !d.tereny) return;
    var sym = normSymbol(symbol);
    var t = sym ? d.tereny.filter(function (x) { return normSymbol(x.symbol) === sym; })[0] : null;
    if (!t && sym) t = d.tereny.filter(function (x) { var n = normSymbol(x.symbol); return n && (n.indexOf(sym) > -1 || sym.indexOf(n) > -1); })[0];
    var bezPauz = function (t) { return String(t).replace(/[\u2013\u2014]/g, '-'); };
    var wiersz = function (k, v) { return v ? '<div class="legenda-row"><span>' + k + '</span><strong>' + esc(bezPauz(v)) + '</strong></div>' : ''; };
    var karta = function (x) {
      return wiersz('Przeznaczenie', x.przeznaczenie) + wiersz('Dopuszczalne', x.dopuszczalne) + wiersz('Wysokość', x.wysokosc) +
        wiersz('Powierzchnia zabudowy', x.powierzchnia_zabudowy) + wiersz('Biologicznie czynna', x.biologicznie_czynna) +
        wiersz('Intensywność', x.intensywnosc) + wiersz('Dach', x.dach) + wiersz('Min. działka', x.min_dzialka) +
        wiersz('Linie zabudowy', x.linie_zabudowy) + wiersz('Parkowanie', x.parkowanie) +
        (x.inne && x.inne.length ? '<ul class="ust-inne">' + x.inne.map(function (i) { return '<li>' + esc(bezPauz(i)) + '</li>'; }).join('') + '</ul>' : '');
    };
    var h = '<div class="legenda-title">Zapisy planu miejscowego' + (t ? ' dla terenu ' + esc(t.symbol) : '') + '</div><div class="legenda-body">';
    if (t) h += karta(t) + (t.paragraf ? '<p class="mapbox-cap">Źródło: ' + esc(t.paragraf) + ' uchwały' + (d.plan && d.plan.uchwala ? ' ' + esc(d.plan.uchwala) : '') + '.</p>' : '');
    else h += '<p class="mapbox-cap">' + (sym ? 'Nie znaleźliśmy w uchwale terenu ' + esc(symbol) + '.' : 'Usługa krajowa nie podała symbolu terenu działki - odczytaj go z rysunku planu (mapa w sekcji 04), a zapisy znajdziesz poniżej.') + '</p>';
    var inne = d.tereny.filter(function (x) { return x !== t; });
    if (inne.length) h += '<details class="ust-wszystkie"><summary>' + (t ? 'Pozostałe tereny w planie' : 'Tereny w planie') + ' (' + inne.length + ')</summary>' +
      inne.map(function (x) { return '<details class="ust-teren"><summary><strong>' + esc(x.symbol) + '</strong> - ' + esc(bezPauz(x.przeznaczenie || '')) + '</summary>' + karta(x) + '</details>'; }).join('') + '</details>';
    if (d.plan && d.plan.ustalenia_ogolne && d.plan.ustalenia_ogolne.length) h += '<details class="ust-wszystkie"><summary>Ustalenia ogólne planu</summary><ul class="ust-inne">' +
      d.plan.ustalenia_ogolne.map(function (i) { return '<li>' + esc(bezPauz(i)) + '</li>'; }).join('') + '</ul></details>';
    h += '<p class="ust-uwaga">Zapisy odczytane automatycznie z treści uchwały (AI). Przed decyzją zakupową potwierdź je w wypisie i wyrysie z planu z urzędu gminy.' +
      (d.zrodlo && d.zrodlo.pdf ? ' <a href="' + esc(d.zrodlo.pdf) + '" target="_blank" rel="noopener">Treść uchwały →</a>' : '') + '</p></div>';
    box.innerHTML = h;
  }

  // Wynik analizy sieci - pod mapa uzbrojenia (sekcja 07), bez dublowania mapy
  function rysujMedia(w) {
    var box = $('media-wynik'); if (!box) return;
    if (w.blad) { box.innerHTML = bladSekcji('Usługa uzbrojenia terenu (KIUT) nie odpowiedziała.', w); return; }
    if (w.niedostepne) {
      box.innerHTML = '<div class="media-naglowek">Jak czytać mapę sieci</div>' +
        ocena('uwaga', 'Oceń przebieg sieci na mapie powyżej', 'Serwer tego powiatu pozwala wyświetlić sieci, ale nie udostępnia ich do automatycznej analizy. Zwróć uwagę na trzy rzeczy:') +
        ocena('minus', 'Sieć przechodzi przez działkę', 'Zwykle wymaga służebności przesyłu lub przełożenia; w pasie sieci nie wolno budować.') +
        ocena('minus', 'Sieć biegnie tuż przy granicy', 'Linia napowietrzna średniego napięcia ma strefę ok. 7,5 m od osi, 110 kV - ok. 20 m; gazociąg ma strefę kontrolowaną. Strefa może wchodzić na działkę.') +
        ocena('plus', 'Sieci w drodze przy działce', 'Woda, kanalizacja, prąd i gaz w ulicy obok działki (do ok. 50 m) ułatwiają przyłączenie.');
      return;
    }
    if (w.brakDanych) { box.innerHTML = ocena('uwaga', 'Brak danych o sieciach dla tego terenu', 'Powiat nie przekazuje danych GESUT do usługi krajowej (lub w promieniu ' + w.bufor + ' m nie ma zinwentaryzowanych sieci). Dostępność mediów sprawdź u gestorów.'); return; }
    var h = '', zasieg = [];
    SIECI.forEach(function (s) {
      var x = w.sieci[s.klucz], st = STREFY_SIECI[s.klucz];
      if (x.przez) h += ocena('minus', 'Sieć ' + s.nazwa + ' przechodzi przez działkę', SKUTEK_SIECI[s.klucz]);
      else if (x.minOdl !== null && st && x.minOdl <= st.strefa) h += ocena('minus', 'Sieć ' + s.nazwa + ' ok. ' + odl(x.minOdl) + ' od granicy działki', st.opis);
      else if (x.minOdl !== null && st && st.dalej && x.minOdl <= st.dalej) h += ocena('uwaga', 'Sieć ' + s.nazwa + ' ok. ' + odl(x.minOdl) + ' od granicy działki', st.opisDalej);
      else if (x.minOdl !== null && x.minOdl <= 50 && /woda|kanal|gaz|elektro/.test(s.klucz)) zasieg.push(s.nazwa + ' ok. ' + odl(x.minOdl));
    });
    if (zasieg.length) h += ocena('plus', 'Media w zasięgu przyłącza (do 50 m od działki)', zasieg.join(' · '));
    if (!h) h = ocena('uwaga', 'Brak sieci w promieniu 50 m od działki', 'Przyłączenie może wymagać rozbudowy sieci.');
    box.innerHTML = '<div class="media-naglowek">Analiza przebiegu sieci względem granic działki</div>' + h;
  }

  function rysujOtoczenie(w) {
    if (w.blad) { $('droga-wynik').innerHTML = bladSekcji('Serwer OpenStreetMap nie odpowiedział.', w); return; }
    var nazwyDrog = { motorway: 'autostrada', trunk: 'droga ekspresowa', primary: 'droga główna', secondary: 'droga wojewódzka/powiatowa', tertiary: 'droga lokalna',
      unclassified: 'droga lokalna', residential: 'ulica osiedlowa', living_street: 'strefa zamieszkania', service: 'droga dojazdowa/wewnętrzna', track: 'droga gruntowa' };
    var h = '';
    if (w.drogi.length) {
      var d = w.drogi[0];
      var publ = !/^(service|track)$/.test(d.typ);
      h += ocena(publ ? 'plus' : 'uwaga', 'Przy granicy działki: ' + (nazwyDrog[d.typ] || d.typ) + (d.nazwa ? ' - ' + d.nazwa : ''),
        (d.nawierzchnia ? 'nawierzchnia: ' + d.nawierzchnia + ' · ' : '') + (w.drogi.length > 1 ? 'dróg przy działce: ' + w.drogi.length + ' · ' : '') + 'status drogi potwierdź w gminie');
    }
    var drEG = w.egib && w.egib.sprawdzone && w.egib.drogowe.length;
    var osmPubl = w.drogi.some(function (x) { return !/^(service|track)$/.test(x.typ); });
    if (!w.drogi.length) h += ocena(drEG ? 'uwaga' : 'minus', 'Brak drogi przy granicy działki (wg OpenStreetMap)',
      drEG ? 'Działka drogowa jest w ewidencji, ale na mapie nie ma drogi - może być nieurządzona (np. gruntowa).' : 'Sprawdź dostęp do drogi publicznej - bezpośredni lub przez służebność.');
    if (w.egib && w.egib.sprawdzone) {
      if (drEG) h += ocena('plus', 'W ewidencji gruntów działka graniczy z działką drogową (dr)', w.egib.drogowe.filter(function (x) { return /^\d/.test(x); }).join(', ') || 'użytek „dr” przy granicy działki');
      else h += ocena(osmPubl ? 'uwaga' : 'minus', 'W ewidencji brak działki drogowej (dr) przy granicach działki',
        osmPubl ? 'Ulica z mapy może leżeć na działce o innym użytku - upewnij się w gminie, że to droga publiczna.' : 'Dojazd do weryfikacji - służebność drogowa lub udział w drodze wewnętrznej (księga wieczysta, dział III).');
    }
    $('droga-wynik').innerHTML = h;
    var kat = [['szkola', 'Szkoła'], ['przedszkole', 'Przedszkole'], ['sklep', 'Sklep spożywczy'], ['przystanek', 'Przystanek autobusowy'], ['kolej', 'Kolej / tramwaj'], ['zdrowie', 'Apteka / przychodnia']];
    $('otoczenie-grid').innerHTML = kat.map(function (k) {
      var l = w.poi[k[0]];
      return '<div class="ot-item"><div class="ot-k">' + k[1] + '</div><div class="ot-v">' + (l.length ? odl(l[0].odl) : '> 1,5 km') + '</div><div class="ot-n">' +
        (l.length ? esc(l[0].nazwa || 'najbliższy') + (l.length > 1 ? ' · w promieniu: ' + l.length : '') : 'brak w promieniu 1,5 km') + '</div></div>';
    }).join('');
  }

  function rysujPozwolenia(w) {
    var el = $('pozwolenia-wynik'); if (!el) return;
    var linkRWDZ = '<a href="' + URL_RWDZ + '" target="_blank" rel="noopener">wyszukiwarce GUNB</a>';
    if (w.blad) { el.innerHTML = bladSekcji('Nasz serwer nie odpowiedział.', w); return; }
    if (w.stan !== 'ok') { el.innerHTML = ocena('uwaga', 'Rejestr pozwoleń dla tego województwa jeszcze uzupełniamy', 'Na razie pozwolenia w okolicy sprawdzisz w wyszukiwarce GUNB (po adresie lub numerze działki).') + '<p class="mapbox-cap" style="margin-top:.6rem;">Wyszukiwarka rejestru RWDZ: <a href="' + URL_RWDZ + '" target="_blank" rel="noopener">wyszukiwarka.gunb.gov.pl</a></p>'; return; }
    var lista = w.lista || [];
    var nowe = lista.filter(function (x) { return x.rodzaj === 0; });
    var ile = function (g) { return nowe.filter(function (x) { return grupaPozw(x.kategoria) === g; }).length; };
    var od = dataPL(w.od).slice(3);
    var karta = function (l, v, n) { return '<div class="scard"><div class="scard-top"><span class="scard-l">' + l + '</span></div><div class="scard-v">' + v + '</div><div class="scard-note">' + n + '</div></div>'; };
    var h = '<div class="status-grid pozw-karty">' +
      karta('Domy jednorodzinne', ile('dom'), 'nowe budynki od ' + od) +
      karta('Budynki wielorodzinne', ile('mieszk'), 'nowe budynki od ' + od) +
      karta('Usługi i handel', ile('uslugi'), 'nowe budynki od ' + od) +
      karta('Przemysł i magazyny', ile('przem'), 'nowe budynki od ' + od) + '</div>';
    var wlasne = lista.filter(function (x) { return x.wlasna; });
    if (wlasne.length) h += ocena('uwaga', 'Dla tej działki jest sprawa w rejestrze pozwoleń', wielka(wlasne[0].opis) + ' · ' + (wlasne[0].data_decyzji ? 'decyzja z ' + dataPL(wlasne[0].data_decyzji) : 'wniosek z ' + dataPL(wlasne[0].data_wniosku)));
    if (!lista.length) h += ocena('uwaga', 'Brak pozwoleń na budowę w promieniu 1 km od ' + od, 'Okolica w ostatnich latach się nie zabudowywała albo urząd nie przekazał danych do rejestru GUNB.');
    else {
      lista.forEach(function (x, i) { x._nr = i + 1; });   // lista jest posortowana od najblizszej
      h += '<div class="pozw-uklad">' + mapkaPozwolen(lista, w.promien || 1000) + '<div class="pozw-lista-box">';
      var wazne = lista.filter(function (x) { return x.rodzaj <= 3; });
      var reszta = lista.filter(function (x) { return x.rodzaj > 3; });
      var wiersz = function (x) {
        var g = grupaPozw(x.kategoria);
        var dt = x.data_decyzji ? dataPL(x.data_decyzji) : 'wniosek ' + dataPL(x.data_wniosku);
        var gdzie = [x.ulica, x.inwestor].filter(Boolean).map(esc).join(' · ');
        return '<li class="pozw-' + g + (x.wlasna ? ' pozw-wlasna' : '') + '"><span class="pozw-odl">' + (x.rodzaj <= 3 ? '<b class="pozw-nr pz-' + g + '">' + x._nr + '</b>' : '') + (x.wlasna ? 'ta działka' : odl(x.odl)) + '</span>' +
          '<div><strong>' + esc(wielka(x.opis || (GRUPY_POZW[g] ? GRUPY_POZW[g].n : 'obiekt budowlany'))) + '</strong>' +
          '<small>' + (GRUPY_POZW[g] ? GRUPY_POZW[g].n : 'inne') + ' · ' + RODZAJ_POZW[x.rodzaj] + ' · ' + dt + (x.kubatura ? ' · ' + m(x.kubatura) + ' m³' : '') + (gdzie ? '<br>' + gdzie : '') + '</small></div></li>';
      };
      var pierwsze = wazne.slice(0, 5);   // 5 najblizszych - lista na wysokosc mapy, reszta rozwijana
      h += '<ul class="pozw-lista">' + (pierwsze.length ? pierwsze.map(wiersz).join('') : '<li class="pozw-pusto">brak nowych budynków i rozbudów - tylko przebudowy i roboty wewnątrz budynków</li>') + '</ul>';
      var dalsze = wazne.slice(5).concat(reszta);
      if (dalsze.length) h += '<details class="pozw-wiecej"><summary>Pokaż pozostałe (' + dalsze.length + ')' + (reszta.length ? ' - w tym przebudowy i instalacje' : '') + '</summary><ul class="pozw-lista">' + dalsze.map(wiersz).join('') + '</ul></details>';
      h += '</div></div>';
    }
    h += '<p class="mapbox-cap" style="margin-top:.75rem;">Pozwolenia na budowę z rejestru GUNB (RWDZ) w promieniu ' + odl(w.promien || 1000) + ', wnioski i decyzje od ' + od + ' · bez sieci uzbrojenia i rozbiórek' +
      (w.aktualnosc ? ' · stan rejestru: ' + dataPL(w.aktualnosc.slice(0, 10)) : '') + (w.bez_polozenia ? ' · ' + w.bez_polozenia + ' spraw bez ustalonego położenia' : '') + ' · szczegóły sprawy w ' + linkRWDZ + '</p>';
    el.innerHTML = h;
  }

  // Mapa polozenia pozwolen: ortofotomapa (GUGiK) 2 x 2 km, obrys dzialki, ponumerowane punkty (numery jak na liscie)
  function mapkaPozwolen(lista, R) {
    var s = geo.srodek, S = 560;
    var dLon = R * 1.08 / (111320 * Math.cos(s[1] * Math.PI / 180)), dLat = R * 1.08 / 110574;
    var bb = [s[0] - dLon, s[1] - dLat, s[0] + dLon, s[1] + dLat];
    var X = function (lon) { return (lon - bb[0]) / (bb[2] - bb[0]) * S; }, Y = function (lat) { return (bb[3] - lat) / (bb[3] - bb[1]) * S; };
    var orto = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=900&HEIGHT=900&BBOX=' + bb.map(function (v) { return v.toFixed(6); }).join(',');
    var c = S / 2, r1 = R / (R * 1.08) * S / 2;
    var obrys = geo.pier.map(function (r) { return 'M' + r.map(function (p) { return X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join('L') + 'Z'; }).join('');
    var pkt = lista.slice().reverse().map(function (x) {
      var cx = X(x.lon).toFixed(1), cy = Y(x.lat).toFixed(1), g = grupaPozw(x.kategoria);
      var tyt = '<title>' + esc((x._nr ? x._nr + '. ' : '') + wielka(x.opis || '') + ' - ' + odl(x.odl)) + '</title>';
      if (x.rodzaj > 3) return '<circle class="pz-' + g + ' pz-drobne" cx="' + cx + '" cy="' + cy + '" r="3.5">' + tyt + '</circle>';
      return '<g class="pz-pin">' + tyt + '<circle class="pz-' + g + '" cx="' + cx + '" cy="' + cy + '" r="9"/><text x="' + cx + '" y="' + (+cy + 3.5).toFixed(1) + '">' + x._nr + '</text></g>';
    }).join('');
    var leg = [['dom', 'domy'], ['mieszk', 'wielorodzinne'], ['uslugi', 'usługi'], ['przem', 'przemysł'], ['infra', 'infrastruktura']];
    return '<figure class="pozw-mapka"><svg viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-label="Położenie pozwoleń na budowę na ortofotomapie">' +
      '<image href="' + orto + '" x="0" y="0" width="' + S + '" height="' + S + '" preserveAspectRatio="none"/>' +
      '<rect class="pz-przyciemn" x="0" y="0" width="' + S + '" height="' + S + '"/>' +
      '<circle class="pz-krag" cx="' + c + '" cy="' + c + '" r="' + r1.toFixed(1) + '"/><circle class="pz-krag" cx="' + c + '" cy="' + c + '" r="' + (r1 / 2).toFixed(1) + '"/>' +
      '<text class="pz-opis" x="' + c + '" y="' + (c - r1 / 2 - 4).toFixed(1) + '">500 m</text><text class="pz-opis" x="' + c + '" y="' + (c - r1 - 4).toFixed(1) + '">1 km</text>' +
      '<path class="pz-dzialka" d="' + obrys + '"/>' + pkt +
      '<text class="pz-opis pz-n" x="' + (S - 12) + '" y="20">N ↑</text></svg>' +
      '<figcaption>' + leg.map(function (l) { return '<span><i class="pz-' + l[0] + '"></i>' + l[1] + '</span>'; }).join('') +
      '<span class="pz-zrodlo">numery jak na liście · małe kropki: przebudowy i instalacje · tło: ortofotomapa GUGiK</span></figcaption></figure>';
  }

  function rysujListeKontrolna() {
    var el = $('lista-kontrolna'); if (!el) return;
    el.innerHTML = pozycjeListy().map(function (p) { return '<li class="' + (p.w ? 'wazne' : '') + '"><div><strong>' + esc(p.t) + '</strong><small>' + esc(p.o) + '</small></div></li>'; }).join('');
  }

  // Pozycje listy kontrolnej (te same na stronie i w PDF). w = wazne dla tej dzialki
  function pozycjeListy() {
    var d = (stan.dzialka && stan.dzialka.data) || {};
    var planJest = stan.mpzp && stan.mpzp.status === 'jest';
    var pozycje = [];
    var dod = function (tytul, opis, wazne) { pozycje.push({ t: tytul, o: opis, w: !!wazne }); };
    if (planJest) dod('Wypis i wyrys z MPZP', 'Zamów w urzędzie gminy - potwierdza przeznaczenie, wskaźniki zabudowy, linie zabudowy i wysokość budynków.', true);
    else dod('Decyzja o warunkach zabudowy (WZ)', 'Zapytaj właściciela, czy ma ważną decyzję WZ i dla jakiej inwestycji. Jeśli nie - sprawdź w gminie, czy WZ jest możliwe (sąsiedztwo, dostęp do drogi, media, plan ogólny).', true);
    dod('Księga wieczysta', 'Sprawdź dział II (właściciel), III (służebności, roszczenia, ograniczenia) i IV (hipoteki) w Elektronicznych Księgach Wieczystych.', true);
    dod('Wypis z rejestru gruntów i mapa ewidencyjna', 'Potwierdzi powierzchnię, użytki i klasy gleb, a także przebieg granic.');
    var kolizja = stan.media && stan.media.sieci && SIECI.some(function (s) { return stan.media.sieci[s.klucz].przez; });
    dod('Warunki przyłączenia mediów', 'Wystąp do gestorów (prąd, woda, kanalizacja, gaz) o warunki techniczne - potwierdzą możliwość i koszt przyłączenia.' + (kolizja ? ' Zapytaj też o strefy ochronne i możliwość przełożenia sieci przechodzącej przez działkę.' : ''), kolizja);
    var bezDrogi = stan.otoczenie && !stan.otoczenie.blad && !stan.otoczenie.drogi.filter(function (x) { return !/^(service|track)$/.test(x.typ); }).length;
    dod('Dostęp do drogi publicznej', 'Bezpośredni zjazd z drogi publicznej albo służebność drogowa ustanowiona aktem notarialnym.' + (bezDrogi ? ' Model nie znalazł drogi publicznej przy granicy działki.' : ''), bezDrogi);
    if (stan.uzytki && stan.uzytki.opis && stan.uzytki.opis.some(function (o) { return o.wysokaKlasa || o.kat === 'lesne'; }))
      dod('Wyłączenie gruntu z produkcji rolnej / leśnej', 'Dla gruntów klas I-III i gruntów leśnych potrzebna jest zgoda i opłaty - sprawdź w starostwie.', true);
    if (d.powierzchnia && d.powierzchnia >= 10000)
      dod('Decyzja o środowiskowych uwarunkowaniach (DUŚ)', 'Przy większych inwestycjach (m.in. zabudowa mieszkaniowa na dużej powierzchni, zwłaszcza na obszarach chronionych) może być wymagana - progi zależą od powierzchni zabudowy i formy ochrony terenu.');
    dod('Osuwiska i warunki gruntowe', 'Sprawdź System Osłony Przeciwosuwiskowej (PIG-PIB) i zleć badania geotechniczne przed projektem.');
    dod('Ochrona konserwatorska', 'Zapytaj w gminie, czy działka nie jest w gminnej ewidencji zabytków lub strefie ochrony konserwatorskiej (zapisy także w MPZP).');
    dod('Stan faktyczny na miejscu', 'Wizja lokalna: ogrodzenia, zadrzewienia, rowy, słupy, sąsiedztwo uciążliwych obiektów.');
    return pozycje;
  }

  // =====================================================================
  // 7. LISTA KONTROLNA DO PDF
  //    pdfmake (czcionka Roboto z polskimi znakami) ladowany dopiero po kliknieciu.
  //    Gdy CDN nie odpowie - otwieramy wersje do druku (Drukuj -> Zapisz jako PDF).
  // =====================================================================
  var PDFMAKE = [
    ['https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js', 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js']
  ];
  function zaladujSkrypt(src) {
    return new Promise(function (ok, nie) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { nie(new Error('nie załadowano ' + src)); };
      document.head.appendChild(s);
    });
  }
  function zaladujPdfmake(idx) {
    idx = idx || 0;
    if (window.pdfMake && window.pdfMake.vfs) return Promise.resolve(window.pdfMake);
    if (idx >= PDFMAKE.length) return Promise.reject(new Error('brak biblioteki PDF'));
    return zaladujSkrypt(PDFMAKE[idx][0]).then(function () { return zaladujSkrypt(PDFMAKE[idx][1]); })
      .then(function () { if (!window.pdfMake || !window.pdfMake.vfs) throw new Error('pdfmake niekompletny'); return window.pdfMake; })
      .catch(function () { return zaladujPdfmake(idx + 1); });
  }
  function daneNaglowka() {
    var d = (stan.dzialka && stan.dzialka.data) || {};
    var id = (stan.dzialka && stan.dzialka.id) || '';
    return {
      id: id,
      nr: d.parcel || (id ? id.split('.').pop() : ''),
      lok: [d.commune ? 'gm. ' + d.commune : '', d.county || '', d.voivodeship ? 'woj. ' + d.voivodeship : ''].filter(Boolean).join(', '),
      pow: d.powierzchnia ? m(d.powierzchnia) + ' m²' : '',
      data: new Date().toLocaleDateString('pl-PL'),
      wynik: $('werdykt-gora') ? $('werdykt-gora').querySelector('[data-w="punkty"]').textContent : '',
      werdykt: $('werdykt-gora') ? $('werdykt-gora').querySelector('[data-w="tytul"]').textContent : ''
    };
  }
  function pobierzListePDF() {
    if (!stan.dzialka) { alertInfo('Najpierw wygeneruj raport dla działki.'); return; }
    var btn = $('btn-lista-pdf');
    var info = $('pdf-info');
    if (btn) btn.disabled = true;
    if (info) info.textContent = 'Przygotowujemy PDF…';
    var n = daneNaglowka(), poz = pozycjeListy();
    zaladujPdfmake().then(function (pdfMake) {
      var ZLOTO = '#b08d3e';
      var tresc = [
        { columns: [
          { text: [{ text: 'gruntowo', bold: true, color: '#0b0c0a' }, { text: '.pl', color: ZLOTO, bold: true }], fontSize: 16 },
          { text: 'Raport rozszerzony · ' + n.data, alignment: 'right', fontSize: 8, color: '#777', margin: [0, 5, 0, 0] }
        ] },
        { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1, lineColor: ZLOTO }] },
        { text: 'Lista kontrolna przed zakupem działki', fontSize: 20, bold: true, margin: [0, 16, 0, 4] },
        { text: 'Działka nr ' + n.nr + (n.lok ? ' · ' + n.lok : ''), fontSize: 10, color: '#333' },
        { text: 'Identyfikator: ' + n.id + (n.pow ? ' · powierzchnia: ' + n.pow : ''), fontSize: 9, color: '#666', margin: [0, 2, 0, 0] }
      ];
      if (n.wynik && n.wynik !== '-') {
        tresc.push({ table: { widths: ['auto', '*'], body: [[
          { text: n.wynik + '/100', bold: true, fontSize: 14, color: ZLOTO, margin: [6, 4, 6, 4] },
          { text: 'Werdykt modelu: ' + n.werdykt, fontSize: 10, margin: [4, 7, 4, 4] }
        ]] }, layout: { hLineColor: function () { return '#e2d6bb'; }, vLineColor: function () { return '#e2d6bb'; } }, margin: [0, 12, 0, 4] });
      }
      tresc.push({ text: 'Zaznacz punkty po sprawdzeniu. Pozycje oznaczone „WAŻNE” wynikają z analizy tej działki.', fontSize: 9, color: '#666', margin: [0, 12, 0, 8] });
      poz.forEach(function (p, i) {
        tresc.push({
          columns: [
            { width: 18, canvas: [{ type: 'rect', x: 0, y: 1, w: 11, h: 11, r: 2, lineWidth: 1.2, lineColor: ZLOTO }] },
            { width: '*', stack: [
              { text: [{ text: (i + 1) + '. ' + p.t, bold: true }, p.w ? { text: '   WAŻNE', bold: true, color: '#c0612b', fontSize: 8 } : ''], fontSize: 11 },
              { text: p.o, fontSize: 9, color: '#444', margin: [0, 2, 0, 0] },
              { text: 'Notatki: ............................................................................................................................................', fontSize: 8, color: '#aaa', margin: [0, 5, 0, 0] }
            ] }
          ],
          margin: [0, 6, 0, 6], unbreakable: true
        });
      });
      tresc.push({ text: 'Lista przygotowana automatycznie na podstawie danych z rejestrów publicznych (GUGiK, ISOK, GDOŚ, OpenStreetMap). Nie zastępuje wypisu z MPZP, decyzji WZ, odpisu księgi wieczystej ani porady prawnej. gruntowo.pl', fontSize: 7.5, color: '#888', margin: [0, 14, 0, 0] });
      var dok = {
        pageSize: 'A4', pageMargins: [40, 40, 40, 50],
        defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1a1a1a' },
        info: { title: 'Lista kontrolna - działka ' + n.nr, author: 'gruntowo.pl' },
        footer: function (str, ile) { return { text: 'gruntowo.pl · lista kontrolna · strona ' + str + ' z ' + ile, alignment: 'center', fontSize: 7, color: '#999', margin: [0, 20, 0, 0] }; },
        content: tresc
      };
      var nazwa = 'lista-kontrolna-dzialka-' + String(n.nr || 'gruntowo').replace(/[^\w\-]+/g, '_') + '.pdf';
      pdfMake.createPdf(dok).download(nazwa);
      if (info) info.textContent = 'Gotowe - plik ' + nazwa + ' zapisany w Pobranych.';
    }).catch(function (e) {
      console.warn('PDF:', e);
      if (info) info.textContent = 'Otwieramy wersję do druku - wybierz „Zapisz jako PDF”.';
      listaDoDruku(n, poz);
    }).then(function () { if (btn) btn.disabled = false; });
  }
  function alertInfo(t) { var info = $('pdf-info'); if (info) info.textContent = t; }
  // Zapas: okno z lista do druku (przegladarka zapisze je jako PDF)
  function listaDoDruku(n, poz) {
    var w = window.open('', '_blank');
    if (!w) { alertInfo('Przeglądarka zablokowała nowe okno - zezwól na wyskakujące okna dla tej strony.'); return; }
    var html = '<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Lista kontrolna - działka ' + esc(n.nr) + '</title>' +
      '<style>body{font-family:Arial,sans-serif;margin:32px;color:#1a1a1a}h1{font-size:22px;margin:14px 0 4px}.m{color:#666;font-size:12px}' +
      'li{list-style:none;margin:12px 0;padding-left:26px;position:relative;font-size:14px}li:before{content:"";position:absolute;left:0;top:2px;width:13px;height:13px;border:1.5px solid #b08d3e;border-radius:2px}' +
      'small{display:block;color:#444;font-size:12px;margin-top:2px}.w{color:#c0612b;font-size:10px;font-weight:bold;margin-left:6px}ul{padding:0}.s{font-size:10px;color:#888;margin-top:20px}</style></head><body>' +
      '<div><b>gruntowo</b><b style="color:#b08d3e">.pl</b></div><h1>Lista kontrolna przed zakupem działki</h1>' +
      '<div class="m">Działka nr ' + esc(n.nr) + (n.lok ? ' · ' + esc(n.lok) : '') + '<br>Identyfikator: ' + esc(n.id) + ' · ' + esc(n.data) + '</div><ul>' +
      poz.map(function (p) { return '<li><b>' + esc(p.t) + '</b>' + (p.w ? '<span class="w">WAŻNE</span>' : '') + '<small>' + esc(p.o) + '</small></li>'; }).join('') +
      '</ul><div class="s">Lista przygotowana automatycznie na podstawie danych z rejestrów publicznych. Nie zastępuje wypisu z MPZP, decyzji WZ ani odpisu księgi wieczystej.</div></body></html>';
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
  }
  // "Pobierz caly raport (PDF)" w werdykcie koncowym - ten sam wydruk co przycisk u gory
  document.addEventListener('click', function (e) {
    var r = e.target.closest && e.target.closest('[data-pdf-raport]');
    if (r) { e.preventDefault(); if (window.gruntowoDrukuj) window.gruntowoDrukuj(); else window.print(); }
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#btn-lista-pdf, [data-pdf-lista]');
    if (!t) return;
    e.preventDefault();
    pobierzListePDF();
  });
})();
