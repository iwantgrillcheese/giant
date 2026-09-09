const BASE = 'https://external-api.kalshi.com/trade-api/v2';

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

function marketToRow(event, market, milestone) {
  const yesAsk = num(market?.yes_ask_dollars);
  const last = num(market?.last_price_dollars);
  const yesBid = num(market?.yes_bid_dollars);
  const price = yesAsk ?? last ?? yesBid;
  if (!(price > 0 && price < 1)) return null;

  const side = market?.yes_sub_title || market?.subtitle || market?.title || event?.title || 'YES';
  const eventName = event?.title || milestone?.title || market?.title || market?.event_ticker || 'Kalshi market';
  const marketName = market?.title || market?.subtitle || 'Prediction market';
  const startTime = milestone?.start_date || market?.occurrence_datetime || event?.strike_date || market?.open_time || null;
  const odds = probToAmerican(price);
  const quote = {
    key: 'kalshi-direct',
    label: 'Kalshi',
    kind: 'Prediction market',
    odds,
    decimal: price ? 1 / price : null,
    implied: price,
    line: null,
    deeplink: market?.ticker ? `https://kalshi.com/markets/${market.ticker}` : null,
    updatedAt: market?.updated_time || null,
    bid: yesBid,
    ask: yesAsk,
    volume: num(market?.volume_24h_fp) ?? num(market?.volume_fp)
  };

  return {
    eventId: `kalshi:${event?.event_ticker || market?.event_ticker || market?.ticker}`,
    eventName,
    startTime,
    league: 'NFL',
    oddID: `kalshi:${market?.ticker || marketName}`,
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
    line: null,
    best: quote,
    bestPrediction: quote,
    bestSportsbook: null,
    priceGap: null,
    quotes: [quote],
    source: 'kalshi-direct'
  };
}

export async function fetchKalshiNFLRows() {
  const now = Date.now();
  const max = now + 14 * 24 * 60 * 60 * 1000;
  const milestonesURL = new URL(`${BASE}/milestones`);
  milestonesURL.searchParams.set('limit', '100');
  milestonesURL.searchParams.set('minimum_start_date', new Date(now - 6 * 60 * 60 * 1000).toISOString());
  milestonesURL.searchParams.set('category', 'Sports');
  milestonesURL.searchParams.set('competition', 'Pro Football');
  milestonesURL.searchParams.set('type', 'football_game');

  const milestoneData = await getJSON(milestonesURL);
  const milestones = (milestoneData?.milestones || []).filter(m => {
    const t = Date.parse(m?.start_date || '');
    return !Number.isFinite(t) || t <= max;
  });

  const tickerMap = new Map();
  for (const milestone of milestones) {
    const tickers = [
      ...(Array.isArray(milestone?.primary_event_tickers) ? milestone.primary_event_tickers : []),
      ...(Array.isArray(milestone?.related_event_tickers) ? milestone.related_event_tickers : [])
    ];
    for (const ticker of tickers) if (ticker && !tickerMap.has(ticker)) tickerMap.set(ticker, milestone);
  }

  const entries = [...tickerMap.entries()].slice(0, 40);
  const responses = await Promise.allSettled(entries.map(async ([ticker, milestone]) => {
    const u = new URL(`${BASE}/events/${encodeURIComponent(ticker)}`);
    u.searchParams.set('with_nested_markets', 'true');
    const data = await getJSON(u);
    const event = data?.event || {};
    const markets = Array.isArray(event?.markets) ? event.markets : (Array.isArray(data?.markets) ? data.markets : []);
    return markets.map(m => marketToRow(event, m, milestone)).filter(Boolean);
  }));

  const rows = responses.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  return {
    rows,
    milestoneCount: milestones.length,
    eventCount: entries.length
  };
}
