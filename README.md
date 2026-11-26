# Mango Tree — Multi-Institution Academic & Examination Command Center

Multi-tenant institutional administration platform built with React, TypeScript, Vite, Tailwind CSS, and Supabase (PostgreSQL + Auth + Row Level Security).

## Repository Layout

- `frontend/` — React + TypeScript + Vite static web application
- `supabase/migrations/` — Version-controlled PostgreSQL schema, triggers, RPCs, and RLS policies
- `supabase/seed/` — Idempotent platform and initial tenant seed scripts
- `supabase/tests/` — Direct database RLS isolation verification scripts
- `scripts/` — Legacy data transformation and reconciliation utilities

## Local Development

1. Copy `.env.example` to `frontend/.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public keys only; never expose service-role keys).
2. Install dependencies and start the dev server:

    cd frontend
    npm install
    npm run dev

## Render Static Site Configuration

- **Root Directory:** `frontend`
- **Build Command:** `npm ci && npm run build`
- **Publish Directory:** `dist`
- **SPA Rewrite Rule:** `/*` -> `/index.html` (`Rewrite`)

## License

Licensed under the GNU Affero General Public License v3.0 (AGPLv3). See `LICENSE` for details.
