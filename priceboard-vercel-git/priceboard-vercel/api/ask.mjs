import { fetchBoard, isAuthorized } from './_shared.mjs';
import { fetchKalshiNFLRows } from './_kalshi.mjs';

function compactRow(r) {
  return {
    event: r.eventName,
    startTime: r.startTime,
    market: r.marketName,
    side: r.side || r.stat || '',
    line: r.line,
    prediction: r.bestPrediction ? {
      venue: r.bestPrediction.label,
      price: r.bestPrediction.implied,
      americanOdds: r.bestPrediction.odds,
      line: r.bestPrediction.line
    } : null,
    bookReference: r.bestSportsbook ? {
      venue: r.bestSportsbook.label,
      impliedProbability: r.bestSportsbook.implied,
      americanOdds: r.bestSportsbook.odds,
      line: r.bestSportsbook.line
    } : null,
    referenceProbability: r.benchmarkProbability,
    referenceSource: r.benchmarkSource,
    referenceLine: r.benchmarkLine,
    sameLine: r.lineComparable,
    priceGap: r.priceGap,
    quotes: r.quotes.slice(0, 12).map(q => ({ venue: q.label, kind: q.kind, odds: q.odds, probability: q.implied, line: q.line }))
  };
}

function normalizeText(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/\bpats\b/g, ' patriots ')
    .replace(/\bniners\b/g, ' 49ers ')
    .replace(/\bbolts\b/g, ' chargers ')
    .replace(/\btd\b/g, ' touchdown ')
    .replace(/\bml\b/g, ' moneyline ')
    .replace(/[^a-z0-9.+%¢-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text = '') {
  const stop = new Set(['i','a','an','the','on','to','for','of','in','and','or','what','whats','want','wanna','bet','trade','best','seems','like','me','my','this','that','game','nfl','prediction','market','markets','price','good','bad','think','play','way']);
  return normalizeText(text).split(/\s+/).filter(x => x.length > 2 && !stop.has(x));
}

const contextNoise = new Set([
  'moneyline','spread','total','over','under','touchdown','odds','line','lines','prop','props',
  'who','they','them','their','there','he','him','his','she','her','it','its','opponent','matchup',
  'playing','plays','played','said','just','again','current','right','now','next','week','same','one',
  'live','quote','quotes','check','audit','position','positions','ticket','tickets','first','anytime','both','win','wins'
]);

function hasIdentitySignal(text = '') {
  return tokenize(text).some(t => !contextNoise.has(t));
}

function strongIdentityTokens(text = '') {
  return tokenize(text).filter(t => !contextNoise.has(t) && /[a-z]/i.test(t));
}

function isDiscovery(text = '') {
  return /find me|something interesting|anything good|what should i|best value|biggest disagreement|where.*disagree|what looks good|show me.*market/i.test(text);
}

function isSlateRequest(text = '') {
  return /all nfl.*lines|all.*nfl.*games|what nfl games|show me.*nfl|full slate|whole slate|all game lines/i.test(text);
}

function isPortfolioQuoteRequest(text = '') {
  return /live quotes?|get.*quotes?|quote.*bets?|price.*bets?|check.*bets?|audit.*bets?|my bets|my positions|my tickets|outstanding bets/i.test(text);
}

function rowHaystack(r) {
  const quoteText = (r.quotes || []).map(q => `${q.label || ''} ${q.kind || ''} ${q.line ?? ''}`).join(' ');
  return normalizeText(`${r.eventName} ${r.marketName} ${r.side} ${r.stat} ${r.oddID} ${r.line ?? ''} ${r.referenceLine ?? ''} ${quoteText}`);
}

function marketIntentScore(row, text) {
  const norm = normalizeText(text);
  const hay = normalizeText(`${row.marketName} ${row.stat} ${row.oddID}`);
  let score = 0;
  if (norm.includes('moneyline') && /moneyline|\bml\b/.test(hay)) score += 8;
  if (norm.includes('spread') && /spread|\bsp\b/.test(hay)) score += 8;
  if ((norm.includes('touchdown') || norm.includes('first touchdown')) && /touchdown|td/.test(hay)) score += 8;
  if (norm.includes('first touchdown') && /first|1st/.test(hay)) score += 6;
  if (norm.includes('anytime touchdown') && /anytime/.test(hay)) score += 6;
  if (norm.includes('over') && normalizeText(row.side || '').includes('over')) score += 5;
  if (norm.includes('under') && normalizeText(row.side || '').includes('under')) score += 5;
  return score;
}

function selectRelevant(rows, text) {
  const tokens = tokenize(text);
  const scored = rows.map(r => {
    const hay = rowHaystack(r);
    const side = normalizeText(r.side || '');
    let hits = 0;
    let sideHits = 0;
    for (const t of tokens) {
      if (hay.includes(t)) hits += 1;
      if (side.includes(t)) sideHits += 1;
    }
    const executable = r.bestPrediction ? 2 : 0;
    const comparable = Number.isFinite(r.priceGap) ? 1 : 0;
    const intent = marketIntentScore(r, text);
    return { r, score: hits * 8 + sideHits * 5 + executable + comparable + intent, hits };
  });

  const directMatches = scored.filter(x => x.hits > 0 || x.score >= 8);
  if (directMatches.length) {
    return directMatches.sort((a, b) => b.score - a.score).slice(0, 40).map(x => x.r);
  }

  if (isDiscovery(text) || tokens.length === 0) {
    return scored.sort((a, b) => b.score - a.score).slice(0, 40).map(x => x.r);
  }

  return [];
}

function selectForBet(rows, description) {
  const strong = strongIdentityTokens(description);
  if (!strong.length) return [];
  const tokens = tokenize(description);

  return rows.map(r => {
    const hay = rowHaystack(r);
    const side = normalizeText(r.side || '');
    let strongHits = 0;
    let tokenHits = 0;
    let sideHits = 0;
    for (const t of tokens) {
      if (hay.includes(t)) tokenHits += 1;
      if (side.includes(t)) sideHits += 1;
    }
    for (const t of strong) if (hay.includes(t)) strongHits += 1;
    const exactLine = r.line != null && normalizeText(description).includes(normalizeText(String(r.line))) ? 5 : 0;
    const score = strongHits * 16 + tokenHits * 4 + sideHits * 5 + marketIntentScore(r, description) + exactLine + (r.bestPrediction ? 2 : 0);
    return { r, strongHits, score };
  })
    .filter(x => x.strongHits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(x => x.r);
}

function auditPortfolio(rows, portfolio) {
  const positions = Array.isArray(portfolio?.positions)
    ? portfolio.positions.filter(p => !p?.result || p.result === 'open').slice(-25)
    : [];
  const searches = [];
  const selected = [];

  for (const position of positions) {
    const bet = String(position?.description || '').trim();
    if (!bet) continue;
    const matches = selectForBet(rows, bet);
    searches.push({
      bet,
      venue: position?.venue || '',
      stake: Number(position?.stake || 0),
      toWin: Number(position?.toWin || 0),
      matchCount: matches.length,
      matches: matches.slice(0, 5).map(compactRow)
    });
    selected.push(...matches);
  }

  const deduped = [...new Map(selected.map(r => [r.oddID || `${r.eventName}:${r.marketName}:${r.side}:${r.line}`, r])).values()];
  return { rows: deduped.slice(0, 80), searches };
}

function conversationContext(rows, history = []) {
  if (!Array.isArray(history) || !rows.length) return null;
  const recent = history.slice(-12).reverse();

  for (const item of recent) {
    const text = String(item?.content || '').trim();
    if (!text || !hasIdentitySignal(text)) continue;
    const matches = selectRelevant(rows, text);
    if (!matches.length) continue;
    const eventName = matches[0]?.eventName;
    if (!eventName) continue;
    const eventRows = rows.filter(r => r.eventName === eventName);
    if (eventRows.length) return { eventName, rows: eventRows };
  }

  return null;
}

function cents(p) { return Number.isFinite(p) ? `${(p * 100).toFixed(1)}¢` : '—'; }
function pct(p) { return Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '—'; }

function isGreeting(message) {
  return /^(yo+|hey+|hi+|hello|sup|what'?s up|wassup|howdy)[!. ]*$/i.test(message.trim());
}

function isThanks(message) {
  return /^(thanks|thank you|thx|nice|got it|makes sense|cool|lol|lmao)[!. ]*$/i.test(message.trim());
}

function isShortFollowup(message = '') {
  return tokenize(message).length <= 2 && /what about|how about|instead|spread|moneyline|total|over|under|him|it|that/i.test(message);
}

function quotedPrice(message) {
  const m = String(message).match(/(?:at|for|is|=)?\s*(\d{1,2}(?:\.\d+)?)\s*(?:¢|c\b|cents?\b)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 100 ? n / 100 : null;
}

function bestReference(rows) {
  return rows.find(r => Number.isFinite(r.benchmarkProbability)) || null;
}

function fallbackAnswer(rows, message) {
  if (isGreeting(message)) return "Yo 👋 What are you thinking about betting? Give me a team, player, or price and I'll take a look.";
  if (isThanks(message)) return "Yep. Throw me the next one whenever.";

  if (!rows.length) {
    return `I'm not seeing that team/player in the live feeds right now. If you paste the price you're seeing — like “Chargers 58¢” — I can still sanity-check it against anything else I have.`;
  }

  if (/who.*play|who.*playing|opponent|matchup/i.test(message)) {
    const r = rows[0];
    return `The matchup I have in the live feed is ${r.eventName}${r.startTime ? `, starting ${new Date(r.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' })}` : ''}.`;
  }

  const offered = quotedPrice(message);
  const referenceRow = bestReference(rows);
  if (offered != null && referenceRow) {
    const ref = referenceRow.benchmarkProbability;
    const edge = ref - offered;
    const side = referenceRow.side || referenceRow.marketName;
    let read = 'pretty much fair';
    if (edge >= .02) read = 'pretty good';
    else if (edge <= -.02) read = 'a little expensive';
    return `${cents(offered)} on ${side} looks ${read}. The broader reference is around ${pct(ref)}, so you're about ${Math.abs(edge * 100).toFixed(1)} points ${edge >= 0 ? 'cheaper' : 'richer'} than that. Not gospel, but a useful gut check.`;
  }

  const executable = rows.filter(r => r.bestPrediction);
  if (!executable.length) {
    const r = referenceRow || rows[0];
    const side = r.side || r.marketName;
    const refText = Number.isFinite(r.benchmarkProbability) ? ` The broader price has ${side} around ${pct(r.benchmarkProbability)}.` : '';
    return `I can see ${r.eventName}, but I'm not getting a live prediction-market price for ${side} right now.${refText} Send me the price you're seeing and I'll tell you if it looks cheap or rich.`;
  }

  const ranked = executable.slice().sort((a, b) => {
    const ag = Number.isFinite(a.priceGap) ? a.priceGap : -999;
    const bg = Number.isFinite(b.priceGap) ? b.priceGap : -999;
    return bg - ag;
  });
  const best = ranked[0];
  const side = best.side || best.stat || best.marketName;
  const gap = best.priceGap;

  let text = `I'd start with ${side} in ${best.eventName}: ${cents(best.bestPrediction.implied)} on ${best.bestPrediction.label}.`;
  if (Number.isFinite(best.benchmarkProbability) && Number.isFinite(gap)) {
    text += ` The broader reference is around ${pct(best.benchmarkProbability)}, so that price is about ${Math.abs(gap * 100).toFixed(1)} points ${gap >= 0 ? 'cheaper' : 'richer'}.`;
  }
  text += ` That's the one that jumps out first.`;
  if (ranked[1]) text += ` Another one worth a look is ${ranked[1].side || ranked[1].marketName} at ${cents(ranked[1].bestPrediction.implied)} on ${ranked[1].bestPrediction.label}.`;
  return text;
}

function extractText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const out = Array.isArray(response?.output) ? response.output : [];
  const parts = [];
  for (const item of out) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const c of item.content) if (c?.type === 'output_text' && c.text) parts.push(c.text);
  }
  return parts.join('\n').trim();
}

async function llmAnswer({ message, history, portfolio, markets, portfolioSearches }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const system = `You are Giant, the user's NFL prediction-market buddy. Talk like a smart friend watching football on the couch, not a quant terminal, financial adviser, or compliance memo. Be casual, useful, and concise. Contractions are good. The user can trade prediction markets; sportsbooks are reference pricing only.

This is a real conversation, so keep track of what the user and Giant were just talking about. Resolve follow-ups like “what's the moneyline?”, “what about the spread?”, “him?”, “that one?”, and “who do they play?” from the recent conversation. Do not randomly switch to a different team or game. If you previously established a matchup and the CURRENT supplied data still supports it, stay consistent.

Use only the CURRENT supplied live market data for factual claims about matchup/opponent, start time, prices, and market availability. Conversation history is for reference resolution and continuity, not a source of live facts. Never use model memory to invent an NFL schedule, opponent, quote, injury, news item, probability, or edge. If history conflicts with the current data, current data wins and you should say so plainly. If current live data includes the team/game being discussed, never say you cannot see it. Direct Kalshi prices are real prediction-market prices and can be discussed even when no sportsbook reference is available. A reference probability is a rough sanity check, not truth. Only compare prices when the supplied data says the line is comparable.

When PORTFOLIO SEARCH RESULTS are supplied, they are the result of a dedicated search for each open ticket. Treat each ticket separately. Never use a different player, matchup, or bet type as an equivalent quote. If a ticket has matches, use those matches instead of claiming the feed cannot find it. If a ticket has zero matches, say that ticket is unmatched rather than substituting a vaguely similar market. Giant currently searches NFL only, so non-NFL tickets can be called unsupported instead of pretending they were searched successfully.

When asked for the best way to play a team, compare the relevant moneyline/spread/props you actually have and say which one you'd look at first and why. Keep it in plain English. Do not suggest a dollar stake or bankroll percentage unless the user explicitly asks how much to bet. Mention the user's existing bets only when they are directly relevant to the thing being discussed. Do not over-warn or moralize. Avoid words like executable, benchmarkProbability, lineComparable, model edge, or alpha unless asked. Do not use Markdown formatting or asterisks. Most answers should be 2-6 sentences unless the user explicitly asks to audit multiple bets.`;

  let prior = Array.isArray(history)
    ? history
        .filter(x => x?.role === 'user' || x?.role === 'assistant')
        .slice(-12)
        .map(x => ({ role: x.role, content: String(x.content || '').slice(0, 1200) }))
    : [];
  if (prior.length && prior[prior.length - 1].role === 'user' && normalizeText(prior[prior.length - 1].content) === normalizeText(message)) {
    prior = prior.slice(0, -1);
  }

  const positions = Array.isArray(portfolio?.positions)
    ? portfolio.positions.slice(-25).map(p => ({ bet: p.description, venue: p.venue, stake: p.stake, toWin: p.toWin, result: p.result }))
    : [];
  const input = [
    ...prior,
    { role: 'user', content: `Current request: ${message}\n\nUser's book:\n${JSON.stringify({ bankroll: portfolio?.bankroll || 0, inPlay: portfolio?.exposure || 0, pnl: portfolio?.realized || 0, openBets: portfolio?.openCount || 0, positions })}\n\nPORTFOLIO SEARCH RESULTS:\n${JSON.stringify(portfolioSearches || null)}\n\nCURRENT relevant live market data:\n${JSON.stringify(markets.map(compactRow))}` }
  ];

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions: system,
      input,
      reasoning: { effort: 'none' },
      max_output_tokens: 700
    })
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: { message: text } }; }
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI returned ${r.status}`);
  return extractText(data) || null;
}

export async function POST(request) {
  if (!isAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const message = String(body?.message || '').trim();
    if (!message) return Response.json({ error: 'Message is required' }, { status: 400 });

    if (!process.env.OPENAI_API_KEY && (isGreeting(message) || isThanks(message))) {
      return Response.json({ answer: fallbackAnswer([], message), mode: 'rules', marketCount: 0 }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const url = new URL(request.url);
    url.search = '';
    url.searchParams.set('league', 'NFL');
    url.searchParams.set('limit', '100');

    const [sgoResult, kalshiResult] = await Promise.allSettled([
      fetchBoard(url),
      fetchKalshiNFLRows()
    ]);
    const board = sgoResult.status === 'fulfilled' ? sgoResult.value : { rows: [], demo: false };
    const kalshi = kalshiResult.status === 'fulfilled' ? kalshiResult.value : { rows: [] };
    const allRows = [...(kalshi.rows || []), ...(board.rows || [])];

    const portfolioRequest = isPortfolioQuoteRequest(message);
    let portfolioSearches = null;
    let relevant;

    if (isSlateRequest(message)) {
      relevant = allRows.slice(0, 80);
    } else if (portfolioRequest) {
      const audit = auditPortfolio(allRows, body?.portfolio);
      relevant = audit.rows;
      portfolioSearches = audit.searches;
    } else if (!hasIdentitySignal(message)) {
      const context = conversationContext(allRows, body?.history);
      relevant = context ? selectRelevant(context.rows, message) : selectRelevant(allRows, message);
    } else {
      relevant = selectRelevant(allRows, message);
    }

    if (!relevant.length && !portfolioRequest && Array.isArray(body?.history)) {
      const recentConversation = body.history
        .slice(-8)
        .map(x => String(x?.content || ''))
        .filter(Boolean)
        .join(' ');
      relevant = selectRelevant(allRows, `${recentConversation} ${message}`);
    }

    if (!relevant.length && !portfolioRequest && isShortFollowup(message) && Array.isArray(body?.history)) {
      const lastUser = body.history.filter(x => x?.role === 'user').slice(-2).map(x => x.content).join(' ');
      relevant = selectRelevant(allRows, `${lastUser} ${message}`);
    }

    let answer = null;
    let mode = 'rules';
    if (process.env.OPENAI_API_KEY) {
      try {
        answer = await llmAnswer({ message, history: body?.history, portfolio: body?.portfolio, markets: relevant, portfolioSearches });
        if (answer) mode = 'llm';
      } catch (error) {
        console.error('Giant LLM error:', error?.message || error);
      }
    }
    if (!answer) answer = fallbackAnswer(relevant, message);

    return Response.json({
      answer,
      mode,
      marketCount: relevant.length,
      totalMarketCount: allRows.length,
      sourceEventCount: board.sourceEventCount || 0,
      sourcePagesFetched: board.pagesFetched || 0,
      portfolioSearchCount: portfolioSearches?.length || 0,
      kalshiMarketCount: kalshi.rows?.length || 0,
      kalshiEventCount: kalshi.eventCount || 0,
      demo: board.demo,
      feedErrors: [
        sgoResult.status === 'rejected' ? `SportsGameOdds: ${sgoResult.reason?.message || 'failed'}` : null,
        kalshiResult.status === 'rejected' ? `Kalshi: ${kalshiResult.reason?.message || 'failed'}` : null
      ].filter(Boolean)
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error?.message || 'Failed to answer' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
