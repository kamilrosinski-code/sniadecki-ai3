/*
 * gruntowo.pl — CENNIK ZE SERWERA (ceny ustawiane w CRM, zakladka "Cennik")
 *
 * Jak to dziala:
 *  - w HTML / w kodzie JS cena jest w elemencie <span data-cena="raport">159 zł</span>
 *    (albo data-cena="konsultacja"; wersja bez "zł": data-cena="raport-liczba" / "konsultacja-liczba");
 *    wartosc wpisana w HTML to tylko zapas na wypadek braku polaczenia z serwerem;
 *  - ten skrypt pobiera https://sniadecki-development.pl/gruntowo-api/cennik.php i podstawia aktualne ceny,
 *    takze w elementach dodanych pozniej przez inne skrypty (MutationObserver);
 *  - inne skrypty czytaja kwoty z window.GruntowoCeny (np. do zdarzen GA): GruntowoCeny.raport (liczba), GruntowoCeny.tekst('raport').
 * Ladowac PRZED main.js / platnosc.js / raport-rozszerzony.js.
 */
(function () {
  'use strict';
  var API = 'https://sniadecki-development.pl/gruntowo-api/cennik.php';
  var C = window.GruntowoCeny = {
    raport: 159, konsultacja: 1490, raport_tekst: '159 zł', konsultacja_tekst: '1490 zł', gotowe: false,
    tekst: function (k) { return C[k + '_tekst']; },
    liczba: function (k) { return C[k]; },
    zastosuj: zastosuj
  };

  function liczbaPl(n) { return String(n).replace('.', ','); }

  function zastosuj(root) {
    var lista = (root || document).querySelectorAll('[data-cena]');
    for (var i = 0; i < lista.length; i++) {
      var el = lista[i], k = el.getAttribute('data-cena'), v;
      if (/-liczba$/.test(k)) { k = k.replace(/-liczba$/, ''); v = C[k] !== undefined ? liczbaPl(C[k]) : undefined; }
      else v = C[k + '_tekst'];
      if (v !== undefined && el.textContent !== v) el.textContent = v;
    }
  }

  function przyjmij(j) {
    if (!j || !j.ok) return;
    if (j.raport > 0) { C.raport = j.raport; C.raport_tekst = j.raport_tekst || (liczbaPl(j.raport) + ' zł'); }
    if (j.konsultacja > 0) { C.konsultacja = j.konsultacja; C.konsultacja_tekst = j.konsultacja_tekst || (liczbaPl(j.konsultacja) + ' zł'); }
    C.gotowe = true;
    if (document.body) zastosuj();
    try { document.dispatchEvent(new CustomEvent('gruntowo-ceny', { detail: C })); } catch (e) {}
  }

  // zapas z poprzedniej strony (ten sam otwarty przegladarka) - zeby cena nie "mrugala"
  try { var z = JSON.parse(sessionStorage.getItem('gruntowo_cennik') || 'null'); if (z && z.ok) przyjmij(z); } catch (e) {}

  if (window.fetch) {
    fetch(API, { cache: 'default' }).then(function (r) { return r.json(); }).then(function (j) {
      przyjmij(j);
      try { sessionStorage.setItem('gruntowo_cennik', JSON.stringify(j)); } catch (e) {}
    }).catch(function () { /* brak polaczenia - zostaja ceny wpisane w HTML */ });
  }

  // elementy dodawane pozniej (np. baner w raporcie, formularz konsultacji, tresci z arkusza Google)
  var czeka = false;
  function pozniej() { if (czeka) return; czeka = true; (window.requestAnimationFrame || setTimeout)(function () { czeka = false; zastosuj(); }); }
  function start() {
    zastosuj();
    if (window.MutationObserver) new MutationObserver(pozniej).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
