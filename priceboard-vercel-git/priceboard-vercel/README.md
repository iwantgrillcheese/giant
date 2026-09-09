# Giant

Giant is a personal NFL prediction-market trading copilot. It is prediction-market first: sportsbooks are used as a pricing reference layer, while the UI is built around finding executable prediction-market prices, understanding what they imply, and tracking a simple trading book.

## V1

- Conversational `Ask Giant` interface for requests like “I want to trade the Chargers. What seems like the best bet?”
- Live NFL market feed through SportsGameOdds.
- Prediction-market quotes surfaced ahead of sportsbook reference prices.
- A simple benchmark / price-gap comparison. Benchmarks are estimates, not true probabilities.
- Manual account balances, open exposure, positions, realized P&L, and marked P&L.
- Probability lab for odds, implied probability, de-vigging, and prediction-contract payouts.
- Optional OpenAI LLM layer. If no OpenAI key is configured, Giant falls back to a deterministic market-comparison rules engine rather than failing.
- Optional access code to protect the API endpoints on a personal deployment.

## Environment variables

```bash
SPORTSGAMEODDS_API_KEY=your_sgo_key
OPENAI_API_KEY=your_openai_key          # optional, enables full conversational answers
OPENAI_MODEL=gpt-5.6-luna              # optional
GIANT_ACCESS_CODE=your_private_code     # optional
```

If `GIANT_ACCESS_CODE` is set in Vercel, open Giant → Settings and save the same code in the browser. It is stored only in localStorage and sent as the `x-giant-code` header.

## Deploy to Vercel

The Vercel project should use this folder as its project root:

```text
priceboard-vercel-git/priceboard-vercel
```

The frontend is static HTML/CSS/JS. Server-side functions live under `/api`, so private API keys are never shipped to the browser.

## API

- `GET /api/health` — feed/LLM configuration status
- `GET /api/board?league=NFL&limit=30` — normalized market board
- `POST /api/ask` — conversational market analysis using the current live board

## Important interpretation notes

- A prediction-market quote and sportsbook bet may have different settlement rules or fees even when they look similar.
- The SportsGameOdds `fairOdds` field is used as the preferred benchmark when present. Otherwise Giant can show a sportsbook quote median as context, which is explicitly labeled as not de-vigged.
- A gap versus a benchmark is a price-shopping signal, not proof that the contract is +EV or that Giant knows the true probability.
- P&L is kept separate from deposits and account balances.
