function americanToDecimal(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

function americanToProb(odds) {
  const d = americanToDecimal(odds);
  return d ? 1 / d : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function normalizeBookKey(key = '') {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const bookMeta = {
  fanduel: { label: 'FanDuel', kind: 'Sportsbook' },
  draftkings: { label: 'DraftKings', kind: 'Sportsbook' },
  betmgm: { label: 'BetMGM', kind: 'Sportsbook' },
  caesars: { label: 'Caesars', kind: 'Sportsbook' },
  williamhillus: { label: 'Caesars', kind: 'Sportsbook' },
  fanatics: { label: 'Fanatics', kind: 'Sportsbook' },
  bet365: { label: 'bet365', kind: 'Sportsbook' },
  betrivers: { label: 'BetRivers', kind: 'Sportsbook' },
  hardrockbet: { label: 'Hard Rock Bet', kind: 'Sportsbook' },
  pinnacle: { label: 'Pinnacle', kind: 'Sharp book' },
  circa: { label: 'Circa', kind: 'Sharp book' },
  kalshi: { label: 'Kalshi', kind: 'Prediction market' },
  polymarket: { label: 'Polymarket', kind: 'Prediction market' },
  polymarketus: { label: 'Polymarket US', kind: 'Prediction market' },
  novig: { label: 'Novig', kind: 'Prediction market' },
  prophetx: { label: 'ProphetX', kind: 'Exchange' }
};

function prettyBook(key) {
  const norm = normalizeBookKey(key);
  return bookMeta[norm] || {
    label: String(key).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    kind: 'Other'
  };
}

function getQuoteOdds(q) {
  if (q == null) return null;
  if (typeof q === 'string' || typeof q === 'number') return finiteNumber(q);
  const candidates = [q.odds, q.price, q.americanOdds, q.bookOdds];
  for (const c of candidates) {
    const n = finiteNumber(c);
    if (n !== null && n !== 0) return n;
  }
  return null;
}

function getLine(q, market) {
  if (!q || typeof q !== 'object') return null;
  const candidates = [q.spread, q.overUnder, q.line, market?.fairSpread, market?.fairOverUnder];
  for (const c of candidates) {
    const n = finiteNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function isPredictionQuote(q) {
  return /prediction market|exchange/i.test(q?.kind || '');
}

function isSportsbookQuote(q) {
  return /sportsbook|sharp book/i.test(q?.kind || '');
}

function sameLine(a, b) {
  if (a == null || b == null) return true;
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

function displaySide(market, home, away) {
  const raw = String(market?.sideID || '').toLowerCase();
  if (raw === 'home') return home;
  if (raw === 'away') return away;
  if (raw === 'over') return 'Over';
  if (raw === 'under') return 'Under';
  if (raw && !['all', 'both', 'either'].includes(raw)) return market.sideID;

  const entity = market?.statEntity?.name
    || market?.statEntityName
    || market?.playerName
    || market?.participantName
    || market?.selectionName
    || market?.statEntityID;
  if (entity) return entity;
  return market?.sideID || '';
}

function normalizeEvents(payload) {
  const events = Array.isArray(payload?.data) ? payload.data : [];
  const rows = [];

  for (const event of events) {
    const home = event?.teams?.home?.name || event?.teams?.home?.names?.long || event?.homeTeam || 'Home';
    const away = event?.teams?.away?.name || event?.teams?.away?.names?.long || event?.awayTeam || 'Away';
    const eventName = `${away} @ ${home}`;
    const eventId = event?.eventID || event?.id || eventName;
    const startTime = event?.startTime || event?.startDate || event?.status?.startsAt || null;
    const markets = event?.odds && typeof event.odds === 'object' ? event.odds : {};
    let eventRowCount = 0;

    for (const [oddID, market] of Object.entries(markets)) {
      const byBookmaker = market?.byBookmaker && typeof market.byBookmaker === 'object' ? market.byBookmaker : {};
      const quotes = [];

      for (const [bookKey, q] of Object.entries(byBookmaker)) {
        if (q?.available === false) continue;
        const odds = getQuoteOdds(q);
        if (!Number.isFinite(odds) || odds === 0) continue;
        const decimal = americanToDecimal(odds);
        const implied = americanToProb(odds);
        const meta = prettyBook(bookKey);
        quotes.push({
          key: bookKey,
          label: meta.label,
          kind: meta.kind,
          odds,
          decimal,
          implied,
          line: getLine(q, market),
          deeplink: q?.deeplink || null,
          updatedAt: q?.lastUpdatedAt || q?.updatedAt || null
        });
      }

      if (!quotes.length) continue;
      quotes.sort((a, b) => b.odds - a.odds);

      const predictionQuotes = quotes.filter(isPredictionQuote).sort((a, b) => a.implied - b.implied);
      const sportsbookQuotes = quotes.filter(isSportsbookQuote);
      const bestPrediction = predictionQuotes[0] || null;
      const bestSportsbook = sportsbookQuotes.slice().sort((a, b) => b.odds - a.odds)[0] || null;
      const best = quotes[0];

      const fairOdds = finiteNumber(market?.fairOdds);
      const fairProbability = fairOdds !== null && fairOdds !== 0 ? americanToProb(fairOdds) : null;
      const sportsbookMedian = median(sportsbookQuotes.map(q => q.implied));
      const benchmarkProbability = fairProbability ?? sportsbookMedian;
      const benchmarkSource = fairProbability != null
        ? 'SportsGameOdds fair-price estimate'
        : (sportsbookMedian != null ? `Median of ${sportsbookQuotes.length} sportsbook quote${sportsbookQuotes.length === 1 ? '' : 's'} (not de-vigged)` : null);
      const fairLine = finiteNumber(market?.fairSpread) ?? finiteNumber(market?.fairOverUnder);
      const benchmarkLine = fairLine ?? bestSportsbook?.line ?? null;
      const lineComparable = bestPrediction ? sameLine(bestPrediction.line, benchmarkLine) : false;
      const priceGap = bestPrediction && benchmarkProbability != null && lineComparable ? benchmarkProbability - bestPrediction.implied : null;
      const line = bestPrediction?.line ?? bestSportsbook?.line ?? best?.line ?? fairLine;

      rows.push({
        eventId,
        eventName,
        startTime,
        league: event?.leagueID || event?.league || '',
        oddID,
        marketName: market?.marketName || market?.betTypeID || oddID,
        side: displaySide(market, home, away),
        stat: market?.statID || '',
        period: market?.periodID || '',
        fairOdds,
        fairProbability,
        fairLine,
        benchmarkProbability,
        benchmarkSource,
        benchmarkLine,
        lineComparable,
        line,
        best,
        bestPrediction,
        bestSportsbook,
        priceGap,
        quotes
      });
      eventRowCount++;
    }

    if (eventRowCount === 0) {
      rows.push({
        eventId,
        eventName,
        startTime,
        league: event?.leagueID || event?.league || '',
        oddID: `${eventId}-game`,
        marketName: 'Game',
        side: '',
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
        best: null,
        bestPrediction: null,
        bestSportsbook: null,
        priceGap: null,
        quotes: []
      });
    }
  }

  return rows.sort((a, b) => {
    const ap = a.bestPrediction ? 1 : 0;
    const bp = b.bestPrediction ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ag = Number.isFinite(a.priceGap) ? Math.abs(a.priceGap) : -1;
    const bg = Number.isFinite(b.priceGap) ? Math.abs(b.priceGap) : -1;
    if (ag !== bg) return bg - ag;
    return new Date(a.startTime || 0) - new Date(b.startTime || 0);
  });
}

function demoPayload(league = 'NFL') {
  const now = Date.now();
  const mk = (oddID, marketName, sideID, fairOdds, quotes, extra = {}) => ({
    oddID, marketName, sideID, fairOdds: String(fairOdds), ...extra,
    byBookmaker: Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, {
      odds: String(v), available: true, lastUpdatedAt: new Date().toISOString()
    }]))
  });

  return {
    demo: true,
    data: [
      {
        eventID: 'demo-1', leagueID: league, startTime: new Date(now + 86400000).toISOString(),
        teams: { away: { name: 'San Francisco 49ers' }, home: { name: 'Los Angeles Rams' } },
        odds: {
          'points-away-game-sp-away': mk('points-away-game-sp-away', 'Spread', 'away', -103, { fanduel: -110, draftkings: -108, betmgm: -112, novig: 106, kalshi: 101, polymarket: 103 }, { fairSpread: '3.5' }),
          'points-home-game-ml-home': mk('points-home-game-ml-home', 'Moneyline', 'home', -141, { fanduel: -150, draftkings: -148, betmgm: -155, novig: -139, kalshi: -143, polymarket: -140 })
        }
      },
      {
        eventID: 'demo-2', leagueID: league, startTime: new Date(now + 2 * 86400000).toISOString(),
        teams: { away: { name: 'Los Angeles Chargers' }, home: { name: 'Arizona Cardinals' } },
        odds: {
          'points-away-game-ml-away': mk('points-away-game-ml-away', 'Moneyline', 'away', -116, { fanduel: -125, draftkings: -122, betmgm: -120, kalshi: -105, polymarket: -110 }),
          'points-away-game-sp-away': mk('points-away-game-sp-away', 'Spread', 'away', -106, { fanduel: -110, draftkings: -108, betmgm: -112, kalshi: 102, polymarket: 100 }, { fairSpread: '-2.5' })
        }
      }
    ]
  };
}

export async function fetchBoard(url) {
  const league = (url.searchParams.get('league') || 'NFL').toUpperCase();
  const live = url.searchParams.get('live') === 'true';
  const requestedLimit = Math.max(1, Number(url.searchParams.get('limit') || 100));
  const limit = Math.min(500, Math.max(100, requestedLimit));
  const apiKey = process.env.SPORTSGAMEODDS_API_KEY || '';

  if (!apiKey) {
    const payload = demoPayload(league);
    return { rows: normalizeEvents(payload), demo: true, provider: 'Demo data', league };
  }

  const endpoint = new URL('https://api.sportsgameodds.com/v2/events');
  endpoint.searchParams.set('leagueID', league);
  endpoint.searchParams.set('type', 'match');
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('includeAltLines', 'true');
  endpoint.searchParams.set('cancelled', 'false');

  if (live) {
    endpoint.searchParams.set('live', 'true');
    endpoint.searchParams.set('oddsAvailable', 'true');
  } else {
    const now = Date.now();
    endpoint.searchParams.set('started', 'false');
    endpoint.searchParams.set('finalized', 'false');
    endpoint.searchParams.set('oddsPresent', 'true');
    endpoint.searchParams.set('startsAfter', new Date(now - 6 * 60 * 60 * 1000).toISOString());
    endpoint.searchParams.set('startsBefore', new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString());
  }

  const response = await fetch(endpoint, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' }
  });

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: text }; }

  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `SportsGameOdds returned ${response.status}`);
  }

  return {
    rows: normalizeEvents(payload),
    demo: false,
    provider: 'SportsGameOdds',
    league,
    sourceEventCount: Array.isArray(payload?.data) ? payload.data.length : 0,
    nextCursor: payload?.nextCursor || null
  };
}

export function isAuthorized(request) {
  const required = process.env.GIANT_ACCESS_CODE || '';
  if (!required) return true;
  return request.headers.get('x-giant-code') === required;
}

export function health() {
  const configured = Boolean(process.env.SPORTSGAMEODDS_API_KEY);
  return {
    ok: true,
    configured,
    provider: configured ? 'SportsGameOdds' : 'Demo',
    llmConfigured: Boolean(process.env.OPENAI_API_KEY),
    llmModel: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    accessProtected: Boolean(process.env.GIANT_ACCESS_CODE)
  };
}
