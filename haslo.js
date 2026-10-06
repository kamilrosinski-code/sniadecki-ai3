/*
 * gruntowo.pl - DOSTEP do raportu rozszerzonego (haslo, zakup, raport przykladowy).
 *
 * Od tej wersji dostep nadaje SERWER (dostep.php na LH): sprawdza haslo albo oplacone zamowienie
 * i wydaje podpisany token. Dane platne (pozwolenia na budowe, zapisy planu, mapa sieci) serwer
 * wydaje tylko z waznym tokenem - "odblokowanie" raportu w przegladarce nic nie daje bez niego.
 * Strona nie zna juz hasla ani jego skrotu (zmiana hasla: tylko w dostep.php na serwerze).
 *
 * window.GruntowoHaslo:
 *   sprawdz(haslo)            -> Promise<bool>   (poprawne haslo = token na wszystkie dzialki)
 *   czyOdblokowane()          -> bool            (jest wazny token z hasla)
 *   token(id)                 -> string          (wazny token dla dzialki albo z hasla; '' gdy brak)
 *   tokenZamowienia(id, ext)  -> Promise<string> (token po oplaceniu; '' gdy nieoplacone)
 *   tokenPrzykladu(id)        -> Promise<string> (token dla dzialki przykladowej)
 *   podlacz(form, opcje), adresRaportu(id)
 */
(function () {
  'use strict';

  var API = 'https://sniadecki-development.pl/gruntowo-api/dostep.php';
  var KLUCZ = 'gruntowo_dostep_v2';          // { haslo: {t, e}, d: { idDzialki: {t, e} } }  e = ms
  var STRONA_ROZSZERZONA = 'raport-rozszerzony.html';
  var ZAPAS_MS = 5 * 60 * 1000;               // token konczacy sie za < 5 min traktujemy jak wygasly

  function pamiec() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(KLUCZ) || 'null'); } catch (e) {}
    if (!p || typeof p !== 'object') p = {};
    if (!p.d || typeof p.d !== 'object') p.d = {};
    return p;
  }
  function zapiszPamiec(p) { try { localStorage.setItem(KLUCZ, JSON.stringify(p)); } catch (e) { /* bez pamieci - trudno */ } }
  function wazny(w) { return !!(w && w.t && w.e && w.e - ZAPAS_MS > Date.now()); }

  function zapiszToken(id, token, wygasaSek) {
    var p = pamiec(), w = { t: token, e: (wygasaSek || 0) * 1000 };
    if (id === '*') p.haslo = w; else p.d[id] = w;
    zapiszPamiec(p);
  }
  function token(id) {
    var p = pamiec();
    if (id && wazny(p.d[id])) return p.d[id].t;
    if (wazny(p.haslo)) return p.haslo.t;
    return '';
  }
  function czyOdblokowane() { return wazny(pamiec().haslo); }

  function zapytaj(dane) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dane), cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }

  // Haslo sprawdza serwer. Zbyt wiele blednych prob z jednego adresu -> chwilowa blokada (blad 'limit').
  function sprawdz(haslo) {
    return zapytaj({ haslo: String(haslo || '').trim() }).then(function (w) {
      if (w && w.ok && w.token) { zapiszToken('*', w.token, w.wygasa); return true; }
      if (w && w.blad === 'limit') { var e = new Error('limit'); e.limit = true; throw e; }
      return false;
    });
  }
  function tokenZamowienia(id, ext) {
    var t = token(id);
    if (t) return Promise.resolve(t);
    return zapytaj({ id: id, zamowienie: ext }).then(function (w) {
      if (w && w.ok && w.token) { zapiszToken(id, w.token, w.wygasa); return w.token; }
      return '';
    }, function () { return ''; });
  }
  function tokenPrzykladu(id) {
    var t = token(id);
    if (t) return Promise.resolve(t);
    return zapytaj({ id: id, przyklad: 1 }).then(function (w) {
      if (w && w.ok && w.token) { zapiszToken(id, w.token, w.wygasa); return w.token; }
      return '';
    }, function () { return ''; });
  }
  // zgodnosc ze starszym kodem - zapamietanie robi teraz sprawdz()
  function zapamietaj() {}

  function adresRaportu(idDzialki) {
    if (!idDzialki) return STRONA_ROZSZERZONA;
    return STRONA_ROZSZERZONA + '?id=' + encodeURIComponent(idDzialki) + '&ok=1';
  }

  /*
   * Podlacza formularz hasla:
   *   <form data-haslo><input data-haslo-pole type="password"><button type="submit">Odblokuj</button><div data-haslo-msg></div></form>
   * opcje.onOk(): co zrobic po poprawnym hasle (domyslnie przejscie do raportu rozszerzonego).
   * opcje.idDzialki(): funkcja zwracajaca identyfikator dzialki do przekazania (opcjonalnie).
   */
  function podlacz(form, opcje) {
    if (!form) return;
    opcje = opcje || {};
    var pole = form.querySelector('[data-haslo-pole]');
    var msg = form.querySelector('[data-haslo-msg]');
    var pokaz = function (tekst, blad) {
      if (!msg) return;
      msg.textContent = tekst;
      msg.classList.toggle('haslo-blad', !!blad);
      msg.classList.toggle('haslo-ok', !blad && !!tekst);
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var wartosc = pole ? pole.value : '';
      if (!wartosc.trim()) { pokaz('Wklej hasło, które otrzymałeś.', true); if (pole) pole.focus(); return; }
      pokaz('Sprawdzamy hasło…', false);
      sprawdz(wartosc).then(function (ok) {
        if (!ok) { pokaz('Nieprawidłowe hasło. Sprawdź, czy wklejasz je bez spacji.', true); if (pole) pole.select(); return; }
        pokaz('Hasło poprawne - otwieramy raport rozszerzony...', false);
        if (opcje.onOk) { opcje.onOk(); return; }
        var id = opcje.idDzialki ? opcje.idDzialki() : '';
        window.location.href = adresRaportu(id);
      }).catch(function (err) {
        if (err && err.limit) { pokaz('Zbyt wiele prób. Spróbuj ponownie za kilkanaście minut.', true); return; }
        console.warn('Hasło:', err);
        pokaz('Nie udało się połączyć z serwerem. Sprawdź internet i spróbuj ponownie.', true);
      });
    });
  }

  window.GruntowoHaslo = {
    sprawdz: sprawdz,
    zapamietaj: zapamietaj,
    czyOdblokowane: czyOdblokowane,
    token: token,
    tokenZamowienia: tokenZamowienia,
    tokenPrzykladu: tokenPrzykladu,
    adresRaportu: adresRaportu,
    podlacz: podlacz
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form[data-haslo]:not([data-haslo-reczne])').forEach(function (f) {
      podlacz(f);
    });
  });
})();
