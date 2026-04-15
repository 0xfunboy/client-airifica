# Configuration

The repository is branded `client-airifica`, but the current runtime contract still uses `AIRI3_*` variables for compatibility with the live Airifica web stack.

## Essential variables

These must be set in every real deployment:

- `AIRI3_AUTH_SECRET`
- `AIRI3_ENCRYPTION_KEY`
- `AIRI3_PUBLIC_APP_URL`
- `PACIFICA_BUILDER_CODE`
- `PACIFICA_API_BASE`
- `AIRI3_PACIFICA_PUBLIC_API_BASE`

In production, set:

- `AIRI3_CORS_ORIGIN`

## Server

- `AIRI3_PORT`
  HTTP and WebSocket port for the client runtime.
- `AIRI3_JSON_LIMIT`
  JSON body size limit for Express.
- `AIRI3_DATA_DIR`
  Optional custom state directory for persistent bindings.
- `AIRI3_CORS_ORIGIN`
  Comma-separated origin allowlist for production browser traffic.
- `AIRI3_PUBLIC_APP_URL`
  Public app URL used in wallet signature challenges and mobile wallet flows.

## Auth

- `AIRI3_AUTH_SECRET`
  Session token signing secret.
- `AIRI3_AUTH_ISSUER`
  JWT issuer label.
- `AIRI3_AUTH_AUDIENCE`
  JWT audience label.
- `AIRI3_AUTH_TOKEN_TTL_MS`
  Session token lifetime.
- `AIRI3_NONCE_TTL_MS`
  Wallet challenge nonce lifetime.
- `AIRI3_ENCRYPTION_KEY`
  32-byte hex key used to encrypt Pacifica agent private keys at rest.

## Message and action timeouts

- `AIRI3_ACTION_VALIDATE_TIMEOUT_MS`
- `AIRI3_ACTION_HANDLER_TIMEOUT_MS`
- `AIRI3_LLM_TIMEOUT_MS`
- `AIRI3_EVALUATION_TIMEOUT_MS`
- `AIRI3_TRADE_PARSER_TIMEOUT_MS`

These values control the async guardrails around validation, action execution, LLM response generation, evaluation, and trade setup parsing.

## Pacifica

- `PACIFICA_BUILDER_CODE`
  Builder code approved by the end user.
- `AIRI3_PACIFICA_BUILDER_MAX_FEE_RATE`
  Max fee rate requested in the builder approval payload.
- `PACIFICA_API_BASE`
  Signed-action base URL.
- `AIRI3_PACIFICA_PUBLIC_API_BASE`
  Public Pacifica market data base URL.
- `AIRI3_PACIFICA_MARKET_LOT_SIZE`
  Legacy fallback lot size if market metadata is unavailable.
- `AIRI3_PACIFICA_MIN_DEPOSIT_USD`
  Minimum deposit hint shown in the UI.
- `AIRI3_DEFAULT_NOTIONAL_USD`
  Default fallback sizing used when a proposal does not carry explicit collateral.
- `AIRI3_PACIFICA_BETA_ACCESS_URL`
  URL shown when Pacifica rejects trading because beta access is not redeemed yet.
- `AUTO_PACIFICA_API_KEY`
  Optional Pacifica API key if your tenant uses one.
- `AUTO_PACIFICA_EXPIRY_MS`
  Expiry window used in signed Pacifica payloads.

## Caches

- `PACIFICA_SYMBOLS_TTL_MS`
  Market universe refresh interval.
- `AIRI3_EXTERNAL_MARKET_CACHE_TTL_MS`
  External ticker / contract-address fallback cache TTL for DexScreener and GeckoTerminal.
- `AIRI3_PACIFICA_CONTEXT_CACHE_MS`
  Live account context refresh interval.
- `AIRI3_PACIFICA_CONTEXT_IDLE_MS`
  Idle eviction window for cached account state.

## Recommended production baseline

- keep `AIRI3_CORS_ORIGIN` explicit
- set `AIRI3_PUBLIC_APP_URL` to the public domain used by the browser
- keep `PACIFICA_API_BASE` and `AIRI3_PACIFICA_PUBLIC_API_BASE` on the official Pacifica endpoints
- never commit populated values for `AIRI3_AUTH_SECRET` or `AIRI3_ENCRYPTION_KEY`
- rotate the encryption key carefully, because existing stored agent wallet bindings depend on it
