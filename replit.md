# PropEdge - Sports Betting Research Platform

## Overview

PropEdge is an NHL-first sports betting research dashboard that finds positive expected value (EV) player prop bets by comparing sportsbook odds to model-based fair probabilities. The architecture is sport-agnostic and expandable to NBA, MLB, and NFL.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/propedge)
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/          # Express 5 API server
│   │   └── src/
│   │       ├── routes/      # health, sports, games, props, players, refresh
│   │       └── services/
│   │           ├── ev-calculator.ts       # Sport-agnostic EV/probability math
│   │           └── nhl/
│   │               ├── projection-engine.ts  # NHL weighted projection model
│   │               └── seed-data.ts          # Real NHL game/player/prop data
│   └── propedge/            # React + Vite frontend
│       └── src/
│           ├── pages/       # dashboard, props-explorer, player-detail
│           ├── components/  # layout, prop-card
│           └── hooks/       # use-props (API hooks)
├── lib/
│   ├── api-spec/            # OpenAPI spec + Orval codegen config
│   ├── api-client-react/    # Generated React Query hooks
│   ├── api-zod/             # Generated Zod schemas
│   └── db/                  # Drizzle ORM schema + DB connection
│       └── src/schema/
│           ├── sports.ts    # Sports/leagues table
│           ├── games.ts     # Games/matchups table
│           ├── players.ts   # Players + game logs tables
│           └── props.ts     # Props + projections tables
└── scripts/                 # Utility scripts
```

## NHL Projection Model

The projection engine uses a weighted model:
- 35% last 10 games average
- 25% last 5 games average
- 20% season average
- 10% opponent matchup adjustment
- 10% usage/ice time/power play/role adjustment

Additional adjustments: back-to-back game penalty (-8%), home/away split (+/-3%).

## API Endpoints

- `GET /api/healthz` — Health check
- `GET /api/sports` — Supported sports
- `GET /api/games?sport=NHL&date=YYYY-MM-DD` — Today's games
- `GET /api/props?sport=NHL&market=points&sportsbook=DraftKings&team=BOS&min_ev=0.02` — Props with EV
- `GET /api/top-ev-picks?sport=NHL&limit=20` — Top EV picks ranked
- `GET /api/player/:playerSlug?sport=NHL` — Player detail + game log
- `POST /api/refresh-data` — Seed/refresh data

## Frontend Pages

1. **Dashboard** (`/`) — Top EV picks (over/under), market-specific sections
2. **Props Explorer** (`/props`) — Filterable/sortable table with sticky filter bar
3. **Player Detail** (`/player/:slug`) — Game log, season stats, today's props

## Data Models

Each prop contains: sport, event_id, game, player, market, line, sportsbook, over/under odds, projection, implied probability, fair probability, EV over/under, confidence score (0-100), matchup notes.

## Future Expansion

The codebase is structured for easy NBA, MLB, NFL expansion:
- Add new sport adapter in `artifacts/api-server/src/services/<sport>/`
- Add seed data and projection logic
- API routes are sport-agnostic (filter by `sport` query param)
- Frontend sport selector already shows NBA as "coming soon"

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned by Replit)
- `PORT` — Server port (auto-assigned per artifact)

## Development

```bash
# Install dependencies
pnpm install

# Push DB schema
pnpm --filter @workspace/db run push

# Seed NHL data
curl -X POST http://localhost/api/refresh-data -d '{"sport":"NHL"}'

# Run dev servers (managed by Replit workflows)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/propedge run dev

# Codegen (after OpenAPI spec changes)
pnpm --filter @workspace/api-spec run codegen
```
