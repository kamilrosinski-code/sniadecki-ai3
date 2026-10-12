/*
 * gruntowo.pl - PODGLAD RAPORTU W HERO (index.html)
 *  - skaluje karte do szerokosci kolumny,
 *  - wczytuje prawdziwa ortofotomape dzialki przykladowej (78/3 Janikowo) z Geoportalu + granice dzialek z KIEG,
 *  - licznik werdyktu 0 -> 83 zgrany z animacja pierscienia,
 *  - lekkie pochylanie karty za kursorem (tylko mysz).
 */
(function () {
  'use strict';
  var box = document.getElementById('hero-wizual');
  if (!box) return;
  var hero = box.closest('.hero');
  var malo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- skala karty (projekt 680 x 560 px) ----
  function skaluj() {
    var w = box.clientWidth || box.parentNode.clientWidth;
    var s = Math.max(0.42, Math.min(1, w / 690));
    box.style.setProperty('--hw-skala', s.toFixed(4));
  }
  skaluj();
  if (window.ResizeObserver) new ResizeObserver(skaluj).observe(box); else window.addEventListener('resize', skaluj);

  // ---- ortofotomapa (PUWG 1992), kadr 240 x 164 m wokol dzialki, 2 x 2 kafle 480 x 328 px ----
  var BB = [365714, 509986, 365954, 510150];
  var ORTO = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Raster&STYLES=&SRS=EPSG:2180&FORMAT=image/jpeg&WIDTH=480&HEIGHT=328&BBOX=';
  var KIEG = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=dzialki&STYLES=&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=TRUE&WIDTH=960&HEIGHT=656&BBOX=' + BB.join(',');
  var orto = document.getElementById('hw-orto');
  // usluga czasem oddaje pusty (bialy) kafel - maly plik; wtedy ponawiamy
  function kafel(bb, proba) {
    var url = ORTO + bb.join(',') + (proba ? '&_p=' + proba : '');
    if (!window.fetch || !window.URL) return Promise.resolve(url);
    return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('http'); return r.blob(); }).then(function (b) {
      if (b.size < 9000 && proba < 6) return kafel(bb, proba + 1);
      return URL.createObjectURL(b);
    }).catch(function (e) { return proba < 2 ? kafel(bb, proba + 1) : url; });   // bez CORS - zwykly obrazek
  }
  function laduj() {
    if (!orto || orto.dataset.ladowane) return; orto.dataset.ladowane = '1';
    var dx = (BB[2] - BB[0]) / 2, dy = (BB[3] - BB[1]) / 2, zad = [];
    for (var ix = 0; ix < 2; ix++) for (var iy = 0; iy < 2; iy++) {
      (function (ix, iy) {
        var bb = [BB[0] + ix * dx, BB[3] - (iy + 1) * dy, BB[0] + (ix + 1) * dx, BB[3] - iy * dy];
        zad.push(kafel(bb, 0).then(function (src) {
          return new Promise(function (ok) {
            var im = new Image(); im.className = 'hw-tile'; im.alt = ''; im.decoding = 'async';
            im.style.left = (ix * 50) + '%'; im.style.top = (iy * 50) + '%';
            im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src;
          });
        }));
      })(ix, iy);
    }
    Promise.all(zad).then(function (imgs) {
      if (imgs.filter(Boolean).length < 4) return;              // niepelna mapa - zostaje stonowane tlo
      imgs.forEach(function (im) { orto.appendChild(im); });
      var g = new Image(); g.className = 'hw-granice'; g.alt = ''; g.onload = function () { orto.appendChild(g); }; g.src = KIEG;
      orto.classList.add('gotowe');
      var kopia = box.querySelector('.hw-orto-kopia');            // rozmyta karta w tle
      if (kopia) imgs.forEach(function (im) { kopia.appendChild(im.cloneNode()); });
    });
  }
  // mapa tylko gdy karta jest widoczna na ekranie
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { laduj(); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(box);
  } else laduj();

  // ---- licznik werdyktu (rusza razem z pierscieniem: 1,5 s po zaladowaniu, 1,6 s) ----
  var pkt = document.getElementById('hw-punkty');
  if (pkt && !malo) {
    var cel = +pkt.textContent || 83, t0 = performance.now() + 1500, dl = 1600;
    pkt.textContent = '0';
    var krok = function (now) {
      if (hero && hero.classList.contains('wejscie-zrobione')) { pkt.textContent = cel; return; }
      var p = Math.max(0, Math.min(1, (now - t0) / dl)), e = 1 - Math.pow(1 - p, 3);
      pkt.textContent = Math.round(cel * e);
      if (p < 1) requestAnimationFrame(krok);
    };
    requestAnimationFrame(krok);
  }

  // ---- pochylanie za kursorem ----
  var mysz = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (mysz && !malo && hero) {
    var ruch = box.querySelector('.hw-ruch'), ramka = null, mx = 0, my = 0;
    hero.addEventListener('mousemove', function (e) {
      mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5;
      if (ramka) return;
      ramka = requestAnimationFrame(function () {
        ramka = null;
        ruch.style.setProperty('--hw-my', (mx * 7).toFixed(2) + 'deg');
        ruch.style.setProperty('--hw-mx', (-my * 5).toFixed(2) + 'deg');
      });
    });
    hero.addEventListener('mouseleave', function () { ruch.style.setProperty('--hw-my', '0deg'); ruch.style.setProperty('--hw-mx', '0deg'); });
  }
})();
