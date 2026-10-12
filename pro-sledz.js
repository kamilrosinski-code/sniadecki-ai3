/*
 * gruntowo.pl PRO - wspolne funkcje konta PRO (ladowane w pro.html, teren.html, raport.html, raport-rozszerzony.html)
 *  - window.GruntowoPRO.api(akcja, dane) -> Promise(odpowiedz serwera)
 *  - na stronach raportu: zalogowany PRO = dzialka trafia do historii, a raport rozszerzony otwiera sie bez hasla
 * Bez konta PRO ten plik nic nie robi.
 */
(function () {
  'use strict';
  var API = 'https://sniadecki-development.pl/gruntowo-api/pro.php';
  var KLUCZ_SESJI = 'gruntowo_pro_sesja';
  var KLUCZ_DOSTEPU = 'gruntowo_dostep_v2';   // ten sam magazyn co haslo.js (raport rozszerzony)

  function sesja() { try { return localStorage.getItem(KLUCZ_SESJI) || ''; } catch (e) { return ''; } }
  function ustawSesje(s) { try { if (s) localStorage.setItem(KLUCZ_SESJI, s); else localStorage.removeItem(KLUCZ_SESJI); } catch (e) {} }
  function api(akcja, dane) {
    var b = dane || {}; b.akcja = akcja; if (!b.sesja && sesja()) b.sesja = sesja();
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.zaloguj) ustawSesje(''); return j || {}; });
  }
  function dostepWazny() {
    try { var p = JSON.parse(localStorage.getItem(KLUCZ_DOSTEPU) || 'null'); return !!(p && p.haslo && p.haslo.e - 5 * 60 * 1000 > Date.now()); } catch (e) { return false; }
  }
  // bilet do danych raportu rozszerzonego (wszystkie dzialki) na czas okresu probnego / abonamentu (maks. 24 h)
  function zapewnijDostep() {
    if (!sesja()) return Promise.resolve(false);
    if (dostepWazny()) return Promise.resolve(true);
    return api('dostep').then(function (j) {
      if (!j.ok || !j.token) return false;
      try {
        var p = JSON.parse(localStorage.getItem(KLUCZ_DOSTEPU) || 'null') || {}; if (!p.d) p.d = {};
        p.haslo = { t: j.token, e: (j.wygasa || 0) * 1000, pro: 1 };
        localStorage.setItem(KLUCZ_DOSTEPU, JSON.stringify(p));
      } catch (e) { return false; }
      return true;
    }).catch(function () { return false; });
  }
  function historia(id, opis) { if (sesja() && id) api('historia_dodaj', { dzialka: id, opis: opis || '' }).catch(function () {}); }

  window.GruntowoPRO = { API: API, sesja: sesja, ustawSesje: ustawSesje, api: api, zapewnijDostep: zapewnijDostep, historia: historia };

  // --- strony raportu ---
  if (!sesja()) return;
  var sciezka = location.pathname.split('/').pop();
  var id = new URLSearchParams(location.search).get('id') || '';
  if (/^raport(-rozszerzony)?\.html$/.test(sciezka) && id) {
    // opis do historii: gmina z naglowka raportu, gdy juz sie wczyta
    var zapisz = function () { var s = document.getElementById('rep-sub'); historia(id, s ? s.textContent.replace(/^.*?gm\.\s*/, 'gm. ').slice(0, 190) : ''); };
    setTimeout(zapisz, 6000);
  }
  if (sciezka === 'raport-rozszerzony.html' && !dostepWazny()) {
    // zalogowany PRO bez waznego biletu - pobierz i otworz raport ponownie (raz)
    zapewnijDostep().then(function (ok) { if (ok && !sessionStorage.getItem('gruntowo_pro_odsw')) { sessionStorage.setItem('gruntowo_pro_odsw', '1'); location.reload(); } });
  }
})();
