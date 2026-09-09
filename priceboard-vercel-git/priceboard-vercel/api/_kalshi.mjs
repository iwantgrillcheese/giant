const BASE = 'https://external-api.kalshi.com/trade-api/v2';

const NFL_SERIES = [
  ['KXNFLGAME', 'Moneyline'],
  ['KXNFLSPREAD', 'Spread'],
  ['KXNFLTOTAL', 'Total']
];

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!r.ok) throw new Error(data?.message || data?.error || `Kalshi returned ${r.status}`);
  return data;
}

function bestBuyPrice(market) {
  return num(market?.yes_ask_dollars) ?? num(market?.last_price_dollars) ?? num(market?.yes_bid_dollars);
}

function marketTime(market) {
  return market?.occurrence_datetime || market?.expected_expiration_time || market?.close_time || market?.open_time || null;
}

function withinUpcomingWindow(market) {
  const t = Date.parse(marketTime(market) || '');
  if (!Number.isFinite(t)) return true;
  const now = Date.now();
  return t >= now - 6 * 60 * 60 * 1000 && t <= now + 14 * 24 * 60 * 60 * 1000;
}

function displayLine(market, marketName) {
  if (marketName === 'Moneyline') return null;
  const explicit = num(market?.floor_strike) ?? num(market?.cap_strike);
  if (explicit != null) return explicit;
  const text = `${market?.yes_sub_title || ''} ${market?.title || ''}`;
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*(?:points?|pts?)?/i);
  return m ? Number(m[1]) : null;
}

function marketToRow(market, marketName) {
  const price = bestBuyPrice(market);
  if (!(price > 0 && price < 1)) return null;

  const yesBid = num(market?.yes_bid_dollars);
  const yesAsk = num(market?.yes_ask_dollars);
  const side = market?.yes_sub_title || market?.subtitle || market?.title || 'YES';
  const eventName = market?.title || market?.subtitle || market?.event_ticker || 'Kalshi NFL market';
  const startTime = marketTime(market);
  const line = displayLine(market, marketName);
  const odds = probToAmerican(price);
  const quote = {
    key: 'kalshi-direct',
    label: 'Kalshi',
    kind: 'Prediction market',
    odds,
    decimal: 1 / price,
    implied: price,
    line,
    deeplink: market?.ticker ? `https://kalshi.com/markets/${market.ticker}` : null,
    updatedAt: market?.updated_time || null,
    bid: yesBid,
    ask: yesAsk,
    volume: num(market?.volume_24h_fp) ?? num(market?.volume_fp),
    liquidity: num(market?.liquidity_dollars)
  };

  return {
    eventId: `kalshi:${market?.event_ticker || market?.ticker}`,
    eventName,
    startTime,
    league: 'NFL',
    oddID: `kalshi:${market?.ticker || eventName}`,
    marketName,
    side,
    stat: '',
    period: 'game',
    fairOdds: null,
    fairProbability: null,
    fairLine: null,
    benchmarkProbability: null,
    benchmarkSource: null,
    benchmarkLine: null,
    lineComparable: false,
    line,
    best: quote,
    bestPrediction: quote,
    bestSportsbook: null,
    priceGap: null,
    quotes: [quote],
    source: 'kalshi-direct'
  };
}

async function fetchSeriesMarkets(seriesTicker, marketName) {
  const rows = [];
  let cursor = '';

  for (let page = 0; page < 3; page++) {
    const u = new URL(`${BASE}/markets`);
    u.searchParams.set('series_ticker', seriesTicker);
    u.searchParams.set('status', 'open');
    u.searchParams.set('mve_filter', 'exclude');
    u.searchParams.set('limit', '1000');
    if (cursor) u.searchParams.set('cursor', cursor);

    const data = await getJSON(u);
    const markets = Array.isArray(data?.markets) ? data.markets : [];
    for (const market of markets) {
      if (!withinUpcomingWindow(market)) continue;
      const row = marketToRow(market, marketName);
      if (row) rows.push(row);
    }

    cursor = data?.cursor || '';
    if (!cursor || markets.length === 0) break;
  }

  return rows;
}

export async function fetchKalshiNFLRows() {
  const results = await Promise.allSettled(
    NFL_SERIES.map(([seriesTicker, marketName]) => fetchSeriesMarkets(seriesTicker, marketName))
  );

  const rows = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const deduped = [...new Map(rows.map(r => [r.oddID, r])).values()];

  if (!deduped.length) {
    const errors = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason?.message || 'Kalshi series request failed');
    throw new Error(errors.join(' | ') || 'Kalshi returned no open NFL game markets');
  }

  return {
    rows: deduped,
    eventCount: new Set(deduped.map(r => r.eventId)).size,
    seriesCount: results.filter(r => r.status === 'fulfilled').length
  };
}
