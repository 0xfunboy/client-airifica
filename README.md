# client-airifica

`client-airifica` is the web agent runtime bridge used by the Airifica stage UI.

It runs inside ElizaOS, exposes the authenticated HTTP / WebSocket surface consumed by the webapp, and keeps the per-user state required for:

- wallet signature auth
- session bootstrap and history
- user-to-agent chat delivery
- chart and market context routing
- Pacifica builder onboarding
- Pacifica account state, positions, and order execution

## Scope

This repository contains the standalone client package only.

It does not include:

- the Airifica web frontend
- the TTS proxy
- Cloudflare tunnel setup
- ElizaOS itself

## Compatibility contract

The repository is branded as `client-airifica`, but the runtime keeps the current wire contract used by the live webapp:

- HTTP routes stay under `/api/airi3/*`
- environment variable names stay under `AIRI3_*`
- the ElizaOS client key stays `airi3`

That lets the package drop into the existing Airifica stack without forcing a frontend route migration.

The package also exports both naming styles:

- legacy: `Airi3ClientInterface`
- branded alias: `AirificaClientInterface`

## Main capabilities

- create and resume authenticated browser sessions
- verify Solana wallet ownership with signed challenges
- route chat messages into the active Eliza runtime
- expose market context and sorted Pacifica market universe data
- resolve non-Pacifica tickers and contract addresses through external market sources
- prepare, approve, and bind Pacifica builder wallets
- build and submit Pacifica market orders
- fetch account overview, open positions, and close requests
- maintain cached Pacifica context separately from the frontend polling loop

## Runtime surface

Main routes exposed by the client:

- `GET /api/airi3/health`
- `POST /api/auth/challenge`
- `POST /api/auth/verify`
- `POST /api/airi3/session`
- `POST /api/airi3/message`
- `POST /api/airi3/proposal`
- `GET /api/airi3/history`
- `GET /api/airi3/market-context`
- `GET /api/airi3/market-universe`
- `POST /api/airi3/proposals`
- `POST /api/airi3/proposals/:id/approve`
- `POST /api/airi3/pacifica/prepare-agent`
- `POST /api/airi3/pacifica/approve-builder`
- `POST /api/airi3/pacifica/bind-agent`
- `GET /api/airi3/pacifica/status`
- `GET /api/airi3/pacifica/overview`
- `POST /api/airi3/pacifica/positions/close`
- `POST /v1/chat/completions`

## Requirements

- Node `23.3.0`
- `pnpm`
- an ElizaOS runtime with `@elizaos/core`
- Pacifica builder access
- a public app URL for wallet signing prompts

## Local setup

Install dependencies:

```bash
pnpm install
```

Copy the environment template:

```bash
cp .env.example .env
```

Build:

```bash
pnpm build
```

## Documentation

- [docs/architecture.md](docs/architecture.md)
- [docs/configuration.md](docs/configuration.md)
- [docs/pacifica.md](docs/pacifica.md)
- [docs/elizaos-integration.md](docs/elizaos-integration.md)

## Notes

- the package is branded `client-airifica`, but route and env compatibility stay on the `airi3` namespace
- Pacifica account context is refreshed server-side and should not be fetched inline from the frontend prompt path
- the market universe is cached server-side and can be warmed on boot
- market context falls back to DexScreener and GeckoTerminal when an asset is not listed on Pacifica, preserving venue metadata for frontend routing
