function americanToDecimal(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

function americanToProb(odds) {
  const d = americanToDecimal(odds);
  return d ? 1 / d : null;
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
  novig: { label: 'Novig', kind: 'Exchange' },
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
  if (typeof q === 'string' || typeof q === 'number') return Number(q);
  const candidates = [q.odds, q.price, q.americanOdds, q.bookOdds];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

function getLine(q, market) {
  if (!q || typeof q !== 'object') return null;
  const candidates = [q.spread, q.overUnder, q.line, market?.fairSpread, market?.fairOverUnder];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeEvents(payload) {
  const events = Array.isArray(payload?.data) ? payload.data : [];
  const rows = [];
  for (const event of events) {
    const home = event?.teams?.home?.name || event?.teams?.home?.names?.long || event?.homeTeam || 'Home';
    const away = event?.teams?.away?.name || event?.teams?.away?.names?.long || event?.awayTeam || 'Away';
    const eventName = `${away} @ ${home}`;
    const eventId = event?.eventID || event?.id || eventName;
    const startTime = event?.startTime || event?.startDate || null;
    const markets = event?.odds && typeof event.odds === 'object' ? event.odds : {};

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
      const best = quotes[0];
      const fairOdds = Number(market?.fairOdds);
      const fairProbability = Number.isFinite(fairOdds) ? americanToProb(fairOdds) : null;
      const ev = fairProbability && best.decimal ? fairProbability * best.decimal - 1 : null;

      rows.push({
        eventId,
        eventName,
        startTime,
        league: event?.leagueID || event?.league || '',
        oddID,
        marketName: market?.marketName || market?.betTypeID || oddID,
        side: market?.sideID || market?.statEntityID || '',
        stat: market?.statID || '',
        period: market?.periodID || '',
        fairOdds: Number.isFinite(fairOdds) ? fairOdds : null,
        fairProbability,
        fairLine: Number.isFinite(Number(market?.fairSpread))
          ? Number(market.fairSpread)
          : (Number.isFinite(Number(market?.fairOverUnder)) ? Number(market.fairOverUnder) : null),
        best,
        ev,
        quotes
      });
    }
  }
  return rows;
}

function demoPayload(league = 'NFL') {
  const now = Date.now();
  const mk = (oddID, marketName, sideID, fairOdds, quotes, extra = {}) => ({
    oddID,
    marketName,
    sideID,
    fairOdds: String(fairOdds),
    ...extra,
    byBookmaker: Object.fromEntries(
      Object.entries(quotes).map(([k, v]) => [k, {
        odds: String(v),
        available: true,
        lastUpdatedAt: new Date().toISOString()
      }])
    )
  });

  return {
    demo: true,
    data: [
      {
        eventID: 'demo-1',
        leagueID: league,
        startTime: new Date(now + 86400000).toISOString(),
        teams: { away: { name: 'San Francisco 49ers' }, home: { name: 'Los Angeles Rams' } },
        odds: {
          'points-away-game-sp-away': mk(
            'points-away-game-sp-away', 'Spread', 'away', -103,
            { fanduel: -110, draftkings: -108, betmgm: -112, novig: 106, kalshi: 101, polymarket: 103 },
            { fairSpread: '3.5' }
          ),
          'points-home-game-ml-home': mk(
            'points-home-game-ml-home', 'Moneyline', 'home', -141,
            { fanduel: -150, draftkings: -148, betmgm: -155, novig: -139, kalshi: -143, polymarket: -140 }
          )
        }
      },
      {
        eventID: 'demo-2',
        leagueID: league,
        startTime: new Date(now + 2 * 86400000).toISOString(),
        teams: { away: { name: 'Buffalo Bills' }, home: { name: 'Houston Texans' } },
        odds: {
          'points-home-game-ml-home': mk(
            'points-home-game-ml-home', 'Moneyline', 'home', 104,
            { fanduel: -102, draftkings: 100, betmgm: -105, novig: 108, kalshi: 105, polymarket: 106 }
          ),
          'points-all-game-ou-over': mk(
            'points-all-game-ou-over', 'Total', 'over', -104,
            { fanduel: -110, draftkings: -105, betmgm: -112, novig: 102, kalshi: -101 },
            { fairOverUnder: '47.5' }
          )
        }
      }
    ]
  };
}

export async function fetchBoard(url) {
  const league = (url.searchParams.get('league') || 'NFL').toUpperCase();
  const live = url.searchParams.get('live') === 'true';
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 12)));
  const apiKey = process.env.SPORTSGAMEODDS_API_KEY || '';

  if (!apiKey) {
    const payload = demoPayload(league);
    return { rows: normalizeEvents(payload), demo: true, provider: 'Demo data', league };
  }

  const endpoint = new URL('https://api.sportsgameodds.com/v2/events');
  endpoint.searchParams.set('leagueID', league);
  endpoint.searchParams.set('oddsAvailable', 'true');
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('live', String(live));
  endpoint.searchParams.set('started', live ? 'true' : 'false');

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
    nextCursor: payload?.nextCursor || null
  };
}

export function health() {
  const configured = Boolean(process.env.SPORTSGAMEODDS_API_KEY);
  return { ok: true, configured, provider: configured ? 'SportsGameOdds' : 'Demo' };
}
