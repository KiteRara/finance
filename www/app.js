/* ============================================================
   Finance App — www/app.js (Capacitor / Android build)
   Uses localforage for IndexedDB-based persistence.
   ============================================================ */

const CATS = {
  receita: { icons: { Salary: 'Sal\u00e1rio', Investments: 'Investimentos', Freelance: 'Freelance', Other: 'Outro' } },
  expense: { icons: { Food: 'Alimenta\u00e7\u00e3o', Transport: 'Transporte', Housing: 'Moradia', Health: 'Sa\u00fade', Entertainment: 'Lazer', Shopping: 'Compras', Education: 'Educa\u00e7\u00e3o', Other: 'Outro' } }
};

const CAT_NAMES = {};
for (const [, cfg] of Object.entries(CATS)) {
  for (const [key, name] of Object.entries(cfg.icons)) { CAT_NAMES[key] = name; }
}

const EXPENSE_COLORS = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#06b6d4','#6366f1','#a855f7'];
const REVENUE_COLORS = ['#22c55e','#10b981','#059669','#34d399'];

/* ---- persistence (localforage → IndexedDB, falls back to localStorage) ---- */
const store = (typeof localforage !== 'undefined') ? localforage.createInstance({ name: 'finance' }) : null;

function _pref(key) { return 'finance_' + key; }

async function _get(key) {
  if (store) {
    try { const v = await store.getItem(key); if (v !== null) return v; } catch {}
  }
  const v = localStorage.getItem(_pref(key));
  return v ? JSON.parse(v) : null;
}

async function _set(key, val) {
  if (store) { try { await store.setItem(key, val); } catch { /* quota exceeded */ } }
  localStorage.setItem(_pref(key), JSON.stringify(val));
}

async function _remove(key) {
  if (store) { try { await store.removeItem(key); } catch {} }
  localStorage.removeItem(_pref(key));
}

async function getTxs()   { return (await _get('txs')) || []; }
async function saveTxs(txs) { await _set('txs', txs); }
async function getRecurring() { return (await _get('recurring')) || []; }
async function saveRecurring(r) { await _set('recurring', r); }
async function getBudgets() { return (await _get('budgets')) || {}; }
async function saveBudgets(b) { await _set('budgets', b); }

/* ---- util ---- */
const fmt = v => parseFloat(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iconFor = (type, cat) => { for (const [k, v] of Object.entries(CATS[type]?.icons || {})) { if (k === cat) return v; } return ''; };

/** Escape a string for safe HTML insertion */
const esc = s => { if (typeof s !== 'string') return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;'); };

/** Safe rounding for decimal values */
const safeRound = n => Math.round(n * 100) / 100;

/* ---- currency mask ---- */
function moneyInput(el) {
  el.addEventListener('input', () => {
    let digits = el.value.replace(/\D/g, '');
    if (!digits) { el.value = ''; return; }
    while (digits.length < 3) digits = '0' + digits;
    const cents = digits.slice(-2);
    const intPart = digits.slice(0, -2);
    el.value = 'R$ ' + Number(intPart).toLocaleString('pt-BR') + ',' + cents;
  });
}
function parseMoney(raw) {
  const digits = raw?.replace(/\D/g, '') ?? '';
  if (!digits) return NaN;
  return parseInt(digits, 10) / 100;
}
function fmtInput(raw) {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  while (digits.length < 3) digits = '0' + digits;
  return 'R$ ' + Number(digits.slice(0, -2)).toLocaleString('pt-BR') + ',' + digits.slice(-2);
}

/* ---- toasts ---- */
function toast(msg, type = 'success') {
  let c = document.getElementById('toast-c');
  if (!c) { c = document.createElement('div'); c.id = 'toast-c'; c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ---- confirm dialog ---- */
function confirmDel(msg, onYes) {
  const ev = document.getElementById('confirm-ov');
  document.getElementById('confirm-msg').textContent = msg;
  ev.classList.add('open');
  document.getElementById('confirm-yes').onclick = () => { ev.classList.remove('open'); onYes(); };
  document.getElementById('confirm-no').onclick = () => { ev.classList.remove('open'); };
}

/* ---- recurring: generate instances for current month ---- */
async function syncRecurring() {
  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const txs = await getTxs();
  const existingKeys = new Set(txs.filter(t => t.recurringId).map(t => t.recurringId + '-' + t.date.slice(0, 7)));
  const recurring = await getRecurring();
  let changed = false;

  for (const rec of recurring) {
    const key = rec.id + '-' + ym;
    if (!existingKeys.has(key)) {
      const day = Math.min(rec.day || 1, 28);
      const date = `${ym}-${String(day).padStart(2, '0')}`;
      const maxId = txs.length ? Math.max(...txs.map(t => t.id)) : 0;
      txs.push({ id: maxId + 1, type: rec.type, category: rec.category, description: rec.description, amount: safeRound(rec.amount), date, recurringId: rec.id });
      changed = true;
    }
  }
  if (changed) await saveTxs(txs);
}

/* ---- month filter ---- */
function getMonthOptions(months, ym) {
  const sorted = [...months].sort().reverse();
  const opts = [{ value: 'all', text: 'Todos' }];
  for (const m of sorted) {
    const [y, mo] = m.split('-');
    const d = new Date(parseInt(y, 10), parseInt(mo, 10) - 1);
    opts.push({ value: m, text: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), selected: m === ym });
  }
  return opts;
}

async function populateMonthFilter() {
  const sel = document.getElementById('month-sel');
  const txs = await getTxs();
  const months = new Set();
  for (const t of txs) { if (t.date) months.add(t.date.slice(0, 7)); }
  const ym = new Date().toISOString().slice(0, 7);
  months.add(ym);

  sel.innerHTML = '';
  const opts = getMonthOptions(months, ym);
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.text;
    if (o.selected) opt.selected = true;
    sel.appendChild(opt);
  }
}

/* ---- load & refresh ---- */
async function load() {
  await syncRecurring();

  fillCats('f');
  document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);

  const fAmt = document.getElementById('f-amount');
  const eAmt = document.getElementById('e-amt');
  moneyInput(fAmt);
  moneyInput(eAmt);

  const eType = document.getElementById('e-type');
  eType.innerHTML = '';
  for (const type of Object.keys(CATS)) {
    const o = document.createElement('option');
    o.value = type; o.textContent = type === 'receita' ? 'Receita' : 'Despesa';
    eType.appendChild(o);
  }

  // Budget categories
  const bSel = document.getElementById('budget-cat');
  if (bSel) {
    bSel.innerHTML = '';
    for (const [k, v] of Object.entries(CATS.expense?.icons || {})) {
      const o = document.createElement('option'); o.value = k; o.textContent = v;
      bSel.appendChild(o);
    }
  }

  populateMonthFilter();
  await refresh();
}

async function refresh() {
  await syncRecurring();
  const allTxs = await getTxs();
  allTxs.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  // Balance (all-time, rounded)
  const ineAll = safeRound(allTxs.filter(t => t.type === 'receita').reduce((s, t) => s + Number(t.amount), 0));
  const expAll = safeRound(allTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0));
  document.getElementById('v-ine').textContent = fmt(ineAll);
  document.getElementById('v-exp').textContent = fmt(expAll);
  document.getElementById('v-bal').textContent = fmt(ineAll - expAll);

  // Month filter
  const mSel = document.getElementById('month-sel');
  const month = mSel.value;
  const txs = month !== 'all' ? allTxs.filter(t => t.date && t.date.startsWith(month)) : allTxs;

  renderTable(txs);
  renderDetailCharts(txs);
  renderBudgets(txs);
  renderAnalysis(allTxs, month);
}

function fillCats(prefix) {
  const t = document.getElementById(prefix === 'f' ? 'f-type' : 'e-type').value;
  const sel = document.getElementById(prefix === 'f' ? 'f-cat' : 'e-cat');
  sel.innerHTML = '';
  for (const [k, v] of Object.entries(CATS[t] ? CATS[t].icons : {})) {
    const o = document.createElement('option'); o.value = k; o.textContent = v;
    sel.appendChild(o);
  }
}

/* ---- table ---- */
function renderTable(txs) {
  const tb = document.getElementById('tx-list');
  if (!tb) return;
  if (!txs.length) { tb.innerHTML = '<tr><td colspan="6"><div class="empty">Nenhuma transa\u00e7\u00e3o</div></td></tr>'; return; }
  tb.innerHTML = '';
  for (const t of txs) {
    const tr = document.createElement('tr');
    const lbl = t.type === 'receita' ? 'Receita' : 'Despesa';
    const p = t.type === 'receita' ? 'pill-r' : 'pill-e';
    const ic = esc(iconFor(t.type, t.category));
    const cat = esc(String(t.category));
    const desc = esc(String(t.description));
    const dateStr = t.date ? (() => { try { return new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return esc(t.date); } })() : '';
    const recTag = t.recurringId ? '<span class="recurring-tag">recorrente</span>' : '';
    tr.innerHTML = `<td><span class="pill ${p}">${lbl}</span>${recTag}</td>
      <td>${ic} ${cat}</td>
      <td>${desc}</td>
      <td>${fmt(t.amount)}</td>
      <td>${dateStr}</td>
      <td class="tx-actions">
        <button class="btn-s" onclick="editTx(${t.id})" aria-label="Editar">\u270f</button>
        <button class="btn-s" onclick="delTx(${t.id})" aria-label="Excluir">\u2715</button>
      </td>`;
    tb.appendChild(tr);
  }
}

/* ---- overview charts ---- */
function renderDetailCharts(txs) {
  const cc = document.getElementById('ch-cat');
  if (!cc) return;

  const byC = {};
  for (const t of txs) { const k = t.type + '|' + t.category; byC[k] = safeRound((byC[k] || 0) + t.amount); }
  const mc = Math.max(1, ...Object.values(byC));
  const entries = Object.entries(byC).sort((a, b) => b[1] - a[1]);

  if (!entries.length) { cc.innerHTML = '<div class="empty">Sem dados</div>'; }
  else {
    cc.innerHTML = entries.map(([k, v]) => {
      const [type, cat] = k.split('|');
      const ic = esc(iconFor(type, cat));
      const color = type === 'receita' ? '#4ade80' : '#f87171';
      return `<div class="bar-row"><span>${ic} ${esc(cat)}</span><div class="bar-bg"><div class="bar-fill" style="width:${v / mc * 100}%;background:${color}"></div></div><div class="bar-amt">${fmt(v)}</div></div>`;
    }).join('');
  }

  // Month chart — all time
  const allTxsAll = txs.length > 0 ? (() => {
    // already filtered; use closure
    return txs;
  })() : [];

  // For month chart, aggregate from the passed txs list
  const byM = {};
  for (const t of txs) {
    const m = t.date?.slice(0, 7);
    if (!m) continue;
    const tag = t.type === 'receita' ? '\ud83d\udc9a' : '\u2764\ufe0f';
    const k = m + '|' + tag;
    byM[k] = safeRound((byM[k] || 0) + t.amount);
  }

  const chm = document.getElementById('ch-mth');
  if (!chm) return;
  const mm = Math.max(1, ...Object.values(byM));
  const mEntries = Object.entries(byM).sort((a, b) => a[0].localeCompare(b[0]));

  if (!mEntries.length) { chm.innerHTML = '<div class="empty">Sem dados</div>'; }
  else {
    chm.innerHTML = mEntries.map(([k, v]) => {
      const [mon, tag] = k.split('|');
      const color = tag === '\ud83d\udc9a' ? '#4ade80' : '#f87171';
      return `<div class="bar-row"><span>${mon} ${tag}</span><div class="bar-bg"><div class="bar-fill" style="width:${v / mm * 100}%;background:${color}"></div></div><div class="bar-amt">${fmt(v)}</div></div>`;
    }).join('');
  }
}

/* ---- ANALYSIS PAGE ---- */
function renderAnalysis(allTxs, monthFilter) {
  const container = document.getElementById('analysis-grid');
  if (!container) return;

  if (!allTxs.length) {
    container.innerHTML = '<p class="empty" style="font-size:0.85rem">Sem dados para an\u00e1lise.</p>';
    return;
  }

  const now = monthFilter !== 'all' ? monthFilter : new Date().toISOString().slice(0, 7);
  const currentMonthTxs = allTxs.filter(t => t.date && t.date.startsWith(now));
  const prevMonth = getPrevMonth(now);
  const prevTxs = allTxs.filter(t => t.date && t.date.startsWith(prevMonth));

  // 1. Donut - expense distribution
  const expThisMonth = currentMonthTxs.filter(t => t.type === 'expense');
  const byCat = {};
  for (const t of expThisMonth) { byCat[t.category] = safeRound((byCat[t.category] || 0) + t.amount); }
  const donut = document.getElementById('donut-chart');
  if (donut) donut.innerHTML = renderDonut(byCat, EXPENSE_COLORS, 'expense');

  // 2. Donut - revenue distribution
  const incThisMonth = currentMonthTxs.filter(t => t.type === 'receita');
  const byCatInc = {};
  for (const t of incThisMonth) { byCatInc[t.category] = safeRound((byCatInc[t.category] || 0) + t.amount); }
  const donutInc = document.getElementById('donut-receita');
  if (donutInc) donutInc.innerHTML = renderDonut(byCatInc, REVENUE_COLORS, 'receita');

  // 3. Month comparison
  const comp = document.getElementById('comparison-section');
  if (comp) comp.innerHTML = renderComparison(byCat, prevTxs, now);

  // 4. Balance trend
  const trend = document.getElementById('trend-section');
  if (trend) trend.innerHTML = renderBalanceTrend(allTxs);

  // 5. Monthly summary
  const summary = document.getElementById('monthly-summary');
  if (summary) summary.innerHTML = renderMonthlySummary(currentMonthTxs, now);

  // 6. Category breakdown
  catBreakdownTable(byCat);
}

function getPrevMonth(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 2);
  return d.toISOString().slice(0, 7);
}

function renderDonut(data, colors, type = 'expense') {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return '<p class="empty" style="font-size:0.85rem">Sem transa\u00e7\u00f5es no per\u00edodo</p>';

  const r = 55, cx = 70, cy = 70;
  const circumference = 2 * Math.PI * r;
  let segments = '';
  let legend = '';
  let offset = 0;

  for (let i = 0; i < entries.length; i++) {
    const [cat, amount] = entries[i];
    const pct = amount / total;
    const dashLen = pct * circumference;
    const dashOff = -offset * circumference;
    const col = colors[i % colors.length];
    segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${dashLen} ${circumference - dashLen}" stroke-dashoffset="${dashOff}" transform="rotate(-90 ${cx} ${cy})" />`;
    offset += pct;
  }

  for (let i = 0; i < entries.length; i++) {
    const [cat, amount] = entries[i];
    const pct = Math.round(amount / total * 100);
    const ic = esc(iconFor(type, cat));
    const col = colors[i % colors.length];
    const name = esc(CAT_NAMES[cat] || cat);
    legend += `<div class="donut-legend-item"><span class="dot" style="background:${col}"></span>${ic} ${name} ${pct}%</div>`;
  }

  const title = type === 'expense' ? 'Despesas do m\u00eas' : 'Receitas do m\u00eas';
  return `<p style="font-size:0.7rem;color:#64748b;text-align:center;margin-bottom:6px">${title}</p>
    <svg viewBox="0 0 140 140" class="donut-svg">${segments}</svg>
    <div class="donut-center"><div style="font-size:0.7rem;color:#94a3b8">Total</div><div style="font-weight:700;font-size:1rem">${fmt(total)}</div></div>
    <div class="donut-legend">${legend}</div>`;
}

function renderComparison(currentByCat, prevTxs, monthStr) {
  const prevExp = prevTxs.filter(t => t.type === 'expense');
  const prevByCat = {};
  for (const t of prevExp) { prevByCat[t.category] = safeRound((prevByCat[t.category] || 0) + t.amount); }

  const allCats = new Set([...Object.keys(currentByCat), ...Object.keys(prevByCat)]);
  if (!allCats.size) return '<p class="empty" style="font-size:0.85rem">Sem dados para comparar</p>';

  const label = new Date(monthStr + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const items = [];

  for (const cat of allCats) {
    const cur = currentByCat[cat] || 0;
    const prev = prevByCat[cat] || 0;
    if (!cur && !prev) continue;
    const diff = prev > 0 ? ((cur - prev) / prev * 100) : (cur > 0 ? 100 : 0);
    const arrow = diff > 0 ? '\u2191' : diff < 0 ? '\u2193' : '=';
    const color = diff > 0 ? '#ef4444' : diff < 0 ? '#22c55e' : '#94a3b8';
    const ic = esc(iconFor('expense', cat));
    const name = esc(CAT_NAMES[cat] || cat);
    items.push(`<div class="comparison-row"><span>${ic} ${name}</span><span style="color:${color};font-weight:600">${arrow} ${Math.abs(Math.round(diff))}%</span><span style="font-size:0.7rem;color:#94a3b8">${fmt(prev)} \u2192 ${fmt(cur)}</span></div>`);
  }

  return `<h3>Compara\u00e7\u00e3o mensal</h3><p style="font-size:0.7rem;color:#64748b;margin-bottom:8px">${esc(label)} vs m\u00eas anterior</p>${items.join('')}`;
}

function renderBalanceTrend(allTxs) {
  const months = {};
  for (const t of allTxs) {
    const m = t.date?.slice(0, 7);
    if (!m) continue;
    if (!months[m]) months[m] = { income: 0, expense: 0 };
    if (t.type === 'receita') months[m].income += t.amount;
    else months[m].expense += t.amount;
  }

  const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
  let cumulative = 0;
  const points = sorted.map(([month, data]) => {
    cumulative = safeRound(cumulative + data.income - data.expense);
    return { month, balance: cumulative };
  });

  if (!points.length) return '<h3>Tend\u00eancia de saldo</h3><p class="empty" style="font-size:0.85rem">Sem dados</p>';

  const absMax = Math.max(1, ...points.map(p => Math.abs(p.balance)));
  const w = 280, h = 100, pad = 8;
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;

  let pathD = '', dots = '', labels = '';
  points.forEach((p, i) => {
    const x = pad + i * stepX;
    const mid = (h - pad * 2) / 2;
    const y = (h - pad) - (p.balance / absMax * mid + mid);
    pathD += (i === 0 ? `M${x},${y}` : ` L${x},${y}`);
    dots += `<circle cx="${x}" cy="${y}" r="2.5" fill="${p.balance >= 0 ? '#4ade80' : '#f87171'}" />`;
    if (i === 0 || i === points.length - 1) {
      const [y2, m] = p.month.split('-');
      const d = new Date(parseInt(y2, 10), parseInt(m, 10) - 1);
      labels += `<text x="${x}" y="${h - 1}" fill="#64748b" font-size="6" text-anchor="middle">${d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}</text>`;
    }
  });

  const lastPt = points[points.length - 1];
  const color = lastPt.balance >= 0 ? '#4ade80' : '#f87171';
  const labelY = (h - pad) - (lastPt.balance / absMax * (h - pad * 2) / 2 + (h - pad * 2) / 2) - 6;
  const labelX = points.length > 1 ? pad + (points.length - 1) * stepX : pad;

  return `<h3>Tend\u00eancia de saldo</h3>
    <p style="font-size:0.75rem;color:${color};margin-bottom:8px">${lastPt.balance >= 0 ? '\u2191' : '\u2193'} ${fmt(safeRound(lastPt.balance))} acumulado</p>
    <svg viewBox="0 0 ${w} ${h}" width="100%" style="overflow:visible">
      <line x1="${pad}" y1="${h - pad - (h - pad * 2) / 2}" x2="${w - pad}" y2="${h - pad - (h - pad * 2) / 2}" stroke="#334155" stroke-dasharray="2,3" />
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
      <text x="${labelX}" y="${labelY}" fill="${color}" font-size="6" font-weight="600">${fmt(safeRound(lastPt.balance))}</text>
      ${labels}
    </svg>`;
}

function renderMonthlySummary(txs, monthStr) {
  const inc = safeRound(txs.filter(t => t.type === 'receita').reduce((s, t) => s + Number(t.amount), 0));
  const exp = safeRound(txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0));
  const bal = safeRound(inc - exp);
  const label = new Date(monthStr + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const byCat = {};
  for (const t of txs.filter(t => t.type === 'expense')) { byCat[t.category] = safeRound((byCat[t.category] || 0) + t.amount); }
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

  let topHtml = '';
  if (topCat && topCat[1] > 0) {
    const pct = Math.round(topCat[1] / Math.max(1, exp) * 100);
    const ic = esc(iconFor('expense', topCat[0]));
    const name = esc(CAT_NAMES[topCat[0]] || topCat[0]);
    topHtml = `Maior gasto: ${ic} ${name} (${pct}%)`;
  }

  return `<h3>Resumo do m\u00eas</h3>
    <p style="font-size:0.8rem;color:#94a3b8;line-height:1.6">${esc(label)}:</p>
    <p style="font-size:0.82rem;line-height:1.7">
    Receita: <span style="color:#4ade80;font-weight:600">${fmt(inc)}</span><br>
    Despesas: <span style="color:#f87171;font-weight:600">${fmt(exp)}</span><br>
    Sobra: <span style="color:${bal >= 0 ? '#4ade80' : '#f87171'};font-weight:600">${fmt(bal)}</span><br>
    ${topHtml ? topHtml + '<br>' : ''}
    Transa\u00e7\u00f5es: ${txs.length}
    </p>`;
}

function catBreakdownTable(byCat) {
  const container = document.getElementById('cat-breakdown');
  if (!container) return;
  const total = Object.values(byCat).reduce((s, v) => s + v, 0);
  if (!total) { container.innerHTML = '<p class="empty" style="font-size:0.85rem">Sem transa\u00e7\u00f5es</p>'; return; }
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const html = sorted.map(([cat, amount]) => {
    const pct = Math.round(amount / total * 100);
    const ic = esc(iconFor('expense', cat));
    const name = esc(CAT_NAMES[cat] || cat);
    return `<tr><td style="padding:8px;font-size:0.82rem">${ic} ${name}</td><td style="padding:8px;font-size:0.82rem">${fmt(safeRound(amount))}</td><td style="padding:8px;font-size:0.82rem">${pct}%</td></tr>`;
  }).join('');
  container.innerHTML = `<table><thead><tr><th style="padding:6px 8px">Categoria</th><th style="padding:6px 8px">Valor</th><th style="padding:6px 8px">%</th></tr></thead><tbody>${html}</tbody></table>`;
}

/* ---- add transaction ---- */
async function addTx() {
  const type = document.getElementById('f-type').value;
  const category = document.getElementById('f-cat').value;
  const description = document.getElementById('f-desc').value.trim();
  const amount = parseMoney(document.getElementById('f-amount').value);
  const date = document.getElementById('f-date').value;
  const isRecurring = document.getElementById('f-recurring').checked;

  if (!description || !amount || !date) return toast('Preencha todos os campos', 'error');
  if (isNaN(amount) || amount <= 0) return toast('Valor deve ser maior que zero', 'error');

  const txs = await getTxs();
  const id = txs.length ? Math.max(...txs.map(t => t.id)) + 1 : 1;
  txs.push({ id, type, category, description, amount: safeRound(amount), date });
  await saveTxs(txs);

  if (isRecurring) {
    const day = new Date(date + 'T12:00:00').getDate();
    const recurring = await getRecurring();
    const rid = 'r_' + Date.now();
    recurring.push({ id: rid, type, category, description, amount: safeRound(amount), day });
    await saveRecurring(recurring);
  }

  document.getElementById('f-desc').value = '';
  document.getElementById('f-amount').value = '';
  document.getElementById('f-recurring').checked = false;
  await populateMonthFilter();
  await refresh();
  toast('Transa\u00e7\u00e3o adicionada!');
}

/* ---- delete ---- */
async function delTx(id) {
  confirmDel('Apagar esta transa\u00e7\u00e3o?', async () => {
    const txs = await getTxs();
    await saveTxs(txs.filter(t => t.id !== id));
    await refresh();
    toast('Transa\u00e7\u00e3o apagada', 'info');
  });
}

/* ---- edit ---- */
function editTx(id) {
  getTxs().then(txs => {
    const t = txs?.find(x => x.id === id);
    if (!t) return;
    document.getElementById('e-id').value = t.id;
    fillCats('e');
    document.getElementById('e-type').value = t.type;
    fillCats('e');
    document.getElementById('e-cat').value = t.category;
    document.getElementById('e-desc').value = t.description;
    document.getElementById('e-amt').value = fmtInput(String(Math.round(t.amount * 100)));
    document.getElementById('e-date').value = t.date;
    document.getElementById('m-ov').classList.add('open');
  });
}

async function saveTx() {
  const id = parseInt(document.getElementById('e-id').value, 10);
  const amount = parseMoney(document.getElementById('e-amt').value);
  if (isNaN(amount) || amount <= 0) return toast('Valor inv\u00e1lido', 'error');

  const txs = await getTxs();
  const t = txs.find(x => x.id === id);
  if (!t) return toast('Transa\u00e7\u00e3o n\u00e3o encontrada', 'error');

  t.category = document.getElementById('e-cat').value;
  t.description = document.getElementById('e-desc').value;
  t.amount = safeRound(amount);
  t.date = document.getElementById('e-date').value;
  t.type = document.getElementById('e-type').value;
  await saveTxs(txs);

  closeM();
  await refresh();
  toast('Transa\u00e7\u00e3o atualizada!');
}

function closeM() { document.getElementById('m-ov').classList.remove('open'); }

/* ---- budgets ---- */
function renderBudgets(txs) {
  const container = document.getElementById('budgets-grid');
  if (!container) return;

  const budgets = getBudgets();
  // Budgets are sync in this version
  const keys = Object.keys(budgets);
  if (!keys.length) { container.innerHTML = '<p class="empty" style="font-size:0.85rem">Nenhum or\u00e7amento definido.</p>'; return; }

  const expenseTx = txs.filter(t => t.type === 'expense');
  const byCat = {};
  for (const t of expenseTx) { byCat[t.category] = safeRound((byCat[t.category] || 0) + t.amount); }

  container.innerHTML = '';
  for (const [cat, limit] of Object.entries(budgets)) {
    const spent = byCat[cat] || 0;
    const pct = Math.min(100, Math.round((spent / Math.max(limit, 1)) * 100));
    const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
    const ic = esc(iconFor('expense', cat));
    const name = esc(CAT_NAMES[cat] || cat);
    container.innerHTML += `
      <div class="budget-card">
        <div class="budget-info">
          <div class="budget-label">${ic} ${name}</div>
          <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="budget-amount">${fmt(spent)} / ${fmt(limit)}</div>
        </div>
        <button class="btn-s" onclick="delBudget('${esc(cat)}')" title="Remover">\u2715</button>
      </div>`;
  }
}

function showBudgetForm() {
  const f = document.getElementById('budget-form');
  f.style.display = f.style.display === 'none' ? 'flex' : 'none';
}

function addBudget() {
  const cat = document.getElementById('budget-cat').value;
  const amount = parseFloat(document.getElementById('budget-amount-input').value);
  if (!amount || amount <= 0) return toast('Valor inv\u00e1lido', 'error');

  const budgets = getBudgets();
  budgets[cat] = amount;
  saveBudgets(budgets);
  document.getElementById('budget-amount-input').value = '';
  document.getElementById('budget-form').style.display = 'none';
  refresh();
  toast('Or\u00e7amento definido!');
}

function delBudget(cat) {
  confirmDel('Remover or\u00e7amento de ' + cat + '?', () => {
    const budgets = getBudgets();
    delete budgets[cat];
    saveBudgets(budgets);
    refresh();
    toast('Or\u00e7amento removido', 'info');
  });
}

/* ---- recurring list ---- */
function showRecurring() {
  const container = document.getElementById('recurring-grid');
  if (!container) return;

  const recurring = getRecurring();
  if (!recurring.length) { container.innerHTML = '<p class="empty" style="font-size:0.85rem">Nenhuma transa\u00e7\u00e3o recorrente.</p>'; return; }

  container.innerHTML = '';
  for (const r of recurring) {
    const ic = esc(iconFor(r.type, r.category));
    const desc = esc(String(r.description));
    container.innerHTML += `
      <div class="recurring-item">
        <div class="recurring-item-info">${ic} ${desc} \u2014 ${fmt(r.amount)} (dia ${r.day})</div>
        <button class="btn-s" onclick="delRecurring('${esc(r.id)}')" title="Remover">\u2715</button>
      </div>`;
  }
}

function delRecurring(id) {
  confirmDel('Remover recorrente?', () => {
    getRecurring().then(list => saveRecurring(list.filter(r => r.id !== id)));
    showRecurring();
    toast('Recorrente removido', 'info');
  });
}

/* ---- tabs ---- */
async function goTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.getElementById('pg-' + name)?.classList.add('on');
  const btns = document.querySelectorAll('.bnav button');
  const idx = ['overview', 'analysis', 'budgets', 'settings'].indexOf(name);
  if (idx >= 0) { btns.forEach(b => b.classList.remove('on')); btns[idx]?.classList.add('on'); }
  if (name === 'analysis') renderAnalysis(await getTxs(), document.getElementById('month-sel').value);
  if (name === 'budgets') { renderBudgets(await getTxs()); showRecurring(); }
}

/* ---- export/import ---- */
function exportData() {
  (async () => {
    const data = { transactions: await getTxs(), recurring: await getRecurring(), budgets: await getBudgets() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'finance_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    toast('Dados exportados!');
  })();
}

function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(async text => {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data.transactions)) { await saveTxs(data.transactions); }
      if (Array.isArray(data.recurring)) { await saveRecurring(data.recurring); }
      if (data.budgets && typeof data.budgets === 'object') { await saveBudgets(data.budgets); }
      await refresh();
      await populateMonthFilter();
      toast('Importado!');
    } catch { toast('Erro ao ler arquivo', 'error'); }
    e.target.value = '';
  });
}

function exportCSV() {
  (async () => {
    const txs = await getTxs();
    let csv = 'tipo,categoria,descricao,valor,data\n';
    for (const t of txs) {
      csv += `${t.type},${t.category},"${t.description.replace(/"/g, '""')}",${t.amount},${t.date}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'finance_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    toast('CSV exportado!');
  })();
}

function importCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(async text => {
    try {
      const lines = text.trim().split('\n');
      if (lines.length < 2) return toast('CSV vazio', 'error');
      const header = lines[0].trim().toLowerCase();

      let count = 0;
      const txs = await getTxs();
      let maxId = txs.length ? Math.max(...txs.map(t => t.id)) : 0;

      if (header.includes('data') && header.includes('valor') && header.includes('descri')) {
        // Bank statement format
        for (let i = 1; i < lines.length; i++) {
          const parts = parseCSVLine(lines[i]);
          if (parts.length < 4) continue;
          const dateRaw = parts[0].trim();
          let amountStr = parts[1].trim();
          if (amountStr.includes(',') && !amountStr.includes('.')) { amountStr = amountStr.replace(',', '.'); }
          const description = parts.slice(3).join(',').trim();
          if (!dateRaw || !amountStr || !description) continue;
          const amountNum = parseFloat(amountStr);
          if (isNaN(amountNum)) continue;
          const type = amountNum > 0 ? 'receita' : 'expense';
          const date = dateRaw.split('/').reverse().join('-');
          maxId++;
          let category = 'Other';
          const desc = description.toLowerCase();
          if (amountNum < 0) {
            if (desc.match(/aliment|supermerc|mercado|restaurante|pizzaria|ifd/)) category = 'Food';
            else if (desc.match(/telefonia|transit|transporte|uber/)) category = 'Transport';
            else if (desc.match(/aluguel|moradia|condom/)) category = 'Housing';
            else if (desc.match(/sa\u00fade|farm\u00e1cia|m\u00e9dico|hospital/)) category = 'Health';
            else if (desc.match(/lazer|cinema|netflix|spotify/)) category = 'Entertainment';
            else if (desc.match(/compra|loja|shopping/)) category = 'Shopping';
            else if (desc.match(/educa|curso|livro/)) category = 'Education';
          } else {
            if (desc.match(/sal\u00e1rio|recebida/)) category = 'Salary';
            else if (desc.match(/investimento|resgate/)) category = 'Investments';
            else if (desc.includes('freelance')) category = 'Freelance';
          }
          txs.push({ id: maxId, type, category, description, amount: Math.abs(safeRound(amountNum)), date });
          count++;
        }
      } else if (header.includes('tipo') && header.includes('categoria')) {
        for (let i = 1; i < lines.length; i++) {
          const parts = parseCSVLine(lines[i]);
          if (parts.length < 5) continue;
          const [type, category, ...rest] = parts;
          const date = parts[parts.length - 1].trim();
          const amountStr = parts[parts.length - 2].trim();
          const description = rest.slice(0, -1).join(',').trim();
          if (!type || !category || !description || !amountStr || !date) continue;
          maxId++;
          txs.push({ id: maxId, type: type.trim(), category: category.trim(), description: description.replace(/^"|"$/g, '').replace(/""/g, '"'), amount: parseFloat(amountStr), date });
          count++;
        }
      } else { toast('Formato n\u00e3o reconhecido', 'error'); return; }

      await saveTxs(txs);
      await refresh();
      await populateMonthFilter();
      toast(`${count} transa\u00e7\u00f5es importadas!`);
    } catch { toast('Erro ao ler CSV', 'error'); }
    e.target.value = '';
  });
}

/** Parse a single CSV line respecting quoted commas */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

async function clearAll() {
  confirmDel('Apagar todos os dados? N\u00e3o tem volta.', async () => {
    await _remove('txs');
    await _remove('recurring');
    await _remove('budgets');
    await refresh();
    await populateMonthFilter();
    toast('Dados apagados', 'info');
  });
}

/* ---- month filter change + init ---- */
document.getElementById('month-sel').addEventListener('change', () => { refresh(); });
load();
