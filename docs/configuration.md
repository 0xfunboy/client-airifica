# Configuration

`client-airifica` accepts both `AIRIFICA_*` and `AIRI3_*` names. The live stack still relies on the legacy `AIRI3_*` namespace, so the examples below keep that form.

## Essential Variables

These must be set in any real deployment:

| Variable | Required | Description |
|---|---|---|
| `AIRI3_AUTH_SECRET` | yes | Session signing secret for wallet-auth sessions |
| `AIRI3_ENCRYPTION_KEY` | yes | 32-byte hex key for encrypting Pacifica agent keys |
| `AIRI3_PUBLIC_APP_URL` | yes | Public browser URL used in auth prompts and deep links |
| `PACIFICA_BUILDER_CODE` | yes | Builder code approved by the user |
| `PACIFICA_API_BASE` | yes | Pacifica signed execution API base |
| `AIRI3_PACIFICA_PUBLIC_API_BASE` | yes | Pacifica public market API base |
| `SOLANA_RPC_URL` | strongly recommended | RPC endpoint used for onchain holdings sync |

## Server and Runtime

| Variable | Default | Description |
|---|---|---|
| `AIRI3_PORT` | `4040` | HTTP / WS runtime port |
| `AIRI3_JSON_LIMIT` | `1mb` | Express body limit |
| `AIRI3_DATA_DIR` | empty | Optional data directory override |
| `AIRI3_CORS_ORIGIN` | empty | Explicit allowlist for browser origins |
| `AIRI3_PUBLIC_APP_URL` | empty | Public app URL used in auth and Telegram handoff |

## Auth

| Variable | Default | Description |
|---|---|---|
| `AIRI3_AUTH_SECRET` | — | JWT signing secret |
| `AIRI3_AUTH_ISSUER` | `airifica` | Token issuer |
| `AIRI3_AUTH_AUDIENCE` | `airifica-clients` | Token audience |
| `AIRI3_AUTH_TOKEN_TTL_MS` | `86400000` | Session lifetime |
| `AIRI3_NONCE_TTL_MS` | `300000` | Wallet challenge TTL |
| `AIRI3_ENCRYPTION_KEY` | — | 64 hex chars required for encrypted agent wallet state |

## Timeouts

| Variable | Default | Description |
|---|---|---|
| `AIRI3_ACTION_VALIDATE_TIMEOUT_MS` | `8000` | Action validation guardrail |
| `AIRI3_ACTION_HANDLER_TIMEOUT_MS` | `45000` | Action handler timeout |
| `AIRI3_LLM_TIMEOUT_MS` | `25000` | LLM response timeout |
| `AIRI3_EVALUATION_TIMEOUT_MS` | `5000` | Evaluation timeout |
| `AIRI3_TRADE_PARSER_TIMEOUT_MS` | `15000` | Trade parser timeout |

## Pacifica

| Variable | Default | Description |
|---|---|---|
| `PACIFICA_BUILDER_CODE` | — | Builder code used during approval |
| `AIRI3_PACIFICA_BUILDER_MAX_FEE_RATE` | `0.001` | Fee rate requested in builder approval |
| `PACIFICA_API_BASE` | `https://api.pacifica.fi` | Pacifica signed-action base |
| `AIRI3_PACIFICA_PUBLIC_API_BASE` | `https://api.pacifica.fi/api/v1` | Public Pacifica data base |
| `AIRI3_PACIFICA_MARKET_LOT_SIZE` | `0.00001` | Fallback lot size when metadata is missing |
| `AIRI3_PACIFICA_MIN_DEPOSIT_USD` | `10` | UX hint for minimum account funding |
| `AIRI3_DEFAULT_NOTIONAL_USD` | `100` | Default fallback notional |
| `AIRI3_PACIFICA_BETA_ACCESS_URL` | `https://app.pacifica.fi/portfolio` | Redeem page shown on beta gate |
| `AUTO_PACIFICA_API_KEY` | empty | Optional tenant key |
| `AUTO_PACIFICA_EXPIRY_MS` | `60000` | Signed payload expiry |

## Cache and Market Metadata

| Variable | Default | Description |
|---|---|---|
| `PACIFICA_SYMBOLS_TTL_MS` | `21600000` | Market universe TTL |
| `AIRI3_EXTERNAL_MARKET_CACHE_TTL_MS` | `30000` | External market metadata fallback TTL |
| `AIRI3_PACIFICA_CONTEXT_CACHE_MS` | `5000` | Live account snapshot refresh interval |
| `AIRI3_PACIFICA_CONTEXT_IDLE_MS` | `120000` | Idle eviction window for account cache |
| `AIRI3_ONCHAIN_PORTFOLIO_SYNC_MS` | `300000` | Onchain holdings sync interval |
| `AIRI3_ONCHAIN_PORTFOLIO_IDLE_MS` | `900000` | Idle eviction window for wallet sync jobs |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | RPC endpoint used for wallet holdings sync |

## Telegram and Linking

| Variable | Default | Description |
|---|---|---|
| `AIRI3_TELEGRAM_BOT_USERNAME` | empty | Bot username used for deep links |
| `AIRI3_TELEGRAM_BOT_TOKEN` | empty | Bot token if the runtime also owns Telegram start-up |
| `AIRI3_TELEGRAM_INTERNAL_SECRET` | empty | Shared secret for internal Telegram callbacks |
| `AIRI3_TELEGRAM_LINK_CODE_TTL_MS` | `600000` | One-click link code TTL |
| `AIRI3_TELEGRAM_HEARTBEAT_STALE_MS` | `120000` | Heartbeat freshness threshold |

## Jupiter / Spot Tracking

| Variable | Default | Description |
|---|---|---|
| `AIRI3_JUPITER_TRIGGER_MIN_ORDER_USD` | `10` | Minimum USD size to arm Trigger TP/SL |

## Admin

| Variable | Default | Description |
|---|---|---|
| `AIRI3_ADMIN_WALLETS` | empty | Comma-separated allowlist for admin wallet addresses |

## Production Baseline

- set `AIRI3_CORS_ORIGIN` explicitly
- use a dedicated `SOLANA_RPC_URL` instead of public shared RPC when possible
- never commit populated secrets
- keep `AIRI3_PUBLIC_APP_URL` aligned with the browser domain used in wallet signing
- rotate `AIRI3_ENCRYPTION_KEY` only with a migration plan, because bound Pacifica wallet material depends on it
