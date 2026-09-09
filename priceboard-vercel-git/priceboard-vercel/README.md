# Priceboard

Vercel-ready odds comparison MVP for sportsbook, exchange, and prediction-market prices.

## What it does

- Compares matching outcomes across sportsbooks, exchanges, and prediction markets.
- Highlights the best quoted price.
- Converts prices to break-even probabilities.
- Uses the data feed's `fairOdds` benchmark to estimate EV when available.
- Ranks venues with a simple price generosity index.
- Includes a manual promo wallet stored in browser local storage.
- Includes a probability lab for odds conversion, de-vigging, EV, and parlay math.
- Falls back to demo data when no API key is configured.

## Deploy to Vercel

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Vercel, create a new project and import the repository.
3. Add the environment variable:

   `SPORTSGAMEODDS_API_KEY=your_key_here`

4. Deploy.

The frontend is static and the live odds adapter runs as Vercel Functions under `/api`.

## Local development

The easiest way to reproduce Vercel locally is with the Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

For live data, create `.env.local`:

```bash
SPORTSGAMEODDS_API_KEY=your_key_here
```

Without the key, the app runs in demo mode.

## Repository structure

```text
.
├── index.html
├── app.js
├── styles.css
├── api/
│   ├── _shared.mjs
│   ├── board.mjs
│   └── health.mjs
├── .env.example
├── .gitignore
├── package.json
└── vercel.json
```

## Notes

- Best price comparisons are only meaningful for the same outcome, line, period, and settlement rules.
- Exchange fees and bid/ask execution can change realized value; venue-specific fee normalization is a logical next upgrade.
- Fair odds are estimates, not ground truth.
- Promo valuation is intentionally manual because eligibility and terms are often account-specific.
