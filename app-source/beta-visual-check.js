// Comprobación visual de Beta: después de aprobar un cambio en GitHub, espera a que la
// página publicada lo tenga, saca fotos (antes / después), prueba que la página abra sin
// errores y dibuja una imagen con las líneas que cambiaron. Todo corre en el navegador del
// dueño (mismo origen que la página), sin tokens ni servicios extra.
(() => {
  if (window.MediaChafaVisualCheck) return;
  const SITE_REPO = 'knmollpy/mediachafa-transfer-';
  const SHOT_URL = 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm';
  const DEPLOY_TIMEOUT_MS = 6 * 60 * 1000;
  const POLL_MS = 5000;
  const VIEW_W = 1280, VIEW_H = 800, SHOT_SCALE = 0.75;
  // Archivos que el sitio publica pero que no cambian lo que se ve en la página.
  const NOT_PAGE = /^(app-source\/)?(migrations|supabase|\.github|phone-helper|beta-ai)\/|^(app-source\/)?mobile\/android\/|(^|\/)worker\.js$|\.(md|sql|apk|zip|bin|java|ts)$/i;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (text) => String(text ?? '').replace(/\r\n/g, '\n');
  let shotLib;

  const style = document.createElement('style');
  style.textContent = `.beta-visual-report{margin-top:10px;padding:12px;border:1px solid #512020;border-radius:14px;background:#160c0c;white-space:normal}.beta-visual-report h4{margin:0 0 6px;font-size:13px;color:#ff8a8a}.beta-visual-report p{margin:0 0 8px;font-size:13px;line-height:1.5;white-space:pre-wrap}.beta-visual-shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:8px 0}.beta-visual-shots figure{margin:0}.beta-visual-shots figure.wide{grid-column:1/-1}.beta-visual-shots img{display:block;width:100%;border:1px solid #3a1a1a;border-radius:10px;cursor:zoom-in;background:#0b0b0b}.beta-visual-shots figcaption{margin-top:4px;font-size:11px;color:#c9a3a3}.beta-visual-checks{list-style:none;margin:6px 0 0;padding:0;font-size:12px;line-height:1.6}.beta-visual-checks li[data-ok="true"]::before{content:"✓ ";color:#6ee7a8}.beta-visual-checks li[data-ok="false"]::before{content:"✕ ";color:#ff7b7b}.beta-visual-checks li[data-ok="info"]::before{content:"• ";color:#c9a3a3}.beta-visual-files{font-size:11px;color:#c9a3a3}.beta-visual-what{margin:8px 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#f1d0d0}.beta-visual-shots figure[data-light="before"] img{border:3px solid #ff4d4d;box-shadow:0 0 14px #ff4d4d55}.beta-visual-shots figure[data-light="after"] img{border:3px solid #2ee88a;box-shadow:0 0 14px #2ee88a55}.beta-visual-shots figure[data-light="before"] figcaption{color:#ff9a9a}.beta-visual-shots figure[data-light="after"] figcaption{color:#8ff0bf}.beta-changes{width:100%;margin:0 0 12px;padding:12px 15px;border:1px solid #482020;border-radius:12px;background:#101010}.beta-changes>h3{margin:0 0 4px;font-size:14px}.beta-changes>p{margin:0 0 8px;color:#bfa9a9;font-size:12px}.beta-change-item{margin-top:12px}.beta-change-item>small{color:#bfa9a9;font-size:11px}.beta-see-changes{margin-top:8px;min-height:32px;padding:6px 12px;border-radius:999px;font-size:12px}.beta-visual-zoom{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:#000d;cursor:zoom-out}.beta-visual-zoom img{max-width:100%;max-height:100%;border-radius:10px}`;
  document.head.append(style);

  // ---------- Qué cambió ----------
  function changeFromProposal(proposal) {
    if (!proposal || proposal.provider !== 'github') return null;
    const repository = proposal.repository || SITE_REPO;
    if (proposal.type === 'write_file' && proposal.path) return { repository, files: [{ path: proposal.path, after: norm(proposal.content) }] };
    if (proposal.type === 'write_files' && typeof proposal.content === 'string') {
      const files = [];
      const parts = norm(proposal.content).split(/^===== (.+?) =====\n/m);
      for (let i = 1; i < parts.length; i += 2) files.push({ path: parts[i].trim(), after: parts[i + 1].replace(/\n\n$/, '') });
      return files.length ? { repository, files } : null;
    }
    if (proposal.type === 'delete_path') {
      const paths = Array.isArray(proposal.affectedPaths) && proposal.affectedPaths.length ? proposal.affectedPaths : [proposal.path];
      return { repository, files: paths.filter(Boolean).map((path) => ({ path, after: null, deleted: true })) };
    }
    return null;
  }
  const isSite = (change) => String(change.repository).toLowerCase() === SITE_REPO.toLowerCase();
  const pageFiles = (change) => isSite(change) ? change.files.filter((file) => !NOT_PAGE.test(file.path)) : [];
  const servedUrl = (path) => `/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function readServed(path) {
    try {
      const response = await fetch(`${servedUrl(path)}?beta-check=${Date.now()}`, { cache: 'no-store' });
      return response.ok ? norm(await response.text()) : null;
    } catch { return undefined; }
  }

  // ---------- Diferencias línea por línea ----------
  function diffLines(beforeText, afterText) {
    const A = beforeText ? beforeText.split('\n') : [], B = afterText ? afterText.split('\n') : [];
    let start = 0;
    while (start < A.length && start < B.length && A[start] === B[start]) start++;
    let endA = A.length, endB = B.length;
    while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }
    const ops = [];
    for (let i = 0; i < start; i++) ops.push({ t: '=', s: A[i], a: i + 1, b: i + 1 });
    const midA = A.slice(start, endA), midB = B.slice(start, endB), n = midA.length, m = midB.length;
    if (n && m && n * m <= 4_000_000) {
      const w = m + 1, dp = new Uint16Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && midA[i] === midB[j]) { ops.push({ t: '=', s: midA[i], a: start + i + 1, b: start + j + 1 }); i++; j++; }
        else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) { ops.push({ t: '+', s: midB[j], b: start + j + 1 }); j++; }
        else { ops.push({ t: '-', s: midA[i], a: start + i + 1 }); i++; }
      }
    } else {
      midA.forEach((s, i) => ops.push({ t: '-', s, a: start + i + 1 }));
      midB.forEach((s, j) => ops.push({ t: '+', s, b: start + j + 1 }));
    }
    for (let i = endA, j = endB; i < A.length; i++, j++) ops.push({ t: '=', s: A[i], a: i + 1, b: j + 1 });
    return ops;
  }

  function hunks(ops, context = 2, maxRows = 40) {
    const rows = [];
    let lastShown = -1;
    for (let k = 0; k < ops.length && rows.length < maxRows; k++) {
      if (ops[k].t === '=') continue;
      const from = Math.max(lastShown + 1, k - context);
      if (from > lastShown + 1) rows.push({ t: '@', s: `línea ${ops[from].b || ops[from].a || 1}` });
      let to = k;
      while (to + 1 < ops.length && (ops[to + 1].t !== '=' || ops.slice(to + 1, to + 1 + context * 2 + 1).some((op) => op.t !== '='))) to++;
      to = Math.min(ops.length - 1, to + context);
      for (let r = from; r <= to && rows.length < maxRows; r++) rows.push(ops[r]);
      lastShown = to; k = to;
    }
    // En líneas muy largas (HTML minificado) mostramos la parte donde empieza la diferencia.
    const minus = rows.filter((row) => row.t === '-'), plus = rows.filter((row) => row.t === '+');
    for (let i = 0; i < Math.min(minus.length, plus.length); i++) {
      let c = 0; const a = minus[i].s, b = plus[i].s;
      while (c < a.length && c < b.length && a[c] === b[c]) c++;
      minus[i].focus = plus[i].focus = c;
    }
    return rows;
  }

  function summarizeFiles(change, befores) {
    return change.files.map((file) => {
      const before = befores[file.path];
      const ops = file.deleted ? diffLines(before || '', '') : diffLines(before || '', file.after || '');
      const added = ops.filter((op) => op.t === '+').length, removed = ops.filter((op) => op.t === '-').length;
      const status = file.deleted ? 'borrado' : before == null ? (before === null ? 'nuevo' : 'actualizado') : 'modificado';
      return { path: file.path, added, removed, status, rows: hunks(ops), knownBefore: typeof before === 'string' || file.deleted };
    });
  }

  // ---------- Imagen con el código que cambió ----------
  function drawDiffImage(files) {
    const W = 1200, LH = 19, PAD = 18, font = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const shown = files.slice(0, 6);
    let rowsTotal = 0;
    for (const file of shown) rowsTotal += 2 + Math.max(1, Math.min(file.rows.length, 40));
    const H = Math.min(2400, PAD * 2 + 34 + rowsTotal * LH + shown.length * 10);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff8a8a'; ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('Cambios en el código', PAD, PAD + 14);
    ctx.font = font;
    const charW = ctx.measureText('M').width || 7.8;
    const maxChars = Math.floor((W - PAD * 2 - 90) / charW);
    let y = PAD + 34;
    const clip = (row) => {
      const text = String(row.s ?? '').replace(/\t/g, '  ');
      if (text.length <= maxChars) return text;
      const start = row.focus > maxChars - 20 ? Math.max(0, row.focus - 30) : 0;
      return `${start ? '…' : ''}${text.slice(start, start + maxChars - 2)}…`;
    };
    for (const file of shown) {
      if (y > H - LH * 2) break;
      ctx.fillStyle = '#2a1515'; ctx.fillRect(PAD, y, W - PAD * 2, LH + 6);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(`${file.path}  ·  ${file.status}`, PAD + 8, y + 17);
      ctx.fillStyle = '#6ee7a8'; const plusText = `+${file.added}`; const minusText = `−${file.removed}`;
      const minusW = ctx.measureText(minusText).width;
      ctx.fillText(plusText, W - PAD - 16 - minusW - ctx.measureText(plusText).width - 10, y + 17);
      ctx.fillStyle = '#ff7b7b'; ctx.fillText(minusText, W - PAD - 8 - minusW, y + 17);
      y += LH + 10; ctx.font = font;
      const rows = file.rows.length ? file.rows : [{ t: '@', s: file.knownBefore ? 'Sin diferencias de texto.' : 'Archivo nuevo o sin versión anterior publicada.' }];
      for (const row of rows) {
        if (y > H - LH) break;
        if (row.t === '+' || row.t === '-') { ctx.fillStyle = row.t === '+' ? 'rgba(46,160,67,.25)' : 'rgba(248,81,73,.25)'; ctx.fillRect(PAD, y - 1, W - PAD * 2, LH); }
        ctx.fillStyle = '#777';
        ctx.fillText(row.t === '@' ? '' : String(row.t === '-' ? row.a : row.b ?? row.a ?? ''), PAD + 6, y + 13);
        ctx.fillStyle = row.t === '+' ? '#aff5b4' : row.t === '-' ? '#ffb4ae' : row.t === '@' ? '#8ab4ff' : '#bdbdbd';
        ctx.fillText(`${row.t === '=' ? ' ' : row.t === '@' ? '⋯' : row.t} ${clip(row)}`, PAD + 60, y + 13);
        y += LH;
      }
      y += 10;
    }
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  // ---------- Fotos de la página ----------
  async function loadShotLib() {
    if (!shotLib) shotLib = import(SHOT_URL).catch((error) => { shotLib = undefined; throw error; });
    return shotLib;
  }

  async function capturePage(url, { openBeta = false } = {}) {
    const result = { url, images: [], errors: [], status: 0, hasContent: false, betaOpened: false };
    try { result.status = (await fetch(`${url}${url.includes('?') ? '&' : '?'}beta-check=${Date.now()}`, { cache: 'no-store' })).status; } catch { result.status = 0; }
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-${VIEW_W + 4000}px;top:0;width:${VIEW_W}px;height:${VIEW_H}px;border:0;pointer-events:none;`;
    const loaded = new Promise((resolve, reject) => {
      frame.addEventListener('load', resolve, { once: true });
      setTimeout(() => reject(new Error('La página no terminó de cargar en 45 segundos.')), 45000);
    });
    frame.src = `${url}${url.includes('?') ? '&' : '?'}beta-preview=${Date.now()}`;
    document.body.append(frame);
    try {
      await loaded;
      await sleep(3500);
      const doc = frame.contentDocument, win = frame.contentWindow;
      if (!doc) throw new Error('No pude abrir la página para sacarle una foto.');
      result.errors = Array.isArray(win.__mediachafaErrors) ? win.__mediachafaErrors.slice(0, 10) : null;
      result.hasContent = (doc.body?.innerText || '').trim().length > 20;
      const { domToJpeg } = await loadShotLib();
      const shoot = async () => {
        const bg = win.getComputedStyle(doc.body).backgroundColor;
        return domToJpeg(doc.body, { width: VIEW_W, height: VIEW_H, scale: SHOT_SCALE, quality: 0.78, backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#0b0b0b', timeout: 15000 });
      };
      result.images.push(await shoot());
      if (openBeta) {
        const tab = doc.querySelector('#beta-tab');
        if (tab && !tab.classList.contains('hidden')) { tab.click(); await sleep(1800); result.betaOpened = true; result.images.push(await shoot()); }
      }
      if (Array.isArray(win.__mediachafaErrors)) result.errors = win.__mediachafaErrors.slice(0, 10);
    } finally { frame.remove(); }
    return result;
  }

  // ---------- Fotos ANTES (luz roja) y DESPUÉS (luz verde) ----------
  // Las arma la página sola, sin depender de ninguna IA, para cualquier tipo de cambio.
  const LIGHT = { before: { color: '#ff4d4d', bg: '#1c0909', label: 'ANTES · luz roja', sub: 'Cómo estaba antes del cambio' }, after: { color: '#2ee88a', bg: '#06170e', label: 'DESPUÉS · luz verde', sub: 'Cómo quedó después del cambio' } };

  function wrapText(ctx, text, maxW) {
    const out = [];
    for (const para of String(text ?? '').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  function drawLight(ctx, x, y, r, color) {
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 28; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
  }

  function drawStateCard(kind, title, lines) {
    const L = LIGHT[kind], W = 960, H = 540, PAD = 44;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = L.bg; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 10; ctx.strokeStyle = L.color; ctx.strokeRect(5, 5, W - 10, H - 10);
    drawLight(ctx, PAD + 18, PAD + 18, 18, L.color);
    ctx.fillStyle = L.color; ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillText(L.label, PAD + 52, PAD + 26);
    ctx.fillStyle = '#b9b9b9'; ctx.font = '16px system-ui, sans-serif'; ctx.fillText(L.sub, PAD + 52, PAD + 50);
    let y = PAD + 120;
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px system-ui, sans-serif';
    for (const line of wrapText(ctx, title, W - PAD * 2).slice(0, 3)) { ctx.fillText(line, PAD, y); y += 44; }
    y += 12; ctx.fillStyle = '#dddddd'; ctx.font = '21px system-ui, sans-serif';
    const body = lines.filter(Boolean).flatMap((line) => wrapText(ctx, `• ${line}`, W - PAD * 2));
    for (const line of body.slice(0, 8)) { ctx.fillText(line, PAD, y); y += 31; }
    if (body.length > 8) ctx.fillText('…', PAD, y);
    ctx.fillStyle = '#8a8a8a'; ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(`MediaChafa · Beta · ${new Date().toLocaleString()}`, PAD, H - 26);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  // Pone el marco rojo o verde alrededor de una captura real de la página.
  async function frameShot(src, kind) {
    try {
      const L = LIGHT[kind], img = new Image(); img.src = src; await img.decode();
      const pad = 12, top = 48, W = img.width + pad * 2, H = img.height + top + pad;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = L.bg; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, pad, top);
      ctx.lineWidth = 8; ctx.strokeStyle = L.color; ctx.strokeRect(4, 4, W - 8, H - 8);
      drawLight(ctx, pad + 20, 25, 11, L.color);
      ctx.fillStyle = L.color; ctx.font = 'bold 18px system-ui, sans-serif'; ctx.fillText(`${L.label} · captura real de la página`, pad + 42, 31);
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch { return src; }
  }

  function describeAction(prep, result, files) {
    const p = prep.proposal || {}, url = result?.url || '', msg = String(result?.message || '').trim();
    const owner = (/github\.com\/([^/?#]+)/.exec(url) || [])[1] || String(p.repository || SITE_REPO).split('/')[0];
    const repo = p.repository || (p.name ? `${owner}/${p.name}` : '');
    const visibility = p.visibility === 'public' || p.private === false ? 'público' : 'privado';
    const fileLines = (fn) => (files || []).slice(0, 6).map(fn);
    switch (p.type) {
      case 'create_repository': {
        const full = `${owner}/${p.name}`;
        return { before: { title: `${full} no existía`, lines: ['No había ningún repositorio con ese nombre en tu GitHub.'] },
          after: { title: `Repositorio ${visibility} creado, con README`, lines: [full, p.description ? `Descripción: ${p.description}` : '', url] },
          basic: `Antes, ${full} no existía en tu GitHub. Ahora es un repositorio ${visibility} nuevo, con un archivo README inicial${p.description ? ` y la descripción "${p.description}"` : ''}.` };
      }
      case 'write_file': case 'write_files': {
        const n = files?.length || 0, added = files.reduce((s, f) => s + f.added, 0), removed = files.reduce((s, f) => s + f.removed, 0);
        return { before: { title: `${repo}: ${n} archivo(s) antes del cambio`, lines: fileLines((f) => `${f.path}: ${f.status === 'nuevo' ? 'no existía' : 'versión anterior'}`) },
          after: { title: `${n} archivo(s) guardado(s) en ${repo}`, lines: fileLines((f) => `${f.path}: ${f.status} (+${f.added} −${f.removed})`) },
          basic: `Se ${n === 1 ? 'guardó 1 archivo' : `guardaron ${n} archivos`} en ${repo}: ${files.map((f) => `${f.path} (${f.status})`).join(', ')}. En total se agregaron ${added} líneas y se quitaron ${removed}.` };
      }
      case 'delete_path': {
        const n = files?.length || 0;
        return { before: { title: `Existían ${n} archivo(s) en ${repo}:${p.path}`, lines: fileLines((f) => f.path) },
          after: { title: `${n} archivo(s) borrado(s)`, lines: [`${repo}:${p.path} ya no está.`, msg] },
          basic: `Antes había ${n} archivo(s) en ${p.path} dentro de ${repo}. Ahora están borrados en un solo cambio.` };
      }
      case 'delete_repository':
        return { before: { title: `${repo} existía`, lines: ['El repositorio estaba en tu GitHub.'] }, after: { title: `${repo} fue eliminado`, lines: [msg] }, basic: `Antes, ${repo} existía en tu GitHub. Ahora fue eliminado.` };
      case 'enable_pages':
        return { before: { title: `${repo} sin publicar así`, lines: ['GitHub Pages no tenía esta configuración.'] },
          after: { title: 'GitHub Pages publicado', lines: [`Rama ${p.branch || 'main'}, carpeta ${p.folder || '/'}`, 'Puede tardar 1-2 minutos en verse.', url] },
          basic: `Antes, ${repo} no se publicaba con esta configuración. Ahora GitHub Pages lo publica desde la rama ${p.branch || 'main'}, carpeta ${p.folder || '/'}.` };
      case 'pages_build':
        return { before: { title: 'Publicación anterior', lines: [`El sitio de ${repo} mostraba la versión anterior.`] }, after: { title: 'Nueva publicación pedida', lines: [msg, url] }, basic: `Se pidió volver a publicar el sitio de ${repo}; en 1-2 minutos muestra la versión nueva.` };
      case 'sql': {
        const query = String(p.query || '').split('\n').filter(Boolean).slice(0, 4);
        return { before: { title: 'Base de datos antes de la consulta', lines: ['Estado previo a ejecutar:', ...query] }, after: { title: 'Consulta ejecutada', lines: [msg] }, basic: `Se ejecutó una consulta en la base de datos: ${p.description || query.join(' ').slice(0, 200)}.` };
      }
      case 'create_worker':
        return { before: { title: `El Worker ${p.name} no existía`, lines: ['No había ningún Worker con ese nombre en Cloudflare.'] }, after: { title: `Worker ${p.name} creado`, lines: [url] }, basic: `Antes no existía el Worker ${p.name}. Ahora está creado en tu Cloudflare.` };
      default:
        return { before: { title: 'Antes del cambio', lines: [p.summary || ''] }, after: { title: msg || 'Cambio aplicado', lines: [url] }, basic: `${p.summary || 'Se aplicó el cambio.'} ${msg}`.trim() };
    }
  }


  // Revisión estática ANTES de aprobar: evita publicar HTML/JSON/JS claramente roto
  // y advierte si desaparecen controles que ya existían en la página.
  async function preflight(proposal) {
    const change = changeFromProposal(proposal);
    const checks = [];
    if (!change) return { ok: true, checks: [{ ok: 'info', label: 'Esta acción no modifica archivos web; se comprobará la respuesta del servicio después de ejecutarla.' }] };
    for (const file of change.files.slice(0, 30)) {
      if (file.deleted) {
        checks.push({ ok: 'info', label: `Borrado solicitado: ${file.path}. Revisá que sea intencional.` });
        continue;
      }
      const source = String(file.after ?? '');
      if (!source.trim()) {
        checks.push({ ok: false, label: `${file.path}: el archivo quedaría vacío.` });
        continue;
      }
      if (/\.html?$/i.test(file.path)) {
        try {
          const doc = new DOMParser().parseFromString(source, 'text/html');
          if (!doc.documentElement || !doc.body || doc.querySelector('parsererror')) throw new Error('estructura HTML inválida');
          const oldSource = await readServed(file.path);
          if (typeof oldSource === 'string' && oldSource.trim()) {
            const oldDoc = new DOMParser().parseFromString(oldSource, 'text/html');
            const oldIds = [...oldDoc.querySelectorAll('[id]')].map((node) => node.id).filter(Boolean);
            const newIds = new Set([...doc.querySelectorAll('[id]')].map((node) => node.id).filter(Boolean));
            const missing = oldIds.filter((id) => !newIds.has(id));
            const signature = (node) => {
              const tag = node.tagName.toLowerCase();
              const identity = node.id || node.getAttribute('aria-label') || node.getAttribute('name') || node.getAttribute('href') || (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
              return identity ? `${tag}:${identity}` : '';
            };
            const oldControls = [...oldDoc.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="tab"]')].map(signature).filter(Boolean);
            const newControls = new Set([...doc.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="tab"]')].map(signature).filter(Boolean));
            const missingControls = oldControls.filter((item) => !newControls.has(item));
            if (missing.length) checks.push({ ok: false, label: `${file.path}: se quitarían ${missing.length} ID(s) que ya existían: ${missing.slice(0, 12).join(', ')}.` });
            if (missingControls.length) checks.push({ ok: false, label: `${file.path}: desaparecerían ${missingControls.length} controles o enlaces existentes: ${missingControls.slice(0, 8).join(', ')}.` });
            if (!missing.length && !missingControls.length) checks.push({ ok: true, label: `${file.path}: conserva los ID y controles anteriores.` });
          }
          checks.push({ ok: true, label: `${file.path}: estructura HTML válida.` });
        } catch (error) { checks.push({ ok: false, label: `${file.path}: ${error.message}.` }); }
      } else if (/\.json$/i.test(file.path)) {
        try { JSON.parse(source); checks.push({ ok: true, label: `${file.path}: JSON válido.` }); }
        catch (error) { checks.push({ ok: false, label: `${file.path}: JSON inválido — ${error.message}` }); }
      } else if (/\.(?:js|mjs|cjs)$/i.test(file.path)) {
        if (/^\s*(?:import\s|export\s)/m.test(source)) {
          checks.push({ ok: 'info', label: `${file.path}: usa sintaxis de módulo; la sintaxis se verificará en el pipeline de pruebas, no se ejecutará durante esta revisión.` });
        } else {
          try { new Function(source); checks.push({ ok: true, label: `${file.path}: sintaxis JavaScript válida (sin ejecutar el código).` }); }
          catch (error) { checks.push({ ok: false, label: `${file.path}: error de sintaxis JavaScript — ${error.message}` }); }
        }
      }
    }
    return { ok: !checks.some((check) => check.ok === false), checks };
  }

  // ---------- Flujo completo ----------
  // prepare() se llama justo antes de aprobar: guarda cómo estaba todo (texto y foto).
  function prepare(proposal) {
    if (!proposal) return null;
    const change = changeFromProposal(proposal);
    if (!change) return { proposal, change: null, visible: [], pageUrl: '', openBeta: false, befores: {}, beforeTexts: Promise.resolve(), beforeShot: Promise.resolve(null) };
    const visible = pageFiles(change);
    const htmlFile = visible.find((file) => /\.html?$/i.test(file.path) && !file.deleted);
    const pageUrl = htmlFile ? (htmlFile.path === 'index.html' ? '/' : servedUrl(htmlFile.path)) : '/';
    const openBeta = visible.some((file) => /beta/i.test(file.path)) || /beta/i.test(proposal.summary || '');
    const befores = {};
    const beforeTexts = isSite(change) ? Promise.all(change.files.slice(0, 30).map(async (file) => { befores[file.path] = await readServed(file.path); })) : Promise.resolve();
    const beforeShot = visible.length ? capturePage(pageUrl, { openBeta }).catch((error) => ({ failed: error.message })) : Promise.resolve(null);
    return { proposal, change, visible, pageUrl, openBeta, befores, beforeTexts, beforeShot };
  }

  async function waitForDeploy(prep, onStep) {
    const started = Date.now();
    while (Date.now() - started < DEPLOY_TIMEOUT_MS) {
      let ready = true;
      for (const file of prep.visible) {
        const served = await readServed(file.path);
        if (file.deleted ? served !== null : served !== file.after) { ready = false; break; }
      }
      if (ready) return { ok: true, seconds: Math.round((Date.now() - started) / 1000) };
      onStep?.(`Esperando que la página publique el cambio… ${Math.round((Date.now() - started) / 1000)} s`);
      await sleep(POLL_MS);
    }
    return { ok: false, seconds: Math.round(DEPLOY_TIMEOUT_MS / 1000) };
  }

  async function review(prep, onStep, result = {}) {
    const { proposal, change } = prep;
    const checks = [...(prep.preflight?.checks || [])];
    const images = [];
    onStep?.('Armando las fotos de antes y después del cambio…');
    await prep.beforeTexts;
    const files = change ? summarizeFiles(change, prep.befores) : [];
    const totalAdded = files.reduce((sum, file) => sum + file.added, 0), totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
    const story = describeAction(prep, result, files);
    images.push({ label: `Antes · ${story.before.title}`, src: drawStateCard('before', story.before.title, story.before.lines), kind: 'before' });
    images.push({ label: `Después · ${story.after.title}`, src: drawStateCard('after', story.after.title, story.after.lines), kind: 'after' });
    let deployed = null, after = null;
    if (prep.visible.length) {
      const before = await prep.beforeShot;
      deployed = await waitForDeploy(prep, onStep);
      checks.push(deployed.ok ? { ok: true, label: `El cambio ya está publicado en la página (tardó ${deployed.seconds} s).` } : { ok: false, label: 'La página todavía no publicó el cambio después de 6 minutos; la foto puede mostrar la versión anterior.' });
      onStep?.('Abriendo la página y sacando la foto del resultado…');
      try {
        after = await capturePage(prep.pageUrl, { openBeta: prep.openBeta });
        checks.push({ ok: after.status === 200, label: after.status === 200 ? 'La página abre correctamente.' : `La página respondió con código ${after.status || 'sin conexión'}.` });
        checks.push({ ok: after.hasContent, label: after.hasContent ? 'La página muestra contenido (no quedó en blanco).' : 'La página quedó en blanco.' });
        if (after.errors === null) checks.push({ ok: 'info', label: 'No pude leer los errores de la página (todavía no tiene el detector).' });
        else checks.push({ ok: after.errors.length === 0, label: after.errors.length ? `La página tiró ${after.errors.length} error(es): ${after.errors.slice(0, 3).join(' | ')}` : 'Sin errores de JavaScript al abrir la página.' });
        if (prep.openBeta) checks.push(after.betaOpened ? { ok: true, label: 'La pestaña Beta abre bien.' } : { ok: 'info', label: 'No pude abrir la pestaña Beta en la prueba (requiere tu sesión de dueño).' });
      } catch (error) {
        checks.push({ ok: false, label: `No pude sacar la foto del resultado: ${error.message}` });
      }
      if (before?.images?.[0]) images.push({ label: `Antes · página ${prep.pageUrl}`, src: await frameShot(before.images[0], 'before'), kind: 'before' });
      if (after?.images?.[0]) images.push({ label: `Después · página ${prep.pageUrl}`, src: await frameShot(after.images[0], 'after'), kind: 'after' });
      if (before?.images?.[1]) images.push({ label: 'Antes · pestaña Beta', src: await frameShot(before.images[1], 'before'), kind: 'before' });
      if (after?.images?.[1]) images.push({ label: 'Después · pestaña Beta', src: await frameShot(after.images[1], 'after'), kind: 'after' });
    } else {
      checks.push({ ok: true, label: result?.message ? `El servicio confirmó: ${result.message}` : 'El servicio confirmó el cambio.' });
    }
    if (files.length) images.push({ label: 'Cambios en el código', src: drawDiffImage(files), kind: 'code' });
    const fileList = files.map((file) => `${file.path} (${file.status}, +${file.added} −${file.removed})`).join(', ');
    const failed = checks.some((check) => check.ok === false);
    const summary = `${proposal.summary || 'Cambio aplicado.'}${fileList ? `\n\nArchivos: ${fileList}.` : ''}`;
    const diffText = files.map((file) => `${file.path}:\n${file.rows.filter((row) => row.t !== '=').slice(0, 25).map((row) => `${row.t} ${String(row.s).slice(0, 220)}`).join('\n')}`).join('\n\n').slice(0, 5000);
    return { id: `c${Date.now()}`, at: Date.now(), title: failed ? 'Cambio aplicado, pero algo no anduvo' : 'Cambio aplicado y comprobado', summary, whatChanged: story.basic, before: story.before, after: story.after, explanation: '', files: files.map(({ rows, ...rest }) => rest), totalAdded, totalRemoved, checks, images, ok: !failed, pageUrl: prep.visible.length ? prep.pageUrl : '', url: result?.url || '', diffText };
  }

  function zoom(src) {
    const layer = document.createElement('div');
    layer.className = 'beta-visual-zoom';
    const img = document.createElement('img'); img.src = src; img.alt = '';
    layer.append(img);
    layer.addEventListener('click', () => layer.remove());
    document.body.append(layer);
  }

  function renderReport(node, report) {
    node.querySelector(':scope > .beta-visual-report')?.remove();
    const box = document.createElement('section');
    box.className = 'beta-visual-report';
    const title = document.createElement('h4'); title.textContent = report.title || 'Comprobación visual';
    const whatTitle = document.createElement('h5'); whatTitle.className = 'beta-visual-what'; whatTitle.textContent = 'Qué cambió';
    const text = document.createElement('p'); text.textContent = report.explanation || report.whatChanged || report.summary || '';
    box.append(title, whatTitle, text);
    if (report.images?.length) {
      const grid = document.createElement('div'); grid.className = 'beta-visual-shots';
      for (const image of report.images) {
        const figure = document.createElement('figure');
        if (image.kind === 'code' || image.label === 'Cambios en el código') figure.className = 'wide';
        if (image.kind) figure.dataset.light = image.kind;
        const img = document.createElement('img'); img.src = image.src; img.alt = image.label; img.loading = 'lazy';
        img.addEventListener('click', () => zoom(image.src));
        const caption = document.createElement('figcaption'); caption.textContent = image.label;
        figure.append(img, caption); grid.append(figure);
      }
      box.append(grid);
    }
    if (report.checks?.length) {
      const list = document.createElement('ul'); list.className = 'beta-visual-checks';
      for (const check of report.checks) { const li = document.createElement('li'); li.dataset.ok = String(check.ok); li.textContent = check.label; list.append(li); }
      box.append(list);
    }
    if (report.files?.length) {
      const files = document.createElement('small'); files.className = 'beta-visual-files';
      files.textContent = `Total: +${report.totalAdded ?? 0} líneas, −${report.totalRemoved ?? 0} líneas en ${report.files.length} archivo(s).`;
      box.append(files);
    }
    node.append(box);
    return box;
  }

  window.MediaChafaVisualCheck = { prepare, preflight, review, renderReport, changeFromProposal, diffLines, capturePage };
})();
