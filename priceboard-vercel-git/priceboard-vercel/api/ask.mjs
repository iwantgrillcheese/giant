import { fetchBoard, isAuthorized } from './_shared.mjs';

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
    quotes: r.quotes.slice(0, 8).map(q => ({ venue: q.label, kind: q.kind, odds: q.odds, probability: q.implied, line: q.line }))
  };
}

function normalizeText(text = '') {
  return String(text)
    .toLowerCase()
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

function isDiscovery(text = '') {
  return /find me|something interesting|anything good|what should i|best value|biggest disagreement|where.*disagree|what looks good|show me.*market/i.test(text);
}

function selectRelevant(rows, text) {
  const tokens = tokenize(text);
  const scored = rows.map(r => {
    const hay = normalizeText(`${r.eventName} ${r.marketName} ${r.side} ${r.stat} ${r.oddID}`);
    const side = normalizeText(r.side || '');
    let hits = 0;
    let sideHits = 0;
    for (const t of tokens) {
      if (hay.includes(t)) hits += 1;
      if (side.includes(t)) sideHits += 1;
    }
    const executable = r.bestPrediction ? 2 : 0;
    const comparable = Number.isFinite(r.priceGap) ? 1 : 0;
    const norm = normalizeText(text);
    const marketIntent = norm.includes('moneyline') && /moneyline|\bml\b/i.test(`${r.marketName} ${r.oddID}`) ? 3 : 0;
    const spreadIntent = norm.includes('spread') && /spread|\bsp\b/i.test(`${r.marketName} ${r.oddID}`) ? 3 : 0;
    const tdIntent = norm.includes('touchdown') && /touchdown|td/i.test(`${r.marketName} ${r.stat} ${r.oddID}`) ? 3 : 0;
    return { r, score: hits * 8 + sideHits * 5 + executable + comparable + marketIntent + spreadIntent + tdIntent, hits };
  });

  const directMatches = scored.filter(x => x.hits > 0 || x.score >= 8);
  if (directMatches.length) {
    return directMatches.sort((a, b) => b.score - a.score).slice(0, 24).map(x => x.r);
  }

  if (isDiscovery(text) || tokens.length === 0) {
    return scored.sort((a, b) => b.score - a.score).slice(0, 24).map(x => x.r);
  }

  return [];
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
    return `I'm not seeing that team/player in the live feed right now. If you paste the price you're seeing — like “Chargers 58¢” — I can still sanity-check it against the sportsbook side.`;
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

async function llmAnswer({ message, history, portfolio, markets }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const system = `You are Giant, the user's NFL prediction-market buddy. Talk like a smart friend watching football on the couch, not a quant terminal, financial adviser, or compliance memo. Be casual, useful, and concise. Contractions are good. The user can trade prediction markets; sportsbooks are reference pricing only.

Use only the supplied live market data for prices. Never invent a market, quote, injury, news item, probability, or edge. If relevant live market data is empty, do not talk about some unrelated game. Just say you aren't seeing that team/player in the feed right now and ask for the price the user sees. A reference probability is a rough sanity check, not truth. Only compare prices when the supplied data says the line is comparable.

When asked for the best way to play a team, compare the relevant moneyline/spread/props you actually have and say which one you'd look at first and why. Keep it in plain English. Do not suggest a dollar stake or bankroll percentage unless the user explicitly asks how much to bet. Mention the user's existing bets only when they are directly relevant to the thing being discussed. Do not over-warn or moralize. Avoid words like executable, benchmarkProbability, lineComparable, model edge, or alpha unless asked. Do not use Markdown formatting or asterisks. Most answers should be 2-5 sentences.`;

  const prior = Array.isArray(history)
    ? history.slice(-8).map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.content || '').slice(0, 1200) }))
    : [];
  const positions = Array.isArray(portfolio?.positions)
    ? portfolio.positions.slice(-20).map(p => ({ bet: p.description, venue: p.venue, stake: p.stake, toWin: p.toWin, result: p.result }))
    : [];
  const input = [
    ...prior,
    { role: 'user', content: `Current request: ${message}\n\nUser's book:\n${JSON.stringify({ bankroll: portfolio?.bankroll || 0, inPlay: portfolio?.exposure || 0, pnl: portfolio?.realized || 0, openBets: portfolio?.openCount || 0, positions })}\n\nRelevant live market data:\n${JSON.stringify(markets.map(compactRow))}` }
  ];

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions: system,
      input,
      reasoning: { effort: 'none' },
      max_output_tokens: 500
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
    url.searchParams.set('limit', '50');
    const board = await fetchBoard(url);

    let relevant = selectRelevant(board.rows || [], message);
    if (!relevant.length && isShortFollowup(message) && Array.isArray(body?.history)) {
      const lastUser = body.history.filter(x => x?.role === 'user').slice(-2).map(x => x.content).join(' ');
      relevant = selectRelevant(board.rows || [], `${lastUser} ${message}`);
    }

    let answer = null;
    let mode = 'rules';
    if (process.env.OPENAI_API_KEY) {
      try {
        answer = await llmAnswer({ message, history: body?.history, portfolio: body?.portfolio, markets: relevant });
        if (answer) mode = 'llm';
      } catch (error) {
        console.error('Giant LLM error:', error?.message || error);
      }
    }
    if (!answer) answer = fallbackAnswer(relevant, message);

    return Response.json({ answer, mode, marketCount: relevant.length, totalMarketCount: board.rows?.length || 0, demo: board.demo }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error?.message || 'Failed to answer' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
