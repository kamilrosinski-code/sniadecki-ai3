(function () {
  'use strict';

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
  const mapLabel = document.getElementById('map-label');
  const mapFrame = document.getElementById('map-frame');
  const mapStatic = document.getElementById('map-static');

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const miasto = document.getElementById('s-miasto').value.trim();
      const dzialka = document.getElementById('s-dzialka').value.trim();

      if (!miasto) { flash(document.getElementById('s-miasto')); return; }
      if (!dzialka) { flash(document.getElementById('s-dzialka')); return; }

      if (mapLabel) mapLabel.textContent = miasto.toUpperCase() + ' · DZ. ' + dzialka.toUpperCase();

      // Google Maps embed — działa bez klucza API
      if (mapFrame) {
        const q = encodeURIComponent(miasto + ', Polska');
        mapFrame.src = 'https://www.google.com/maps?q=' + q + '&output=embed&z=15';
        mapFrame.style.display = 'block';
        if (mapStatic) mapStatic.style.display = 'none';
      }

      step1.classList.add('hidden');
      step2.classList.remove('hidden');
    });
  }

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      step2.classList.add('hidden');
      step1.classList.remove('hidden');
    });
  }

  // ⬇️ TU WKLEJ LINK do Web App z Apps Script (patrz INSTRUKCJA-FORMULARZ.txt)
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwJCb2gsKvHg0LyAzu7Uu0jystGynPn6nb2lB-qWCgfZk9rSvLTss2ONLVnwcqdqw-i/exec';

  if (btnSubmit) {
    btnSubmit.addEventListener('click', () => {
      const email = document.getElementById('s-email').value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        flash(document.getElementById('s-email'));
        return;
      }

      const miasto = document.getElementById('s-miasto').value.trim();
      const dzialka = document.getElementById('s-dzialka').value.trim();
      const telefon = document.getElementById('s-telefon') ? document.getElementById('s-telefon').value.trim() : '';

      // Pokaż potwierdzenie od razu (nie każemy czekać użytkownikowi)
      step2.classList.add('hidden');
      step3.classList.remove('hidden');

      // Zapisz dane do arkusza Google (w tle)
      if (FORM_ENDPOINT && FORM_ENDPOINT !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT') {
        const dane = new FormData();
        dane.append('miejscowosc', miasto);
        dane.append('dzialka', dzialka);
        dane.append('email', email);
        dane.append('telefon', telefon);
        dane.append('data', new Date().toLocaleString('pl-PL'));

        fetch(FORM_ENDPOINT, { method: 'POST', body: dane })
          .catch(function (e) { console.warn('Zapis do arkusza nieudany:', e); });
      }
    });
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

  // ⬇️ TU WKLEJ LINK CSV z Google Sheets (Plik → Udostępnij → Opublikuj w internecie → CSV)
  const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbR8JiZTcGO4fTshrnGgqZhSr3BYEi8hCEcb2EKr2CfcsO6xlwaEkTbH1F9xt015D-jf_0iPnMfTvM/pub?gid=0&single=true&output=csv';

  // Jeśli link nie został jeszcze ustawiony — nie rób nic (strona pokaże domyślne teksty z HTML)
  if (!SHEET_CSV_URL || SHEET_CSV_URL === 'WKLEJ_TUTAJ_LINK_CSV') return;

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
})();
