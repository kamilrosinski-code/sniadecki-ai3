/* =========================================================
   ZGODY NA COOKIES + GOOGLE ANALYTICS 4 (gruntowo.pl)
   ---------------------------------------------------------
   - Google Analytics wlacza sie DOPIERO po zgodzie uzytkownika
     (tryb podstawowy Google Consent Mode v2 - bez zgody do Google nic nie trafia).
   - Dopoki GA_ID jest pusty, okienko zgody sie nie pokazuje (strona nie uzywa
     wtedy zadnych cookies poza niezbednymi).
   - Wybor zapisujemy w przegladarce (localStorage) na 12 miesiecy.
   - Ponowne otwarcie ustawien: link z atrybutem data-ustawienia-cookies
     albo window.gruntowoUstawieniaCookies().
   - Zdarzenia: window.gruntowoZdarzenie('nazwa', { parametry }) - bezpieczne
     takze bez zgody (wtedy nic nie wysyla).
   ========================================================= */
(function () {
  'use strict';

  // >>> WKLEJ TUTAJ IDENTYFIKATOR POMIARU GA4, np. 'G-ABC123XYZ9' <<<
  var GA_ID = 'G-Z0HCZ57414';

  var KLUCZ = 'gruntowo_zgody_v1';
  var WAZNOSC_MS = 365 * 24 * 3600 * 1000;

  function odczyt() {
    try {
      var z = JSON.parse(localStorage.getItem(KLUCZ) || 'null');
      if (z && z.data && (Date.now() - z.data) < WAZNOSC_MS) return z;
    } catch (e) {}
    return null;
  }
  function zapisz(analityka) {
    var z = { analityka: !!analityka, data: Date.now() };
    try { localStorage.setItem(KLUCZ, JSON.stringify(z)); } catch (e) {}
    return z;
  }

  // ---------- Google Analytics ----------
  var gaWlaczone = false;
  function wlaczGA() {
    if (!GA_ID || gaWlaczone) return;
    gaWlaczone = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }
  function usunCookiesGA() {
    // przy wycofaniu zgody kasujemy cookies _ga* dla tej domeny i domeny nadrzednej
    var host = location.hostname, domeny = ['', host, '.' + host];
    var czesci = host.split('.');
    if (czesci.length > 2) domeny.push('.' + czesci.slice(-2).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var nazwa = c.split('=')[0].trim();
      if (!/^_ga/.test(nazwa)) return;
      domeny.forEach(function (d) {
        document.cookie = nazwa + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  window.gruntowoZdarzenie = function (nazwa, parametry) {
    if (gaWlaczone && window.gtag) { try { window.gtag('event', nazwa, parametry || {}); } catch (e) {} }
  };

  // ---------- okienko zgody ----------
  var okno = null;
  function css() {
    if (document.getElementById('zgody-css')) return;
    var st = document.createElement('style'); st.id = 'zgody-css';
    st.textContent =
      // szklany panel pod katem (jak karty raportu na stronie glownej), prostuje sie po najechaniu
      '#zgody{position:fixed;left:16px;right:16px;bottom:18px;z-index:9999;max-width:400px;margin-left:auto;' +
      'background:linear-gradient(160deg,rgba(34,36,29,.72),rgba(16,17,14,.82));backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);' +
      'border:1px solid rgba(201,169,110,.32);border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,.5);color:#f2f0eb;' +
      'font:300 13px/1.5 Inter,system-ui,sans-serif;padding:.9rem 1.05rem .95rem;opacity:0;transform-origin:100% 100%;' +
      'transform:perspective(1100px) translate3d(60px,30px,-120px) rotateY(-28deg) rotateX(8deg);' +
      'transition:opacity .7s ease,transform 1s cubic-bezier(.2,.75,.2,1),box-shadow .8s ease}' +
      '#zgody.pokaz{opacity:1;transform:perspective(1100px) rotateY(-11deg) rotateX(4deg) rotateZ(-.8deg)}' +
      '#zgody.pokaz:hover,#zgody.pokaz:focus-within,#zgody.ustawienia{transform:none;box-shadow:0 24px 60px rgba(0,0,0,.55)}' +
      '@media (max-width:760px),(hover:none),(prefers-reduced-motion:reduce){#zgody,#zgody.pokaz{transform:none}#zgody{transition:opacity .3s}}' +
      '#zgody h3{margin:0 0 .25rem;font:500 .98rem/1.3 "Cormorant Garamond",Georgia,serif;color:#c9a96e;letter-spacing:.01em}' +
      '#zgody p{margin:0 0 .7rem;color:rgba(242,240,235,.72);font-size:.74rem;line-height:1.5}' +
      '#zgody a{color:#c9a96e}' +
      '#zgody .zg-opcje{display:none;margin:0 0 .9rem;border-top:1px solid rgba(255,255,255,.08)}' +
      '#zgody.ustawienia .zg-opcje{display:block}' +
      '#zgody .zg-op{display:flex;gap:.6rem;align-items:flex-start;padding:.55rem 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:.72rem;color:rgba(242,240,235,.78)}' +
      '#zgody .zg-op strong{display:block;color:#f2f0eb;font-weight:500}' +
      '#zgody .zg-op input{margin-top:.3rem;accent-color:#c9a96e;flex-shrink:0}' +
      '#zgody .zg-przyciski{display:flex;flex-wrap:wrap;gap:.4rem}' +
      '#zgody button{font:500 .7rem/1 Inter,system-ui,sans-serif;letter-spacing:.05em;border-radius:6px;padding:.55rem .8rem;cursor:pointer;' +
      'border:1px solid rgba(201,169,110,.45);background:transparent;color:#f2f0eb}' +
      '#zgody button.zg-tak{background:#c9a96e;border-color:#c9a96e;color:#14160f}' +
      '#zgody button:hover{border-color:#c9a96e}' +
      '@media (max-width:560px){#zgody{left:8px;right:8px;bottom:8px;max-width:none}#zgody button{flex:1 1 auto}}';
    document.head.appendChild(st);
  }
  function zamknij() { if (okno) { okno.classList.remove('pokaz'); var o = okno; setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 300); okno = null; } }
  function decyzja(analityka) {
    var bylo = odczyt();
    zapisz(analityka);
    zamknij();
    if (analityka) wlaczGA();
    else if (bylo && bylo.analityka) { usunCookiesGA(); location.reload(); }   // wycofanie zgody - przeladowanie wylacza GA
  }
  function pokaz(zUstawieniami) {
    if (!GA_ID) return;
    css();
    if (okno) zamknij();
    var z = odczyt();
    okno = document.createElement('div');
    okno.id = 'zgody';
    okno.setAttribute('role', 'dialog');
    okno.setAttribute('aria-label', 'Ustawienia cookies');
    okno.innerHTML =
      '<h3>Cookies i statystyki</h3>' +
      '<p>Za Twoją zgodą używamy Google Analytics, żeby wiedzieć, jak korzystasz ze strony i co poprawić. ' +
      'Bez zgody strona działa tak samo. Szczegóły w <a href="klauzula.html#cookies">polityce prywatności</a>.</p>' +
      '<div class="zg-opcje">' +
      '<label class="zg-op"><input type="checkbox" checked disabled><span><strong>Niezbędne</strong>Zapamiętanie Twojego wyboru i działanie strony (np. dostęp do opłaconego raportu). Zawsze włączone.</span></label>' +
      '<label class="zg-op"><input type="checkbox" id="zg-analityka"' + (z && z.analityka ? ' checked' : '') + '><span><strong>Statystyki (Google Analytics)</strong>Statystyki odwiedzin, bez Twojego imienia, e-maila i telefonu: które strony oglądasz, skąd trafiłeś na stronę, z jakiego urządzenia.</span></label>' +
      '</div>' +
      '<div class="zg-przyciski">' +
      '<button type="button" class="zg-tak">Akceptuję</button>' +
      '<button type="button" class="zg-nie">Odrzucam</button>' +
      '<button type="button" class="zg-ust">Ustawienia</button>' +
      '</div>';
    if (zUstawieniami) okno.classList.add('ustawienia');
    document.body.appendChild(okno);
    requestAnimationFrame(function () { if (okno) okno.classList.add('pokaz'); });
    okno.querySelector('.zg-tak').addEventListener('click', function () { decyzja(true); });
    okno.querySelector('.zg-nie').addEventListener('click', function () { decyzja(false); });
    okno.querySelector('.zg-ust').addEventListener('click', function () {
      if (!okno.classList.contains('ustawienia')) { okno.classList.add('ustawienia'); this.textContent = 'Zapisz wybór'; }
      else decyzja(okno.querySelector('#zg-analityka').checked);
    });
    if (zUstawieniami) okno.querySelector('.zg-ust').textContent = 'Zapisz wybór';
  }
  window.gruntowoUstawieniaCookies = function () { pokaz(true); };

  function start() {
    document.querySelectorAll('[data-ustawienia-cookies]').forEach(function (a) {
      if (!GA_ID) { a.style.display = 'none'; return; }
      a.addEventListener('click', function (e) { e.preventDefault(); pokaz(true); });
    });
    if (!GA_ID) return;
    var z = odczyt();
    if (z) { if (z.analityka) wlaczGA(); }
    else setTimeout(function () { pokaz(false); }, 900);   // chwila po wejsciu, zeby nie zaslaniac pierwszego wrazenia
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
