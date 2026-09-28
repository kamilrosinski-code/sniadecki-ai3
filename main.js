(function () {
  'use strict';

  // ⬇️ Link do Apps Script zapisujący zgłoszenia do Google Sheets (patrz INSTRUKCJA-FORMULARZ.txt)
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyIs7bFdclWzmjsHUbQOEfkKrA83huHCfzr3JUKXMOGyVBmDEhD9Gg0DKYB8oWNUyzM/exec';

  // Pośrednik ULDK — ustala identyfikator działki z współrzędnych pinezki (ten sam co w raport.js)
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
        window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
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
      mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:2rem;text-align:center;color:var(--m);font-size:.85rem;">Mapa chwilowo niedostępna. Możesz kontynuować — podaj e-mail, a my zlokalizujemy działkę po numerze i miejscowości.</div>';
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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(leafletMap);

      // Zapisuj współrzędne środka przy każdym przesunięciu mapy
      const aktualizujWsp = function () {
        const c = leafletMap.getCenter();
        aktualneWspolrzedne = { lat: c.lat, lng: c.lng };
        const hint = document.getElementById('map-coords-hint');
        if (hint) {
          hint.textContent = 'Pinezka wskazuje: ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) +
            ' — przesuń mapę, aby dostosować.';
        }
      };
      leafletMap.on('move', aktualizujWsp);
      leafletMap.on('moveend', aktualizujWsp);
      aktualizujWsp();
    } else {
      leafletMap.invalidateSize();
    }

    // Geokoduj miejscowość przez Nominatim (OpenStreetMap) — darmowe, bez klucza
    const q = encodeURIComponent(miasto + ', Polska');
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + q, {
      headers: { 'Accept-Language': 'pl' }
    })
      .then(function (r) { return r.json(); })
      .then(function (wyniki) {
        if (wyniki && wyniki.length) {
          const lat = parseFloat(wyniki[0].lat), lng = parseFloat(wyniki[0].lon);
          leafletMap.setView([lat, lng], 15);
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

      // Ustal identyfikator działki z współrzędnych (przez pośrednik ULDK), potem raport
      if (ULDK_PROXY && ULDK_PROXY !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT_ULDK') {
        fetch(ULDK_PROXY + '?xy=' + encodeURIComponent(lon + ',' + lat))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.id) {
              // Mamy identyfikator — przejdź do raportu (dane już zebrane: ok=1)
              window.location.href = 'raport.html?id=' + encodeURIComponent(data.id) + '&ok=1';
            } else {
              pokazBlad(data.error || 'Nie udało się ustalić działki w tym punkcie.');
            }
          })
          .catch(function () {
            pokazBlad('Wystąpił błąd połączenia. Spróbuj ponownie za chwilę.');
          });
      } else {
        // Brak pośrednika — pokaż komunikat zastępczy
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

      setTimeout(() => {
        showMsg(form, 'Dziękujemy! Odezwiemy się w ciągu jednego dnia roboczego.', 'success');
        form.reset();
        btn.textContent = 'Wyślij wiadomość';
        btn.disabled = false;
      }, 1100);
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
   Instrukcja publikacji arkusza — w pliku INSTRUKCJA.txt
   =========================================================== */
(function () {
  'use strict';

  // Link do arkusza BEZ gid — Google bierze wtedy pierwsza zakladke (Arkusz1),
  // niezaleznie od jej numeru. Dzieki temu link nie psuje sie przy edycji arkusza
  // (wczesniej gid zmienial sie za kazdym importem, co psulo pobieranie tresci).
  const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRs5AKabD0xvgDy2K4pm1EI9iuO8ZZrDAJOJ9M00UQGjO-3daVSSOcSOwQyh1KQpg/pub?single=true&output=csv';

  // Jeśli link nie został jeszcze ustawiony — nie rób nic (strona pokaże domyślne teksty z HTML)
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
          // Pozwól na <br> i <em> w treści z arkusza
          el.innerHTML = map[key];
        }
      });
    })
    .catch(function (e) {
      console.warn('CMS: nie udało się pobrać arkusza —', e);
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
      // Pomin formaty typu "24/7" (ukosnik) — to nie liczba do nabijania
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
      // Starsze przegladarki — animuj od razu
      staty.forEach(animuj);
    }
  }

  // Interaktywna sekcja modeli — najechanie na karte pokazuje inne zdjecie + panel analizy.
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

  // Animacja etapow konsultacji — strzalka przechodzi przez kolejne etapy.
  // Wariant B — sekcja przyklejana. Postep scrolla przez wysoki kontener (etapy-pin)
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

  // Uruchom liczniki — z opoznieniem, zeby tresci z arkusza zdazyly sie wczytac
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
