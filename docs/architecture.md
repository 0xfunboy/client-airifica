# Architecture

`client-airifica` is the runtime-side boundary between Airifica clients and the ElizaOS agent process.

## Main Blocks

### 1. Auth Boundary

The browser never gets direct privileged access.

Auth flow:

1. `POST /api/auth/challenge`
2. sign challenge with Solana wallet
3. `POST /api/auth/verify`
4. receive scoped session token

Every wallet-scoped route depends on that session token.

### 2. Conversation Runtime

`/api/airi3/message` rebuilds request context, injects wallet-specific state, and forwards the turn to the Airifica message manager.

The message manager handles:

- conversation fast paths
- account-aware fast paths
- action routing for market requests
- proposal derivation
- safe structured fallback behavior

### 3. Market and Execution Layer

The runtime splits execution by venue:

- **Pacifica** for supported perp assets
- **Jupiter-linked spot** for supported Solana spot assets
- **external info-only** for assets with analytics but no supported execution venue

Market metadata is cached horizontally. Account state is cached per wallet.

### 4. Telegram Surface

The runtime also exposes internal Telegram endpoints for:

- chat linking
- live alert delivery
- runtime heartbeat
- positions / history / account panels
- Telegram-native action menus

### 5. Persistence

The package uses the same SQLite runtime database as ElizaOS and stores Airifica-specific tables there for:

- trade ledger
- Telegram links and link codes
- onchain spot snapshots
- analytics counters
- runtime heartbeats
- wallet-specific runtime state

## Isolation Model

Wallet state is injected strictly per wallet instance:

- web requests only receive state for the authenticated wallet
- Telegram requests only receive state for the wallet linked to that chat
- no shared context blob is injected across wallets

This is the core safety boundary for allocation, positions, history, and execution context.

## Request Flow

### Web Chat

1. wallet signs session
2. browser posts `/api/airi3/session`
3. browser posts `/api/airi3/message`
4. runtime injects wallet state from SQLite
5. Eliza generates response and optional trade proposal
6. browser renders response and trade controls

### Pacifica Open

1. proposal is approved
2. runtime validates builder approval, account state, lot size, and collateral
3. bound Pacifica agent wallet signs order
4. trade ledger is updated
5. Telegram and admin analytics can observe the event

### Jupiter Spot

1. frontend or Telegram handoff prepares spot trade
2. wallet signs Jupiter transaction in the browser
3. runtime receives execution notification
4. onchain holdings snapshot and ledger are refreshed
5. updated state becomes available to web, Telegram, and admin surfaces

## Why SQLite

Earlier JSON state was fast to ship, but not production-correct for:

- queryability
- atomic writes
- concurrent updates
- admin analytics
- history reconstruction

SQLite fixes those issues while staying lightweight and local to the runtime.
