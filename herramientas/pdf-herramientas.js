/* AnimusLex · Herramientas PDF para escritos judiciales (achicar y dividir).
   Todo se procesa en el navegador: el archivo nunca se sube a ningún servidor.
   Librerías (alojadas en /herramientas/lib/): pdf.js 3.11.174 (Apache-2.0), pdf-lib 1.17.1 (MIT), JSZip 3.10.1 (MIT).
   Avisos de licencia completos: /herramientas/lib/LICENCIAS.txt */
(function () {
  'use strict';
  var MB = 1000 * 1000;   // megas decimales; se muestran redondeando hacia abajo para no pasarse nunca del límite
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/herramientas/lib/pdf.worker.min.js';
  try { pdfjsLib.GlobalWorkerOptions.workerPort = new Worker('/herramientas/lib/pdf.worker.min.js'); } catch (e) { /* si no se puede, pdf.js lo crea solo */ }
  var PDFDocument = PDFLib.PDFDocument;

  // ---------- utilidades ----------
  function $(sel) { return document.querySelector(sel); }
  function fmt(b) {
    if (b < 0.1 * MB) return Math.max(1, Math.round(b / 1024)) + ' KB';
    return (Math.floor(b / MB * 10) / 10).toLocaleString('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB';
  }
  function baseName(name) {
    return (name || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'documento';
  }
  function partName(base, i, n) { return base + ' - Parte ' + i + ' de ' + n + '.pdf'; }
  function isPdf(bytes) { return new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).indexOf('%PDF') !== -1; }
  function hasSignature(bytes) {   // firma digital: diccionario /Sig con /ByteRange
    var dec = new TextDecoder('latin1'), step = 4 * MB;
    for (var i = 0; i < bytes.length; i += step) {
      var s = dec.decode(bytes.subarray(i, Math.min(bytes.length, i + step + 32)));
      if (s.indexOf('/ByteRange') !== -1) return true;
    }
    return false;
  }
  function nextFrame() { return new Promise(function (r) { setTimeout(r, 0); }); }

  async function loadLib(bytes) {
    try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test(String(e && (e.name + e.message)))) { var err = new Error('Este PDF está protegido con contraseña o cifrado. Abrilo, guardalo sin protección y probá de nuevo.'); err.cifrado = true; throw err; }
      throw new Error('No se pudo leer el PDF: puede estar dañado.');
    }
  }
  async function analyze(bytes) {
    var pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    var n = pdf.numPages, m = Math.min(3, n), chars = 0;
    for (var i = 1; i <= m; i++) {
      var tc = await (await pdf.getPage(i)).getTextContent();
      chars += tc.items.reduce(function (s, it) { return s + (it.str || '').length; }, 0);
    }
    await pdf.destroy();
    return { pages: n, textual: chars / m > 200 };
  }

  function firmar(doc, src) {   // metadatos del archivo resultante
    try { doc.setProducer('AnimusLex · animuslex.app/herramientas'); doc.setCreator('AnimusLex'); var t = src && src.getTitle && src.getTitle(); if (t) doc.setTitle(t); } catch (e) { }
  }

  // ---------- dividir ----------
  async function buildRange(src, a, b) {   // páginas [a, b), base 0
    var doc = await PDFDocument.create(), idx = [];
    for (var i = a; i < b; i++) idx.push(i);
    var pages = await doc.copyPages(src, idx);
    pages.forEach(function (p) { doc.addPage(p); });
    firmar(doc, src);
    return await doc.save({ useObjectStreams: true });
  }
  async function splitBySize(src, limit, onProgress) {
    var n = src.getPageCount(), parts = [], start = 0;
    while (start < n) {
      var end = start + 1, best = await buildRange(src, start, end), over = best.length > limit;
      if (!over) {
        var lo = end, hi = null, step = 1;
        while (lo < n) {                                   // crece de a 1, 2, 4, 8… páginas
          var t = Math.min(n, lo + step), b = await buildRange(src, start, t);
          if (b.length <= limit) { lo = t; best = b; step *= 2; } else { hi = t; break; }
          onProgress && onProgress(lo, n); await nextFrame();
        }
        if (hi !== null) {                                 // búsqueda binaria entre lo (entra) y hi (no entra)
          while (hi - lo > 1) {
            var mid = (lo + hi) >> 1, bm = await buildRange(src, start, mid);
            if (bm.length <= limit) { lo = mid; best = bm; } else { hi = mid; }
            await nextFrame();
          }
        }
        end = lo;
      }
      parts.push({ from: start + 1, to: end, bytes: best, over: over });
      start = end; onProgress && onProgress(start, n); await nextFrame();
    }
    return parts;
  }
  async function splitEvery(src, k, onProgress) {
    var n = src.getPageCount(), parts = [];
    for (var a = 0; a < n; a += k) {
      var b = Math.min(n, a + k), bytes = await buildRange(src, a, b);
      parts.push({ from: a + 1, to: b, bytes: bytes }); onProgress && onProgress(b, n); await nextFrame();
    }
    return parts;
  }
  function parseRanges(text, n) {
    var out = [];
    String(text || '').split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (r) {
      var m = r.match(/^(\d+)\s*(?:-|a|al|–)\s*(\d+)$/i) || r.match(/^(\d+)$/);
      if (!m) throw new Error('No entiendo el rango «' + r + '». Usá el formato 1-10, 11-25.');
      var a = parseInt(m[1], 10), b = parseInt(m[2] || m[1], 10);
      if (a < 1 || b > n || a > b) throw new Error('El rango «' + r + '» no es válido: el PDF tiene ' + n + ' páginas.');
      out.push([a, b]);
    });
    if (!out.length) throw new Error('Escribí al menos un rango de páginas, por ejemplo: 1-10, 11-25.');
    return out;
  }
  async function splitRanges(src, ranges, onProgress) {
    var parts = [];
    for (var i = 0; i < ranges.length; i++) {
      var bytes = await buildRange(src, ranges[i][0] - 1, ranges[i][1]);
      parts.push({ from: ranges[i][0], to: ranges[i][1], bytes: bytes }); onProgress && onProgress(i + 1, ranges.length); await nextFrame();
    }
    return parts;
  }

  // ---------- achicar ----------
  async function compressKeep(bytes) {   // reescribe el PDF sin objetos sobrantes: el texto sigue siendo texto
    var src = await loadLib(bytes), doc = await PDFDocument.create();
    var pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach(function (p) { doc.addPage(p); });
    firmar(doc, src);
    return await doc.save({ useObjectStreams: true });
  }
  async function compressRaster(bytes, opt, onProgress) {   // cada página pasa a imagen JPEG a la resolución elegida
    var pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise, n = pdf.numPages;
    var out = await PDFDocument.create(), canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: !!opt.gray });
    try {
    for (var i = 1; i <= n; i++) {
      var page = await pdf.getPage(i), vp1 = page.getViewport({ scale: 1 });
      var scale = opt.dpi / 72, px = vp1.width * vp1.height * scale * scale;
      if (px > 16e6) scale *= Math.sqrt(16e6 / px);            // tope de memoria (y del canvas de iPhone) para páginas gigantes
      var vp = page.getViewport({ scale: scale });
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (opt.gray) {
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
        for (var k = 0; k < d.length; k += 4) { var y = (d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114) | 0; d[k] = d[k + 1] = d[k + 2] = y; }
        ctx.putImageData(img, 0, 0);
      }
      var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/jpeg', opt.quality); });
      if (!blob) throw new Error('El navegador no pudo procesar la página ' + i + '. Probá con una calidad más baja o desde una computadora.');
      var jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      out.addPage([vp1.width, vp1.height]).drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      page.cleanup(); onProgress && onProgress(i, n); await nextFrame();
    }
    } finally { canvas.width = canvas.height = 0; await pdf.destroy(); }
    firmar(out, estado.src);
    return await out.save({ useObjectStreams: true });
  }

  // ---------- interfaz común ----------
  var urls = [];
  function clearUrls() { urls.forEach(URL.revokeObjectURL); urls = []; }
  function blobUrl(bytes) { var u = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); urls.push(u); return u; }
  function setProgress(done, total, label) {
    var box = $('#progreso'); box.hidden = false;
    $('#progreso-barra').max = total; $('#progreso-barra').value = done;
    $('#progreso-texto').textContent = label + ' ' + done + ' de ' + total;
  }
  function hideProgress() { $('#progreso').hidden = true; }
  function showError(msg) { var e = $('#error'); e.textContent = msg; e.hidden = !msg; }
  function busy(on) { document.querySelectorAll('[data-run]').forEach(function (b) { b.disabled = on; }); }

  function renderParts(parts, base, limit, target) {
    var box = target || $('#resultado'), n = parts.length, list = document.createElement('div');
    list.className = 'space-y-2';
    parts.forEach(function (p, i) {
      p.name = partName(base, i + 1, n);
      var ok = p.bytes.length <= limit, row = document.createElement('div');
      row.className = 'fila-parte';
      row.innerHTML = '<div class="min-w-0"><div class="nombre"></div><div class="detalle"></div></div>' +
        '<a class="btn-descarga">Descargar</a>';
      row.querySelector('.nombre').textContent = p.name;
      row.querySelector('.detalle').textContent = 'Páginas ' + p.from + (p.to > p.from ? '–' + p.to : '') + ' · ' + fmt(p.bytes.length) + (ok ? ' ✔' : ' ⚠ pasa el límite');
      if (!ok) row.classList.add('fila-mal');
      var a = row.querySelector('a'); a.href = blobUrl(p.bytes); a.download = p.name;
      list.appendChild(row);
    });
    var head = document.createElement('p'); head.className = 'resumen';
    head.textContent = n === 1 ? 'Entra en un solo archivo:' : 'Listo: ' + n + ' partes, cada una para subir como un anexo.';
    box.innerHTML = ''; box.appendChild(head); box.appendChild(list);
    if (parts.some(function (p) { return p.over || p.bytes.length > limit; })) {
      var w = document.createElement('p'); w.className = 'aviso';
      w.textContent = parts.some(function (p) { return p.over; })
        ? 'Alguna página sola pesa más que el límite. Probá primero «Achicar PDF» y después dividí el resultado.'
        : 'Alguna parte pasa el límite de 15 MB del portal: elegí menos páginas por parte o usá el modo automático.';
      box.appendChild(w);
    }
    if (n > 1) {
      var z = document.createElement('button'); z.className = 'btn-gold px-6 py-3 rounded-full mt-4'; z.textContent = 'Descargar todas (ZIP)';
      z.onclick = async function () {
        z.disabled = true; z.textContent = 'Armando el ZIP…';
        var zip = new JSZip(); parts.forEach(function (p) { zip.file(p.name, p.bytes); });
        var blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }), u = URL.createObjectURL(blob); urls.push(u);
        var a = document.createElement('a'); a.href = u; a.download = base + ' - partes.zip'; document.body.appendChild(a); a.click(); a.remove();
        z.disabled = false; z.textContent = 'Descargar todas (ZIP)';
      };
      box.appendChild(z);
    }
    box.hidden = false;
  }

  function setupDrop(onFile) {
    var input = $('#archivo'), zone = $('#zona');
    input.addEventListener('change', function () { var f = input.files[0]; if (f) onFile(f); input.value = ''; });
    ['dragover', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); }); });
    ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('zona-activa'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('zona-activa'); }); });
    zone.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) onFile(f); });
  }

  var estado = { file: null, bytes: null, base: '', src: null };
  async function cargar(file, extra) {
    showError(''); clearUrls(); $('#resultado').hidden = true; $('#resultado').innerHTML = ''; hideProgress();
    $('#info').hidden = true; $('#opciones').hidden = true; $('#aviso-firma').hidden = true;
    estado.file = null; estado.bytes = null; estado.src = null;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { showError('Elegí un archivo PDF.'); return false; }
    var bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdf(bytes)) { showError('Este archivo no es un PDF de verdad (aunque termine en .pdf). Convertilo a PDF y probá de nuevo.'); return false; }
    estado.file = file; estado.bytes = bytes; estado.base = baseName(file.name);
    var info = null; estado.soloLectura = false;
    try { estado.src = await loadLib(bytes); info = { pages: estado.src.getPageCount(), textual: false }; }
    catch (e) {
      if (!(e.cifrado && document.body.getAttribute('data-herramienta') === 'achicar')) { showError(e.message); return false; }
      try { info = await analyze(bytes); estado.soloLectura = true; }   // abre sin clave (protección solo de propietario): se achica en modo Escaneado
      catch (e2) { showError('Este PDF pide una contraseña para abrirse. Abrilo, guardalo sin protección y probá de nuevo.'); return false; }
    }
    if (!estado.soloLectura) { try { info = await analyze(bytes); } catch (e) { /* el análisis es solo orientativo */ } }
    $('#info').hidden = false;
    $('#info-nombre').textContent = file.name;
    $('#info-datos').textContent = fmt(bytes.length) + ' · ' + info.pages + (info.pages === 1 ? ' página' : ' páginas');
    $('#aviso-firma').hidden = !hasSignature(bytes);
    if ($('#nombre-base')) $('#nombre-base').value = estado.base;
    extra && extra(info);
    $('#opciones').hidden = false;
    return true;
  }
  function limite() { var v = $('#limite').value; return v === 'max' ? 14.95 * MB : parseFloat(v) * MB; }
  function limiteTxt() { var v = $('#limite').value; return v === 'max' ? '15 MB' : v + ' MB'; }
  function modoSugerido(info, bytes) { return info.textual && bytes.length / Math.max(1, info.pages) < 400 * 1000 ? 'texto' : 'escaneado'; }

  // ---------- página: dividir ----------
  function initDividir() {
    setupDrop(function (f) { cargar(f); });
    function updateModo() {
      var m = document.querySelector('input[name="modo"]:checked').value;
      $('#campo-limite').hidden = m !== 'auto';
      $('#campo-cada').hidden = m !== 'cada';
      $('#campo-rangos').hidden = m !== 'rangos';
    }
    document.querySelectorAll('input[name="modo"]').forEach(function (r) { r.addEventListener('change', updateModo); });
    $('#btn-dividir').addEventListener('click', async function () {
      if (!estado.src) return;
      showError(''); busy(true); clearUrls(); $('#resultado').hidden = true; $('#resultado').innerHTML = '';
      var base = baseName($('#nombre-base').value || estado.base), modo = document.querySelector('input[name="modo"]:checked').value, parts;
      try {
        if (modo === 'auto' && estado.bytes.length <= limite()) {
          var box = $('#resultado'); box.innerHTML = '';
          var pm = document.createElement('p'); pm.className = 'resumen';
          pm.textContent = 'Tu PDF pesa ' + fmt(estado.bytes.length) + ': ya entra en el límite de ' + limiteTxt() + ', no hace falta dividirlo.';
          var pn = document.createElement('p'); pn.className = 'nota';
          pn.textContent = 'Si igual querés cortarlo, elegí «Cada cierta cantidad de páginas» o «Por rangos de páginas».';
          box.appendChild(pm); box.appendChild(pn); box.hidden = false; busy(false); return;
        }
        if (modo === 'auto') parts = await splitBySize(estado.src, limite(), function (d, t) { setProgress(d, t, 'Revisando página'); });
        else if (modo === 'cada') {
          var k = parseInt($('#cada').value, 10);
          if (!(k >= 1)) throw new Error('Indicá cada cuántas páginas cortar.');
          parts = await splitEvery(estado.src, k, function (d, t) { setProgress(d, t, 'Página'); });
        } else parts = await splitRanges(estado.src, parseRanges($('#rangos').value, estado.src.getPageCount()), function (d, t) { setProgress(d, t, 'Parte'); });
        hideProgress(); renderParts(parts, base, modo === 'auto' ? limite() : 15 * MB);
      } catch (e) { hideProgress(); showError(e.message || String(e)); }
      busy(false);
    });
  }

  // ---------- página: achicar ----------
  function initAchicar() {
    setupDrop(function (f) {
      cargar(f, function (info) {
        var m = estado.soloLectura ? 'escaneado' : modoSugerido(info, estado.bytes);
        document.querySelector('input[name="modo"][value="texto"]').disabled = estado.soloLectura;
        document.querySelector('input[name="modo"][value="' + m + '"]').checked = true;
        $('#sugerencia').textContent = m === 'texto'
          ? 'Este PDF tiene texto digital y es liviano (por ejemplo, un escrito hecho en Word). Probá primero «Mantener el texto»; si no alcanza, usá «Escaneado».'
          : estado.soloLectura ? 'Este PDF tiene una protección que impide modificarlo, pero se puede achicar en modo «Escaneado»: el resultado sale sin esa protección.'
          : (info.textual ? 'Tiene texto digital, pero lo que más pesa son las imágenes: «Escaneado» es el modo que más lo achica (el texto pasará a imagen).'
                          : 'Parece un documento escaneado o con fotos: «Escaneado» es el modo que más lo achica.');
        toggleCalidad();
      });
    });
    function toggleCalidad() { $('#campo-calidad').hidden = document.querySelector('input[name="modo"]:checked').value !== 'escaneado'; }
    document.querySelectorAll('input[name="modo"]').forEach(function (r) { r.addEventListener('change', toggleCalidad); });
    $('#btn-achicar').addEventListener('click', async function () {
      if (!estado.bytes) return;
      showError(''); busy(true); clearUrls(); $('#resultado').hidden = true; $('#resultado').innerHTML = '';
      var modo = document.querySelector('input[name="modo"]:checked').value, out;
      try {
        if (modo === 'texto') { setProgress(0, 1, 'Paso'); out = await compressKeep(estado.bytes); }
        else {
          var q = $('#calidad').value, gray = $('#grises').checked;
          var CAL = { alta: { dpi: 200, quality: 0.75, nombre: 'Alta (200 ppp)' }, buena: { dpi: 150, quality: 0.7, nombre: 'Buena (150 ppp)' },
                      maxima: { dpi: 110, quality: 0.6, nombre: 'Máxima reducción (110 ppp)' }, extrema: { dpi: 100, quality: 0.5, nombre: 'Máxima reducción en escala de grises (100 ppp)', gray: true } };
          if (q !== 'auto') {
            out = await compressRaster(estado.bytes, { dpi: CAL[q].dpi, quality: CAL[q].quality, gray: gray }, function (d, t) { setProgress(d, t, 'Página'); });
            estado.calidad = CAL[q].nombre + (gray ? ', escala de grises' : '');
          } else {                                   // automática: la mejor calidad que entre en el límite
            var lim0 = limite(), orden = ['buena', 'maxima', 'extrema'], paso = 0;
            for (var oi = 0; oi < orden.length; oi++) {
              var c = CAL[orden[oi]]; paso++;
              out = await compressRaster(estado.bytes, { dpi: c.dpi, quality: c.quality, gray: gray || !!c.gray }, function (d, t) { setProgress(d, t, 'Intento ' + paso + ' · página'); });
              estado.calidad = c.nombre + (gray && !c.gray ? ', escala de grises' : '');
              if (out.length <= lim0) break;
            }
            if (orden[oi] === 'buena' && out.length < 0.4 * lim0) {   // sobra mucho margen: probar más nitidez
              var hi = await compressRaster(estado.bytes, { dpi: 200, quality: 0.75, gray: gray }, function (d, t) { setProgress(d, t, 'Mejorando nitidez · página'); });
              if (hi.length <= lim0 && hi.length < estado.bytes.length) { out = hi; estado.calidad = CAL.alta.nombre + (gray ? ', escala de grises' : ''); }
            }
          }
        }
        hideProgress();
        var box = $('#resultado'), antes = estado.bytes.length, despues = out.length, lim = limite();
        box.innerHTML = '';
        var p = document.createElement('p'); p.className = 'resumen';
        if (despues >= antes * 0.97) {
          p.textContent = 'Con este modo casi no se achica (' + fmt(antes) + ' → ' + fmt(despues) + ').';
          box.appendChild(p); out = null;
          var otro = modo === 'texto' ? 'escaneado' : 'texto', bo = document.createElement('button');
          if (estado.soloLectura && otro === 'texto') bo = null;
          if (bo) {
          bo.className = 'btn-borde px-6 py-3 rounded-full mt-1'; bo.setAttribute('data-run', '');
          bo.textContent = otro === 'escaneado' ? 'Probar con el modo «Escaneado» (reduce mucho)' : 'Probar con «Mantener el texto»';
          bo.onclick = function () { document.querySelector('input[name="modo"][value="' + otro + '"]').checked = true; toggleCalidad(); $('#btn-achicar').click(); };
          box.appendChild(bo);
          }
        } else {
          p.textContent = 'Antes: ' + fmt(antes) + ' → Después: ' + fmt(despues) + ' (−' + Math.round((1 - despues / antes) * 100) + ' %)';
          box.appendChild(p);
          if (modo === 'escaneado' && estado.calidad) { var cq = document.createElement('p'); cq.className = 'nota'; cq.textContent = 'Calidad usada: ' + estado.calidad + '.'; box.appendChild(cq); }
          var name = estado.base + ' (achicado).pdf', a = document.createElement('a');
          a.className = 'btn-gold px-6 py-3 rounded-full inline-block mt-2'; a.textContent = 'Descargar el PDF achicado';
          a.href = blobUrl(out); a.download = name; box.appendChild(a);
          if (modo === 'escaneado') {
            var nota = document.createElement('p'); nota.className = 'nota';
            nota.textContent = 'Revisalo antes de presentarlo: en este modo cada página queda como imagen, así que el texto ya no se puede seleccionar ni buscar.';
            box.appendChild(nota);
          }
        }
        var final = out || estado.bytes;
        if (final.length > lim) {
          var w = document.createElement('p'); w.className = 'aviso';
          w.textContent = 'Todavía pasa del límite (' + limiteTxt() + ', con margen). Podés dividirlo en partes y subir cada una como un anexo.';
          var b = document.createElement('button'); b.className = 'btn-borde px-6 py-3 rounded-full mt-2'; b.setAttribute('data-run', '');
          b.textContent = 'Dividirlo en partes de hasta ' + limiteTxt();
          var cont = document.createElement('div'); cont.className = 'mt-4';
          b.onclick = async function () {
            busy(true);
            try {
              var src = await loadLib(final);
              var parts = await splitBySize(src, lim, function (d, t) { setProgress(d, t, 'Revisando página'); });
              hideProgress(); renderParts(parts, estado.base, lim, cont);
            } catch (e) { hideProgress(); showError(e.message || String(e)); }
            busy(false);
          };
          box.appendChild(w); box.appendChild(b); box.appendChild(cont);
        }
        box.hidden = false;
      } catch (e) { hideProgress(); showError(e.message || String(e)); }
      busy(false);
    });
  }

  var tool = document.body.getAttribute('data-herramienta');
  if (tool === 'dividir') initDividir();
  if (tool === 'achicar') initAchicar();

  // Solo para pruebas locales (no corre en animuslex.app): #demo=/ruta/al.pdf carga el archivo y aprieta el botón.
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.hash.indexOf('#demo=') === 0) {
    (async function () {
      var path = decodeURIComponent(location.hash.slice(6)), r = await fetch(path), blob = await r.blob();
      var f = new File([blob], path.split('/').pop(), { type: 'application/pdf' });
      var ok = await cargar(f, tool === 'achicar' ? function (info) {
        var m = modoSugerido(info, estado.bytes);
        document.querySelector('input[name="modo"][value="' + m + '"]').checked = true;
        $('#campo-calidad').hidden = m !== 'escaneado';
      } : null);
      if (ok) $(tool === 'achicar' ? '#btn-achicar' : '#btn-dividir').click();
    })();
  }
  window.__animusPdf = { splitBySize: splitBySize, compressRaster: compressRaster, compressKeep: compressKeep, loadLib: loadLib, parseRanges: parseRanges };
})();
