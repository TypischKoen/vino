const $ = (sel) => document.querySelector(sel);
let wines = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Alleen http(s)-links in href/src, geen javascript: uit een CSV
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? esc(u) : '');

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Fout ${res.status}`);
  return data;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function label(w) {
  return [w.winery, w.name, w.vintage].filter(Boolean).join(' ');
}

function renderStats() {
  const bottles = wines.reduce((n, w) => n + (w.quantity ?? 0), 0);
  const kinds = wines.filter((w) => w.quantity > 0).length;
  $('#stats').textContent = `${bottles} flessen, ${kinds} verschillende wijnen`;
}

function renderWines() {
  const q = $('#filter').value.toLowerCase();
  const showEmpty = $('#show-empty').checked;
  const list = wines
    .filter((w) => showEmpty || w.quantity > 0)
    .filter((w) => !q || JSON.stringify(w).toLowerCase().includes(q))
    .sort((a, b) => label(a).localeCompare(label(b)));

  $('#wines').innerHTML = list.length ? list.map((w) => {
    const img = safeUrl(w.imageUrl);
    const link = safeUrl(w.vivinoUrl) || safeUrl(w.webUrl);
    const meta = [w.type, w.grape, [w.region, w.country].filter(Boolean).join(', '),
      (w.drinkFrom || w.drinkUntil) && `drinken ${w.drinkFrom ?? '?'}-${w.drinkUntil ?? '?'}`,
      w.rating && `★ ${w.rating}`].filter(Boolean).join(' · ');
    return `
      <div class="wine ${w.quantity > 0 ? '' : 'empty'}" data-id="${esc(w.id)}">
        ${img ? `<img src="${img}" alt="" loading="lazy">` : '<div class="ph">🍾</div>'}
        <div>
          <div class="title">${link ? `<a href="${link}" target="_blank" rel="noopener">${esc(label(w))}</a>` : esc(label(w))}</div>
          <div class="meta">${esc(meta)}</div>
          ${w.notes ? `<div class="desc">📝 ${esc(w.notes)}</div>` : ''}
          ${w.description ? `<div class="desc">${esc(w.description)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="small secondary" data-act="minus" title="Fles opgedronken">−</button>
          <span class="qty">${w.quantity ?? 0}</span>
          <button class="small secondary" data-act="plus" title="Fles erbij">+</button>
          <button class="small secondary" data-act="enrich" title="Info opzoeken via Google">🔎</button>
          <button class="small secondary" data-act="delete" title="Verwijderen">🗑</button>
        </div>
      </div>`;
  }).join('') : '<p class="muted">Nog niks hier. Voeg een fles toe of importeer je Vivino-data.</p>';
  renderStats();
}

async function loadWines() {
  wines = await api('/api/wines');
  renderWines();
}

async function changeQty(id, delta) {
  const w = wines.find((x) => x.id === id);
  const updated = await api(`/api/wines/${id}`, json('PATCH', { quantity: Math.max(0, (w.quantity ?? 0) + delta) }));
  Object.assign(w, updated);
  renderWines();
}

$('#wines').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.wine').dataset.id;
  btn.disabled = true;
  try {
    if (btn.dataset.act === 'plus') await changeQty(id, 1);
    if (btn.dataset.act === 'minus') await changeQty(id, -1);
    if (btn.dataset.act === 'delete') {
      const w = wines.find((x) => x.id === id);
      if (confirm(`${label(w)} helemaal verwijderen?`)) {
        await api(`/api/wines/${id}`, { method: 'DELETE' });
        wines = wines.filter((x) => x.id !== id);
        renderWines();
      }
    }
    if (btn.dataset.act === 'enrich') {
      const { wine } = await api(`/api/wines/${id}/enrich`, { method: 'POST' });
      Object.assign(wines.find((x) => x.id === id), wine);
      renderWines();
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#filter').addEventListener('input', renderWines);
$('#show-empty').addEventListener('change', renderWines);

// Wijn-spijs advies
function wineLine(w) {
  return `<strong>${esc(label(w))}</strong> <span class="muted">(${w.quantity}x op voorraad)</span>`;
}

$('#pair-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  const out = $('#pair-result');
  btn.disabled = true;
  out.innerHTML = '<p class="muted">Even in de kelder kijken...</p>';
  try {
    const advice = await api('/api/pair', json('POST', { dish: $('#dish').value }));
    const pick = advice.keuze;
    out.innerHTML = `
      <div class="advice">
        <div class="pick">
          <h3>🍷 ${esc(label(pick.wine))}</h3>
          <p>${esc(pick.waarom)}</p>
          <p class="muted">${esc(pick.serveertip)}</p>
          <button class="small" id="drink-btn">Deze trek ik open (−1)</button>
        </div>
        ${advice.alternatieven.length ? `<p><strong>Ook goed:</strong></p><ul>${advice.alternatieven
          .map((a) => `<li>${wineLine(a.wine)}: ${esc(a.waarom)}</li>`).join('')}</ul>` : ''}
        ${advice.tip ? `<p class="muted">💡 ${esc(advice.tip)}</p>` : ''}
      </div>`;
    $('#drink-btn').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      await changeQty(pick.wine.id, -1);
      ev.target.textContent = 'Proost! Voorraad bijgewerkt';
    });
  } catch (err) {
    out.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
});

// Google zoeken bij toevoegen
$('#google-btn').addEventListener('click', async () => {
  const q = $('#google-q').value.trim();
  const out = $('#google-results');
  if (!q) return;
  out.innerHTML = '<p class="muted">Zoeken...</p>';
  try {
    const results = await api(`/api/google?q=${encodeURIComponent(q)}`);
    out.innerHTML = results.length ? results.map((r, i) => `
      <div class="result">
        <a href="${safeUrl(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        <div class="muted">${esc(r.snippet)}</div>
        <button class="small secondary" data-i="${i}">Gebruik deze info</button>
      </div>`).join('') : '<p class="muted">Niks gevonden.</p>';
    out.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
      const r = results[b.dataset.i];
      const form = $('#add-form');
      form.description.value = r.snippet ?? '';
      form.webUrl.value = r.link ?? '';
      form.imageUrl.value = r.image ?? '';
      const year = r.title.match(/\b(19|20)\d{2}\b/);
      if (year && !form.vintage.value) form.vintage.value = year[0];
      if (!form.name.value) form.name.value = r.title.split(/[|\-–]/)[0].replace(/\b(19|20)\d{2}\b/, '').trim();
      form.winery.focus();
    }));
  } catch (err) {
    out.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
  }
});

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    wines.push(await api('/api/wines', json('POST', data)));
    e.target.reset();
    $('#google-results').innerHTML = '';
    renderWines();
  } catch (err) {
    alert(err.message);
  }
});

// Vivino import
$('#import-btn').addEventListener('click', async () => {
  const file = $('#csv').files[0];
  const out = $('#import-result');
  if (!file) { out.textContent = 'Kies eerst een CSV-bestand.'; return; }
  out.textContent = 'Importeren...';
  try {
    const res = await api(`/api/import/vivino?mode=${$('#import-mode').value}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: await file.text(),
    });
    out.textContent = `${res.added} nieuw, ${res.updated} bijgewerkt. Herkende kolommen: ${res.recognized.join(', ')}`;
    await loadWines();
  } catch (err) {
    out.textContent = err.message;
  }
});

async function init() {
  const status = await api('/api/status');
  const warn = [];
  if (!status.ai) warn.push('AI-advies staat uit (geen ANTHROPIC_API_KEY)');
  if (!status.google) warn.push('Google zoeken staat uit (geen GOOGLE_API_KEY / GOOGLE_CSE_ID)');
  $('#warnings').textContent = warn.join(' · ');
  await loadWines();
}

init().catch((err) => { $('#warnings').textContent = err.message; });
