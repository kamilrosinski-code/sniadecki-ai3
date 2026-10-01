/*
 * gruntowo.pl - ZAKUP RAPORTU ROZSZERZONEGO (PayU)
 *
 * Kup:      GruntowoPlatnosc.kup(idDzialki)  -> okienko z e-mailem -> strona platnosci PayU
 *           (albo dowolny przycisk z atrybutem data-kup-raport - dzialka brana z raportu)
 * Sprawdz:  GruntowoPlatnosc.sprawdz(idDzialki, numerZamowienia) -> Promise<{oplacone, status}>
 *
 * Oplacone dzialki zapamietujemy w przegladarce (osobno kazda dzialka) - haslo dalej odblokowuje wszystko.
 * Backend: pliki PHP w folderze gruntowo-api na LH (platnosc-start.php, platnosc-status.php, payu-notify.php).
 */
(function () {
  'use strict';

  var API = 'https://sniadecki-development.pl/gruntowo-api';
  var KLUCZ = 'gruntowo_oplacone_v1';
  var CENA = '69 zł';
  // Oficjalne logo PayU - plik pobrany ze strony PayU (Pliki do pobrania) i wgrany obok raportu.
  // Najpierw payu-logo.svg, potem payu-logo.png; gdy zadnego nie ma - napis "PayU".
  var LOGO_PAYU = 'payu-logo.svg';
  function logoPayU(klasa) {
    return '<img class="' + (klasa || 'logo-payu') + '" src="' + LOGO_PAYU + '" alt="PayU" ' +
      'onerror="if(this.src.indexOf(\'.svg\')>-1){this.src=\'payu-logo.png\';return;}var s=document.createElement(\'strong\');s.className=\'logo-payu-tekst\';s.textContent=\'PayU\';this.replaceWith(s);" />';
  }

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---- pamiec oplaconych dzialek { id: numerZamowienia } ----
  function oplacone() { try { return JSON.parse(localStorage.getItem(KLUCZ) || '{}') || {}; } catch (e) { return {}; } }
  function zapamietaj(id, ext) { try { var o = oplacone(); o[id] = ext; localStorage.setItem(KLUCZ, JSON.stringify(o)); } catch (e) {} }
  function zamowienieDla(id) { return oplacone()[id] || ''; }

  function sprawdz(id, ext) {
    return fetch(API + '/platnosc-status.php?zamowienie=' + encodeURIComponent(ext) + '&id=' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (w) { if (w && w.oplacone) zapamietaj(id, ext); return w || { oplacone: false }; });
  }

  // ---- okienko zakupu ----
  var modal = null;
  function zbudujModal() {
    modal = document.createElement('div');
    modal.className = 'kup-modal';
    modal.innerHTML =
      '<form class="kup-okno" novalidate>' +
      '<button type="button" class="kup-zamknij" aria-label="Zamknij">×</button>' +
      '<p class="kup-eyebrow">Raport rozszerzony</p>' +
      '<h2 class="kup-tytul">Kup raport dla tej działki</h2>' +
      '<p class="kup-dzialka"></p>' +
      '<ul class="kup-lista"><li>Werdykt inwestycyjny z plusami i minusami</li><li>Plan, media, zagrożenia, teren, dostęp do drogi</li><li>Lista kontrolna przed zakupem (PDF)</li></ul>' +
      '<div class="kup-cena"><strong>' + CENA + '</strong><span>jednorazowo, dostęp od razu po płatności</span></div>' +
      '<label class="kup-label" for="kup-email">Adres e-mail (na potwierdzenie płatności)</label>' +
      '<input id="kup-email" class="id-input" type="email" autocomplete="email" placeholder="jan@firma.pl" required />' +
      '<label class="kup-zgoda"><input type="checkbox" id="kup-zgoda" required /> <span>Akceptuję <a href="regulamin.html" target="_blank" rel="noopener">regulamin</a> i chcę otrzymać raport od razu - wiem, że po jego dostarczeniu tracę prawo odstąpienia od umowy.</span></label>' +
      '<div class="kup-msg" role="status" aria-live="polite"></div>' +
      '<button type="submit" class="btn btn-gold kup-btn">Przechodzę do płatności - ' + CENA + '</button>' +
      '<div class="kup-payu"><span>Bezpieczną płatność obsługuje</span>' + logoPayU() + '</div>' +
      '<p class="kup-info">BLIK, karta płatnicza lub szybki przelew. Po opłaceniu wrócisz do raportu rozszerzonego tej działki.</p>' +
      '</form>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal || e.target.classList.contains('kup-zamknij')) zamknij(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') zamknij(); });
    modal.querySelector('form').addEventListener('submit', wyslij);
  }
  function zamknij() { if (modal) modal.classList.remove('pokaz'); }

  var biezaceId = '';
  function kup(id) {
    if (!id) { alert('Najpierw wygeneruj raport dla działki.'); return; }
    if (!modal) zbudujModal();
    biezaceId = id;
    modal.querySelector('.kup-dzialka').textContent = 'Działka: ' + id;
    var pole = modal.querySelector('#kup-email');
    if (!pole.value) {
      var z = document.getElementById('r-email');
      var zap = ''; try { zap = localStorage.getItem('gruntowo_email') || ''; } catch (e) {}
      pole.value = (z && z.value) || zap;
    }
    modal.querySelector('.kup-msg').textContent = '';
    modal.classList.add('pokaz');
    setTimeout(function () { (pole.value ? modal.querySelector('#kup-zgoda') : pole).focus(); }, 50);
  }

  function wyslij(e) {
    e.preventDefault();
    var email = modal.querySelector('#kup-email').value.trim();
    var zgoda = modal.querySelector('#kup-zgoda').checked;
    var msg = modal.querySelector('.kup-msg');
    var btn = modal.querySelector('.kup-btn');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Podaj poprawny adres e-mail.'; return; }
    if (!zgoda) { msg.textContent = 'Zaznacz akceptację regulaminu.'; return; }
    try { localStorage.setItem('gruntowo_email', email); } catch (e2) {}
    btn.disabled = true; msg.textContent = 'Łączymy z PayU…';
    fetch(API + '/platnosc-start.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: biezaceId, email: email }) })
      .then(function (r) { return r.json(); })
      .then(function (w) {
        if (w && w.ok && w.redirect) { msg.textContent = 'Przekierowujemy do płatności…'; window.location.href = w.redirect; return; }
        throw new Error((w && w.blad) || 'Nie udało się rozpocząć płatności.');
      })
      .catch(function (err) {
        btn.disabled = false;
        msg.textContent = (err && err.message && err.message !== 'Failed to fetch') ? err.message : 'Brak połączenia z serwerem płatności. Spróbuj za chwilę.';
      });
  }

  // Przyciski "kup" w tresci strony (raport darmowy): dzialka z biezacego raportu
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-kup-raport]');
    if (!b) return;
    e.preventDefault();
    var id = b.getAttribute('data-id') || (window.gruntowoRaport && window.gruntowoRaport.id) || '';
    kup(id);
  });

  // Znaczek "Płatność PayU" przy przyciskach zakupu na stronie (elementy z atrybutem data-payu-znaczek)
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-payu-znaczek]').forEach(function (el) {
      el.innerHTML = '<span>Płatność obsługuje</span>' + logoPayU();
    });
  });

  // Wejscie z linku "Zamow raport rozszerzony" (raport.html?kup=1): podpowiedz nad formularzem,
  // a po wygenerowaniu raportu dla dzialki od razu okienko platnosci
  var trybKup = /[?&]kup=1(&|$)/.test(location.search);
  if (trybKup) {
    document.addEventListener('DOMContentLoaded', function () {
      var start = document.querySelector('#start .lead');
      if (start && !document.querySelector('.kup-podpowiedz')) {
        var p = document.createElement('div');
        p.className = 'kup-podpowiedz';
        p.innerHTML = '<strong>Zamówienie raportu rozszerzonego (69 zł).</strong> Wpisz identyfikator działki albo wskaż ją na mapie i kliknij „Generuj raport” - zaraz potem otworzy się płatność (BLIK, karta, przelew).';
        start.parentNode.insertBefore(p, start.nextSibling);
      }
    });
    var otwarto = false;
    document.addEventListener('gruntowo:dzialka', function (e) {
      var id = e.detail && e.detail.id;
      if (!id || otwarto || !document.querySelector('[data-kup-raport]')) return;
      otwarto = true;
      setTimeout(function () { kup(id); }, 1200);
    });
  }

  window.GruntowoPlatnosc = { kup: kup, sprawdz: sprawdz, zamowienieDla: zamowienieDla, esc: esc, logoPayU: logoPayU };
})();
