const CATS = {
  receita: { icons: {Salary:'Salário',Investments:'Investimentos',Freelance:'Freelance',Other:'Outro'} },
  expense: { icons: {Food:'Alimentação',Transport:'Transporte',Housing:'Moradia',Health:'Saúde',Entertainment:'Lazer',Shopping:'Compras',Education:'Educação',Other:'Outro'} }
};
const CAT_NAMES = {};
for (const [type, cfg] of Object.entries(CATS)) {
  for (const [key, name] of Object.entries(cfg.icons)) {
    CAT_NAMES[key] = name;
  }
}
const EXPENSE_COLORS = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#06b6d4','#6366f1','#a855f7'];
const REVENUE_COLORS = ['#22c55e','#10b981','#059669','#34d399'];

/* ---- util ---- */
const fmt = v => parseFloat(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const iconFor = (type, cat) => { for(const[k,v]of Object.entries(CATS[type]?.icons||{})){if(k===cat)return v;} return '';}

function getTxs() { return JSON.parse(localStorage.getItem('finance_txs')||'[]'); }
function saveTxs(txs) { localStorage.setItem('finance_txs', JSON.stringify(txs)); }
function getRecurring() { return JSON.parse(localStorage.getItem('finance_recurring')||'[]'); }
function saveRecurring(r) { localStorage.setItem('finance_recurring', JSON.stringify(r)); }
function getBudgets() { return JSON.parse(localStorage.getItem('finance_budgets')||'{}'); }
function saveBudgets(b) { localStorage.setItem('finance_budgets', JSON.stringify(b)); }

/* ---- currency mask ---- */
function moneyInput(el) {
  el.addEventListener('input', () => {
    let digits = el.value.replace(/\D/g, '');
    if (!digits) { el.value = ''; return; }
    while (digits.length < 3) digits = '0' + digits;
    const cents = digits.slice(-2);
    const intPart = digits.slice(0, -2);
    const formatted = Number(intPart).toLocaleString('pt-BR') + ',' + cents;
    el.value = 'R$ ' + formatted;
  });
}
function parseMoney(raw) {
  if (!raw) return NaN;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 3) return digits === '' ? NaN : parseInt(digits) / 100;
  return parseInt(digits) / 100;
}

function fmtInput(raw) {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  while (digits.length < 3) digits = '0' + digits;
  return 'R$ ' + Number(digits.slice(0,-2)).toLocaleString('pt-BR') + ',' + digits.slice(-2);
}

/* ---- toasts ---- */
function toast(msg, type='success') {
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
function syncRecurring() {
  const now = new Date();
  const ym = now.toISOString().slice(0,7);
  const txs = getTxs();
  const existingKeys = new Set(txs.filter(t=>t.recurringId).map(t=>t.recurringId+'-'+t.date.slice(0,7)));
  const recurring = getRecurring();
  let changed = false;

  for (const rec of recurring) {
    const key = rec.id + '-' + ym;
    if (!existingKeys.has(key)) {
      const day = Math.min(rec.day || 1, 28);
      const date = `${ym}-${String(day).padStart(2,'0')}`;
      const maxId = txs.length ? Math.max(...txs.map(t=>t.id)) : 0;
      txs.push({
        id: maxId + 1,
        type: rec.type,
        category: rec.category,
        description: rec.description,
        amount: rec.amount,
        date: date,
        recurringId: rec.id
      });
      changed = true;
    }
  }
  if (changed) saveTxs(txs);
}

/* ---- load & refresh ---- */
async function load() {
  syncRecurring();

  fillCats('f');
  document.getElementById('f-date').value = new Date().toISOString().slice(0,10);

  // init money inputs
  const fAmt = document.getElementById('f-amount');
  const eAmt = document.getElementById('e-amt');
  moneyInput(fAmt);
  moneyInput(eAmt);

  // init edit modal type options
  const eType = document.getElementById('e-type');
  eType.innerHTML = '';
  for (const type of Object.keys(CATS)) {
    const o = document.createElement('option');
    o.value = type; o.textContent = type === 'receita' ? 'Receita' : 'Despesa';
    eType.appendChild(o);
  }

  // populate month filter
  populateMonthFilter();

  refresh();
}

function populateMonthFilter() {
  const sel = document.getElementById('month-sel');
  const txs = getTxs();
  const months = new Set();
  for (const t of txs) months.add(t.date.slice(0,7));
  const now = new Date();
  const ym = now.toISOString().slice(0,7);
  months.add(ym);

  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = 'Todos';
  sel.appendChild(all);

  const sorted = [...months].sort().reverse();
  for (const m of sorted) {
    const [y,mo] = m.split('-');
    const d = new Date(y, mo-1);
    const o = document.createElement('option');
    o.value = m;
    o.textContent = d.toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
    if (m === ym) o.selected = true;
    sel.appendChild(o);
  }
}

function refresh() {
  syncRecurring();
  const allTxs = getTxs();
  allTxs.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);

  // Balance cards always show ALL-TIME totals
  const ineAll = allTxs.filter(t=>t.type==='receita').reduce((s,t)=>s+t.amount,0);
  const expAll = allTxs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  document.getElementById('v-ine').textContent = fmt(ineAll);
  document.getElementById('v-exp').textContent = fmt(expAll);
  document.getElementById('v-bal').textContent = fmt(ineAll-expAll);

  // Month filter only affects table and detail charts
  const mSel = document.getElementById('month-sel');
  const month = mSel.value;
  let txs = month !== 'all' ? allTxs.filter(t=>t.date && t.date.startsWith(month)) : allTxs;

  renderTable(txs);
  renderDetailCharts(txs, month);
  renderBudgets(txs);
  renderAnalysis(allTxs, month);
}

function fillCats(prefix) {
  const t = document.getElementById(prefix==='f'?'f-type':'e-type').value;
  const sel = document.getElementById(prefix==='f'?'f-cat':'e-cat');
  sel.innerHTML = '';
  for (const [k,v] of Object.entries(CATS[t] ? CATS[t].icons : {})) {
    const o = document.createElement('option'); o.value = k; o.textContent = v;
    sel.appendChild(o);
  }
}

/* ---- table ---- */
function renderTable(txs) {
  const tb = document.getElementById('tx-list');
  if (!txs.length) { tb.innerHTML='<tr><td colspan="6"><div class="empty">Nenhuma transação</div></td></tr>'; return; }
  tb.innerHTML = '';
  for (const t of txs) {
    const tr = document.createElement('tr');
    const lbl = t.type==='receita'?'Receita':'Despesa';
    const p = t.type==='receita'?'pill-r':'pill-e';
    const ic = iconFor(t.type, t.category);
    const recTag = t.recurringId ? '<span class="recurring-tag">recorrente</span>' : '';
    tr.innerHTML = `<td><span class="pill ${p}">${lbl}</span>${recTag}</td>
      <td>${ic} ${t.category}</td>
      <td>${t.description}</td>
      <td>${fmt(t.amount)}</td>
      <td>${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td class="tx-actions"><button class="btn-s" onclick="editTx(${t.id})">✏</button><button class="btn-s" onclick="delTx(${t.id})">✕</button></td>`;
    tb.appendChild(tr);
  }
}

/* ---- overview charts ---- */
function renderDetailCharts(txs, month) {
  // Category bar chart — reflects current filter
  const byC={};
  for(const t of txs){ const k=t.type+'|'+t.category; byC[k]=(byC[k]||0)+t.amount; }
  const mc=Math.max(1,...Object.values(byC));
  const cc=document.getElementById('ch-cat'); cc.innerHTML='';
  if (!Object.keys(byC).length) { cc.innerHTML='<div class="empty">Sem dados</div>'; }
  for(const[k,v]of Object.entries(byC).sort((a,b)=>b[1]-a[1])){
    const[type,cat]=k.split('|');
    const ic=iconFor(type,cat);
    cc.innerHTML+=`<div class="bar-row"><span>${ic} ${cat}</span><div class="bar-bg"><div class="bar-fill" style="width:${(v/mc)*100}%;background:${type==='receita'?'#4ade80':'#f87171'}"></div></div><div class="bar-amt">${fmt(v)}</div></div>`;
  }

  // Month bar chart — always ALL time
  const allTxs = getTxs();
  const byM={};
  for(const t of allTxs){ const m=t.date.slice(0,7); const k=m+'|'+(t.type==='receita'?'💚':'❤️'); byM[k]=(byM[k]||0)+t.amount; }
  const mm=Math.max(1,...Object.values(byM));
  const chm=document.getElementById('ch-mth'); chm.innerHTML='';
  for(const[k,v]of Object.entries(byM).reverse()){
    const[mon,tag]=k.split('|');
    chm.innerHTML+=`<div class="bar-row"><span>${mon} ${tag}</span><div class="bar-bg"><div class="bar-fill" style="width:${(v/mm)*100}%;background:${tag==='💚'?'#4ade80':'#f87171'}"></div></div><div class="bar-amt">${fmt(v)}</div></div>`;
  }
}

/* ---- ANALYSIS PAGE ---- */
function renderAnalysis(allTxs, monthFilter) {
  const container = document.getElementById('analysis-grid');
  if (!container) return;

  if (!allTxs.length) {
    container.innerHTML = '<p class="empty" style="font-size:0.85rem">Sem dados para análise.</p>';
    return;
  }

  // Current month expenses
  const now = monthFilter !== 'all' ? monthFilter : new Date().toISOString().slice(0,7);
  const currentMonthTxs = allTxs.filter(t=>t.date && t.date.startsWith(now));
  const prevMonth = getPrevMonth(now);
  const prevTxs = allTxs.filter(t=>t.date && t.date.startsWith(prevMonth));

  // 1. Donut chart - expense distribution this month
  const expThisMonth = currentMonthTxs.filter(t=>t.type==='expense');
  const byCat = {};
  for (const t of expThisMonth) {
    byCat[t.category] = (byCat[t.category]||0) + t.amount;
  }
  const donut = document.getElementById('donut-chart');
  donut.innerHTML = renderDonut(byCat, EXPENSE_COLORS);

  // 2. Donut chart - revenue distribution this month
  const incThisMonth = currentMonthTxs.filter(t=>t.type==='receita');
  const byCatInc = {};
  for (const t of incThisMonth) {
    byCatInc[t.category] = (byCatInc[t.category]||0) + t.amount;
  }
  const donutInc = document.getElementById('donut-receita');
  donutInc.innerHTML = renderDonut(byCatInc, REVENUE_COLORS, 'receita');

  // 3. Comparison: month vs previous month
  const comp = document.getElementById('comparison-section');
  comp.innerHTML = renderComparison(byCat, prevTxs, now);

  // 4. Trend: balance over months
  const trend = document.getElementById('trend-section');
  trend.innerHTML = renderBalanceTrend(allTxs);

  // 5. Monthly summary
  const summary = document.getElementById('monthly-summary');
  summary.innerHTML = renderMonthlySummary(currentMonthTxs, now);

  // 6. Category breakdown table
  catBreakdownTable(byCat);
}

function getPrevMonth(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 2);
  return d.toISOString().slice(0,7).slice(0,7);
}

function renderDonut(data, colors, type='expense') {
  const entries = Object.entries(data).sort((a,b)=>b[1]-a[1]);
  const total = entries.reduce((s,[,v])=>s+v,0);
  if (!total) return '<p class="empty" style="font-size:0.85rem">Sem transações no período</p>';

  // SVG donut
  const r = 55;
  const cx = 70;
  const cy = 70;
  const circumference = 2 * Math.PI * r;
  let segments = '';
  let offset = 0;

  for (const [cat, amount] of entries) {
    const pct = amount / total;
    const dashLen = pct * circumference;
    const dashOff = -offset * circumference;
    const ic = iconFor(type, cat);
    const col = colors[entries.indexOf([cat,amount]) % colors.length];
    segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="18"
      stroke-dasharray="${dashLen} ${circumference-dashLen}"
      stroke-dashoffset="${dashOff}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += pct;
  }

  let legend = '';
  for (const [cat, amount] of entries) {
    const pct = Math.round(amount/total*100);
    const ic = iconFor(type, cat);
    const name = CAT_NAMES[cat] || cat;
    legend += `<div class="donut-legend-item"><span class="dot" style="background:${colors[entries.indexOf([cat,amount]) % colors.length]}"></span>${ic} ${name} ${pct}%</div>`;
  }

  const title = type === 'expense' ? 'Despesas do mês' : 'Receitas do mês';
  return `<div class="donut-wrap">
    <p style="font-size:0.7rem;color:#64748b;text-align:center;margin-bottom:6px">${title}</p>
    <svg viewBox="0 0 140 140" class="donut-svg">${segments}</svg>
    <div class="donut-center"><div style="font-size:0.7rem;color:#94a3b8">Total</div><div style="font-weight:700;font-size:1rem">${fmt(total)}</div></div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

function renderComparison(currentByCat, prevTxs, monthStr) {
  const prevExp = prevTxs.filter(t=>t.type==='expense');
  const prevByCat = {};
  for (const t of prevExp) prevByCat[t.category] = (prevByCat[t.category]||0) + t.amount;

  const allCats = new Set([...Object.keys(currentByCat), ...Object.keys(prevByCat)]);
  if (!allCats.size) return '<p class="empty" style="font-size:0.85rem">Sem dados para comparar</p>';

  const label = new Date(monthStr+'-15').toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
  let html = `<h3>Comparação mensal</h3><p style="font-size:0.7rem;color:#64748b;margin-bottom:8px">${label} vs mês anterior</p>`;

  const items = [];
  for (const cat of allCats) {
    const cur = currentByCat[cat] || 0;
    const prev = prevByCat[cat] || 0;
    if (!cur && !prev) continue;
    const diff = prev > 0 ? ((cur - prev) / prev * 100) : (cur > 0 ? 100 : 0);
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
    const color = diff > 0 ? '#ef4444' : diff < 0 ? '#22c55e' : '#94a3b8';
    const ic = iconFor('expense', cat);
    const name = CAT_NAMES[cat] || cat;
    if (diff > 0) {
      items.push(`<div class="comparison-row"><span>${ic} ${name}</span><span style="color:${color};font-weight:600">${arrow} ${Math.abs(Math.round(diff))}%</span><span style="font-size:0.7rem;color:#94a3b8">${fmt(prev)} → ${fmt(cur)}</span></div>`);
    } else if (diff < 0) {
      items.push(`<div class="comparison-row"><span>${ic} ${name}</span><span style="color:${color};font-weight:600">${arrow} ${Math.abs(Math.round(diff))}%</span><span style="font-size:0.7rem;color:#94a3b8">${fmt(prev)} → ${fmt(cur)}</span></div>`);
    } else {
      items.push(`<div class="comparison-row"><span>${ic} ${name}</span><span style="color:#94a3b8">=</span><span style="font-size:0.7rem;color:#94a3b8">${fmt(cur)}</span></div>`);
    }
  }

  html += items.join('');
  return html;
}

function renderBalanceTrend(allTxs) {
  const months = {};
  for (const t of allTxs) {
    const m = t.date.slice(0,7);
    if (!months[m]) months[m] = { income: 0, expense: 0 };
    if (t.type === 'receita') months[m].income += t.amount;
    else months[m].expense += t.amount;
  }

  const sorted = Object.entries(months).sort((a,b)=>a[0].localeCompare(b[0]));
  let cumulative = 0;
  const points = sorted.map(([month, data]) => {
    cumulative += data.income - data.expense;
    return { month, balance: cumulative };
  });

  if (!points.length) return '<p class="empty" style="font-size:0.85rem">Sem dados</p>';

  const absMax = Math.max(1, ...points.map(p => Math.abs(p.balance)));
  const w = 280, h = 100, pad = 8;
  const stepX = points.length > 1 ? (w - pad*2) / (points.length - 1) : 0;

  let pathD = '';
  let dots = '';
  let labels = '';
  points.forEach((p, i) => {
    const x = pad + i * stepX;
    const mid = (h - pad*2) / 2;
    const y = (h - pad) - ((p.balance / absMax) * mid + mid);
    pathD += (i===0 ? `M${x},${y}` : ` L${x},${y}`);
    dots += `<circle cx="${x}" cy="${y}" r="2.5" fill="${p.balance>=0?'#4ade80':'#f87171'}" />`;
    // label every few or just last
    if (i === points.length - 1 || i === 0) {
      const [y2,m] = p.month.split('-');
      const d = new Date(parseInt(y2), parseInt(m)-1);
      labels += `<text x="${x}" y="${h-1}" fill="#64748b" font-size="6" text-anchor="middle">${d.toLocaleDateString('pt-BR',{month:'short','year':'2-digit'})}</text>`;
    }
  });

  const lastBal = points[points.length-1].balance;
  const color = lastBal >= 0 ? '#4ade80' : '#f87171';
  const lastPt = points.length ? points[points.length-1] : null;
  const labelY = lastPt ? (h - pad) - ((lastPt.balance / absMax) * (h-pad*2)/2 + (h-pad*2)/2) - 6 : pad - 6;
  const labelX = points.length > 1 ? pad + (points.length-1) * stepX : pad;

  return `<h3>Tendência de saldo</h3>
    <p style="font-size:0.75rem;color:${color};margin-bottom:8px">${lastBal>=0?'↑':'↓'} ${fmt(lastBal)} acumulado</p>
    <svg viewBox="0 0 ${w} ${h}" width="100%" style="overflow:visible">
      <line x1="${pad}" y1="${h-pad - (h-pad*2)/2}" x2="${w-pad}" y2="${h-pad - (h-pad*2)/2}" stroke="#334155" stroke-dasharray="2,3" />
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
      <text x="${labelX}" y="${labelY}" fill="${color}" font-size="6" font-weight="600">${fmt(lastBal)}</text>
      ${labels}
    </svg>`;
}

function renderMonthlySummary(txs, monthStr) {
  const ine = txs.filter(t=>t.type==='receita').reduce((s,t)=>s+t.amount,0);
  const exp = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const bal = ine - exp;
  const label = new Date(monthStr+'-15').toLocaleDateString('pt-BR', {month:'long', year:'numeric'});

  // Top expense category
  const byCat = {};
  for (const t of txs.filter(t=>t.type==='expense')) byCat[t.category] = (byCat[t.category]||0) + t.amount;
  const topCat = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
  let topHtml = '';
  if (topCat && topCat[1] > 0) {
    const pct = Math.round(topCat[1] / Math.max(1, exp) * 100);
    const ic = iconFor('expense', topCat[0]);
    const name = CAT_NAMES[topCat[0]] || topCat[0];
    topHtml = `Maior gasto: ${ic} ${name} (${pct}%)`;
  }

  return `<h3>Resumo do mês</h3>
    <p style="font-size:0.8rem;color:#94a3b8;line-height:1.6">${label}:</p>
    <p style="font-size:0.82rem;line-height:1.7">
    Receita: <span style="color:#4ade80;font-weight:600">${fmt(ine)}</span><br>
    Despesas: <span style="color:#f87171;font-weight:600">${fmt(exp)}</span><br>
    Sobra: <span style="color:${bal>=0?'#4ade80':'#f87171'};font-weight:600">${fmt(bal)}</span><br>
    ${topHtml ? topHtml + '<br>' : ''}
    Transações: ${txs.length}
    </p>`;
}

function catBreakdownTable(byCat) {
  const container = document.getElementById('cat-breakdown');
  if (!container) return;
  const total = Object.values(byCat).reduce((s,v)=>s+v,0);
  if (!total) {
    container.innerHTML = '<p class="empty" style="font-size:0.85rem">Sem transações</p>';
    return;
  }
  const sorted = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  let html = '<table><thead><tr><th style="padding:6px 8px">Categoria</th><th style="padding:6px 8px">Valor</th><th style="padding:6px 8px">%</th></tr></thead><tbody>';
  for (const [cat, amount] of sorted) {
    const pct = Math.round(amount/total*100);
    const ic = iconFor('expense', cat);
    const name = CAT_NAMES[cat] || cat;
    html += `<tr><td style="padding:8px;font-size:0.82rem">${ic} ${name}</td><td style="padding:8px;font-size:0.82rem">${fmt(amount)}</td><td style="padding:8px;font-size:0.82rem">${pct}%</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

/* ---- add transaction ---- */
function addTx() {
  const type=document.getElementById('f-type').value;
  const category=document.getElementById('f-cat').value;
  const description=document.getElementById('f-desc').value.trim();
  const amount=parseMoney(document.getElementById('f-amount').value);
  const date=document.getElementById('f-date').value;
  const isRecurring=document.getElementById('f-recurring').checked;
  if(!description||!amount||!date) return toast('Preencha todos os campos','error');
  if(amount<=0) return toast('Valor deve ser maior que zero','error');

  const txs=getTxs();
  const id=txs.length?Math.max(...txs.map(t=>t.id))+1:1;
  txs.push({id,type,category,description,amount,date});
  saveTxs(txs);

  if (isRecurring) {
    const day = new Date(date+'T12:00:00').getDate();
    const recurring = getRecurring();
    const rid = 'r_' + Date.now();
    recurring.push({id:rid, type, category, description, amount, day});
    saveRecurring(recurring);
  }

  document.getElementById('f-desc').value='';
  document.getElementById('f-amount').value='';
  document.getElementById('f-recurring').checked=false;
  populateMonthFilter();
  refresh();
  toast('Transação adicionada!');
}

/* ---- delete ---- */
function delTx(id) {
  confirmDel('Apagar esta transação?', () => {
    saveTxs(getTxs().filter(t=>t.id!==id));
    refresh();
    toast('Transação apagada','info');
  });
}

/* ---- edit ---- */
function editTx(id) {
  const t=getTxs().find(x=>x.id===id); if(!t)return;
  document.getElementById('e-id').value=t.id;
  fillCats('e');
  document.getElementById('e-type').value=t.type; fillCats('e');
  document.getElementById('e-cat').value=t.category;
  document.getElementById('e-desc').value=t.description;
  document.getElementById('e-amt').value=fmtInput(String(t.amount * 100));
  document.getElementById('e-date').value=t.date;
  document.getElementById('m-ov').classList.add('open');
}

function saveTx() {
  const id=parseInt(document.getElementById('e-id').value);
  const txs=getTxs();
  const t=txs.find(x=>x.id===id); if(!t)return;
  t.category=document.getElementById('e-cat').value;
  t.description=document.getElementById('e-desc').value;
  t.amount=parseMoney(document.getElementById('e-amt').value);
  t.date=document.getElementById('e-date').value;
  t.type=document.getElementById('e-type').value;
  saveTxs(txs);
  document.getElementById('m-ov').classList.remove('open');
  refresh();
  toast('Transação atualizada!');
}
function closeM(){ document.getElementById('m-ov').classList.remove('open'); }

/* ---- budgets ---- */
function renderBudgets(txs) {
  const container = document.getElementById('budgets-grid');
  if (!container) return;

  const budgets = getBudgets();
  const keys = Object.keys(budgets);
  if (!keys.length) {
    container.innerHTML = '<p class="empty" style="font-size:0.85rem">Nenhum orçamento definido.</p>';
    return;
  }

  const expenseTx = txs.filter(t=>t.type==='expense');
  const byCat = {};
  for (const t of expenseTx) byCat[t.category] = (byCat[t.category]||0) + t.amount;

  container.innerHTML = '';
  for (const [cat, limit] of Object.entries(budgets)) {
    const spent = byCat[cat] || 0;
    const pct = Math.min(100, Math.round((spent / Math.max(limit,1)) * 100));
    const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
    const ic = iconFor('expense', cat);

    container.innerHTML += `
      <div class="budget-card">
        <div class="budget-info">
          <div class="budget-label">${ic} ${cat}</div>
          <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="budget-amount">${fmt(spent)} / ${fmt(limit)}</div>
        </div>
        <button class="btn-del" onclick="delBudget('${cat}')" title="Remover">✕</button>
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
  if (!amount || amount <= 0) return toast('Valor inválido', 'error');

  const budgets = getBudgets();
  budgets[cat] = amount;
  saveBudgets(budgets);
  document.getElementById('budget-amount-input').value = '';
  document.getElementById('budget-form').style.display = 'none';
  refresh();
  toast('Orçamento definido!');
}

function delBudget(cat) {
  confirmDel('Remover orçamento de ' + cat + '?', () => {
    const budgets = getBudgets();
    delete budgets[cat];
    saveBudgets(budgets);
    refresh();
    toast('Orçamento removido', 'info');
  });
}

/* ---- recurring list ---- */
function showRecurring() {
  const container = document.getElementById('recurring-grid');
  if (!container) return;

  const recurring = getRecurring();
  if (!recurring.length) {
    container.innerHTML = '<p class="empty" style="font-size:0.85rem">Nenhuma transação recorrente.</p>';
    return;
  }

  container.innerHTML = '';
  for (const r of recurring) {
    const ic = iconFor(r.type, r.category);
    const catName = CATS[r.type]?.icons?.[r.category] || r.category;
    container.innerHTML += `
      <div class="recurring-item">
        <div class="recurring-item-info">${ic} ${r.description} — ${fmt(r.amount)} (dia ${r.day})</div>
        <button class="btn-del" onclick="delRecurring('${r.id}')" title="Remover">✕</button>
      </div>`;
  }
}

function delRecurring(id) {
  confirmDel('Remover recorrente?', () => {
    saveRecurring(getRecurring().filter(r=>r.id!==id));
    showRecurring();
    toast('Recorrente removido', 'info');
  });
}

/* ---- tabs ---- */
function goTab(name) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.getElementById('pg-'+name).classList.add('on');
  document.querySelectorAll('.bnav button').forEach(b=>b.classList.remove('on'));
  document.querySelectorAll('.bnav button')[['overview','analysis','budgets','settings'].indexOf(name)].classList.add('on');
  if(name==='analysis') renderAnalysis(getTxs(), document.getElementById('month-sel').value);
  if(name==='budgets') { renderBudgets(getTxs()); showRecurring(); }
}

/* ---- export/import ---- */
function exportData() {
  const data = { transactions: getTxs(), recurring: getRecurring(), budgets: getBudgets() };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='finance_backup_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  toast('Dados exportados!');
}

function importData(e) {
  const file=e.target.files[0]; if(!file) return;
  file.text().then(text=>{
    try {
      const data=JSON.parse(text);
      if(data.transactions) { saveTxs(data.transactions); }
      if(data.recurring) { saveRecurring(data.recurring); }
      if(data.budgets) { saveBudgets(data.budgets); }
      refresh();
      populateMonthFilter();
      toast(`${getTxs().length} transações importadas!`);
    } catch { toast('Erro ao ler arquivo','error'); }
    e.target.value='';
  });
}

function exportCSV() {
  const txs = getTxs();
  let csv = 'tipo,categoria,descricao,valor,data\n';
  for (const t of txs) {
    csv += `${t.type},${t.category},"${t.description.replace(/"/g,'""')}",${t.amount},${t.date}\n`;
  }
  const blob = new Blob([csv], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'finance_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  toast('CSV exportado!');
}

function importCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(text => {
    try {
      const lines = text.trim().split('\n');
      if (lines.length < 2) return toast('CSV vazio','error');
      const header = lines[0].trim().toLowerCase();
      let count = 0;
      if (header.includes('data') && header.includes('valor') && header.includes('descrição')) {
        const txs = getTxs();
        let maxId = txs.length ? Math.max(...txs.map(t => t.id)) : 0;
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length < 4) continue;
          const dateRaw = parts[0].trim();
          let amountStr = parts[1].trim();
          if (amountStr.includes(',') && !amountStr.includes('.')) {
            amountStr = amountStr.replace(',', '.');
          }
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
            if (desc.includes('alimentação')||desc.includes('supermercado')||desc.includes('mercado')||desc.includes('restaurante')||desc.includes('pizzaria')||desc.includes('ifd*')) category='Food';
            else if (desc.includes('telefone')||desc.includes('telefonia')||desc.includes('transit')||desc.includes('transporte')||desc.includes('uber')) category='Transport';
            else if (desc.includes('aluguel')||desc.includes('moradia')||desc.includes('condomínio')) category='Housing';
            else if (desc.includes('saúde')||desc.includes('farmácia')||desc.includes('médico')||desc.includes('hospital')) category='Health';
            else if (desc.includes('lazer')||desc.includes('cinema')||desc.includes('netflix')||desc.includes('spotify')) category='Entertainment';
            else if (desc.includes('compra')||desc.includes('loja')||desc.includes('shopping')) category='Shopping';
            else if (desc.includes('educação')||desc.includes('curso')||desc.includes('livro')) category='Education';
            else category='Other';
          } else {
            if (desc.includes('salário')||desc.includes('recebida')) category='Salary';
            else if (desc.includes('investimento')||desc.includes('resgate')) category='Investments';
            else if (desc.includes('freelance')) category='Freelance';
            else category='Other';
          }
          txs.push({id:maxId,type,category,description,amount:Math.abs(amountNum),date});
          count++;
        }
        saveTxs(txs);
        refresh();
        populateMonthFilter();
        toast(`${count} transações importadas do extrato!`);
      } else if (header.includes('tipo') && header.includes('categoria')) {
        const txs = getTxs();
        let maxId = txs.length ? Math.max(...txs.map(t => t.id)) : 0;
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length < 5) continue;
          const [type,category,...rest]=parts;
          const date=parts[parts.length-1].trim();
          const amount=parts[parts.length-2].trim();
          const description=rest.slice(0,-1).join(',').trim();
          if(!type||!category||!description||!amount||!date) continue;
          maxId++;
          txs.push({id:maxId,type:type.trim(),category:category.trim(),description:description.replace(/^"|"$/g,'').replace(/""/g,'"'),amount:parseFloat(amount),date});
          count++;
        }
        saveTxs(txs);
        refresh();
        populateMonthFilter();
        toast(`${count} transações importadas!`);
      } else {
        toast('Formato não reconhecido','error');
      }
    } catch { toast('Erro ao ler CSV','error'); }
    e.target.value='';
  });
}

function clearAll() {
  confirmDel('Apagar todos os dados? Não tem volta.', () => {
    localStorage.removeItem('finance_txs');
    localStorage.removeItem('finance_recurring');
    localStorage.removeItem('finance_budgets');
    refresh();
    populateMonthFilter();
    toast('Dados apagados','info');
  });
}

/* ---- month filter change ---- */
document.getElementById('month-sel').addEventListener('change', () => { refresh(); });

load();
