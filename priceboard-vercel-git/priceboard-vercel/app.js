const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let rows = [];
let chatHistory = [];
let healthState = null;

const store = {
  accounts: 'giant.accounts.v1',
  positions: 'giant.positions.v1',
  access: 'giant.access.v1',
  chat: 'giant.chat.v1'
};

function loadJSON(key, fallback = []) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function escapeHtml(s = '') { return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function money(n) { return Number.isFinite(Number(n)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(n)) : '—'; }
function pct(p, d = 1) { return Number.isFinite(Number(p)) ? `${(Number(p) * 100).toFixed(d)}%` : '—'; }
function fmtOdds(o) { o = Number(o); return Number.isFinite(o) ? `${o > 0 ? '+' : ''}${Math.round(o)}` : '—'; }
function dateShort(x) { if (!x) return ''; const d = new Date(x); return Number.isNaN(d.valueOf()) ? '' : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function americanToDecimal(o) { o = Number(o); if (!Number.isFinite(o) || o === 0) return null; return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o); }
function americanToProb(o) { const d = americanToDecimal(o); return d ? 1 / d : null; }
function probToAmerican(p) { p = Number(p); if (p > 1) p /= 100; if (!(p > 0 && p < 1)) return null; return p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p; }
function lineText(line) { return line == null ? '' : `${Number(line) > 0 ? '+' : ''}${Number(line)}`; }
function predictionPrice(q) { return q?.implied == null ? '—' : `${(q.implied * 100).toFixed(1)}¢`; }
function accessHeaders() { const code = localStorage.getItem(store.access) || ''; return code ? { 'x-giant-code': code } : {}; }

function setTab(id) {
  $$('.navItem').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
  if (id === 'markets' && !rows.length) loadBoard();
  if (id === 'portfolio') renderPortfolio();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.navItem').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

function getAccounts() { return loadJSON(store.accounts, []); }
function getPositions() { return loadJSON(store.positions, []); }

function positionPnl(p) {
  if (p.mark == null || p.mark === '') return null;
  const mark = Number(p.mark);
  if (!Number.isFinite(mark)) return null;
  return Number(p.contracts || 0) * (mark - Number(p.entry || 0)) / 100 - Number(p.fees || 0);
}

function portfolioSnapshot() {
  const accounts = getAccounts();
  const positions = getPositions();
  const bankroll = accounts.reduce((sum, x) => sum + Number(x.balance || 0), 0);
  const open = positions.filter(p => p.status === 'open');
  const closed = positions.filter(p => p.status === 'closed');
  const exposure = open.reduce((sum, p) => sum + Number(p.contracts || 0) * Number(p.entry || 0) / 100, 0);
  const realized = closed.reduce((sum, p) => sum + (positionPnl(p) || 0), 0);
  const unrealized = open.reduce((sum, p) => sum + (positionPnl(p) || 0), 0);
  return { bankroll, exposure, realized, unrealized, accounts, positions, openCount: open.length };
}

function updatePortfolioMetrics() {
  const p = portfolioSnapshot();
  ['#heroBankroll', '#metricBankroll'].forEach(id => { const el = $(id); if (el) el.textContent = money(p.bankroll); });
  ['#heroExposure', '#metricExposure'].forEach(id => { const el = $(id); if (el) el.textContent = money(p.exposure); });
  ['#heroPnl', '#metricPnl'].forEach(id => {
    const el = $(id); if (!el) return;
    el.textContent = `${p.realized >= 0 ? '+' : ''}${money(p.realized)}`;
    el.classList.toggle('negative', p.realized < 0); el.classList.toggle('positive', p.realized > 0);
  });
  if ($('#metricOpen')) $('#metricOpen').textContent = String(p.openCount);
}

function renderPortfolio() {
  updatePortfolioMetrics();
  const accounts = getAccounts();
  $('#accountList').innerHTML = accounts.length ? accounts.map(a => `<div class="listRow"><div><strong>${escapeHtml(a.venue)}</strong><span>Manual balance</span></div><div class="rowActions"><b>${money(a.balance)}</b><button class="miniButton" data-account-del="${a.id}">×</button></div></div>`).join('') : '<div class="empty">No balances yet.</div>';
  $$('[data-account-del]').forEach(b => b.onclick = () => { saveJSON(store.accounts, accounts.filter(a => a.id !== b.dataset.accountDel)); renderPortfolio(); });

  const positions = getPositions().sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  $('#positionList').innerHTML = positions.length ? positions.map(p => {
    const pnl = positionPnl(p);
    return `<div class="positionRow"><div class="positionMain"><div class="positionTitle"><strong>${escapeHtml(p.description)}</strong><span class="pill">${escapeHtml(p.status)}</span></div><div class="positionMeta">${escapeHtml(p.venue)} · ${Number(p.contracts)} contracts · ${Number(p.entry).toFixed(1)}¢ entry${p.mark != null && p.mark !== '' && Number.isFinite(Number(p.mark)) ? ` · ${Number(p.mark).toFixed(1)}¢ ${p.status === 'closed' ? 'exit' : 'mark'}` : ''} · fees ${money(p.fees)}</div></div><div class="positionPnl ${pnl == null ? '' : pnl >= 0 ? 'positive' : 'negative'}">${pnl == null ? 'Open' : `${pnl >= 0 ? '+' : ''}${money(pnl)}`}</div><button class="miniButton" data-pos-edit="${p.id}">Edit</button><button class="miniButton" data-pos-del="${p.id}">×</button></div>`;
  }).join('') : '<div class="empty">No positions logged yet.</div>';
  $$('[data-pos-del]').forEach(b => b.onclick = () => { saveJSON(store.positions, positions.filter(p => p.id !== b.dataset.posDel)); renderPortfolio(); });
  $$('[data-pos-edit]').forEach(b => b.onclick = () => editPosition(b.dataset.posEdit));
}

$('#accountForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const venue = String(fd.get('venue') || '').trim();
  const balance = Number(fd.get('balance'));
  const accounts = getAccounts();
  const existing = accounts.find(a => a.venue.toLowerCase() === venue.toLowerCase());
  if (existing) existing.balance = balance; else accounts.push({ id: crypto.randomUUID(), venue, balance });
  saveJSON(store.accounts, accounts); e.currentTarget.reset(); renderPortfolio();
});

$('#positionForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const rawMark = String(fd.get('mark') || '').trim();
  const p = {
    id: crypto.randomUUID(), venue: String(fd.get('venue') || '').trim(), description: String(fd.get('description') || '').trim(),
    contracts: Number(fd.get('contracts')), entry: Number(fd.get('entry')), mark: rawMark === '' ? null : Number(rawMark),
    fees: Number(fd.get('fees') || 0), status: String(fd.get('status') || 'open'), createdAt: Date.now()
  };
  const list = getPositions(); list.push(p); saveJSON(store.positions, list);
  e.currentTarget.reset(); e.currentTarget.querySelector('[name=fees]').value = 0; renderPortfolio();
});

function editPosition(id) {
  const list = getPositions(); const p = list.find(x => x.id === id); if (!p) return;
  const mark = prompt('Current / exit price in cents (0–100). Leave blank to clear:', p.mark == null ? '' : p.mark); if (mark === null) return;
  const status = prompt('Status: open or closed', p.status); if (status === null) return;
  p.mark = mark.trim() === '' ? null : Math.max(0, Math.min(100, Number(mark)));
  p.status = status.toLowerCase().startsWith('c') ? 'closed' : 'open';
  saveJSON(store.positions, list); renderPortfolio();
}

function isMarket(row, filter) {
  if (filter === 'all') return true;
  const s = `${row.marketName} ${row.oddID}`.toLowerCase();
  if (filter === 'moneyline') return /moneyline|\-ml\-|\bml\b/.test(s);
  if (filter === 'spread') return /spread|\-sp\-|\bsp\b/.test(s);
  if (filter === 'total') return /total|over|under|\-ou\-/.test(s);
  return !/moneyline|\-ml\-|spread|\-sp\-|total|\-ou\-/.test(s);
}

function filteredRows() {
  const filter = $('#marketFilter').value;
  const venueFilter = $('#venueFilter').value;
  const q = $('#search').value.trim().toLowerCase();
  return rows.filter(r => isMarket(r, filter)).filter(r => venueFilter !== 'prediction' || r.bestPrediction).filter(r => !q || `${r.eventName} ${r.marketName} ${r.side} ${r.stat}`.toLowerCase().includes(q));
}

function renderMarketCard(r) {
  const gap = r.priceGap;
  const benchmark = r.benchmarkProbability ?? r.fairProbability;
  const gapClass = gap == null ? '' : gap > .025 ? 'good' : gap < -.025 ? 'bad' : '';
  return `<article class="marketCard">
    <div class="marketTopline"><div><div class="eventName">${escapeHtml(r.eventName)}</div><div class="marketMeta">${dateShort(r.startTime)}</div></div><span class="pill">${escapeHtml(r.marketName)}</span></div>
    <div class="marketSide">${escapeHtml(r.side || r.stat || r.marketName)} ${r.line != null ? `<span>${lineText(r.line)}</span>` : ''}</div>
    <div class="priceGrid">
      <div class="priceBox primaryPrice"><span>Best prediction price</span><strong>${r.bestPrediction ? predictionPrice(r.bestPrediction) : 'None'}</strong><small>${r.bestPrediction ? `${escapeHtml(r.bestPrediction.label)} · ${fmtOdds(r.bestPrediction.odds)}` : 'Reference only'}</small></div>
      <div class="priceBox"><span>Market benchmark</span><strong>${benchmark == null ? '—' : pct(benchmark)}</strong><small>${r.benchmarkSource ? escapeHtml(r.benchmarkSource) : 'No clean benchmark'}</small></div>
      <div class="priceBox ${gapClass}"><span>Price gap</span><strong>${gap == null ? '—' : `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)} pts`}</strong><small>${gap == null ? 'Not comparable' : gap > 0 ? 'Prediction price is cheaper' : 'Prediction price is richer'}</small></div>
    </div>
    <div class="quoteStrip">${r.quotes.slice(0, 10).map(q => `<span class="quote ${/prediction|exchange/i.test(q.kind) ? 'prediction' : ''}">${escapeHtml(q.label)} <b>${/prediction|exchange/i.test(q.kind) ? predictionPrice(q) : fmtOdds(q.odds)}</b>${q.line != null ? ` @ ${lineText(q.line)}` : ''}</span>`).join('')}</div>
  </article>`;
}

function renderBoard() {
  const rs = filteredRows();
  $('#rowCount').textContent = String(rs.length);
  $('#predictionCount').textContent = String(rs.filter(r => r.bestPrediction).length);
  const gaps = rs.map(r => r.priceGap).filter(Number.isFinite);
  const maxGap = gaps.length ? Math.max(...gaps) : null;
  $('#largestGap').textContent = maxGap == null ? '—' : `${maxGap >= 0 ? '+' : ''}${(maxGap * 100).toFixed(1)} pts`;
  $('#boardRows').innerHTML = rs.length ? rs.slice(0, 120).map(renderMarketCard).join('') : '<div class="empty large">No markets match those filters.</div>';
}

async function loadBoard() {
  const btn = $('#refresh'); btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const r = await fetch('/api/board?league=NFL&limit=30', { headers: accessHeaders() });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Failed to load markets');
    rows = data.rows || [];
    $('#feedStatus').textContent = data.demo ? 'Demo market feed' : 'SportsGameOdds live';
    document.querySelector('.statusDot')?.classList.toggle('live', !data.demo);
    $('#demoNotice').classList.toggle('hidden', !data.demo);
    if (data.demo) $('#demoNotice').innerHTML = 'Giant is using sample prices because the SportsGameOdds key is not available to this deployment.';
    renderBoard();
  } catch (e) {
    $('#feedStatus').textContent = e.message === 'Unauthorized' ? 'Access code required' : 'Market feed error';
    $('#boardRows').innerHTML = `<div class="notice">${escapeHtml(e.message)}</div>`;
  } finally { btn.disabled = false; btn.textContent = 'Refresh'; }
}

$('#marketFilter').addEventListener('change', renderBoard);
$('#venueFilter').addEventListener('change', renderBoard);
$('#search').addEventListener('input', renderBoard);
$('#refresh').addEventListener('click', loadBoard);

function renderMessage(role, text, meta = '') {
  const wrap = $('#conversation');
  const el = document.createElement('article');
  el.className = `message ${role}`;
  const safe = escapeHtml(text).replace(/\n/g, '<br>');
  el.innerHTML = `<div class="messageLabel">${role === 'user' ? 'YOU' : 'GIANT'}</div><div class="messageBody">${safe}</div>${meta ? `<div class="messageMeta">${escapeHtml(meta)}</div>` : ''}`;
  wrap.appendChild(el); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return el;
}

function saveChat() { saveJSON(store.chat, chatHistory.slice(-12)); }
function restoreChat() {
  chatHistory = loadJSON(store.chat, []);
  if (!chatHistory.length) return;
  chatHistory.forEach(m => renderMessage(m.role, m.content, m.meta || ''));
}

async function askGiant(message) {
  renderMessage('user', message);
  chatHistory.push({ role: 'user', content: message });
  const thinking = renderMessage('assistant', 'Checking the market…');
  try {
    const payload = { message, history: chatHistory.slice(-8), portfolio: portfolioSnapshot() };
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', ...accessHeaders() }, body: JSON.stringify(payload) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Giant could not answer');
    thinking.remove();
    renderMessage('assistant', data.answer, data.mode === 'llm' ? `GPT · ${data.marketCount || 0} relevant markets checked` : `Rules engine · ${data.marketCount || 0} relevant markets checked`);
    chatHistory.push({ role: 'assistant', content: data.answer, meta: data.mode }); saveChat();
  } catch (e) {
    thinking.remove(); renderMessage('assistant', e.message === 'Unauthorized' ? 'This deployment is protected. Open Settings and enter your Giant access code.' : `I hit an error: ${e.message}`);
  }
}

$('#askForm').addEventListener('submit', e => {
  e.preventDefault(); const input = $('#askInput'); const text = input.value.trim(); if (!text) return;
  input.value = ''; input.style.height = 'auto'; askGiant(text);
});
$('#askInput').addEventListener('input', e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(180, e.currentTarget.scrollHeight)}px`; });
$('#askInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askForm').requestSubmit(); } });
$$('[data-prompt]').forEach(b => b.onclick = () => { $('#askInput').value = b.dataset.prompt; $('#askForm').requestSubmit(); });

function updateLabs() {
  const o = Number($('#oddsInput').value), op = americanToProb(o), od = americanToDecimal(o);
  $('#oddsResult').innerHTML = `${pct(op, 2)} implied · ${od ? od.toFixed(3) : '—'}x total payout`;
  const p = Number($('#probInput').value) / 100, pa = probToAmerican(p);
  $('#probResult').innerHTML = `${fmtOdds(pa)} fair · ${p > 0 ? (1 / p).toFixed(2) : '—'}x total payout`;
  const a = americanToProb(Number($('#vigA').value)), b = americanToProb(Number($('#vigB').value));
  if (a && b) { const sum = a + b; $('#vigResult').innerHTML = `Hold: ${((sum - 1) * 100).toFixed(2)} pts<br>De-vig: ${pct(a / sum, 2)} / ${pct(b / sum, 2)}`; }
  const price = Number($('#contractPrice').value) / 100, spend = Number($('#contractSpend').value);
  if (price > 0 && price < 1 && spend > 0) { const contracts = spend / price, profit = contracts * (1 - price); $('#contractResult').innerHTML = `${contracts.toFixed(1)} contracts · ${money(contracts)} payout<br>${money(profit)} profit if YES settles at $1`; }
}
['oddsInput', 'probInput', 'vigA', 'vigB', 'contractPrice', 'contractSpend'].forEach(id => $('#' + id).addEventListener('input', updateLabs));

async function loadHealth() {
  try {
    const r = await fetch('/api/health', { headers: accessHeaders() }); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Health check failed');
    healthState = data;
    $('#llmStatus').textContent = data.llmConfigured ? `LLM ready · ${data.llmModel}` : 'LLM key not configured — Giant will use its built-in market rules engine.';
  } catch { $('#llmStatus').textContent = 'Could not read deployment status.'; }
}

const dialog = $('#settingsDialog');
function openSettings() { $('#accessCode').value = localStorage.getItem(store.access) || ''; dialog.showModal(); loadHealth(); }
$('#settingsButton').onclick = openSettings; $('#mobileSettings').onclick = openSettings;
$('#saveSettings').addEventListener('click', e => { e.preventDefault(); localStorage.setItem(store.access, $('#accessCode').value.trim()); dialog.close(); loadBoard(); loadHealth(); });

updatePortfolioMetrics(); renderPortfolio(); restoreChat(); updateLabs(); loadHealth(); loadBoard();
