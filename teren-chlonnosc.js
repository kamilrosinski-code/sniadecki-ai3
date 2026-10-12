/*
 * gruntowo.pl PRO - CHLONNOSC TERENU i WYCENA REZYDUALNA (czesc teren.html)
 *
 * Chlonnosc: z wskaznikow planu (MPZP odczytany przez AI albo strefa planu ogolnego) liczymy dla kazdej dzialki:
 *   powierzchnia budowlana (bez drog, zieleni, lasow i wod z planu) -> maks. powierzchnia zabudowy (PZ%),
 *   powierzchnia calkowita nadziemna PCN = min(zabudowa x kondygnacje, powierzchnia x intensywnosc),
 *   PUM (powierzchnia uzytkowa mieszkan) i orientacyjna liczba domow albo mieszkan.
 * Wycena rezydualna: przychod ze sprzedazy (PUM x cena, bez VAT) - budowa - infrastruktura - koszty miekkie - marza
 *   = ile maksymalnie mozna zaplacic za grunt. Zalozenia ustawia uzytkownik suwakami (zapamietywane w przegladarce).
 * To szacunek koncepcyjny - nie zastepuje koncepcji architekta (linie zabudowy, miejsca postojowe, odleglosci).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v, d) { return (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('pl-PL'); };
  var zl = function (v) { return (v < 0 ? '−' : '') + fmt(Math.abs(v)) + ' zł'; };
  var mln = function (v) { return Math.abs(v) >= 1e6 ? (v < 0 ? '−' : '') + (Math.abs(v) / 1e6).toFixed(2).replace('.', ',') + ' mln zł' : zl(v); };

  // ---- typy zabudowy: domyslne zalozenia ----
  var TYPY = {
    wolnostojace: { nazwa: 'domy wolnostojące', dzialka: 700, pumLokalu: 150, drogi: 15, pumPcn: 0.80, cena: 8000, budowa: 4000, infra: 50, jedn: ['dom', 'domy', 'domów'] },
    blizniaki:    { nazwa: 'domy w zabudowie bliźniaczej', dzialka: 450, pumLokalu: 120, drogi: 15, pumPcn: 0.80, cena: 7500, budowa: 3800, infra: 55, jedn: ['lokal', 'lokale', 'lokali'] },
    szeregowe:    { nazwa: 'zabudowa szeregowa', dzialka: 300, pumLokalu: 100, drogi: 18, pumPcn: 0.80, cena: 7000, budowa: 3600, infra: 60, jedn: ['segment', 'segmenty', 'segmentów'] },
    mieszkania:   { nazwa: 'budynki wielorodzinne (mieszkania)', dzialka: 0, pumLokalu: 55, drogi: 5, pumPcn: 0.72, cena: 9500, budowa: 5800, infra: 30, jedn: ['mieszkanie', 'mieszkania', 'mieszkań'] }
  };
  var ZAL_DOMYSLNE = { marza: 15, miekkie: 10, vat: 8 };
  function odm(n, f) { var d = n % 10, s = n % 100; return n === 1 ? f[0] : (d >= 2 && d <= 4 && (s < 12 || s > 14)) ? f[1] : f[2]; }
  var KLUCZ = 'gruntowo_pro_rezydualna_v1';

  // ---- odczyt liczb z tekstu planu ("maks. 30%", "0,1–0,6", "do 9 m, do 2 kondygnacji", "1 000 m²") ----
  function liczby(t) {
    return (String(t || '').replace(/(\d)[  ](?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d+)?/g) || []).map(function (x) { return parseFloat(x.replace(',', '.')); });
  }
  function procent(t) { var m = String(t || '').match(/(\d+(?:[.,]\d+)?)\s*%/g); if (!m) { var l = liczby(t); return l.length && l[0] <= 100 ? l[0] : null; } var v = m.map(function (x) { return parseFloat(x.replace(',', '.')); }); return v[0]; }
  function procentMaks(t) { var m = String(t || '').match(/(\d+(?:[.,]\d+)?)\s*%/g); if (!m) return procent(t); return Math.max.apply(null, m.map(function (x) { return parseFloat(x.replace(',', '.')); })); }
  function intensywnosc(t) { var l = liczby(t).filter(function (x) { return x <= 10; }); return l.length ? Math.max.apply(null, l) : null; }
  function wysokosc(t) {
    var s = String(t || ''), czesci = s.split(/[;,]|\boraz\b/);
    for (var i = 0; i < czesci.length; i++) {
      var m = czesci[i].match(/(\d+(?:[.,]\d+)?)\s*m\b(?!²|2)/g);
      if (m) return Math.max.apply(null, m.map(function (x) { return parseFloat(x.replace(',', '.')); }));
    }
    return null;
  }
  function kondygnacje(t) { var m = String(t || '').match(/(\d+)\s*(?:kondygnac|kond\.)/i); return m ? +m[1] : null; }
  function minDzialka(t) { var l = liczby(t).filter(function (x) { return x >= 100; }); return l.length ? l[0] : null; }
  function zTekstuPlanu(teren) {
    if (!teren) return null;
    var w = {
      pz: procentMaks(teren.powierzchnia_zabudowy), pbc: procent(teren.biologicznie_czynna), i: intensywnosc(teren.intensywnosc),
      h: wysokosc(teren.wysokosc), kond: kondygnacje(teren.wysokosc), minDz: minDzialka(teren.min_dzialka)
    };
    w.opis = [teren.powierzchnia_zabudowy && 'zabudowa ' + teren.powierzchnia_zabudowy, teren.intensywnosc && 'intensywność ' + teren.intensywnosc,
      teren.wysokosc && 'wysokość ' + teren.wysokosc, teren.biologicznie_czynna && 'biol. czynna ' + teren.biologicznie_czynna, teren.min_dzialka && 'min. działka ' + teren.min_dzialka].filter(Boolean).join(' · ');
    return w;
  }
  function kondZWysokosci(h, typ) { if (!h) return typ === 'mieszkania' ? 4 : 2; return Math.max(1, Math.floor((h - 1) / 3)); }
  // typ zabudowy z symbolu planu
  function typZSymbolu(sym, pogKod) {
    var s = String(sym || '').toUpperCase();
    if (/MW/.test(s)) return 'mieszkania';
    if (/MN|ML|MR|RM/.test(s)) return 'wolnostojace';
    if (pogKod === 'SW') return 'mieszkania';
    return 'wolnostojace';
  }

  // ---- stan modulu ----
  // typ zabudowy: 'auto' = kazda dzialka wg swojego planu (MW -> mieszkania, reszta -> domy), albo jeden typ dla calego terenu
  var D = [], mediana = 0, wybor = 'auto', zal = {}, wiersze = [];
  function wczytajZal() { try { var z = JSON.parse(localStorage.getItem(KLUCZ) || 'null'); if (z && typeof z === 'object') return z; } catch (e) {} return {}; }
  function zapiszZal() { try { localStorage.setItem(KLUCZ, JSON.stringify(zal)); } catch (e) {} }
  function zalTypu(k, t) {
    if (ZAL_DOMYSLNE[k] != null) return zal[k] != null ? zal[k] : ZAL_DOMYSLNE[k];
    return zal[t] && zal[t][k] != null ? zal[t][k] : TYPY[t][k];
  }
  function ustawZal(k, v, t) { if (ZAL_DOMYSLNE[k] != null) zal[k] = v; else { zal[t] = zal[t] || {}; zal[t][k] = v; } zapiszZal(); }
  function typDzialki(d) {
    if (wybor !== 'auto') return wybor;
    var bud = (d.udzialy || []).filter(function (u) { return u.symbol && u.symbol !== '?' && !window.TerenKlasa(u.symbol); });
    return typZSymbolu(d.wskMPZP && d.wskMPZP.symbol || (bud[0] && bud[0].symbol), d.pog && d.pog.kod);
  }

  // wskazniki dzialki: wpisane recznie > MPZP (AI) > strefa POG > brak
  function wskaznikiDzialki(d) {
    var r = d.wskReczne || {}, m = d.wskMPZP, p = d.pog && d.pog.wsk, zr = m ? 'mpzp' : p ? 'pog' : '';
    var w = {}, pola = ['pz', 'pbc', 'i', 'h', 'kond', 'minDz'];
    pola.forEach(function (k) { w[k] = r[k] != null ? r[k] : m && m[k] != null ? m[k] : p && p[k] != null ? p[k] : null; });
    w.zrodlo = zr; return w;
  }
  // udzial powierzchni budowlanej dzialki (bez terenow drog, zieleni, lasu, wod; strefy POG nieinwestycyjne)
  function udzialBudowlany(d) {
    if (d.udzialy && d.udzialy.some(function (u) { return u.symbol && u.symbol !== '?'; })) {
      var s = 0; d.udzialy.forEach(function (u) { if (u.symbol && !window.TerenKlasa(u.symbol)) s += u.udzial; });
      return s;
    }
    if (d.pog && /^(SN|SK|SO|SC|SG|SI|SR)$/.test(d.pog.kod || '')) return 0;
    return 1;
  }

  function policzDzialke(d) {
    var t = typDzialki(d), T = TYPY[t];
    var w = wskaznikiDzialki(d), ab = d.pow * udzialBudowlany(d);
    var pz = w.pz != null ? w.pz / 100 : (t === 'mieszkania' ? 0.35 : 0.30);
    var kond = w.kond || kondZWysokosci(w.h, t);
    var I = w.i;
    var wyn = { d: d, t: t, w: w, ab: ab, pz: pz, kond: kond, zalozone: !w.zrodlo || w.pz == null, zabudowa: 0, pcn: 0, pum: 0, lokale: 0, maksPcn: 0 };
    if (ab <= 0) return wyn;
    wyn.maksPcn = Math.min(ab * pz * kond, I ? ab * I : Infinity);
    if (t === 'mieszkania') {
      wyn.zabudowa = ab * pz;
      wyn.pcn = wyn.maksPcn;
      wyn.pum = wyn.pcn * T.pumPcn;
      wyn.lokale = Math.floor(wyn.pum / Math.max(25, zalTypu('pumLokalu', t)));
    } else {
      var dz = Math.max(zalTypu('dzialka', t), w.minDz || 0);
      var n = Math.floor(ab * (1 - zalTypu('drogi', t) / 100) / dz);
      var pcnL = Math.min(dz * pz * kond, I ? dz * I : Infinity);
      var pumL = Math.min(pcnL * T.pumPcn, zalTypu('pumLokalu', t));
      wyn.dzialkaLokalu = dz; wyn.lokale = n;
      wyn.zabudowa = n * Math.min(dz * pz, pumL / T.pumPcn);
      wyn.pcn = n * pumL / T.pumPcn; wyn.pum = n * pumL;
    }
    return wyn;
  }
  function rezydualnaWiersza(r, mnC, mnB) {
    var t = r.t, cenaN = zalTypu('cena', t) * (mnC || 1) / (1 + zalTypu('vat') / 100);
    var o = { przychod: r.pum * cenaN, budowa: r.pum * zalTypu('budowa', t) * (mnB || 1), infra: r.ab * zalTypu('infra', t) };
    o.miekkie = (o.budowa + o.infra) * zalTypu('miekkie') / 100; o.marza = o.przychod * zalTypu('marza') / 100;
    o.grunt = o.przychod - o.budowa - o.infra - o.miekkie - o.marza; return o;
  }
  function rezydualna(mnC, mnB) {
    return wiersze.reduce(function (a, r) { var o = rezydualnaWiersza(r, mnC, mnB); Object.keys(o).forEach(function (k) { a[k] = (a[k] || 0) + o[k]; }); return a; }, { przychod: 0, budowa: 0, infra: 0, miekkie: 0, marza: 0, grunt: 0 });
  }
  function typyObecne() { var o = []; wiersze.forEach(function (r) { if (r.ab > 0 && o.indexOf(r.t) < 0) o.push(r.t); }); return o.length ? o : [wybor === 'auto' ? 'wolnostojace' : wybor]; }

  // ---- widok ----
  var SUWAKI_WSPOLNE = [
    { k: 'miekkie', t: 'Koszty miękkie (projekt, opłaty, finansowanie, sprzedaż)', j: '% budowy', min: 3, max: 30, krok: 1 },
    { k: 'marza', t: 'Marża dewelopera', j: '% przychodu', min: 5, max: 35, krok: 1 },
    { k: 'vat', t: 'VAT w cenie sprzedaży', j: '%', min: 0, max: 23, krok: 1 }
  ];
  var SUWAKI_TYPU = [
    { k: 'cena', t: 'Cena sprzedaży (brutto)', j: 'zł/m² PUM', min: 3000, max: 25000, krok: 100 },
    { k: 'budowa', t: 'Koszt budowy (netto)', j: 'zł/m² PUM', min: 2000, max: 12000, krok: 100 },
    { k: 'infra', t: 'Drogi, media, zagospodarowanie', j: 'zł/m² terenu', min: 0, max: 300, krok: 5 },
    { k: 'pumLokalu', t: 'Średnia wielkość domu / lokalu', j: 'm² PUM', min: 25, max: 300, krok: 5 },
    { k: 'dzialka', t: 'Działka na 1 dom / lokal', j: 'm²', min: 150, max: 3000, krok: 10, tylkoDomy: true },
    { k: 'drogi', t: 'Drogi wewnętrzne przy podziale', j: '% terenu', min: 0, max: 35, krok: 1, tylkoDomy: true }
  ];
  var sygnaturaSuwakow = '';
  function suwak(s, t) {
    var v = zalTypu(s.k, t), a = 'data-k="' + s.k + '" data-t="' + (t || '') + '"';
    return '<label class="rez-suwak"><span class="rez-t">' + esc(s.t) + '</span><span class="rez-v"><input type="number" data-r="n" ' + a + ' value="' + v + '" min="' + s.min + '" max="' + s.max + '" step="' + s.krok + '"> ' + esc(s.j) + '</span>'
      + '<input type="range" data-r="s" ' + a + ' value="' + v + '" min="' + s.min + '" max="' + s.max + '" step="' + s.krok + '"></label>';
  }
  function rysujSuwaki(wymus) {
    var el = $('rez-suwaki'); if (!el) return;
    var typy = typyObecne(), sig = typy.join(',');
    if (!wymus && sig === sygnaturaSuwakow) return;   // nie przerysowujemy w trakcie przesuwania
    sygnaturaSuwakow = sig;
    el.innerHTML = typy.map(function (t) {
      return '<div class="rez-grupa"><div class="rez-grupa-t">' + esc(TYPY[t].nazwa) + '</div>' + SUWAKI_TYPU.filter(function (s) { return !(s.tylkoDomy && t === 'mieszkania'); }).map(function (s) { return suwak(s, t); }).join('') + '</div>';
    }).join('') + '<div class="rez-grupa"><div class="rez-grupa-t">Wspólne</div>' + SUWAKI_WSPOLNE.map(function (s) { return suwak(s, ''); }).join('') + '</div>';
    el.querySelectorAll('input').forEach(function (inp) {
      inp.oninput = function () {
        var k = inp.dataset.k, t = inp.dataset.t, v = +inp.value; if (isNaN(v) || inp.value === '') return;
        ustawZal(k, v, t);
        var para = el.querySelector('input[data-k="' + k + '"][data-t="' + t + '"][data-r="' + (inp.dataset.r === 's' ? 'n' : 's') + '"]'); if (para) para.value = v;
        przelicz(false);
      };
    });
  }
  function rysujWskazniki() {
    var tb = $('chl-wsk'); if (!tb) return;
    var aktywny = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('chl-in') ? document.activeElement.dataset.i + '|' + document.activeElement.dataset.k : '';
    tb.innerHTML = wiersze.map(function (r, i) {
      var d = r.d, w = r.w, ozn = d.wskMPZP ? 'MPZP ' + esc(d.wskMPZP.symbol || '') : d.pog && d.pog.wsk ? 'plan ogólny ' + esc(d.pog.ozn || d.pog.kod) + (d.pog.projekt ? ' (projekt)' : '') : (d.wskStan ? esc(d.wskStan) : (r.ab > 0 ? 'brak wskaźników – założenia typowe' : 'teren niebudowlany'));
      var pole = function (k, kr) { var rc = d.wskReczne && d.wskReczne[k] != null; return '<input class="chl-in' + (rc ? ' recz' : '') + '" data-i="' + i + '" data-k="' + k + '" type="number" step="' + kr + '" value="' + (w[k] != null ? w[k] : '') + '" placeholder="' + (k === 'kond' && r.ab > 0 ? r.kond : k === 'pz' && r.ab > 0 ? Math.round(r.pz * 100) : '–') + '">'; };
      return '<tr><td data-k="Działka"><span class="mono" style="font-size:.78rem">' + esc(d.nr) + '</span><div style="font-size:.72rem;color:var(--sage)">' + ozn + ' · ' + esc(TYPY[r.t].nazwa) + '</div></td>'
        + '<td data-k="Pow. budowlana" class="num">' + fmt(r.ab) + ' m²</td>'
        + '<td data-k="Maks. zabudowa %">' + pole('pz', 1) + '</td><td data-k="Intensywność">' + pole('i', 0.05) + '</td>'
        + '<td data-k="Wysokość m">' + pole('h', 0.5) + '</td><td data-k="Kondygnacje">' + pole('kond', 1) + '</td>'
        + '<td data-k="Biol. czynna %">' + pole('pbc', 1) + '</td><td data-k="Min. działka m²">' + pole('minDz', 10) + '</td>'
        + '<td data-k="PUM" class="num">' + fmt(r.pum) + ' m²<div style="font-size:.72rem;color:var(--sage)">' + r.lokale + ' ' + esc(odm(r.lokale, TYPY[r.t].jedn)) + '</div></td></tr>'
        + (d.wskMPZP && d.wskMPZP.opis ? '<tr class="chl-opis"><td colspan="9">Zapisy planu: ' + esc(d.wskMPZP.opis) + '</td></tr>' : '');
    }).join('');
    tb.querySelectorAll('.chl-in').forEach(function (inp) {
      inp.onchange = function () {
        var d = D[+inp.dataset.i]; d.wskReczne = d.wskReczne || {};
        if (inp.value === '') delete d.wskReczne[inp.dataset.k]; else d.wskReczne[inp.dataset.k] = +inp.value;
        przelicz(true);
      };
    });
    if (aktywny) { var a = aktywny.split('|'), el = tb.querySelector('.chl-in[data-i="' + a[0] + '"][data-k="' + a[1] + '"]'); if (el) el.focus(); }
  }

  function przelicz(odswiezTabele) {
    if (!D.length || !$('chl-wyniki')) return;
    wiersze = D.map(policzDzialke);
    rysujSuwaki(false);
    if (odswiezTabele !== false) rysujWskazniki();
    var s = wiersze.reduce(function (a, r) { a.ab += r.ab; a.zab += r.zabudowa; a.pcn += r.pcn; a.pum += r.pum; a.maksPcn += r.maksPcn; a.lok[r.t] = (a.lok[r.t] || 0) + r.lokale; return a; }, { ab: 0, zab: 0, pcn: 0, pum: 0, maksPcn: 0, lok: {} });
    var pow = D.reduce(function (a, d) { return a + d.pow; }, 0);
    var bezWsk = wiersze.filter(function (r) { return r.ab > 0 && r.zalozone; }).length;
    var czeka = D.some(function (d) { return d.udzialy === undefined || (d.wskStan && /czytamy|ustalamy/i.test(d.wskStan)); });
    var lok = Object.keys(s.lok).filter(function (t) { return s.lok[t] > 0; }).map(function (t) { return fmt(s.lok[t]) + ' ' + odm(s.lok[t], TYPY[t].jedn); });
    var domy = wiersze.some(function (r) { return r.t !== 'mieszkania' && r.ab > 0; });
    $('chl-wyniki').innerHTML =
      kafel('Powierzchnia budowlana', fmt(s.ab) + ' m²', Math.round(s.ab / Math.max(1, pow) * 100) + '% terenu (bez dróg, zieleni, lasów i wód z planu)')
      + kafel('Maks. powierzchnia zabudowy', fmt(s.zab) + ' m²', 'rzut budynków na gruncie')
      + kafel('PUM – powierzchnia użytkowa', fmt(s.pum) + ' m²', 'nadziemna całkowita ' + fmt(s.pcn) + ' m²' + (domy && s.maksPcn > s.pcn * 1.15 ? ' · plan pozwala do ' + fmt(s.maksPcn) + ' m² (np. przy zabudowie wielorodzinnej)' : ''))
      + kafel('Orientacyjnie', lok.length ? lok.join(' + ') : '–', typyObecne().map(function (t) { return TYPY[t].nazwa; }).join(', '));
    $('chl-uwagi').innerHTML = (czeka ? '<div class="teren-uwaga">Czytamy plany miejscowe (zapisy uchwał odczytuje AI) – wyniki uzupełnią się same, zwykle do minuty na działkę.</div>' : '')
      + (bezWsk ? '<div class="teren-uwaga minus">Dla ' + bezWsk + ' z ' + wiersze.length + ' działek brak wskaźników planu – przyjęto typowe wartości (30–35% zabudowy, wysokość wg typu). Wpisz je w tabeli z wypisu z planu albo warunków zabudowy.</div>' : '');
    // wycena rezydualna
    var r = rezydualna();
    var naM2 = pow ? r.grunt / pow : 0;
    var por = mediana ? '<div class="s">mediana transakcji w okolicy: ' + fmt(mediana) + ' zł/m² · ' + (naM2 <= 0 ? '<span style="color:#e08a6a">projekt nie pokrywa ceny gruntu</span>' : Math.abs(naM2 / mediana - 1) < 0.03 ? 'na poziomie cen rynkowych' : naM2 >= mediana ? '<span style="color:#7fc29b">o ' + Math.round((naM2 / mediana - 1) * 100) + '% więcej niż rynek – jest rezerwa</span>' : '<span style="color:#e08a6a">o ' + Math.round((1 - naM2 / mediana) * 100) + '% mniej niż ceny rynkowe</span>') + '</div>' : '';
    var srCena = s.pum ? r.przychod / s.pum : 0;
    $('rez-wynik').innerHTML = '<div class="rez-glowna"><div class="k">Maksymalna cena za grunt</div><div class="v">' + mln(r.grunt) + '</div><div class="s">' + (r.grunt > 0 ? fmt(naM2) + ' zł/m² terenu' + (s.pum ? ' · ' + fmt(r.grunt / s.pum) + ' zł na 1 m² PUM' : '') : 'przy tych założeniach projekt nie zarabia na zakup gruntu') + '</div>' + por + '</div>'
      + '<table class="rez-tab"><tbody>'
      + wiersz('Przychód ze sprzedaży (bez VAT)', r.przychod, fmt(s.pum) + ' m² × ' + fmt(srCena) + ' zł')
      + wiersz('− budowa', -r.budowa, s.pum ? fmt(r.budowa / s.pum) + ' zł/m² PUM' : '')
      + wiersz('− drogi, media, zagospodarowanie', -r.infra, fmt(s.ab) + ' m² terenu budowlanego')
      + wiersz('− koszty miękkie', -r.miekkie, zalTypu('miekkie') + '% budowy i infrastruktury')
      + wiersz('− marża dewelopera', -r.marza, zalTypu('marza') + '% przychodu')
      + '<tr class="suma"><td>= wartość rezydualna gruntu</td><td class="num">' + zl(r.grunt) + '</td><td></td></tr></tbody></table>'
      + wrazliwosc();
  }
  function kafel(k, v, s) { return '<div class="teren-kafel"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }
  function wiersz(t, v, op) { return '<tr><td>' + esc(t) + '</td><td class="num">' + zl(v) + '</td><td class="op">' + esc(op) + '</td></tr>'; }
  // tabela wrazliwosci: cena sprzedazy i koszt budowy +/-10%
  function wrazliwosc() {
    var zm = [-0.1, 0, 0.1], et = function (z, o) { return z ? (z > 0 ? '+' : '−') + '10%' : o; };
    var h = '<div class="rez-wraz"><div class="k">Wrażliwość ceny gruntu (mln zł)</div><table><thead><tr><th>koszt budowy ↓ / cena sprzedaży →</th>' + zm.map(function (z) { return '<th>' + et(z, 'obecna') + '</th>'; }).join('') + '</tr></thead><tbody>';
    zm.forEach(function (zb) {
      h += '<tr><th>' + et(zb, 'obecny') + '</th>';
      zm.forEach(function (zc) { var g = rezydualna(1 + zc, 1 + zb).grunt; h += '<td class="' + (g < 0 ? 'ujemna' : '') + (zb === 0 && zc === 0 ? ' biezaca' : '') + '">' + (g / 1e6).toFixed(2).replace('.', ',') + '</td>'; });
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  window.TerenChlonnosc = {
    start: function (dzialki) {
      D = dzialki; zal = wczytajZal();
      $('sekcja-chlonnosc').style.display = ''; $('sekcja-rezydualna').style.display = '';
      var sel = $('chl-typ');
      sel.innerHTML = '<option value="auto">według planu każdej działki</option>' + Object.keys(TYPY).map(function (k) { return '<option value="' + k + '">wszędzie: ' + esc(TYPY[k].nazwa) + '</option>'; }).join('');
      sel.onchange = function () { wybor = sel.value; przelicz(true); };
      $('rez-reset').onclick = function () { zal = {}; zapiszZal(); rysujSuwaki(true); przelicz(false); };
      przelicz(true);
    },
    odswiez: function (med) { if (med != null) mediana = med; if (D.length) przelicz(true); },
    _parsuj: zTekstuPlanu, _kond: kondZWysokosci
  };
})();
