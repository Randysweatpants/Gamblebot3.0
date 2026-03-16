# Gamblebot3.0 Website Drop-In

This package turns your existing Gamblebot3.0 Express API into a browser-friendly website.

## What's included
- `public/index.html` — dashboard UI
- `public/styles.css` — dark sportsbook-style design
- `public/app.js` — frontend logic that calls your existing `/api/*` routes
- `src-app-patch.ts` — replacement for your current `src/app.ts` so Express serves the website

## Expected backend routes
The frontend calls these endpoints already present in your repo:
- `GET /api/healthz`
- `GET /api/props`
- `GET /api/top-ev-picks`
- `POST /api/refresh-data`

## Install into your repo
1. Copy the `public/` folder into the root of `Gamblebot3.0`.
2. Replace your current `src/app.ts` with `src-app-patch.ts`.
3. Run your normal install/build/dev flow.
4. Open the root URL of the app in your browser.

## What this gives you
- NHL-first homepage
- filters for sport, market, sportsbook, team, date, and minimum EV
- top over / top under cards
- props explorer table
- refresh data button
- future-ready sport selector for NBA / MLB / NFL later
