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
  const stop = new Set(['i','a','an','the','on','to','for','of','in','and','or','what','whats','want','wanna','bet','trade','best','seems','like','me','my','this','that','game','nfl','prediction','market','markets','price','good','bad','think']);
  return normalizeText(text).split(/\s+/).filter(x => x.length > 2 && !stop.has(x));
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
    const marketIntent = normalizeText(text).includes('moneyline') && /moneyline|\bml\b/i.test(`${r.marketName} ${r.oddID}`) ? 3 : 0;
    const spreadIntent = normalizeText(text).includes('spread') && /spread|\bsp\b/i.test(`${r.marketName} ${r.oddID}`) ? 3 : 0;
    const tdIntent = normalizeText(text).includes('touchdown') && /touchdown|td/i.test(`${r.marketName} ${r.stat} ${r.oddID}`) ? 3 : 0;
    return { r, score: hits * 8 + sideHits * 5 + executable + comparable + marketIntent + spreadIntent + tdIntent };
  });
  const anyHits = scored.some(x => x.score >= 8);
  return scored
    .filter(x => !anyHits || x.score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map(x => x.r);
}

function cents(p) { return Number.isFinite(p) ? `${(p * 100).toFixed(1)}¢` : '—'; }
function pct(p) { return Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '—'; }

function isGreeting(message) {
  return /^(yo+|hey+|hi+|hello|sup|what'?s up|wassup|howdy)[!. ]*$/i.test(message.trim());
}

function isThanks(message) {
  return /^(thanks|thank you|thx|nice|got it|makes sense|cool|lol|lmao)[!. ]*$/i.test(message.trim());
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
    return `I'm not finding a clean NFL match for that in the feed right now. Try the team/player name, or just give me the price you're seeing and what the bet is.`;
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
    return `${cents(offered)} on ${side} looks ${read} to me. The market/book reference I have is around ${pct(ref)}, so you're about ${Math.abs(edge * 100).toFixed(1)} points ${edge >= 0 ? 'under' : 'over'} that. I wouldn't treat that reference as truth, but it's a solid sanity check.`;
  }

  const executable = rows.filter(r => r.bestPrediction);
  if (!executable.length) {
    const r = referenceRow || rows[0];
    const side = r.side || r.marketName;
    const refText = Number.isFinite(r.benchmarkProbability) ? ` The broader price reference has ${side} around ${pct(r.benchmarkProbability)}.` : '';
    return `I can see the ${r.eventName} market, but this feed isn't giving me a live prediction-market price for it right now.${refText} So I can't honestly call a “best trade” yet. If you paste the price you're seeing — like “Chargers 81¢” — I can tell you if it looks cheap or rich.`;
  }

  const ranked = executable.slice().sort((a, b) => {
    const ag = Number.isFinite(a.priceGap) ? a.priceGap : -999;
    const bg = Number.isFinite(b.priceGap) ? b.priceGap : -999;
    return bg - ag;
  });
  const best = ranked[0];
  const side = best.side || best.stat || best.marketName;
  const gap = best.priceGap;

  let text = `The best-looking price I can see is ${side} in ${best.eventName} at ${cents(best.bestPrediction.implied)} on ${best.bestPrediction.label}.`;
  if (Number.isFinite(best.benchmarkProbability) && Number.isFinite(gap)) {
    text += ` The broader reference is around ${pct(best.benchmarkProbability)}, so you're getting it about ${Math.abs(gap * 100).toFixed(1)} points ${gap >= 0 ? 'cheaper' : 'richer'}.`;
  }
  text += ` That's enough for me to say the price is interesting — not enough to pretend we know the true odds.`;
  if (ranked[1]) text += `\n\nSecond one I'd look at: ${ranked[1].side || ranked[1].marketName} at ${cents(ranked[1].bestPrediction.implied)} on ${ranked[1].bestPrediction.label}.`;
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

  const system = `You are Giant, the user's personal NFL prediction-market buddy. Talk like a smart friend who knows odds, not a quant terminal and not a compliance memo. Be casual, clear, and concise. Contractions are good. The user trades prediction markets; sportsbooks are reference pricing only.

Use only the supplied live market data for prices. Never make up a price, injury, news item, true probability, or edge. A reference probability is just a sanity check, not ground truth. Only compare prices when the supplied data says the line is comparable. If there isn't a live prediction-market quote, say that plainly, but still give useful sportsbook/reference context and invite the user to paste the price they're seeing. If they give you a price in cents, compare its break-even probability to the supplied reference. When asked for the best bet/trade, give at most 1-3 options and explain them in normal language. Avoid words like executable, benchmarkProbability, lineComparable, model edge, or alpha unless the user asks for technical detail. Most answers should be 2-6 sentences.`;

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
      max_output_tokens: 600
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

    const priorUserContext = Array.isArray(body?.history)
      ? body.history.filter(x => x?.role === 'user').slice(-3).map(x => x.content).join(' ')
      : '';
    const relevant = selectRelevant(board.rows || [], `${priorUserContext} ${message}`);

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

    return Response.json({ answer, mode, marketCount: relevant.length, demo: board.demo }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error?.message || 'Failed to answer' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
