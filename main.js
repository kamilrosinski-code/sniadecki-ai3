(function () {
  'use strict';

  // ⬇️ Link do Apps Script zapisujący zgłoszenia do Google Sheets (patrz INSTRUKCJA-FORMULARZ.txt)
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyIs7bFdclWzmjsHUbQOEfkKrA83huHCfzr3JUKXMOGyVBmDEhD9Gg0DKYB8oWNUyzM/exec';

  // ⬇️ CRM gruntowo (panel na LH) - tu trafiaja wszystkie zgloszenia ze strony
  const CRM_ENDPOINT = 'https://sniadecki-development.pl/gruntowo-api/zgloszenie.php';
  // ⬇️ Strona rezerwacji konsultacji w Zencal (zespol Kamil + Marcin). Puste = przycisk prowadzi do formularza kontaktowego.
  const ZENCAL_URL = 'https://app.zencal.io/o/gruntowo/kamilrosinski/konsultacja-z-ekspertem';
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
        '#konsult-modal input{width:100%;box-sizing:border-box;background:#1a1c17;border:1px solid #2a2c26;border-radius:8px;color:#f2f0eb;padding:.65rem .75rem;font:inherit}' +
        '#konsult-modal button[type=submit]{margin-top:1.1rem;width:100%;background:#c9a96e;color:#14181a;border:0;border-radius:8px;padding:.8rem;font-weight:600;font:inherit;cursor:pointer}' +
        '#konsult-modal .km-mapa-btn{margin-top:.5rem;background:none;border:0;color:#c9a96e;font:inherit;font-size:.8rem;text-decoration:underline;cursor:pointer;padding:0}' +
        '#konsult-modal .km-mapa{margin-top:.6rem;border:1px solid #2a2c26;border-radius:8px;overflow:hidden;flex-shrink:0}#konsult-modal .km-mapa-btn{flex-shrink:0}' +
        '#konsult-modal .km-szukaj{display:flex;gap:.4rem;padding:.4rem}#konsult-modal .km-szukaj input{flex:1;min-width:0;width:auto}' +
        '#konsult-modal .km-szukaj button{background:#c9a96e;color:#14181a;border:0;border-radius:6px;padding:0 .8rem;font:inherit;font-size:.8rem;cursor:pointer}' +
        '#konsult-modal .km-mapa-el{height:260px}#konsult-modal .km-info{margin:0;padding:.45rem .6rem;font-size:.78rem;color:#8a9a93}#konsult-modal .km-info strong{color:#dfc090}' +
        '#konsult-modal .x{position:absolute;top:.6rem;right:.8rem;background:none;border:0;color:#8a9a93;font-size:1.6rem;cursor:pointer}#konsult-modal .msg{color:#ff9a7a;font-size:.85rem;min-height:1.2em;margin-top:.5rem}';
      document.head.appendChild(st);
      m = document.createElement('div'); m.id = 'konsult-modal';
      m.innerHTML = '<form novalidate><button type="button" class="x" aria-label="Zamknij">×</button>' +
        '<div style="font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e">Konsultacja z ekspertem · 499 zł</div>' +
        '<h3>Umów konsultację</h3><p>Zostaw dane i numer działki - przygotujemy się do rozmowy. W następnym kroku wybierzesz dogodny termin w kalendarzu.</p>' +
        '<label>Imię i nazwisko</label><input name="imie" autocomplete="name" required>' +
        '<label>E-mail</label><input name="email" type="email" autocomplete="email" required>' +
        '<label>Telefon</label><input name="telefon" type="tel" autocomplete="tel">' +
        '<label>Numer działki lub adres (opcjonalnie)</label><input name="dzialka" placeholder="np. 302105_2.0009.222/8">' +
        '<button type="button" class="km-mapa-btn">Nie znasz numeru? Wskaż działkę na mapie</button>' +
        '<div class="km-mapa" hidden><div class="km-szukaj"><input type="text" placeholder="Miejscowość lub adres" autocomplete="off"><button type="button">Szukaj</button></div>' +
        '<div class="km-mapa-el"></div><p class="km-info">Wyszukaj miejscowość, przybliż mapę i kliknij w działkę.</p></div>' +
        '<input name="strona_www" tabindex="-1" autocomplete="off" style="position:absolute;left:-5000px" aria-hidden="true">' +
        '<div class="msg" role="status"></div><button type="submit">Dalej - wybierz termin →</button></form>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m || e.target.classList.contains('x')) m.style.display = 'none'; });
      // Wskazanie dzialki na mapie w okienku konsultacji (klik -> numer z ULDK do pola "dzialka")
      let kmMapa = null, kmZnacznik = null;
      m.querySelector('.km-mapa-btn').addEventListener('click', function () {
        const box = m.querySelector('.km-mapa');
        box.hidden = !box.hidden;
        if (!box.hidden) setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60);
        if (box.hidden || kmMapa) { if (kmMapa) setTimeout(function () { kmMapa.invalidateSize(); }, 50); return; }
        const el = box.querySelector('.km-mapa-el'), info = box.querySelector('.km-info'), pole = m.querySelector('input[name=dzialka]');
        if (typeof L === 'undefined') { el.innerHTML = '<p style="padding:1rem;font-size:.8rem;color:#8a9a93">Mapa chwilowo niedostępna - wpisz miejscowość i ulicę w polu powyżej.</p>'; return; }
        kmMapa = L.map(el, { center: [52.40, 16.92], zoom: 11 });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(kmMapa);
        L.tileLayer.wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow', { layers: 'dzialki,numery_dzialek', format: 'image/png', transparent: true, minZoom: 16, maxZoom: 20 }).addTo(kmMapa);
        const szukajPole = box.querySelector('.km-szukaj input');
        const szukaj = function () {
          const q = szukajPole.value.trim(); if (!q) return;
          fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'pl' } })
            .then(function (r) { return r.json(); })
            .then(function (w) { if (w && w.length) kmMapa.setView([+w[0].lat, +w[0].lon], 17); else info.textContent = 'Nie znaleźliśmy tego miejsca - wpisz samą miejscowość.'; })
            .catch(function () { info.textContent = 'Wyszukiwarka chwilowo nie działa - przesuń mapę ręcznie.'; });
        };
        box.querySelector('.km-szukaj button').addEventListener('click', szukaj);
        szukajPole.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); szukaj(); } });
        kmMapa.on('click', function (e) {
          if (kmMapa.getZoom() < 15) { kmMapa.setView(e.latlng, 17); info.textContent = 'Teraz kliknij w swoją działkę.'; return; }
          if (kmZnacznik) kmZnacznik.remove();
          kmZnacznik = L.marker(e.latlng).addTo(kmMapa);
          info.textContent = 'Ustalamy numer działki…';
          fetch(ULDK_PROXY + '?xy=' + encodeURIComponent(e.latlng.lng.toFixed(6) + ',' + e.latlng.lat.toFixed(6)))
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d && d.id) { pole.value = d.id; info.innerHTML = 'Wybrana działka: <strong>' + d.id + '</strong>'; }
              else { pole.value = e.latlng.lat.toFixed(6) + ', ' + e.latlng.lng.toFixed(6); info.textContent = 'Nie ustaliliśmy numeru - zapisaliśmy współrzędne punktu.'; }
            })
            .catch(function () { pole.value = e.latlng.lat.toFixed(6) + ', ' + e.latlng.lng.toFixed(6); info.textContent = 'Zapisaliśmy współrzędne punktu - numer ustalimy sami.'; });
        });
        setTimeout(function () { kmMapa.invalidateSize(); }, 80);
      });
      m.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        const f = e.target, msg = f.querySelector('.msg'), btn = f.querySelector('button[type=submit]');
        const v = function (n) { return f.elements[n].value.trim(); };
        if (!v('imie') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) { msg.textContent = 'Podaj imię i poprawny e-mail.'; return; }
        btn.disabled = true; btn.textContent = 'Chwilka…';
        // Kalendarz Zencal w NOWEJ karcie (otwarta od razu przy kliknieciu - inaczej przegladarka ja zablokuje);
        // gruntowo.pl zostaje w tej karcie z podziekowaniem, wiec po rezerwacji klient wraca na strone
        const okno = window.open('', '_blank');
        if (okno) { try { okno.document.title = 'Wybór terminu - gruntowo.pl'; okno.document.body.innerHTML = '<p style="font:16px sans-serif;padding:2rem">Otwieramy kalendarz…</p>'; } catch (e2) {} }
        const dz = v('dzialka'), jestId = /^\d{6}_\d\./.test(dz);
        doCRM({ zrodlo: 'konsultacja', imie: v('imie'), email: v('email'), telefon: v('telefon'),
          dzialka: jestId ? dz : '', miejscowosc: jestId ? '' : dz, temat: 'Konsultacja z ekspertem - wybór terminu w Zencal',
          strona_www: v('strona_www'), strona: location.href })
          .then(function () {   // w Zencal i tak wybiera termin, nawet gdy CRM nie odpowie
            if (!okno || okno.closed) { window.location.href = ZENCAL_URL; return; }   // blokada okien - jak dawniej
            okno.location.href = ZENCAL_URL;
            f.innerHTML = '<button type="button" class="x" aria-label="Zamknij">×</button>' +
              '<div style="font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e">Konsultacja z ekspertem · 499 zł</div>' +
              '<h3>Dziękujemy, ' + v('imie').split(' ')[0].replace(/[<>&"]/g, '') + '!</h3>' +
              '<p>Kalendarz otworzył się w nowej karcie - wybierz tam dogodny termin. Po rezerwacji możesz zamknąć tamtą kartę i wrócić tutaj.</p>' +
              '<p>Potwierdzenie spotkania przyjdzie na e-mail. Przed rozmową przygotujemy analizę Twojej działki.</p>' +
              '<a href="' + ZENCAL_URL + '" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:1rem;background:#c9a96e;color:#14181a;border-radius:8px;padding:.8rem;font-weight:600;text-decoration:none">Otwórz kalendarz ponownie</a>' +
              '<button type="button" class="km-wroc" style="display:block;width:100%;margin-top:.6rem;background:none;border:1px solid #2a2c26;border-radius:8px;color:#f2f0eb;padding:.7rem;font:inherit;cursor:pointer">Wróć na stronę</button>';
            f.querySelector('.km-wroc').addEventListener('click', function () { m.style.display = 'none'; });
          });
      });
    }
    m.style.display = 'flex';
    if (dzialka) m.querySelector('input[name=dzialka]').value = dzialka;
    setTimeout(function () { m.querySelector('input[name=imie]').focus(); }, 50);
  }
  // Wejscie z raportu (przycisk "Umow konsultacje") -> od razu okienko konsultacji z numerem dzialki
  (function () {
    const p = new URLSearchParams(location.search);
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
    if (!mysz || malo || /#szukaj|#search-box/.test(location.hash)) { wysun(); }
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
    if (film && window.innerWidth >= 900 && !oszczedza && window.fetch && window.URL) {
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
          if (wysunieta) { wymusPelna = true; }
          hero.classList.remove('hero-czeka'); hero.classList.add('hero-sterowane'); sb.classList.remove('wysuwa');
          const pokazSzukaj = function (o) {
            sb.style.opacity = o.toFixed(3);
            sb.style.transform = 'translateY(' + ((1 - o) * 46).toFixed(1) + 'px)';
            sb.style.pointerEvents = o > 0.4 ? 'auto' : 'none';
            hero.classList.toggle('szukaj-widac', o > 0.02);
          };
          const t0 = performance.now();
          const zakres = function () {
            const y0 = scena.offsetTop - gora, y1 = y0 + droga;                // hero stoi: y0..y1
            const y2 = sekcja ? Math.max(y1 + 200, sekcja.offsetTop + sekcja.offsetHeight - window.innerHeight) : y1 + window.innerHeight;
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
            cien.style.opacity = (0.2 * ps2).toFixed(3);   // tekst ma juz wlasny kafelek, wiec tlo tylko lekko przyciemnione
            warstwa.style.opacity = (1 - Math.max(0, Math.min(1, (y - z.y2) / (z.y3 - z.y2)))).toFixed(3);
            // przewijamy film tylko, gdy zmienia sie klatka, i nigdy dwa przewiniecia naraz
            const kl = Math.round(t * KL);
            if (!szuka && kl !== ostKlatka) { ostKlatka = kl; szuka = true; film.currentTime = kl / KL; }
            if (cur === cel && sw === ps && a >= 1 && !szuka) { petla = null; ostatniKrok = 0; return; }
            petla = requestAnimationFrame(krok);
          };
          const budz = function () { if (!petla) petla = requestAnimationFrame(krok); };
          // Granica pole/gleba musi isc dokladnie z przewijaniem - ustawiamy ja w TEJ SAMEJ klatce co przewiniecie
          // (zdarzenie Lenis / scroll), a nie w nastepnej klatce petli, bo wtedy przy szybkim przewijaniu robila sie szpara
          let glebaH = 0;
          function ustawGlebe() {
            const vh = window.innerHeight;
            const B = hero.getBoundingClientRect().bottom;
            if (!glebaH) glebaH = gleba.offsetHeight;
            gleba.style.opacity = B < vh ? '1' : '0';
            const ty = B >= 0 ? B : Math.max(vh - glebaH, B * 0.75);
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
          requestAnimationFrame(function () { warstwa.style.opacity = '1'; hero.classList.add('film-na-tle');
            setTimeout(function () { warstwa.classList.add('widac'); }, 950); });
          budz();
          }, Math.max(0, 1700 - performance.now()));
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
      const orto = L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution', { layers: 'Raster', format: 'image/jpeg', maxZoom: 20, attribution: 'GUGiK' });
      const dzialki = L.tileLayer.wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow', { layers: 'dzialki,numery_dzialek', format: 'image/png', transparent: true, minZoom: 16, maxZoom: 20 }).addTo(leafletMap);
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

    // Geokoduj miejscowość przez Nominatim (OpenStreetMap) - darmowe, bez klucza
    const q = encodeURIComponent(miasto + ', Polska');
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + q, {
      headers: { 'Accept-Language': 'pl' }
    })
      .then(function (r) { return r.json(); })
      .then(function (wyniki) {
        if (wyniki && wyniki.length) {
          const lat = parseFloat(wyniki[0].lat), lng = parseFloat(wyniki[0].lon);
          leafletMap.setView([lat, lng], 16);
        }
      })
      .catch(function () { /* zostaje domyślny widok */ })
      .finally(function () { leafletMap.invalidateSize(); });
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
        dane.append('wspolrzedne', wsp);
        dane.append('mapa_link', 'https://www.google.com/maps?q=' + encodeURIComponent(wsp));
        dane.append('data', new Date().toLocaleString('pl-PL'));
        fetch(FORM_ENDPOINT, { method: 'POST', body: dane }).catch(function () {});
      }
      // ...i do CRM
      doCRM({ zrodlo: 'raport_darmowy', email: email, telefon: telefon, miejscowosc: miasto, wspolrzedne: wsp,
        mapa_link: 'https://www.google.com/maps?q=' + encodeURIComponent(wsp), strona: location.href });

      // Ustal identyfikator działki z współrzędnych (przez pośrednik ULDK), potem raport
      if (ULDK_PROXY && ULDK_PROXY !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT_ULDK') {
        fetch(ULDK_PROXY + '?xy=' + encodeURIComponent(lon + ',' + lat))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.id) {
              // Mamy identyfikator - przejdź do raportu (dane już zebrane: ok=1)
              window.location.href = 'raport.html?id=' + encodeURIComponent(data.id) + '&ok=1';
            } else {
              pokazBlad(data.error || 'Nie udało się ustalić działki w tym punkcie.');
            }
          })
          .catch(function () {
            pokazBlad('Wystąpił błąd połączenia. Spróbuj ponownie za chwilę.');
          });
      } else {
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
      doCRM({
        zrodlo: 'kontakt', imie: name, email: email,
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
  } catch (e) { window.__lenis = null; }
})();
