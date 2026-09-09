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
      impliedProbability: r.bestPrediction.implied,
      americanOdds: r.bestPrediction.odds,
      line: r.bestPrediction.line
    } : null,
    sportsbookReference: r.bestSportsbook ? {
      venue: r.bestSportsbook.label,
      impliedProbability: r.bestSportsbook.implied,
      americanOdds: r.bestSportsbook.odds,
      line: r.bestSportsbook.line
    } : null,
    benchmarkProbability: r.benchmarkProbability,
    benchmarkSource: r.benchmarkSource,
    priceGap: r.priceGap,
    quotes: r.quotes.slice(0, 8).map(q => ({ venue: q.label, kind: q.kind, odds: q.odds, impliedProbability: q.implied, line: q.line }))
  };
}

function tokenize(text = '') {
  const stop = new Set(['i','a','an','the','on','to','for','of','in','and','or','what','whats','want','bet','trade','best','seems','like','me','my','this','that','game','nfl','prediction','market','markets']);
  return String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 2 && !stop.has(x));
}

function selectRelevant(rows, message) {
  const tokens = tokenize(message);
  const scored = rows.map(r => {
    const hay = `${r.eventName} ${r.marketName} ${r.side} ${r.stat}`.toLowerCase();
    const hits = tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    const executable = r.bestPrediction ? 3 : 0;
    const gap = Number.isFinite(r.priceGap) ? Math.max(-1, Math.min(1, r.priceGap * 10)) : 0;
    return { r, score: hits * 10 + executable + gap };
  });
  const anyHits = scored.some(x => x.score >= 10);
  return scored.filter(x => !anyHits || x.score >= 10).sort((a, b) => b.score - a.score).slice(0, 24).map(x => x.r);
}

function cents(p) { return Number.isFinite(p) ? `${(p * 100).toFixed(1)}¢` : '—'; }
function pct(p) { return Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '—'; }

function fallbackAnswer(rows, message) {
  const executable = rows.filter(r => r.bestPrediction);
  if (!rows.length) return `I couldn't find a current NFL market matching “${message}” in the feed. Try a team name, player, or a broader request like “find me something interesting this week.”`;
  if (!executable.length) {
    const r = rows[0];
    return `I found ${r.eventName} / ${r.marketName}, but this feed does not currently show an executable prediction-market quote for it. The sportsbook/reference side is visible, so I can use it for context, but I would not pretend there is a trade available when there isn't.`;
  }

  const ranked = executable.slice().sort((a, b) => {
    const ag = Number.isFinite(a.priceGap) ? a.priceGap : -999;
    const bg = Number.isFinite(b.priceGap) ? b.priceGap : -999;
    return bg - ag;
  });
  const best = ranked[0];
  const side = best.side || best.stat || best.marketName;
  const gap = best.priceGap;
  const gapText = Number.isFinite(gap) ? `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)} percentage points versus the benchmark` : 'no clean benchmark comparison';
  let text = `For a simple way to express that view, the most interesting quote I can see is ${side} in ${best.eventName}: ${cents(best.bestPrediction.implied)} on ${best.bestPrediction.label}. `;
  if (Number.isFinite(best.benchmarkProbability)) text += `Giant's reference benchmark is ${pct(best.benchmarkProbability)}, so that's ${gapText}. `;
  text += `I would treat that as a price-shopping signal, not proof of true +EV — the benchmark can be wrong and settlement/fees can differ.`;
  if (ranked[1]) text += `\n\nRunner-up: ${ranked[1].side || ranked[1].marketName} at ${cents(ranked[1].bestPrediction.implied)} on ${ranked[1].bestPrediction.label}.`;
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

  const system = `You are Giant, a personal NFL prediction-market trading copilot. The user trades prediction markets for fun and wants to make disciplined, price-aware decisions; sportsbooks are reference pricing only, not executable for this user. Answer conversationally and directly. Use only the supplied live market data for prices. Never invent a market, quote, injury, news item, true probability, or edge. A benchmark is not ground truth. Prefer prediction-market execution when available. Explain cents/probabilities plainly. When asked for the "best bet" or "best trade", compare the relevant supplied markets and recommend at most 1-3 options, with why. Mention meaningful caveats about fees, liquidity, or settlement only when relevant. Do not act like a quant terminal. Do not use sportsbook recommendations as executable bets. Keep most answers under 250 words.`;

  const prior = Array.isArray(history) ? history.slice(-6).map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.content || '').slice(0, 1200) })) : [];
  const input = [
    ...prior,
    { role: 'user', content: `Current user request: ${message}\n\nCurrent portfolio snapshot:\n${JSON.stringify({ bankroll: portfolio?.bankroll || 0, exposure: portfolio?.exposure || 0, realized: portfolio?.realized || 0, openCount: portfolio?.openCount || 0 })}\n\nRelevant market data:\n${JSON.stringify(markets.map(compactRow))}` }
  ];

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions: system,
      input,
      reasoning: { effort: 'low' },
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

    const url = new URL(request.url);
    url.search = '';
    url.searchParams.set('league', 'NFL');
    url.searchParams.set('limit', '40');
    const board = await fetchBoard(url);
    const relevant = selectRelevant(board.rows || [], message);

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
