/*
 * gruntowo.pl - dostep do raportu rozszerzonego haslem (etap przejsciowy, przed Przelewy24).
 *
 * UWAGA: to zabezpieczenie po stronie przegladarki - wystarcza na akcje promocyjna
 * ("wklej haslo, dostan raport rozszerzony za darmo"), ale NIE chroni tresci przed kims,
 * kto zna JavaScript. Docelowo dostep ma nadawac backend (PHP na LH) po oplaceniu raportu.
 *
 * Haslo nie jest zapisane jawnie - trzymamy tylko jego skrot SHA-256.
 * Zmiana hasla: policz nowy skrot, np. w terminalu:
 *     echo -n "noweHaslo" | sha256sum
 * i wklej wynik do HASLO_SHA256 ponizej.
 */
(function () {
  'use strict';

  // SHA-256 z "gruntowo2026"
  var HASLO_SHA256 = 'e210a372cac86f342a8dbf04c3a558a617abb7333a6db3e8cb98fa87d34ee0e8';
  var KLUCZ = 'gruntowo_rozszerzony_v1';
  var STRONA_ROZSZERZONA = 'raport-rozszerzony.html';

  function sha256(tekst) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('Przeglądarka nie obsługuje crypto.subtle (wymagany HTTPS).'));
    }
    var dane = new TextEncoder().encode(tekst);
    return window.crypto.subtle.digest('SHA-256', dane).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  function sprawdz(haslo) {
    return sha256(String(haslo || '').trim()).then(function (h) { return h === HASLO_SHA256; });
  }

  // Zapamietanie odblokowania (per przegladarka). Pamiec przegladarki moze byc wylaczona -
  // wtedy dzialamy dalej, tylko klient poda haslo ponownie przy nastepnej wizycie.
  function zapamietaj() {
    try { localStorage.setItem(KLUCZ, '1'); } catch (e) { /* brak pamieci - trudno */ }
    try { sessionStorage.setItem(KLUCZ, '1'); } catch (e) { /* j.w. */ }
  }
  function czyOdblokowane() {
    try { if (localStorage.getItem(KLUCZ) === '1') return true; } catch (e) {}
    try { if (sessionStorage.getItem(KLUCZ) === '1') return true; } catch (e) {}
    return false;
  }

  // Adres raportu rozszerzonego; z identyfikatorem dzialki od razu generuje raport.
  function adresRaportu(idDzialki) {
    if (!idDzialki) return STRONA_ROZSZERZONA;
    return STRONA_ROZSZERZONA + '?id=' + encodeURIComponent(idDzialki) + '&ok=1';
  }

  /*
   * Podlacza formularz hasla. Oczekiwany HTML (klasy dowolne, liczy sie atrybut data-haslo):
   *   <form data-haslo>
   *     <input data-haslo-pole type="password">
   *     <button type="submit">Odblokuj</button>
   *     <div data-haslo-msg></div>
   *   </form>
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
      sprawdz(wartosc).then(function (ok) {
        if (!ok) { pokaz('Nieprawidłowe hasło. Sprawdź, czy wklejasz je bez spacji.', true); if (pole) pole.select(); return; }
        zapamietaj();
        pokaz('Hasło poprawne - otwieramy raport rozszerzony...', false);
        if (opcje.onOk) { opcje.onOk(); return; }
        var id = opcje.idDzialki ? opcje.idDzialki() : '';
        window.location.href = adresRaportu(id);
      }).catch(function (err) {
        console.warn('Hasło:', err);
        pokaz('Nie udało się sprawdzić hasła w tej przeglądarce. Otwórz stronę przez https://', true);
      });
    });
  }

  window.GruntowoHaslo = {
    sprawdz: sprawdz,
    zapamietaj: zapamietaj,
    czyOdblokowane: czyOdblokowane,
    adresRaportu: adresRaportu,
    podlacz: podlacz
  };

  // Automatyczne podlaczenie wszystkich formularzy z atrybutem data-haslo
  // (strona glowna; w raporcie darmowym formularz podlacza raport.html z id dzialki).
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form[data-haslo]:not([data-haslo-reczne])').forEach(function (f) {
      podlacz(f);
    });
  });
})();
