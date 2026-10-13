/*
 * gruntowo.pl PRO - CHLONNOSC TERENU i WYCENA REZYDUALNA (czesc teren.html)
 *
 * Jak liczy deweloper (uproszczona analiza chlonnosci):
 *   powierzchnia budowlana (bez drog, zieleni, lasow i wod z planu)
 *   -> maks. powierzchnia zabudowy = pow. budowlana x % zabudowy z planu
 *   -> PCN (powierzchnia calkowita nadziemna) = min(zabudowa x kondygnacje, pow. budowlana x intensywnosc z planu)
 *   -> PUM / PU = PCN x wspolczynnik (sciany, scianki dzialowe, klatki, szachty):
 *        domy jednorodzinne ok. 0,75 (R. Wanago, "Dobre Praktyki" 12/2021: PUM 2 kondygnacji = 75% sumy powierzchni),
 *        budynki wielorodzinne ok. 0,70-0,75 (praktyka rynkowa; przyjmujemy 0,72)
 *   -> liczba lokali = PUM / srednia powierzchnia lokalu; domy: tez ograniczone min. wielkoscia dzialki z planu.
 * Wycena rezydualna: przychod (bez VAT) - budowa - infrastruktura - koszty miekkie - marza = ile mozna zaplacic za grunt.
 * Uzytkownik moze nadpisac kazdy parametr (pola "Kluczowe parametry" i tabela dzialek). To szacunek koncepcyjny.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v, d) { return (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('pl-PL'); };
  var zl = function (v) { return (v < 0 ? '−' : '') + fmt(Math.abs(v)) + ' zł'; };
  var mln = function (v) { return Math.abs(v) >= 1e6 ? (v < 0 ? '−' : '') + (Math.abs(v) / 1e6).toFixed(2).replace('.', ',') + ' mln zł' : zl(v); };
  function odm(n, f) { var d = n % 10, s = n % 100; return n === 1 ? f[0] : (d >= 2 && d <= 4 && (s < 12 || s > 14)) ? f[1] : f[2]; }

  // ---- typy zabudowy: domyslne zalozenia ----
  var TYPY = {
    wolnostojace: { nazwa: 'domy wolnostojące', dom: true, naBud: 1, dzialka: 700, sred: 140, wsp: 0.75, pz: 30, kond: 2, drogi: 15, cena: 8000, budowa: 4000, infra: 50, lok: ['dom', 'domy', 'domów'] },
    blizniaki:    { nazwa: 'bliźniaki', dom: true, naBud: 2, dzialka: 450, sred: 120, wsp: 0.75, pz: 30, kond: 2, drogi: 15, cena: 7500, budowa: 3800, infra: 55, lok: ['lokal', 'lokale', 'lokali'] },
    szeregowe:    { nazwa: 'zabudowa szeregowa', dom: true, naBud: 4, dzialka: 300, sred: 100, wsp: 0.75, pz: 35, kond: 2, drogi: 18, cena: 7000, budowa: 3600, infra: 60, lok: ['segment', 'segmenty', 'segmentów'] },
    mieszkania:   { nazwa: 'budynki wielorodzinne', dom: false, bud: 500, sred: 52, wsp: 0.72, pz: 35, kond: 4, cena: 9500, budowa: 5800, infra: 30, lok: ['mieszkanie', 'mieszkania', 'mieszkań'] }
  };
  var BUD = ['budynek', 'budynki', 'budynków'];
  var ZAL_DOMYSLNE = { marza: 15, miekkie: 10, vat: 8 };
  var KLUCZ = 'gruntowo_pro_rezydualna_v2';

  // ---- odczyt liczb z tekstu planu ("maks. 30%", "0,1–0,6", "do 9 m, do 2 kondygnacji", "1 000 m²") ----
  function liczby(t) { return (String(t || '').replace(/(\d)[  ](?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d+)?/g) || []).map(function (x) { return parseFloat(x.replace(',', '.')); }); }
  function procent(t) { var m = String(t || '').match(/(\d+(?:[.,]\d+)?)\s*%/g); if (!m) { var l = liczby(t); return l.length && l[0] <= 100 ? l[0] : null; } return parseFloat(m[0].replace(',', '.')); }
  function procentMaks(t) { var m = String(t || '').match(/(\d+(?:[.,]\d+)?)\s*%/g); if (!m) return procent(t); return Math.max.apply(null, m.map(function (x) { return parseFloat(x.replace(',', '.')); })); }
  function intensywnosc(t) { var l = liczby(t).filter(function (x) { return x <= 10; }); return l.length ? Math.max.apply(null, l) : null; }
  function wysokosc(t) {
    var cz = String(t || '').split(/[;,]|\boraz\b/);
    for (var i = 0; i < cz.length; i++) { var m = cz[i].match(/(\d+(?:[.,]\d+)?)\s*m\b(?!²|2)/g); if (m) return Math.max.apply(null, m.map(function (x) { return parseFloat(x.replace(',', '.')); })); }
    return null;
  }
  function kondygnacje(t) { var m = String(t || '').match(/(\d+)\s*(?:kondygnac|kond\.)/i); return m ? +m[1] : null; }
  function minDzialka(t) { var l = liczby(t).filter(function (x) { return x >= 100; }); return l.length ? l[0] : null; }
  function zTekstuPlanu(teren) {
    if (!teren) return null;
    var w = { pz: procentMaks(teren.powierzchnia_zabudowy), pbc: procent(teren.biologicznie_czynna), i: intensywnosc(teren.intensywnosc), h: wysokosc(teren.wysokosc), kond: kondygnacje(teren.wysokosc), minDz: minDzialka(teren.min_dzialka) };
    w.opis = [teren.powierzchnia_zabudowy && 'zabudowa ' + teren.powierzchnia_zabudowy, teren.intensywnosc && 'intensywność ' + teren.intensywnosc, teren.wysokosc && 'wysokość ' + teren.wysokosc,
      teren.biologicznie_czynna && 'biol. czynna ' + teren.biologicznie_czynna, teren.min_dzialka && 'min. działka ' + teren.min_dzialka].filter(Boolean).join(' · ');
    return w;
  }
  function kondZWysokosci(h, dom) { if (!h) return dom ? 2 : 4; return Math.max(1, Math.floor((h - 1) / 3)); }
  function typZSymbolu(sym, pogKod) { var s = String(sym || '').toUpperCase(); if (/MW/.test(s)) return 'mieszkania'; if (/MN|ML|MR|RM/.test(s)) return 'wolnostojace'; if (pogKod === 'SW') return 'mieszkania'; return 'wolnostojace'; }

  // ---- stan ----
  var D = [], mediana = 0, typ = 'wolnostojace', typRecznie = false, zal = {}, wyn = null;
  function wczytajZal() { try { var z = JSON.parse(localStorage.getItem(KLUCZ) || 'null'); if (z && typeof z === 'object') return z; } catch (e) {} return {}; }
  function zapiszZal() { try { localStorage.setItem(KLUCZ, JSON.stringify(zal)); } catch (e) {} }
  function Z(k) { if (ZAL_DOMYSLNE[k] != null) return zal[k] != null ? zal[k] : ZAL_DOMYSLNE[k]; return zal[typ] && zal[typ][k] != null ? zal[typ][k] : TYPY[typ][k]; }
  function ustaw(k, v) { if (ZAL_DOMYSLNE[k] != null) { if (v === null) delete zal[k]; else zal[k] = v; } else { zal[typ] = zal[typ] || {}; if (v === null) delete zal[typ][k]; else zal[typ][k] = v; } zapiszZal(); }
  function recznie(k) { return zal[typ] && zal[typ][k] != null; }

  // wskazniki dzialki: wpisane recznie > MPZP (AI) > strefa POG
  function wskDzialki(d) {
    var r = d.wskReczne || {}, m = d.wskMPZP, p = d.pog && d.pog.wsk, w = {};
    ['pz', 'pbc', 'i', 'h', 'kond', 'minDz'].forEach(function (k) { w[k] = r[k] != null ? r[k] : m && m[k] != null ? m[k] : p && p[k] != null ? p[k] : null; });
    w.zrodlo = m ? 'MPZP' + (m.symbol ? ' ' + m.symbol : '') : p ? 'plan ogólny ' + (d.pog.ozn || d.pog.kod) : ''; return w;
  }
  function udzialBud(d) {
    if (d.udzialy && d.udzialy.some(function (u) { return u.symbol && u.symbol !== '?'; })) { var s = 0; d.udzialy.forEach(function (u) { if (u.symbol && !window.TerenKlasa(u.symbol)) s += u.udzial; }); return s; }
    if (d.pog && /^(SN|SK|SO|SC|SG|SI|SR)$/.test(d.pog.kod || '')) return 0;
    return 1;
  }

  // ---- obliczenie ----
  function policz() {
    var T = TYPY[typ], wsp = Z('wsp'), sred = Z('sred');
    var pzG = recznie('pz') ? Z('pz') / 100 : null, kondG = recznie('kond') ? Z('kond') : null;
    var r = { pow: 0, ab: 0, zab: 0, pcn: 0, pum: 0, lok: 0, bud: 0, wiersze: [], ogr: {} };
    D.forEach(function (d) {
      var w = wskDzialki(d), ab = d.pow * udzialBud(d);
      var pz = pzG != null ? pzG : w.pz != null ? w.pz / 100 : T.pz / 100;
      var kond = kondG != null ? kondG : w.kond || kondZWysokosci(w.h, T.dom);
      var I = w.i, x = { d: d, w: w, ab: ab, pz: pz, kond: kond, zab: 0, pcn: 0, pum: 0, lok: 0, bud: 0, ogr: '' };
      r.pow += d.pow; r.ab += ab;
      if (ab > 0) {
        if (T.dom) {
          var dz = Math.max(Z('dzialka'), w.minDz || 0), n = Math.floor(ab * (1 - Z('drogi') / 100) / dz);
          var zabL = dz * pz, pcnPlan = Math.min(zabL * kond, I ? dz * I : Infinity), pumL = Math.min(pcnPlan * wsp, sred);
          x.ogr = n === 0 ? 'teren za mały na działkę ' + fmt(dz) + ' m²' : pumL < sred ? (I && dz * I < zabL * kond ? 'intensywność z planu' : 'powierzchnia zabudowy z planu') : 'założona wielkość domu';
          if (w.minDz && w.minDz > Z('dzialka')) x.ogr += ' · min. działka z planu ' + fmt(w.minDz) + ' m²';
          x.lok = n; x.pum = n * pumL; x.pcn = x.pum / wsp; x.zab = Math.min(n * zabL, x.pcn / kond);
          x.bud = Math.ceil(n / T.naBud);
        } else {
          x.zab = ab * pz; var pcnZ = x.zab * kond, pcnI = I ? ab * I : Infinity;
          x.pcn = Math.min(pcnZ, pcnI); x.ogr = pcnI < pcnZ ? 'intensywność z planu' : 'powierzchnia zabudowy × kondygnacje';
          x.zab = Math.min(x.zab, x.pcn / kond);
          x.pum = x.pcn * wsp; x.lok = Math.floor(x.pum / Math.max(25, sred));
          x.bud = x.zab > 0 ? Math.max(1, Math.round(x.zab / Z('bud'))) : 0;
        }
      }
      r.zab += x.zab; r.pcn += x.pcn; r.pum += x.pum; r.lok += x.lok; r.bud += x.bud;
      if (x.ogr) r.ogr[x.ogr.split(' · ')[0]] = 1;
      r.wiersze.push(x);
    });
    var cenaN = Z('cena') / (1 + Z('vat') / 100);
    r.przychod = r.pum * cenaN; r.budowa = r.pum * Z('budowa'); r.infra = r.ab * Z('infra');
    r.miekkie = (r.budowa + r.infra) * Z('miekkie') / 100; r.marza = r.przychod * Z('marza') / 100;
    r.grunt = r.przychod - r.budowa - r.infra - r.miekkie - r.marza;
    return r;
  }
  function gruntPrzy(r, mnC, mnB) {
    var prz = r.pum * Z('cena') * mnC / (1 + Z('vat') / 100), bud = r.pum * Z('budowa') * mnB;
    return prz - bud - r.infra - (bud + r.infra) * Z('miekkie') / 100 - prz * Z('marza') / 100;
  }

  // ---- widok: kluczowe parametry ----
  function pole(k, et, jedn, krok, opis, wartPokaz) {
    var v = recznie(k) || wartPokaz == null ? Z(k) : wartPokaz;
    return '<label class="kp-pole' + (recznie(k) ? ' recz' : '') + '"><span class="kp-et">' + esc(et) + '</span>'
      + '<span class="kp-wart"><input type="number" data-kp="' + k + '" value="' + v + '" step="' + krok + '" min="0"><i>' + esc(jedn) + '</i></span>'
      + '<span class="kp-op">' + opis + (recznie(k) ? ' · <a href="#" data-reset="' + k + '">przywróć</a>' : '') + '</span></label>';
  }
  function wynik(et, v, opis, akcent) { return '<div class="kp-wynik' + (akcent ? ' akc' : '') + '"><span class="kp-et">' + esc(et) + '</span><b>' + v + '</b><span class="kp-op">' + opis + '</span></div>'; }
  function rysujKluczowe(r) {
    var T = TYPY[typ], el = $('chl-kluczowe'); if (!el) return;
    var aktywny = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.kp : null;
    var srPz = r.ab ? r.wiersze.reduce(function (a, x) { return a + x.pz * x.ab; }, 0) / r.ab * 100 : T.pz;
    var srKond = r.ab ? r.wiersze.reduce(function (a, x) { return a + x.kond * x.ab; }, 0) / r.ab : T.kond;
    var ogr = Object.keys(r.ogr).join(', ');
    el.innerHTML =
      '<div class="kp-rzad">'
      + wynik('Powierzchnia terenu', fmt(r.pow) + ' m²', 'budowlana ' + fmt(r.ab) + ' m² (' + Math.round(r.ab / Math.max(1, r.pow) * 100) + '%)')
      + pole('pz', 'Maks. zabudowa (z planu)', '%', 1, 'rzut budynków do ' + fmt(r.ab * srPz / 100) + ' m²', Math.round(srPz))
      + pole('kond', 'Kondygnacje nadziemne', 'kond.', 1, 'z wysokości w planie', Math.round(srKond * 2) / 2)
      + wynik('Pow. całkowita nadziemna', fmt(r.pcn) + ' m²', 'PCN – suma kondygnacji brutto')
      + '</div><div class="kp-rzad">'
      + pole('wsp', 'Współczynnik PUM / PCN', '×', 0.01, T.dom ? 'domy ok. 0,75 – ściany i ścianki działowe' : 'wielorodzinne 0,70–0,75 – klatki, ściany, szachty')
      + wynik(T.dom ? 'Pow. użytkowa domów' : 'PUM – pow. użytkowa', fmt(r.pum) + ' m²', 'do sprzedaży', true)
      + pole('sred', T.dom ? 'Średnia pow. domu' : 'Średnia pow. mieszkania', 'm²', 1, T.dom ? 'górna granica wielkości domu' : 'typowo 45–60 m²')
      + wynik('Liczba lokali', fmt(r.lok) + ' ' + odm(r.lok, T.lok), fmt(r.bud) + ' ' + odm(r.bud, BUD), true)
      + '</div>'
      + '<div class="kp-rzad kp-rzad-2">' + (T.dom
          ? pole('dzialka', 'Działka na 1 ' + (typ === 'wolnostojace' ? 'dom' : 'lokal'), 'm²', 10, 'po podziale terenu') + pole('drogi', 'Drogi wewnętrzne', '%', 1, 'teren na dojazdy przy podziale')
          : pole('bud', 'Rzut jednego budynku', 'm²', 10, 'do policzenia liczby budynków')) + '</div>'
      + (ogr ? '<p class="kp-ogr">Co ogranicza zabudowę: <strong>' + esc(ogr) + '</strong>' + (/założona wielkość/.test(ogr) ? ' – plan pozwala na więcej; zwiększ średnią powierzchnię, jeśli rynek to przyjmie.' : '') + '</p>' : '');
    el.querySelectorAll('[data-kp]').forEach(function (inp) {
      inp.oninput = function () { var v = parseFloat(inp.value); if (isNaN(v)) return; ustaw(inp.dataset.kp, v); przelicz({ bezKluczowych: true }); };
    });
    // pelne przerysowanie dopiero po wyjsciu z panelu - przechodzenie miedzy polami nie gubi wpisywanych wartosci
    el.onfocusout = function () { setTimeout(function () { if (!el.contains(document.activeElement)) przelicz(); }, 0); };
    el.onkeydown = function (e) { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.kp) { e.target.blur(); } };
    el.querySelectorAll('[data-reset]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); ustaw(a.dataset.reset, null); przelicz(); }; });
    if (aktywny) { var f = el.querySelector('[data-kp="' + aktywny + '"]'); if (f) f.focus(); }
  }

  // ---- widok: dzialki (wskazniki z planu + AI) ----
  function rysujDzialki(r) {
    var tb = $('chl-wsk'); if (!tb) return;
    tb.innerHTML = r.wiersze.map(function (x, i) {
      var d = x.d, w = x.w, maPlan = d.udzialy && d.udzialy.some(function (u) { return u.symbol; });
      var zr = w.zrodlo ? esc(w.zrodlo) : d.wskStan ? esc(d.wskStan) : maPlan ? 'plan miejscowy – wskaźniki nieodczytane' : d.udzialy === undefined ? 'sprawdzamy plan…' : x.ab > 0 ? 'brak planu – założenia typowe' : 'teren niebudowlany';
      var pf = function (k, kr) { var rc = d.wskReczne && d.wskReczne[k] != null; return '<input class="chl-in' + (rc ? ' recz' : '') + '" data-i="' + i + '" data-k="' + k + '" type="number" step="' + kr + '" value="' + (w[k] != null ? w[k] : '') + '" placeholder="' + (k === 'pz' ? Math.round(x.pz * 100) : k === 'kond' ? x.kond : '–') + '">'; };
      var ai = '';
      if (maPlan && !d.wskMPZP && !/czytamy|ustalamy|szukamy/.test(d.wskStan || '')) {
        ai = d.wskBrakZrodla
          ? '<div class="chl-ai"><span>Uchwały nie ma w usługach krajowych' + (d.mpzpInfo && d.mpzpInfo.uchwala ? ' (uchwała ' + esc(d.mpzpInfo.uchwala) + (d.mpzpInfo.dziennik ? ', ' + esc(d.mpzpInfo.dziennik) : '') + ')' : '') + '. Wklej link do PDF uchwały – AI odczyta zapisy:</span>'
            + '<input class="chl-pdf" data-i="' + i + '" placeholder="https://… .pdf (Dziennik Urzędowy / BIP gminy)"><button class="btn pro-mini" data-ai="' + i + '">Odczytaj z AI</button>'
            + (d.mpzpInfo && d.mpzpInfo.link ? ' <a href="' + esc(d.mpzpInfo.link) + '" target="_blank" rel="noopener">strona gminy z uchwałą →</a>' : '') + '</div>'
          : '<div class="chl-ai"><button class="btn pro-mini" data-ai="' + i + '">Odczytaj plan z AI</button><span>AI przeczyta uchwałę i rysunek planu – zwykle do minuty</span></div>';
      }
      return '<tr><td data-k="Działka"><span class="mono" style="font-size:.78rem">' + esc(d.nr) + '</span><div class="chl-zr">' + zr + '</div></td>'
        + '<td data-k="Pow. budowlana" class="num">' + fmt(x.ab) + ' m²</td>'
        + '<td data-k="Zabudowa %">' + pf('pz', 1) + '</td><td data-k="Intensywność">' + pf('i', 0.05) + '</td>'
        + '<td data-k="Wysokość m">' + pf('h', 0.5) + '</td><td data-k="Kondygnacje">' + pf('kond', 1) + '</td>'
        + '<td data-k="Min. działka m²">' + pf('minDz', 10) + '</td>'
        + '<td data-k="Wynik" class="num"><b>' + fmt(x.pum) + ' m²</b><div class="chl-zr">' + x.lok + ' ' + esc(odm(x.lok, TYPY[typ].lok)) + '</div></td></tr>'
        + (d.wskMPZP && d.wskMPZP.opis ? '<tr class="chl-opis"><td colspan="8">Zapisy planu: ' + esc(d.wskMPZP.opis) + '</td></tr>' : '')
        + (ai ? '<tr class="chl-opis"><td colspan="8">' + ai + '</td></tr>' : '');
    }).join('');
    tb.querySelectorAll('.chl-in').forEach(function (inp) {
      inp.onchange = function () { var d = D[+inp.dataset.i]; d.wskReczne = d.wskReczne || {}; if (inp.value === '') delete d.wskReczne[inp.dataset.k]; else d.wskReczne[inp.dataset.k] = +inp.value; przelicz(); };
    });
    tb.querySelectorAll('[data-ai]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.ai, d = D[i], pdfIn = tb.querySelector('.chl-pdf[data-i="' + i + '"]'), pdf = pdfIn ? pdfIn.value.trim() : '';
        if (pdfIn && !/^https?:\/\/\S+$/i.test(pdf)) { pdfIn.focus(); pdfIn.classList.add('zle'); return; }
        b.disabled = true; b.textContent = 'Czytamy…';
        if (window.TerenAI) window.TerenAI(d, pdf || undefined).then(function () { przelicz(); });
      };
    });
  }

  // ---- widok: wycena ----
  var SUWAKI = [
    { k: 'cena', t: 'Cena sprzedaży (brutto)', j: 'zł/m²', min: 3000, max: 25000, krok: 100 },
    { k: 'budowa', t: 'Koszt budowy (netto)', j: 'zł/m²', min: 2000, max: 12000, krok: 100 },
    { k: 'infra', t: 'Drogi, media, zagospodarowanie', j: 'zł/m² terenu', min: 0, max: 300, krok: 5 },
    { k: 'miekkie', t: 'Koszty miękkie (projekt, opłaty, finansowanie, sprzedaż)', j: '% budowy', min: 3, max: 30, krok: 1 },
    { k: 'marza', t: 'Marża dewelopera', j: '% przychodu', min: 5, max: 35, krok: 1 },
    { k: 'vat', t: 'VAT w cenie sprzedaży', j: '%', min: 0, max: 23, krok: 1 }
  ];
  var sygnatura = '';
  function rysujSuwaki(wymus) {
    var el = $('rez-suwaki'); if (!el) return;
    if (!wymus && sygnatura === typ) return; sygnatura = typ;
    el.innerHTML = '<div class="rez-grupa-t">Założenia finansowe · ' + esc(TYPY[typ].nazwa) + '</div>' + SUWAKI.map(function (s) {
      var v = Z(s.k);
      return '<label class="rez-suwak"><span class="rez-t">' + esc(s.t) + '</span><span class="rez-v"><input type="number" data-r="n" data-k="' + s.k + '" value="' + v + '" step="' + s.krok + '"> ' + esc(s.j) + '</span>'
        + '<input type="range" data-r="s" data-k="' + s.k + '" value="' + v + '" min="' + s.min + '" max="' + s.max + '" step="' + s.krok + '"></label>';
    }).join('');
    el.querySelectorAll('input').forEach(function (inp) {
      inp.oninput = function () {
        var v = +inp.value; if (isNaN(v) || inp.value === '') return; ustaw(inp.dataset.k, v);
        var para = el.querySelector('input[data-k="' + inp.dataset.k + '"][data-r="' + (inp.dataset.r === 's' ? 'n' : 's') + '"]'); if (para) para.value = v;
        wyn = policz(); rysujWycene(wyn);
      };
    });
  }
  function rysujWycene(r) {
    var el = $('rez-wynik'); if (!el) return;
    var naM2 = r.pow ? r.grunt / r.pow : 0;
    var por = mediana ? '<div class="s">mediana transakcji w okolicy: ' + fmt(mediana) + ' zł/m² · ' + (naM2 <= 0 ? '<span style="color:#e08a6a">projekt nie pokrywa ceny gruntu</span>' : Math.abs(naM2 / mediana - 1) < 0.03 ? 'na poziomie cen rynkowych' : naM2 >= mediana ? '<span style="color:#9fc79a">o ' + Math.round((naM2 / mediana - 1) * 100) + '% więcej niż rynek – jest rezerwa</span>' : '<span style="color:#e08a6a">o ' + Math.round((1 - naM2 / mediana) * 100) + '% mniej niż ceny rynkowe</span>') + '</div>' : '';
    var wr = function (t, v, op) { return '<tr><td>' + esc(t) + '</td><td class="num">' + zl(v) + '</td><td class="op">' + esc(op) + '</td></tr>'; };
    var zm = [-0.1, 0, 0.1], et = function (z, o) { return z ? (z > 0 ? '+' : '−') + '10%' : o; };
    var tab = '<div class="rez-wraz"><div class="k">Wrażliwość ceny gruntu (mln zł)</div><table><thead><tr><th>koszt budowy ↓ / cena sprzedaży →</th>' + zm.map(function (z) { return '<th>' + et(z, 'obecna') + '</th>'; }).join('') + '</tr></thead><tbody>'
      + zm.map(function (zb) { return '<tr><th>' + et(zb, 'obecny') + '</th>' + zm.map(function (zc) { var g = gruntPrzy(r, 1 + zc, 1 + zb); return '<td class="' + (g < 0 ? 'ujemna' : '') + (!zb && !zc ? ' biezaca' : '') + '">' + (g / 1e6).toFixed(2).replace('.', ',') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    el.innerHTML = '<div class="rez-glowna"><div class="k">Maksymalna cena za grunt</div><div class="v">' + mln(r.grunt) + '</div><div class="s">'
      + (r.grunt > 0 ? fmt(naM2) + ' zł/m² terenu · ' + fmt(r.pum ? r.grunt / r.pum : 0) + ' zł na 1 m² PUM · ' + Math.round(r.przychod ? r.grunt / r.przychod * 100 : 0) + '% przychodu' : 'przy tych założeniach projekt nie zarabia na zakup gruntu') + '</div>' + por + '</div>'
      + '<table class="rez-tab"><tbody>'
      + wr('Przychód ze sprzedaży (bez VAT)', r.przychod, fmt(r.pum) + ' m² × ' + fmt(Z('cena') / (1 + Z('vat') / 100)) + ' zł')
      + wr('− budowa', -r.budowa, fmt(Z('budowa')) + ' zł/m²')
      + wr('− drogi, media, zagospodarowanie', -r.infra, fmt(Z('infra')) + ' zł/m² × ' + fmt(r.ab) + ' m²')
      + wr('− koszty miękkie', -r.miekkie, Z('miekkie') + '% budowy i infrastruktury')
      + wr('− marża dewelopera', -r.marza, Z('marza') + '% przychodu')
      + '<tr class="suma"><td>= wartość rezydualna gruntu</td><td class="num">' + zl(r.grunt) + '</td><td></td></tr></tbody></table>' + tab;
  }

  function przelicz(opc) {
    opc = opc || {};
    if (!D.length || !$('chl-kluczowe')) return;
    wyn = policz();
    if (!opc.bezKluczowych) rysujKluczowe(wyn);
    else {   // w trakcie pisania w polu: odswiezamy tylko liczby wynikowe, bez przerysowania pol
      var T = TYPY[typ], b = $('chl-kluczowe').querySelectorAll('.kp-wynik b');
      if (b[1]) b[1].textContent = fmt(wyn.pcn) + ' m²'; if (b[2]) b[2].textContent = fmt(wyn.pum) + ' m²'; if (b[3]) b[3].textContent = fmt(wyn.lok) + ' ' + odm(wyn.lok, T.lok);
    }
    rysujDzialki(wyn); rysujSuwaki(false); rysujWycene(wyn);
    var czeka = D.some(function (d) { return d.udzialy === undefined || /czytamy|ustalamy|szukamy/.test(d.wskStan || ''); });
    var bez = wyn.wiersze.filter(function (x) { return x.ab > 0 && !x.w.zrodlo && !(x.d.wskReczne && x.d.wskReczne.pz != null); }).length;
    $('chl-uwagi').innerHTML = (czeka ? '<div class="teren-uwaga">Odczytujemy plany działek – wyniki uzupełnią się same.</div>' : '')
      + (bez && !recznie('pz') ? '<div class="teren-uwaga minus">Dla ' + bez + ' z ' + D.length + ' działek nie mamy wskaźników planu – przyjęto ' + TYPY[typ].pz + '% zabudowy. Użyj „Odczytaj plan z AI” albo wpisz wartości z wypisu z planu.</div>' : '');
  }
  function autoTyp() {
    if (typRecznie) return;
    var licz = {};
    D.forEach(function (d) { var t = typZSymbolu(d.wskMPZP && d.wskMPZP.symbol || (d.udzialy && d.udzialy[0] && d.udzialy[0].symbol), d.pog && d.pog.kod); licz[t] = (licz[t] || 0) + d.pow; });
    var t = Object.keys(licz).sort(function (a, b) { return licz[b] - licz[a]; })[0] || 'wolnostojace';
    if (t !== typ) { typ = t; var sel = $('chl-typ'); if (sel) sel.value = t; rysujSuwaki(true); }
  }

  window.TerenChlonnosc = {
    start: function (dzialki) {
      D = dzialki; zal = wczytajZal();
      $('sekcja-chlonnosc').style.display = ''; $('sekcja-rezydualna').style.display = '';
      var sel = $('chl-typ');
      sel.innerHTML = Object.keys(TYPY).map(function (k) { return '<option value="' + k + '">' + esc(TYPY[k].nazwa) + '</option>'; }).join('');
      sel.value = typ;
      sel.onchange = function () { typ = sel.value; typRecznie = true; rysujSuwaki(true); przelicz(); };
      $('rez-reset').onclick = function () { zal = {}; zapiszZal(); rysujSuwaki(true); przelicz(); };
      autoTyp(); rysujSuwaki(true); przelicz();
    },
    // nowe dane z planow: przeliczamy, ale nie w trakcie wpisywania w pole
    odswiez: function (med) {
      if (med != null) mediana = med; if (!D.length) return; autoTyp();
      var a = document.activeElement; if (a && a.tagName === 'INPUT' && a.closest && a.closest('#sekcja-chlonnosc, #sekcja-rezydualna')) return;
      przelicz();
    },
    _parsuj: zTekstuPlanu, _kond: kondZWysokosci
  };
})();
