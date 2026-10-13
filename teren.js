/*
 * gruntowo.pl PRO - ANALIZA TERENU: 2-8 dzialek jako jeden teren (teren.html?dzialki=id1,id2[,..][&teren=idZapisanego])
 * Dane: ULDK (GUGiK) - ksztalt i powierzchnia, KIMPZP - przeznaczenie w planie miejscowym (probkowanie punktow),
 * Rejestr Urbanistyczny / pog-strefy.php - plan ogolny, ceny.php - mediana cen z RCN. Tylko dla zalogowanych PRO.
 */
(function () {
  'use strict';
  var PRO = window.GruntowoPRO;
  var ULDK_PROXY = 'https://script.google.com/macros/s/AKfycbzMevjlU6LD5YKp37spIFdNf8lEfkUWL03PuK8N2Ey8HqBBjBiPgvJASVGQP1yLp_Tf/exec';
  var URL_KIMPZP = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego';
  var URL_RU = 'https://rejestr-urbanistyczny.gov.pl/uslugi-sieciowe/';
  var URL_POG = 'https://sniadecki-development.pl/gruntowo-api/pog-strefy.php';
  var URL_CENY = 'https://sniadecki-development.pl/gruntowo-api/ceny.php';
  var URL_USTALENIA = 'https://sniadecki-development.pl/gruntowo-api/plan-ustalenia.php';
  var STREFY_KODY = ['SW', 'SJ', 'SZ', 'SU', 'SH', 'SP', 'SR', 'SI', 'SN', 'SC', 'SG', 'SO', 'SK'];
  var STATUSY_POG = ['PrawnieWiazacyLubRealizowany', 'WTrakciePrzyjmowania', 'WOpracowaniu'];
  var KOLORY = ['#c9a961', '#6fae8a', '#7aa7d6', '#d97a5b', '#b48ad6', '#e0c35a', '#5bc0be', '#d65b8f'];
  var MNOZNIKI = { droga: 0.3, zielen: 0.3, las: 0.2, wody: 0.1 };
  var NAZWY_KLAS = { droga: 'droga', zielen: 'zieleń', las: 'las', wody: 'wody' };
  var STREFY = { SW: 'wielofunkcyjna z zab. wielorodzinną', SJ: 'wielofunkcyjna z zab. jednorodzinną', SZ: 'zabudowy zagrodowej', SU: 'usługowa', SH: 'handlu wielkopow.', SP: 'gospodarcza', SR: 'produkcji rolnej', SI: 'infrastruktury', SN: 'zieleni i rekreacji', SC: 'cmentarzy', SG: 'górnictwa', SO: 'otwarta', SK: 'komunikacyjna' };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var zl = function (v) { return Math.round(v).toLocaleString('pl-PL') + ' zł'; };
  var m2 = function (v) { return Math.round(v).toLocaleString('pl-PL') + ' m²'; };
  var par = new URLSearchParams(location.search);
  var ID_TERENU = +(par.get('teren') || 0);
  var ids = (par.get('dzialki') || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return /^\d{6}_\d\.[0-9A-Za-z_]{1,12}\.[0-9A-Za-z_\/.\-]{1,30}$/.test(s); });
  ids = ids.filter(function (s, i) { return ids.indexOf(s) === i; }).slice(0, 8);
  var D = [];   // dane dzialek

  // pobranie z limitem czasu (uslugi gmin potrafia "wisiec" minutami - wtedy cala tabela stala na "…") i ponowieniem
  function ponow(url, ile, ms) {
    var ac = window.AbortController ? new AbortController() : null, t = ac ? setTimeout(function () { ac.abort(); }, ms || 20000) : null;
    return fetch(url, ac ? { signal: ac.signal } : undefined).then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r; })
      .catch(function (e) { if (t) clearTimeout(t); if (!ile) throw e; return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return ponow(url, ile - 1, ms); }); });
  }
  // dane opisowe planu z KIMPZP (uchwala, data, poziom informatyzacji, linki) - gdy symbolu terenu brak (plan rastrowy)
  function infoPlanu(html) {
    var t = String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    var m = function (re) { var x = t.match(re); return x ? x[1].trim() : ''; };
    var link = (String(html).match(/Tre[sś][cć] uchwa[łl]y[\s\S]{0,200}?href="([^"]+)"/i) || [])[1] || m(/Treść uchwały (https?:\/\/\S+)/);
    var info = { uchwala: m(/Uchwała ([^\s]+\/[^\s]+)/), data: m(/Data uchwały (\d{4}-\d{2}-\d{2})/), poziom: m(/Poziom informatyzacji (\S+)/),
      dziennik: m(/Dziennik (.+?) Numer planu/), nazwa: m(/Nazwa planu (.+?) (?:Zmiana|Treść|Rysunek)/), link: link || '' };
    return info.uchwala || info.data ? info : null;
  }
  function pierscienie(wkt) {
    return (String(wkt || '').match(/\(([^()]+)\)/g) || []).map(function (r) {
      return r.replace(/[()]/g, '').split(',').map(function (p) { return p.trim().split(/\s+/).map(Number); });
    }).filter(function (r) { return r.length >= 3; });
  }
  function wewnatrz(x, y, rr) {
    var w = false;
    rr.forEach(function (r) { for (var i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / ((r[j][1] - r[i][1]) || 1e-12) + r[i][0]) w = !w; } });
    return w;
  }
  function bbox(rr) { var b = [180, 90, -180, -90]; rr[0].forEach(function (p) { b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])]; }); return b; }

  // --- przeznaczenie z MPZP (jak w raporcie: symbol terenu -> klasa gruntu) ---
  function klasa(symbol) {
    var cz = String(symbol || '').toUpperCase().replace(/^[\d\s.]+/, '').split(/[\/,;+\s]+/).map(function (x) { return x.replace(/[\d.]/g, '').replace(/^-+|-+$/g, ''); }).filter(Boolean);
    if (!cz.length) return null; var k = null;
    for (var i = 0; i < cz.length; i++) {
      var c = cz[i];
      if (/^(M|U|P|RM|MN|MW|ML|MU|UM)/.test(c)) return null;
      var kk = /^(ZL|L|LS)$/.test(c) ? 'las' : /^K/.test(c) ? 'droga' : /^Z/.test(c) ? 'zielen' : /^W/.test(c) ? 'wody' : null;
      if (!kk) return null; if (!k) k = kk;
    }
    return k;
  }
  window.TerenKlasa = klasa;
  function symbolZHtml(html) {
    if (!html) return '';
    var bez = html.replace(/<tr[^>]*>\s*<th[^>]*>\s*(?:nazwa planu|dziennik|tre[sś][cć] uchwa[łl]y|rysunek planu|us[łl]uga|legenda|identyfikator|uchwa[łl]a|zmiana|numer planu|poziom informatyzacji)[\s\S]*?<\/tr>/gi, ' ');
    var pl = bez.replace(/<[^>]+>/g, ' \n ').replace(/&nbsp;/g, ' ');
    var m = pl.match(/\b(\d{0,2}[A-Z]{1,3}\d{0,2}(?:[\.\/][A-Z0-9]{1,4})?)\b(?=[ \t]*[-–:]?[ \t]*(?:[Tt]ereny|[Zz]abudow|[Pp]rzeznacz|[Ff]unkcj))/)
      || pl.match(/(?:[Ss]ymbol|[Oo]znaczenie|[Pp]rzeznaczenie|[Ff]unkcja)[\s:]+(\d{0,2}[A-Z]{1,3}\d{0,2}(?:[\.\/][A-Z0-9]{1,4})?)\b/);
    var fs = html.match(/<FUN_SYMB>([^<]+)<\/FUN_SYMB>/i) || html.match(/>\s*(?:symbol|fun_symb)\s*<\/t[hd]>\s*<td[^>]*>([^<]+)</i);
    return fs ? fs[1].trim() : (m ? m[1] : '');
  }
  function linkZHtml(html) {
    var m = String(html || '').match(/(https?:\/\/[^\s"'<>]+\.pdf)/i);
    return m ? m[1].replace(/&amp;/g, '&') : '';
  }
  function udzialyMPZP(rr, dz) {
    var b = bbox(rr), pkt = [];
    for (var n = 5; n <= 12 && pkt.length < 12; n++) {
      pkt = [];
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { var x = b[0] + (b[2] - b[0]) * (i + 0.5) / n, y = b[1] + (b[3] - b[1]) * (j + 0.5) / n; if (wewnatrz(x, y, rr)) pkt.push([x, y]); }
    }
    if (pkt.length > 16) { var krok = pkt.length / 16; pkt = Array.from({ length: 16 }, function (_, i) { return pkt[Math.floor(i * krok)]; }); }
    if (!pkt.length) return Promise.resolve(null);
    var d = 0.00004;
    var zapytaj = function (p) {
      var url = URL_KIMPZP + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&SRS=EPSG:4326&BBOX=' + [p[0] - d, p[1] - d, p[0] + d, p[1] + d].join(',')
        + '&WIDTH=11&HEIGHT=11&STYLES=&FORMAT=image/png&LAYERS=plany_granice,wektor-str&QUERY_LAYERS=plany_granice,wektor-str&INFO_FORMAT=text/html&FEATURE_COUNT=5&X=5&Y=5';
      return ponow(url, 1, 12000).then(function (r) { return r.text(); }).then(function (h) { if (dz && !dz.mpzpPdf) dz.mpzpPdf = linkZHtml(h); if (dz && !dz.mpzpInfo) dz.mpzpInfo = infoPlanu(h); var s = symbolZHtml(h); return s || (/plany_granice|wektor/i.test(h) && /<td/i.test(h) ? '?' : ''); }).catch(function () { return null; });
    };
    var wyn = [], i2 = 0;
    var kolejne = function () { if (i2 >= pkt.length) return Promise.resolve(); var part = pkt.slice(i2, i2 + 4); i2 += 4; return Promise.all(part.map(zapytaj)).then(function (w) { wyn.push.apply(wyn, w); return kolejne(); }); };
    return kolejne().then(function () {
      var ok = wyn.filter(function (w) { return w !== null; });
      if (!ok.length) return null;
      var licz = {}; ok.forEach(function (w) { licz[w] = (licz[w] || 0) + 1; });
      return Object.keys(licz).map(function (k) { return { symbol: k, udzial: licz[k] / ok.length }; }).sort(function (a, c) { return c.udzial - a.udzial; });
    });
  }
  // --- plan ogolny w srodku dzialki ---
  function pog(id, lon, lat) {
    var L1 = STATUSY_POG.map(function (st) { return 'APP.POG.' + st; }), d = 0.0003;
    STATUSY_POG.forEach(function (st) { STREFY_KODY.forEach(function (k) { L1.push('APP.POG.' + k + '.' + st); }); });
    var url = URL_RU + 'wms-pog/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&SRS=EPSG:4326&BBOX=' + [lon - d, lat - d, lon + d, lat + d].join(',')
      + '&WIDTH=101&HEIGHT=101&X=50&Y=50&LAYERS=' + L1.join(',') + '&QUERY_LAYERS=' + L1.join(',') + '&STYLES=&INFO_FORMAT=application/json&FEATURE_COUNT=20';
    var zSerwera = function (q) {
      return ponow(URL_POG + '?' + q + '&lon=' + lon.toFixed(6) + '&lat=' + lat.toFixed(6), 0, 45000).then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok || !j.strefa) return null;
          var w = j.strefa.wskazniki;
          return { kod: j.strefa.symbol, ozn: j.strefa.oznaczenie, projekt: !!(j.plan && j.plan.projekt), wsk: w ? { i: w.i, pz: w.pz, h: w.h, pbc: w.pbc } : null };
        }).catch(function () { return null; });
    };
    return ponow(url, 1, 15000).then(function (r) { return r.json(); }).then(function (j) {
      var f = j.features || [];
      var str = f.filter(function (x) { return /^APP\.POG\.S[A-Z]{1,2}\./.test(String(x.id)); })[0];
      var plan = f.filter(function (x) { return /^APP\.POG\.(PrawnieWiazacy|WTrakcie|WOpracowaniu)/.test(String(x.id)); })[0];
      if (str) {
        var pp = str.properties || {}, pole = function (w) { var k = Object.keys(pp).filter(function (x) { return w.test(x); })[0]; var v = k ? String(pp[k]) : ''; return v === '-' || v === 'null' ? '' : v; };
        var licz = function (w) { var m = pole(w).replace(',', '.').match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
        var o = pole(/^Oznaczenie/), km = (o.match(/(S[A-Z]{1,2})$/) || String(str.id).match(/APP\.POG\.(S[A-Z]{1,2})\./) || [])[1] || '';
        var wsk = { i: licz(/intensywno/i), pz: licz(/udzia. powierzchni zabudowy/i), h: licz(/wysoko/i), pbc: licz(/biologicznie/i) };
        return { kod: km, ozn: o, projekt: !/PrawnieWiazacy/.test(String(str.id)), wsk: (wsk.i != null || wsk.pz != null || wsk.h != null || wsk.pbc != null) ? wsk : null };
      }
      if (plan) {
        var link = ''; Object.keys(plan.properties || {}).forEach(function (k) { if (/^Link/.test(k)) link = String(plan.properties[k]); });
        var idA = (link.match(/details\/(?:mpzp|pog)\/(\d+)/) || [])[1];
        var proj = !/^APP\.POG\.PrawnieWiazacy/.test(String(plan.id));
        if (idA) return zSerwera('id=' + idA).then(function (w) { if (w) w.projekt = proj; return w; });
      }
      return zSerwera('teryt=' + id.slice(0, 6));
    }).catch(function () { return zSerwera('teryt=' + id.slice(0, 6)); });
  }
  // --- wskazniki MPZP dla terenu dzialki: plan z Rejestru Urbanistycznego (id) albo PDF z KIMPZP, symbol z probkowania,
  //     zapisy odczytuje AI na serwerze (plan-ustalenia.php, wynik zapamietany w bazie - kolejne razy od razu) ---
  function tokenPRO() { try { var p = JSON.parse(localStorage.getItem('gruntowo_dostep_v2') || 'null'); return p && p.haslo ? p.haslo.t : ''; } catch (e) { return ''; } }
  function odpytuj(url, maxProb) {
    return new Promise(function (ok, zle) {
      var proby = 0;
      var pytaj = function () {
        fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.stan === 'gotowe' && d.wynik) return ok(d.wynik);
          if (d.stan === 'w_toku' && ++proby < maxProb) return setTimeout(pytaj, 5000);
          zle(new Error(d.blad || d.stan || 'brak odpowiedzi'));
        }).catch(function () { if (++proby < maxProb) setTimeout(pytaj, 7000); else zle(new Error('serwer nie odpowiedział')); });
      };
      pytaj();
    });
  }
  function planRU(lon, lat) {
    var L = STATUSY_POG.map(function (st) { return 'APP.MPZP.' + st; }), d = 0.0003;
    var url = URL_RU + 'wms-mpzp/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&SRS=EPSG:4326&BBOX=' + [lon - d, lat - d, lon + d, lat + d].join(',')
      + '&WIDTH=101&HEIGHT=101&X=50&Y=50&LAYERS=' + L.join(',') + '&QUERY_LAYERS=' + L.join(',') + '&STYLES=&INFO_FORMAT=application/json&FEATURE_COUNT=10';
    return ponow(url, 1).then(function (r) { return r.json(); }).then(function (j) {
      var f = (j.features || []).filter(function (x) { return /PrawnieWiazacy/.test(String(x.id)); })[0]; if (!f) return '';
      var link = ''; Object.keys(f.properties || {}).forEach(function (k) { if (/^Link/.test(k)) link = String(f.properties[k]); });
      return (link.match(/details\/mpzp\/(\d+)/) || [])[1] || '';
    }).catch(function () { return ''; });
  }
  function wskaznikiMPZP(d, gotowe, pdfReczny) {
    var budowlane = (d.udzialy || []).filter(function (u) { return u.symbol && !klasa(u.symbol); });
    if (!budowlane.length && !pdfReczny) return Promise.resolve();          // brak planu albo same drogi/zielen
    var sym = budowlane.length ? budowlane[0].symbol : '?';
    d.wskStan = 'szukamy uchwały planu…'; d.wskBrakZrodla = false; gotowe();
    return (pdfReczny ? Promise.resolve('') : planRU(d.srodek[0], d.srodek[1])).then(function (idRU) {
      var pdf = pdfReczny || d.mpzpPdf;
      var baza = idRU ? URL_USTALENIA + '?id=' + idRU : pdf ? URL_USTALENIA + '?pdf=' + encodeURIComponent(pdf) : '';
      if (!baza) { d.wskStan = ''; d.wskBrakZrodla = true; gotowe(); return; }   // UI pokaze pole na link do uchwaly
      return PRO.zapewnijDostep().then(function () {
        var t = '&t=' + encodeURIComponent(tokenPRO());
        var symbol = sym !== '?' ? Promise.resolve([sym]) : (d.wskStan = 'ustalamy teren na rysunku planu…', gotowe(),
          odpytuj(baza + '&dzialka=' + encodeURIComponent(d.id) + t, 30).then(function (w) { return (w.symbole || []).map(function (s) { return s.symbol; }).filter(Boolean); }));
        return symbol.then(function (lista) {
          if (!lista.length) throw new Error('nie ustalono terenu planu');
          d.wskStan = 'czytamy zapisy planu ' + lista[0] + '…'; gotowe();
          return odpytuj(baza + '&symbol=' + encodeURIComponent(lista[0]) + t, 30);
        }).then(function (w) {
          var teren = (w.tereny || [])[0];
          var p = window.TerenChlonnosc && TerenChlonnosc._parsuj(teren);
          if (p) { p.symbol = teren.symbol; d.wskMPZP = p; d.wskStan = ''; } else d.wskStan = 'w uchwale brak wskaźników terenu';
          gotowe();
        });
      });
    }).catch(function (e) { d.wskStan = 'zapisy planu: ' + (e && e.message || 'błąd'); gotowe(); });
  }
  // przycisk "Odczytaj plan z AI" w tabeli chlonnosci (teren-chlonnosc.js)
  window.TerenAI = function (d, pdf) { return wskaznikiMPZP(d, odswiezGlobal, pdf); };
  var odswiezGlobal = function () {};
  function mnoznik(dz) {
    if (dz.udzialy && dz.udzialy.some(function (u) { return u.symbol && u.symbol !== '?'; })) {
      var s = 0, op = [];
      dz.udzialy.forEach(function (u) { var k = klasa(u.symbol), m = k ? MNOZNIKI[k] : 1; s += u.udzial * m; if (k) op.push(Math.round(u.udzial * 100) + '% ' + NAZWY_KLAS[k]); });
      return { m: Math.max(0.05, Math.round(s * 100) / 100), opis: op.join(', ') };
    }
    if (dz.pog && !dz.pog.projekt && (dz.pog.kod === 'SN' || dz.pog.kod === 'SK')) return { m: 0.3, opis: 'strefa ' + dz.pog.kod + ' planu ogólnego' };
    return { m: 1, opis: '' };
  }

  // --- przyleganie dzialek (w metrach, lokalnie) ---
  function sasiedztwo() {
    var c = D.reduce(function (a, d) { return [a[0] + d.srodek[0] / D.length, a[1] + d.srodek[1] / D.length]; }, [0, 0]);
    var kx = 111320 * Math.cos(c[1] * Math.PI / 180), ky = 111132;
    var met = D.map(function (d) { return d.rr[0].map(function (p) { return [(p[0] - c[0]) * kx, (p[1] - c[1]) * ky]; }); });
    var odl = function (p, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; var t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    var odlDoObrysu = function (p, r) { var m = 1e9; for (var i = 0; i < r.length - 1; i++) m = Math.min(m, odl(p, r[i], r[i + 1])); return m; };
    var wspolna = function (A, B) {   // dlugosc odcinkow A lezacych na granicy B (tolerancja 1 m)
      var s = 0; for (var i = 0; i < A.length - 1; i++) { if (odlDoObrysu(A[i], B) < 1 && odlDoObrysu(A[i + 1], B) < 1 && odlDoObrysu([(A[i][0] + A[i + 1][0]) / 2, (A[i][1] + A[i + 1][1]) / 2], B) < 1) s += Math.hypot(A[i + 1][0] - A[i][0], A[i + 1][1] - A[i][1]); }
      return s;
    };
    var rodzic = D.map(function (_, i) { return i; }); var znajdz = function (i) { return rodzic[i] === i ? i : (rodzic[i] = znajdz(rodzic[i])); };
    var pary = [];
    for (var i = 0; i < D.length; i++) for (var j = i + 1; j < D.length; j++) {
      var w = Math.max(wspolna(met[i], met[j]), wspolna(met[j], met[i]));
      if (w >= 2) { pary.push([i, j, w]); rodzic[znajdz(i)] = znajdz(j); }
    }
    var grupy = {}; D.forEach(function (_, i) { var r = znajdz(i); (grupy[r] = grupy[r] || []).push(i); });
    var wszystkie = []; met.forEach(function (r) { wszystkie = wszystkie.concat(r); });
    var xs = wszystkie.map(function (p) { return p[0]; }), ys = wszystkie.map(function (p) { return p[1]; });
    return { pary: pary, grupy: Object.keys(grupy).map(function (k) { return grupy[k]; }), szer: Math.max.apply(null, xs) - Math.min.apply(null, xs), wys: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
  }

  // ---------------- rysowanie ----------------
  function rysujMape() {
    if (typeof L === 'undefined') { $('mapa').innerHTML = '<p class="pro-pusto" style="padding:1rem">Mapa chwilowo niedostępna.</p>'; return; }
    var mapa = L.map('mapa');
    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">autorzy OpenStreetMap</a>' }).addTo(mapa);
    var orto = L.tileLayer('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}', { maxNativeZoom: 19, maxZoom: 20, attribution: 'Ortofotomapa: GUGiK' });
    var dz = L.tileLayer.wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow', { layers: 'dzialki,numery_dzialek', format: 'image/png', transparent: true, minZoom: 15, maxZoom: 20, tileSize: 512 }).addTo(mapa);
    L.control.layers({ 'Mapa': osm, 'Ortofotomapa': orto }, { 'Granice działek': dz }, { collapsed: false }).addTo(mapa);
    var grupa = L.featureGroup().addTo(mapa);
    D.forEach(function (d, i) {
      L.polygon(d.rr.map(function (r) { return r.map(function (p) { return [p[1], p[0]]; }); }), { color: KOLORY[i % KOLORY.length], weight: 3, fillOpacity: 0.28 })
        .bindTooltip((i + 1) + '. ' + d.nr, { permanent: true, direction: 'center', className: '' }).addTo(grupa);
    });
    mapa.fitBounds(grupa.getBounds(), { padding: [20, 20], maxZoom: 18 });
  }
  function rysujTabele(mediana) {
    var suma = { pow: 0, wart: 0, bazowa: 0 };
    var wiersze = D.map(function (d, i) {
      var mn = mnoznik(d), wart = mediana ? mediana * d.pow * mn.m : 0;
      suma.pow += d.pow; suma.wart += wart; suma.bazowa += mediana ? mediana * d.pow : 0;
      var mp = d.udzialy === undefined ? '<span class="wczyt">…</span>' : !d.udzialy ? 'brak danych' :
        d.udzialy.filter(function (u) { return u.symbol; }).length ? d.udzialy.map(function (u) { return (u.symbol === '?' ? (d.wskMPZP && d.wskMPZP.symbol ? esc(d.wskMPZP.symbol) : 'plan obowiązuje') : esc(u.symbol)) + (d.udzialy.length > 1 ? ' ~' + Math.round(u.udzial * 100) + '%' : ''); }).join(', ')
          + (d.mpzpInfo ? '<div style="font-size:.72rem;color:var(--sage)">' + esc([d.mpzpInfo.uchwala && 'uchwała ' + d.mpzpInfo.uchwala, d.mpzpInfo.data && d.mpzpInfo.data.slice(0, 4), d.mpzpInfo.poziom === 'rastrowy' ? 'plan rastrowy (skan)' : ''].filter(Boolean).join(' · ')) + '</div>' : '') : 'brak planu';
      var pg = d.pog === undefined ? '<span class="wczyt">…</span>' : !d.pog ? 'brak' : esc(d.pog.ozn || d.pog.kod) + (STREFY[d.pog.kod] ? ' – ' + STREFY[d.pog.kod] : '') + (d.pog.projekt ? ' <em>(projekt)</em>' : '');
      return '<tr><td data-k="#"><span class="kolor-kropka" style="background:' + KOLORY[i % KOLORY.length] + '"></span>' + (i + 1) + '</td>'
        + '<td data-k="Działka"><span class="mono" style="font-size:.78rem">' + esc(d.id) + '</span><div class="opis" style="color:var(--sage);font-size:.75rem">obręb ' + esc(d.obreb) + '</div></td>'
        + '<td data-k="Powierzchnia" class="num">' + m2(d.pow) + '</td><td data-k="MPZP">' + mp + '</td><td data-k="POG">' + pg + '</td>'
        + '<td data-k="Mnożnik" class="num">' + (d.udzialy === undefined ? '…' : (mn.m === 1 ? '1,0' : String(mn.m).replace('.', ',')) + (mn.opis ? '<div style="font-size:.72rem;color:var(--sage)">' + esc(mn.opis) + '</div>' : '')) + '</td>'
        + '<td data-k="Wartość" class="num">' + (mediana ? zl(wart) : '…') + '</td>'
        + '<td><button class="btn pro-mini no-print" data-raport="' + esc(d.id) + '">Raport</button></td></tr>';
    });
    $('tabela').querySelector('tbody').innerHTML = wiersze.join('');
    $('tabela').querySelector('tfoot').innerHTML = '<tr><td></td><td>Teren łącznie</td><td class="num">' + m2(suma.pow) + '</td><td></td><td></td><td></td><td class="num">' + (mediana ? zl(suma.wart) : '…') + '</td><td></td></tr>';
    $('tabela').querySelectorAll('[data-raport]').forEach(function (b) { b.onclick = function () { PRO.zapewnijDostep().then(function () { location.href = 'raport-rozszerzony.html?id=' + encodeURIComponent(b.dataset.raport); }); }; });
    return suma;
  }
  var mediana = 0, liczbaTrans = 0;
  function odswiez() {
    var s = rysujTabele(mediana);
    if (window.TerenChlonnosc) TerenChlonnosc.odswiez(mediana);
    if (mediana) {
      $('k-wart').textContent = zl(s.wart);
      $('k-wart-s').textContent = 'mediana ' + Math.round(mediana).toLocaleString('pl-PL') + ' zł/m² z ' + liczbaTrans + ' transakcji' + (s.bazowa > s.wart + 1 ? ' · bez korekt: ' + zl(s.bazowa) : '');
      $('opis-wyceny').textContent = 'Mediana cen działek niezabudowanych w promieniu 1,5 km od środka terenu: ' + Math.round(mediana).toLocaleString('pl-PL') + ' zł/m² (' + liczbaTrans + ' transakcji, Rejestr Cen Nieruchomości).';
    }
  }

  // ---------------- start ----------------
  function blokada(html) { $('blokada').innerHTML = html; $('blokada').style.display = ''; $('podtytul').textContent = ''; }
  document.addEventListener('DOMContentLoaded', function () {
    $('btn-druk').onclick = function () { window.print(); };
    if (ids.length < 2) { blokada('<p>Wybierz co najmniej 2 działki w <a href="pro.html">panelu PRO</a>.</p>'); return; }
    if (!PRO || !PRO.sesja()) { blokada('<p>Analiza terenu jest dostępna w <strong>gruntowo.pl PRO</strong>. <a class="btn btn-gold" href="pro.html?nowe=1&dodaj=' + encodeURIComponent(ids.join(',')) + '">Załóż konto – 3 dni za darmo</a> <a class="btn" href="pro.html">Zaloguj się</a></p>'); return; }
    PRO.api('ja').then(function (j) {
      if (!j.ok) { blokada('<p>Sesja wygasła. <a class="btn btn-gold" href="pro.html">Zaloguj się</a></p>'); return; }
      if (j.konto.plan === 'wygasl') { blokada('<p>Dostęp PRO wygasł. <a class="btn btn-gold" href="pro.html">Przejdź do panelu i włącz abonament</a></p>'); return; }
      wczytaj();
    }).catch(function () { blokada('<p>Brak połączenia z serwerem. Odśwież stronę.</p>'); });
  });

  function wczytaj() {
    Promise.all(ids.map(function (id) {
      return ponow(ULDK_PROXY + '?id=' + encodeURIComponent(id), 1).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.geom_wkt) throw new Error('brak');
        var rr = pierscienie(d.geom_wkt), b = bbox(rr);
        return { id: id, nr: d.parcel || id.split('.').pop(), obreb: d.region || '', gmina: d.commune || '', powiat: d.county || '', pow: +d.powierzchnia || 0, rr: rr, srodek: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] };
      }).catch(function () { return { id: id, blad: true }; });
    })).then(function (lista) {
      var zle = lista.filter(function (d) { return d.blad; });
      D = lista.filter(function (d) { return !d.blad; });
      if (D.length < 2) { blokada('<p>Nie udało się pobrać danych działek z rejestru GUGiK (' + esc(zle.map(function (d) { return d.id; }).join(', ')) + '). Sprawdź identyfikatory i spróbuj ponownie.</p>'); return; }
      $('tresc').style.display = '';
      var gminy = D.map(function (d) { return d.gmina; }).filter(function (g, i, a) { return g && a.indexOf(g) === i; });
      $('tytul').textContent = 'Teren z ' + D.length + ' działek' + (gminy.length ? ' · gm. ' + gminy.join(', ') : '');
      $('podtytul').textContent = 'Działki: ' + D.map(function (d) { return d.nr; }).join(', ') + (D[0].obreb ? ' · obręb ' + D[0].obreb : '') + (D[0].powiat ? ', ' + D[0].powiat : '');
      var pow = D.reduce(function (a, d) { return a + d.pow; }, 0);
      $('k-pow').textContent = pow >= 10000 ? (pow / 10000).toFixed(2).replace('.', ',') + ' ha' : m2(pow); $('k-pow-s').textContent = m2(pow);
      $('k-ile').textContent = D.length;
      var s = sasiedztwo();
      $('k-wym').textContent = Math.round(s.szer) + ' × ' + Math.round(s.wys) + ' m'; $('k-wym-s').textContent = 'prostokąt obejmujący teren · wypełnienie ' + Math.round(pow / Math.max(1, s.szer * s.wys) * 100) + '%';
      var uw = '';
      if (zle.length) uw += '<div class="teren-uwaga minus">Nie udało się pobrać: ' + esc(zle.map(function (d) { return d.id; }).join(', ')) + ' – pominięte w analizie.</div>';
      if (s.grupy.length === 1) { $('k-ile-s').textContent = 'przylegają do siebie – zwarty teren'; uw += '<div class="teren-uwaga plus"><strong>Działki tworzą zwarty teren</strong> – każda graniczy z co najmniej jedną inną (wspólne granice łącznie ok. ' + Math.round(s.pary.reduce(function (a, p) { return a + p[2]; }, 0)) + ' m).</div>'; }
      else {
        $('k-ile-s').textContent = s.grupy.length + ' oddzielne części';
        uw += '<div class="teren-uwaga minus"><strong>Działki nie tworzą jednego zwartego terenu</strong> – ' + s.grupy.length + ' oddzielne części: ' + s.grupy.map(function (g) { return '[' + g.map(function (i) { return D[i].nr; }).join(', ') + ']'; }).join(' · ') + '. Sprawdź, czy brakuje działki łączącej (np. drogi lub rowu).</div>';
      }
      $('uwagi').innerHTML = uw;
      try { rysujMape(); } catch (e) { console.warn('mapa', e); }
      if (window.TerenChlonnosc) TerenChlonnosc.start(D);
      odswiez();
      ids = D.map(function (d) { return d.id; });
      D.forEach(function (d) { PRO.historia(d.id, 'gm. ' + d.gmina + ' · w analizie terenu'); });
      $('btn-zapisz').disabled = false;
      $('btn-zapisz').onclick = function () {
        var nazwa = prompt('Nazwa terenu (np. „Kiekrz – 3 działki przy lesie”):', $('tytul').textContent); if (nazwa === null) return;
        PRO.api('teren_zapisz', { id: ID_TERENU || undefined, nazwa: nazwa, dzialki: ids }).then(function (j) { if (j.ok) { ID_TERENU = j.id; $('btn-zapisz').textContent = 'Zapisano ✓'; } else alert(j.blad || 'Nie udało się zapisać.'); });
      };
      // ceny w okolicy srodka terenu
      var c = D.reduce(function (a, d) { return [a[0] + d.srodek[0] / D.length, a[1] + d.srodek[1] / D.length]; }, [0, 0]);
      ponow(URL_CENY + '?lon=' + c[0].toFixed(6) + '&lat=' + c[1].toFixed(6) + '&promien=1500&rodzaj=niezabudowana', 1).then(function (r) { return r.json(); }).then(function (j) {
        mediana = +j.mediana_cena_m2 || 0; liczbaTrans = +j.liczba_transakcji || 0;
        if (!mediana) { $('k-wart').textContent = 'brak danych'; $('k-wart-s').textContent = 'za mało transakcji w okolicy'; }
        odswiez();
      }).catch(function () { $('k-wart').textContent = 'brak danych'; $('k-wart-s').textContent = 'serwer cen nie odpowiedział'; });
      // przeznaczenie kazdej dzialki (po kolei - nie obciazamy uslug panstwowych)
      // plan ogolny: dla wszystkich dzialek od razu (kazda osobno, z limitem czasu); plan miejscowy - dzialka po dzialce
      odswiezGlobal = odswiez;
      D.forEach(function (d) { pog(d.id, d.srodek[0], d.srodek[1]).catch(function () { return null; }).then(function (w) { d.pog = w; odswiez(); }); });
      var kolejna = function (i) {
        if (i >= D.length) return;
        udzialyMPZP(D[i].rr, D[i]).catch(function () { return null; })
          .then(function (w) { D[i].udzialy = w; odswiez(); kolejkaAI.push(D[i]); dalejAI(); kolejna(i + 1); });
      };
      // zapisy planow przez AI - po jednej dzialce naraz
      var kolejkaAI = [], pracujeAI = false;
      var dalejAI = function () {
        if (pracujeAI || !kolejkaAI.length) return;
        pracujeAI = true;
        wskaznikiMPZP(kolejkaAI.shift(), odswiez).then(function () { pracujeAI = false; odswiez(); dalejAI(); });
      };
      kolejna(0);
    });
  }
})();
