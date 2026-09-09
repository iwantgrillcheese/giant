const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let rows = [];
let chatHistory = [];
let healthState = null;

const store = {
  accounts: 'giant.accounts.v1',
  positions: 'giant.positions.v2',
  legacyPositions: 'giant.positions.v1',
  access: 'giant.access.v1',
  chat: 'giant.chat.v2'
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

function migrateLegacyPosition(p) {
  const contracts = Number(p.contracts || 0);
  const entry = Number(p.entry || 0);
  const stake = contracts * entry / 100;
  const toWin = contracts * Math.max(0, 100 - entry) / 100;
  let result = 'open';
  if (p.status === 'closed' && Number(p.mark) >= 99) result = 'won';
  else if (p.status === 'closed' && Number(p.mark) <= 1) result = 'lost';
  return {
    id: p.id || crypto.randomUUID(),
    venue: p.venue || '',
    description: p.description || 'Old position',
    stake: Number(stake.toFixed(2)),
    toWin: Number(toWin.toFixed(2)),
    result,
    createdAt: p.createdAt || Date.now()
  };
}

function getPositions() {
  if (localStorage.getItem(store.positions) == null) {
    const legacy = loadJSON(store.legacyPositions, []);
    if (legacy.length) saveJSON(store.positions, legacy.map(migrateLegacyPosition));
  }
  return loadJSON(store.positions, []);
}

function positionPnl(p) {
  if (p.result === 'won') return Number(p.toWin || 0);
  if (p.result === 'lost') return -Number(p.stake || 0);
  if (p.result === 'void') return 0;
  return null;
}

function portfolioSnapshot() {
  const accounts = getAccounts();
  const positions = getPositions();
  const bankroll = accounts.reduce((sum, x) => sum + Number(x.balance || 0), 0);
  const open = positions.filter(p => p.result === 'open');
  const settled = positions.filter(p => p.result !== 'open');
  const exposure = open.reduce((sum, p) => sum + Number(p.stake || 0), 0);
  const realized = settled.reduce((sum, p) => sum + (positionPnl(p) || 0), 0);
  return { bankroll, exposure, realized, accounts, positions, openCount: open.length };
}

function updatePortfolioMetrics() {
  const p = portfolioSnapshot();
  ['#heroBankroll', '#metricBankroll'].forEach(id => { const el = $(id); if (el) el.textContent = money(p.bankroll); });
  ['#heroExposure', '#metricExposure'].forEach(id => { const el = $(id); if (el) el.textContent = money(p.exposure); });
  ['#heroPnl', '#metricPnl'].forEach(id => {
    const el = $(id); if (!el) return;
    el.textContent = `${p.realized >= 0 ? '+' : ''}${money(p.realized)}`;
    el.classList.toggle('negative', p.realized < 0);
    el.classList.toggle('positive', p.realized > 0);
  });
  if ($('#metricOpen')) $('#metricOpen').textContent = String(p.openCount);
}

function normalizeBetText(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/\btd\b/g, ' touchdown ')
    .replace(/\bml\b/g, ' moneyline ')
    .replace(/[^a-z0-9.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const genericBetTokens = new Set(['anytime','touchdown','moneyline','spread','over','under','total','game','first','half','quarter','yes','no','bet','to','win','the','a','an','and','or']);

function findBetMarket(p) {
  if (!rows.length) return null;
  const desc = normalizeBetText(p.description);
  const tokens = desc.split(' ').filter(t => t.length > 2 && !['the','and','for','with'].includes(t));
  let best = null;

  for (const r of rows) {
    if (!Number.isFinite(r.benchmarkProbability)) continue;
    const hay = normalizeBetText(`${r.eventName} ${r.marketName} ${r.side} ${r.stat} ${r.oddID}`);
    let score = 0;
    let identityHits = 0;
    for (const t of tokens) {
      if (!hay.includes(t)) continue;
      score += 2;
      if (!genericBetTokens.has(t)) identityHits += 1;
    }
    if (desc.includes('touchdown') && hay.includes('touchdown')) score += 3;
    if (desc.includes('moneyline') && hay.includes('moneyline')) score += 3;
    if (desc.includes('spread') && hay.includes('spread')) score += 3;
    if (desc.includes('over') && hay.includes('over')) score += 2;
    if (desc.includes('under') && hay.includes('under')) score += 2;

    const sideText = normalizeBetText(r.side || '');
    for (const t of tokens) if (!genericBetTokens.has(t) && sideText.includes(t)) score += 4;

    if (identityHits < 1 || score < 3) continue;
    if (!best || score > best.score) best = { row: r, score };
  }
  return best?.row || null;
}

function getBetRating(p) {
  const stake = Number(p.stake || 0), toWin = Number(p.toWin || 0);
  if (!(stake > 0) || !(toWin > 0)) return { label: 'No read', className: 'evUnknown', detail: '' };
  const breakEven = stake / (stake + toWin);
  const row = findBetMarket(p);
  if (!row) return { label: 'No read', className: 'evUnknown', detail: `Your price needs ${pct(breakEven)} to hit. I couldn't match this cleanly to the live board.` };

  const ref = Number(row.benchmarkProbability);
  const edge = ref - breakEven;
  let label = 'About fair', className = 'evNeutral';
  if (edge >= .02) { label = 'Looks +EV'; className = 'evGood'; }
  else if (edge <= -.02) { label = 'Looks -EV'; className = 'evBad'; }
  const direction = Math.abs(edge) < .005 ? 'basically in line' : `${Math.abs(edge * 100).toFixed(1)} pts ${edge > 0 ? 'better than' : 'worse than'} the reference`;
  return {
    label,
    className,
    detail: `Needs ${pct(breakEven)} · market ref ~${pct(ref)} · ${direction}. Rough check, not gospel.`,
    row
  };
}

function renderPortfolio() {
  updatePortfolioMetrics();
  const accounts = getAccounts();
  $('#accountList').innerHTML = accounts.length
    ? accounts.map(a => `<div class="listRow"><div><strong>${escapeHtml(a.venue)}</strong><span>Saved manually</span></div><div class="rowActions"><b>${money(a.balance)}</b><button class="miniButton" data-account-del="${a.id}">×</button></div></div>`).join('')
    : '<div class="empty">No balances yet.</div>';
  $$('[data-account-del]').forEach(b => b.onclick = () => { saveJSON(store.accounts, accounts.filter(a => a.id !== b.dataset.accountDel)); renderPortfolio(); });

  const positions = getPositions().sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  $('#positionList').innerHTML = positions.length ? positions.map(p => {
    const pnl = positionPnl(p);
    const rating = getBetRating(p);
    const resultLabel = p.result === 'open' ? 'Open' : p.result === 'won' ? 'Won' : p.result === 'lost' ? 'Lost' : 'Void';
    const actions = p.result === 'open'
      ? `<div class="settleActions"><button class="settleButton win" data-settle="won" data-id="${p.id}">Won</button><button class="settleButton loss" data-settle="lost" data-id="${p.id}">Lost</button><button class="settleButton" data-settle="void" data-id="${p.id}">Void</button></div>`
      : `<button class="miniButton" data-settle="open" data-id="${p.id}">Undo</button>`;
    return `<div class="positionRow simplePositionRow">
      <div class="positionMain">
        <div class="positionTitle"><strong>${escapeHtml(p.description)}</strong><span class="pill">${resultLabel}</span><span class="evBadge ${rating.className}">${rating.label}</span></div>
        <div class="positionMeta">${escapeHtml(p.venue)} · ${money(p.stake)} to win ${money(p.toWin)}</div>
        <div class="betCheck">${escapeHtml(rating.detail)}</div>
      </div>
      <div class="positionPnl ${pnl == null ? '' : pnl >= 0 ? 'positive' : 'negative'}">${pnl == null ? `${money(p.stake)} in play` : `${pnl >= 0 ? '+' : ''}${money(pnl)}`}</div>
      ${actions}
      <button class="miniButton deleteBet" data-pos-del="${p.id}">×</button>
    </div>`;
  }).join('') : '<div class="empty">No bets yet. Add one above — “Olave anytime TD, $5 to win $20” is enough.</div>';

  $$('[data-pos-del]').forEach(b => b.onclick = () => { saveJSON(store.positions, positions.filter(p => p.id !== b.dataset.posDel)); renderPortfolio(); });
  $$('[data-settle]').forEach(b => b.onclick = () => settlePosition(b.dataset.id, b.dataset.settle));
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
  const p = {
    id: crypto.randomUUID(),
    venue: String(fd.get('venue') || '').trim(),
    description: String(fd.get('description') || '').trim(),
    stake: Number(fd.get('stake')),
    toWin: Number(fd.get('toWin')),
    result: String(fd.get('result') || 'open'),
    createdAt: Date.now()
  };
  const list = getPositions(); list.push(p); saveJSON(store.positions, list);
  e.currentTarget.reset(); renderPortfolio();
});

function settlePosition(id, result) {
  const list = getPositions();
  const p = list.find(x => x.id === id); if (!p) return;
  p.result = ['won', 'lost', 'void', 'open'].includes(result) ? result : 'open';
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
  return rows
    .filter(r => isMarket(r, filter))
    .filter(r => venueFilter !== 'prediction' || r.bestPrediction)
    .filter(r => !q || `${r.eventName} ${r.marketName} ${r.side} ${r.stat}`.toLowerCase().includes(q));
}

function renderMarketCard(r) {
  const gap = r.priceGap;
  const benchmark = r.benchmarkProbability ?? r.fairProbability;
  const gapClass = gap == null ? '' : gap > .025 ? 'good' : gap < -.025 ? 'bad' : '';
  return `<article class="marketCard">
    <div class="marketTopline"><div><div class="eventName">${escapeHtml(r.eventName)}</div><div class="marketMeta">${dateShort(r.startTime)}</div></div><span class="pill">${escapeHtml(r.marketName)}</span></div>
    <div class="marketSide">${escapeHtml(r.side || r.stat || r.marketName)} ${r.line != null ? `<span>${lineText(r.line)}</span>` : ''}</div>
    <div class="priceGrid">
      <div class="priceBox primaryPrice"><span>Best trade price</span><strong>${r.bestPrediction ? predictionPrice(r.bestPrediction) : '—'}</strong><small>${r.bestPrediction ? `${escapeHtml(r.bestPrediction.label)} · ${fmtOdds(r.bestPrediction.odds)}` : 'No prediction quote in this feed'}</small></div>
      <div class="priceBox"><span>Book-ish reference</span><strong>${benchmark == null ? '—' : pct(benchmark)}</strong><small>${r.benchmarkSource ? escapeHtml(r.benchmarkSource) : 'No clean reference'}</small></div>
      <div class="priceBox ${gapClass}"><span>Gap</span><strong>${gap == null ? '—' : `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)} pts`}</strong><small>${gap == null ? 'Not apples-to-apples' : gap > 0 ? 'Trade price is cheaper' : 'Trade price is richer'}</small></div>
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
  $('#boardRows').innerHTML = rs.length ? rs.slice(0, 120).map(renderMarketCard).join('') : '<div class="empty large">Nothing matches that right now.</div>';
}

async function loadBoard() {
  const btn = $('#refresh'); btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const r = await fetch('/api/board?league=NFL&limit=40', { headers: accessHeaders() });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Could not load prices');
    rows = data.rows || [];
    $('#feedStatus').textContent = data.demo ? 'Demo prices' : 'Live prices';
    document.querySelector('.statusDot')?.classList.toggle('live', !data.demo);
    $('#demoNotice').classList.toggle('hidden', !data.demo);
    if (data.demo) $('#demoNotice').innerHTML = 'This deployment is using sample prices right now.';
    renderBoard();
    renderPortfolio();
  } catch (e) {
    $('#feedStatus').textContent = e.message === 'Unauthorized' ? 'Access code needed' : 'Price feed issue';
    $('#boardRows').innerHTML = `<div class="notice">${escapeHtml(e.message)}</div>`;
  } finally { btn.disabled = false; btn.textContent = 'Refresh'; }
}

$('#marketFilter').addEventListener('change', renderBoard);
$('#venueFilter').addEventListener('change', renderBoard);
$('#search').addEventListener('input', renderBoard);
$('#refresh').addEventListener('click', loadBoard);

function friendlyMeta(meta = '') {
  if (meta === 'llm') return 'AI + live price scan';
  if (meta === 'rules') return 'Live price check';
  return meta;
}

function renderMessage(role, text, meta = '') {
  const wrap = $('#conversation');
  const el = document.createElement('article');
  el.className = `message ${role}`;
  const safe = escapeHtml(text).replace(/\n/g, '<br>');
  const shownMeta = friendlyMeta(meta);
  el.innerHTML = `<div class="messageLabel">${role === 'user' ? 'YOU' : 'GIANT'}</div><div class="messageBody">${safe}</div>${shownMeta ? `<div class="messageMeta">${escapeHtml(shownMeta)}</div>` : ''}`;
  wrap.appendChild(el); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return el;
}

function saveChat() { saveJSON(store.chat, chatHistory.slice(-14)); }
function restoreChat() {
  chatHistory = loadJSON(store.chat, []);
  if (!chatHistory.length) {
    renderMessage('assistant', "Yo. Tell me what you're thinking about betting and I'll shop the price.");
    return;
  }
  chatHistory.forEach(m => renderMessage(m.role, m.content, m.meta || ''));
}

async function askGiant(message) {
  renderMessage('user', message);
  chatHistory.push({ role: 'user', content: message });
  const thinking = renderMessage('assistant', 'Lemme check…');
  try {
    const payload = { message, history: chatHistory.slice(-8), portfolio: portfolioSnapshot() };
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', ...accessHeaders() }, body: JSON.stringify(payload) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Giant could not answer');
    thinking.remove();
    renderMessage('assistant', data.answer, data.mode);
    chatHistory.push({ role: 'assistant', content: data.answer, meta: data.mode }); saveChat();
  } catch (e) {
    thinking.remove();
    renderMessage('assistant', e.message === 'Unauthorized' ? 'This one is locked down. Open Settings and put in your Giant access code.' : `Something broke on that one: ${e.message}`);
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
  $('#oddsResult').innerHTML = `${pct(op, 2)} chance · ${od ? od.toFixed(3) : '—'}x total payout`;
  const p = Number($('#probInput').value) / 100, pa = probToAmerican(p);
  $('#probResult').innerHTML = `${fmtOdds(pa)} fair odds · ${p > 0 ? (1 / p).toFixed(2) : '—'}x payout`;
  const a = americanToProb(Number($('#vigA').value)), b = americanToProb(Number($('#vigB').value));
  if (a && b) { const sum = a + b; $('#vigResult').innerHTML = `Book tax: ${((sum - 1) * 100).toFixed(2)} pts<br>Fair-ish split: ${pct(a / sum, 2)} / ${pct(b / sum, 2)}`; }
  const price = Number($('#contractPrice').value) / 100, spend = Number($('#contractSpend').value);
  if (price > 0 && price < 1 && spend > 0) { const contracts = spend / price, profit = contracts * (1 - price); $('#contractResult').innerHTML = `${contracts.toFixed(1)} contracts · ${money(profit)} profit if it hits`; }
}
['oddsInput', 'probInput', 'vigA', 'vigB', 'contractPrice', 'contractSpend'].forEach(id => $('#' + id).addEventListener('input', updateLabs));

async function loadHealth() {
  try {
    const r = await fetch('/api/health', { headers: accessHeaders() }); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Health check failed');
    healthState = data;
    $('#llmStatus').textContent = data.llmConfigured ? `AI chat is on · ${data.llmModel}` : "AI chat isn't connected yet. Giant will still do basic live price checks.";
  } catch { $('#llmStatus').textContent = 'Could not check chat status.'; }
}

const dialog = $('#settingsDialog');
function openSettings() { $('#accessCode').value = localStorage.getItem(store.access) || ''; dialog.showModal(); loadHealth(); }
$('#settingsButton').onclick = openSettings; $('#mobileSettings').onclick = openSettings;
$('#saveSettings').addEventListener('click', e => { e.preventDefault(); localStorage.setItem(store.access, $('#accessCode').value.trim()); dialog.close(); loadBoard(); loadHealth(); });

updatePortfolioMetrics();
renderPortfolio();
restoreChat();
updateLabs();
loadHealth();
loadBoard();
