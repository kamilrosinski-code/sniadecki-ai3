/*
 * gruntowo.pl - PODGLADY RAPORTU (index.html): karta w hero + karta w sekcji "Nie dostajesz kolejnych map..."
 *  - skaluje karty do szerokosci kolumny (projekt 680 x 560 px),
 *  - wczytuje prawdziwa ortofotomape dzialki przykladowej (78/3 Janikowo) z Geoportalu + granice dzialek (KIEG)
 *    albo rysunek planu miejscowego (KIMPZP) - dla karty z data-mpzp,
 *  - liczniki (werdykt 0 -> 83, zabudowa 0 -> 350 m2) zgrane z animacjami,
 *  - druga karta animuje sie dopiero po wjechaniu na ekran,
 *  - lekkie pochylanie kart za kursorem (tylko mysz),
 *  - po wyborze miejscowosci (mapa w wyszukiwarce) hero dostaje klase .hero-mapa: raport sie oddala, mapa przybliza.
 */
(function () {
  'use strict';
  var karty = Array.prototype.slice.call(document.querySelectorAll('.hero-wizual'));
  if (!karty.length) return;
  var malo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mysz = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hero = document.querySelector('.hero');

  // ---- skala kart ----
  function skaluj(box) {
    var w = box.clientWidth || box.parentNode.clientWidth;
    box.style.setProperty('--hw-skala', Math.max(0.42, Math.min(1, w / 690)).toFixed(4));
  }
  karty.forEach(function (box) {
    skaluj(box);
    if (window.ResizeObserver) new ResizeObserver(function () { skaluj(box); }).observe(box);
    else window.addEventListener('resize', function () { skaluj(box); });
  });

  // ---- mapy (PUWG 1992), kadr 240 x 164 m wokol dzialki ----
  var BB = [365714, 509986, 365954, 510150];
  var ORTO = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Raster&STYLES=&SRS=EPSG:2180&FORMAT=image/jpeg&WIDTH=480&HEIGHT=328&BBOX=';
  var KIEG = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=dzialki&STYLES=&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=TRUE&WIDTH=960&HEIGHT=656&BBOX=' + BB.join(',');
  var MPZP = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=TRUE&LAYERS=raster,wektor-str,wektor-pow,wektor-lin,wektor-pkt,wektor-lzb,granice&STYLES=,,,,,,&WIDTH=960&HEIGHT=656&BBOX=' + BB.join(',');
  // usluga czasem oddaje pusty (bialy) kafel - maly plik; wtedy ponawiamy. Kafle wspolne dla obu kart.
  function kafel(bb, proba) {
    var url = ORTO + bb.join(',') + (proba ? '&_p=' + proba : '');
    if (!window.fetch || !window.URL) return Promise.resolve(url);
    return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('http'); return r.blob(); }).then(function (b) {
      if (b.size < 9000 && proba < 6) return kafel(bb, proba + 1);
      return URL.createObjectURL(b);
    }).catch(function () { return proba < 2 ? kafel(bb, proba + 1) : url; });   // bez CORS - zwykly obrazek
  }
  var kafle = null;
  function pobierzKafle() {
    if (kafle) return kafle;
    var dx = (BB[2] - BB[0]) / 2, dy = (BB[3] - BB[1]) / 2, zad = [];
    for (var ix = 0; ix < 2; ix++) for (var iy = 0; iy < 2; iy++) {
      var bb = [BB[0] + ix * dx, BB[3] - (iy + 1) * dy, BB[0] + (ix + 1) * dx, BB[3] - iy * dy];
      zad.push(kafel(bb, 0).then((function (ix, iy) { return function (src) { return { src: src, x: ix * 50, y: iy * 50 }; }; })(ix, iy)));
    }
    return (kafle = Promise.all(zad));
  }
  function obraz(src, klasa, x, y) {
    return new Promise(function (ok) {
      var im = new Image(); im.className = klasa; im.alt = ''; im.decoding = 'async';
      if (x != null) { im.style.left = x + '%'; im.style.top = y + '%'; }
      im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src;
    });
  }
  function laduj(box) {
    box.querySelectorAll('.hw-orto').forEach(function (orto) { ladujMape(box, orto); });
  }
  function ladujMape(box, orto) {
    if (orto.dataset.ladowane) return; orto.dataset.ladowane = '1';
    pobierzKafle().then(function (lista) {
      return Promise.all(lista.map(function (k) { return obraz(k.src, 'hw-tile', k.x, k.y); }));
    }).then(function (imgs) {
      if (imgs.filter(Boolean).length < 4) return;              // niepelna mapa - zostaje stonowane tlo
      imgs.forEach(function (im) { orto.appendChild(im); });
      orto.classList.add('gotowe');
      obraz(orto.dataset.mpzp ? MPZP : KIEG, orto.dataset.mpzp ? 'hw-mpzp' : 'hw-granice').then(function (im) { if (im) orto.appendChild(im); });
      // kopie zdjecia: rozmyta karta w tle (hero) i miniatury "historii zdjec" (model 1) - tylko raz na karte
      if (!box.dataset.kopie) { box.dataset.kopie = '1'; box.querySelectorAll('.hw-orto-kopia').forEach(function (kopia) { imgs.forEach(function (im) { kopia.appendChild(im.cloneNode()); }); }); }
    });
  }

  // ---- liczniki ----
  function licz(el, opoznienie, dl) {
    var cel = +(el.dataset.licz || el.textContent) || 0;
    if (malo) { el.textContent = cel; return; }
    var t0 = performance.now() + opoznienie;
    el.textContent = '0';
    var krok = function (now) {
      if (hero && hero.classList.contains('wejscie-zrobione') && hero.contains(el)) { el.textContent = cel; return; }
      var p = Math.max(0, Math.min(1, (now - t0) / dl)), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(cel * e);
      if (p < 1) requestAnimationFrame(krok);
    };
    requestAnimationFrame(krok);
  }

  // ---- start kart: hero od razu, pozostale po wjechaniu na ekran ----
  function start(box) {
    if (box.classList.contains('hw-gra')) return;
    box.classList.add('hw-gra');
    var pkt = box.querySelector('#hw-punkty'); if (pkt) licz(pkt, 1500, 1600);
    box.querySelectorAll('[data-licz]').forEach(function (el) {
      var karta = el.closest('.hwm');
      if (karta && !karta.classList.contains('aktywne')) return;   // modele: licznik rusza przy pokazaniu karty
      licz(el, karta ? 900 : box.classList.contains('hw-onas') ? 1000 : 2600, 1200);
    });
  }
  // modele: przy przelaczeniu karty liczniki od nowa
  if (window.MutationObserver) document.querySelectorAll('.hwm').forEach(function (karta) {
    new MutationObserver(function () {
      var box = karta.closest('.hero-wizual');
      if (karta.classList.contains('aktywne') && box && box.classList.contains('hw-gra')) karta.querySelectorAll('[data-licz]').forEach(function (el) { licz(el, 500, 1100); });
    }).observe(karta, { attributes: true, attributeFilter: ['class'] });
  });
  karty.forEach(function (box) {
    var wHero = hero && hero.contains(box);
    if (!window.IntersectionObserver) { laduj(box); start(box); return; }
    // mapa wczesniej (z zapasem), animacja gdy karta naprawde widac
    var ioM = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { laduj(box); ioM.disconnect(); } }, { rootMargin: '400px' });
    ioM.observe(box);
    if (wHero) start(box);
    else {
      var ioA = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { start(box); ioA.disconnect(); } }, { threshold: 0.35 });
      ioA.observe(box);
    }
  });

  // ---- pochylanie za kursorem ----
  if (mysz && !malo) karty.forEach(function (box) {
    var obszar = box.closest('section') || box.parentNode, ruch = box.querySelector('.hw-ruch'), ramka = null, mx = 0, my = 0;
    obszar.addEventListener('mousemove', function (e) {
      var r = obszar.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5;
      if (ramka) return;
      ramka = requestAnimationFrame(function () {
        ramka = null;
        ruch.style.setProperty('--hw-my', (mx * 7).toFixed(2) + 'deg');
        ruch.style.setProperty('--hw-mx', (-my * 5).toFixed(2) + 'deg');
      });
    });
    obszar.addEventListener('mouseleave', function () { ruch.style.setProperty('--hw-my', '0deg'); ruch.style.setProperty('--hw-mx', '0deg'); });
  });

  // ---- mapa w wyszukiwarce: raport sie oddala ----
  var s2 = document.getElementById('step-2'), s3 = document.getElementById('step-3');
  if (hero && s2 && window.MutationObserver) {
    var bylo = false;
    var sprawdz = function () {
      var jest = !s2.classList.contains('hidden') || (s3 && !s3.classList.contains('hidden'));
      hero.classList.toggle('hero-mapa', jest);
      var sb = document.getElementById('search-box');
      // polozenie w ukladzie strony (bez transformacji) - do wysrodkowania ramki na ekranie
      var naStronie = function (el) { var x = 0, y = 0; while (el) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return { x: x, y: y }; };
      // poziomo: ramka z mapa srodkiem na srodku ekranu (komputer); CSS ma zapasowe 9vw
      if (jest && sb && window.innerWidth >= 1100) {
        var szer = Math.min(840, window.innerWidth * 0.6), lewo = naStronie(sb).x;
        sb.style.setProperty('--sb-x', Math.round(window.innerWidth / 2 - lewo - szer / 2) + 'px');
      } else if (sb) sb.style.removeProperty('--sb-x');
      // pionowo: lagodnie przewijamy tak, by ramka (a gdy jest wyzsza niz ekran - sama mapa) byla na srodku ekranu
      if (jest && !bylo) setTimeout(function () {
        var mb = document.querySelector('#step-2:not(.hidden) .map-box');
        if (!sb || !mb) return;
        var vh = window.innerHeight, el = sb.offsetHeight < vh - 80 ? sb : mb, p = naStronie(el);
        var cel = Math.max(0, Math.round(p.y + el.offsetHeight / 2 - vh / 2));
        if (Math.abs(cel - window.scrollY) < 8) return;
        if (window.__lenis && !malo) window.__lenis.scrollTo(cel, { duration: 1.6, easing: function (t) { return 1 - Math.pow(1 - t, 3); } });
        else window.scrollTo({ top: cel, behavior: malo ? 'auto' : 'smooth' });
      }, 1150);   // po zwinieciu opisu pod haslem
      bylo = jest;
    };
    var mo = new MutationObserver(sprawdz);
    mo.observe(s2, { attributes: true, attributeFilter: ['class'] }); if (s3) mo.observe(s3, { attributes: true, attributeFilter: ['class'] });
    sprawdz();
  }

  // ---- sekcja "Nie dostajesz kolejnych map...": naglowek slowo po slowie, kafelek wjezdza po wjechaniu na ekran ----
  var kafelTekst = document.querySelector('.sekcja-analiza .intro-tekst');
  if (kafelTekst) {
    var h2 = kafelTekst.querySelector('.h2'), nr = 0;
    var rozbij = function (wezel) {
      Array.prototype.slice.call(wezel.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (cz) {
            if (!cz) return;
            if (/^\s+$/.test(cz)) { frag.appendChild(document.createTextNode(cz)); return; }
            var sp = document.createElement('span'); sp.className = 'ia-slowo'; sp.style.setProperty('--i', nr++); sp.textContent = cz; frag.appendChild(sp);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') rozbij(n);
      });
    };
    if (h2 && !malo) rozbij(h2);
    if (window.IntersectionObserver && !malo) {
      var ioK = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { kafelTekst.classList.add('widoczny'); ioK.disconnect(); } }, { threshold: 0.3 });
      ioK.observe(kafelTekst);
    } else kafelTekst.classList.add('widoczny');
    // naglowki pozostalych sekcji (modele, cennik, o nas): slowo po slowie, gdy sekcja wjedzie na ekran
    document.querySelectorAll('[data-naglowek-dyn]').forEach(function (blok) {
      var h = blok.querySelector('.h2');
      if (h && !malo) { nr = 0; rozbij(h); }
      if (window.IntersectionObserver && !malo) {
        var io = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { blok.classList.add('widoczny'); io.disconnect(); } }, { threshold: 0.4 });
        io.observe(blok);
      } else blok.classList.add('widoczny');
    });
  }

  // ---- cennik: kafelki modeli wjezdzaja i blyskaja po kolei, gdy sekcja wjedzie na ekran ----
  var cennik = document.querySelector('.oferty-warianty');
  if (cennik) {
    if (window.IntersectionObserver && !malo) {
      var ioC = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { cennik.classList.add('widoczne'); ioC.disconnect(); } }, { threshold: 0.25 });
      ioC.observe(cennik);
    } else cennik.classList.add('widoczne');
  }
})();
