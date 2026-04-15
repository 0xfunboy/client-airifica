# Pacifica

`client-airifica` owns the server-side Pacifica execution flow used by the Airifica webapp.

## Supported flows

### 1. Agent wallet preparation

The runtime generates a dedicated agent wallet per user account and stores the private key encrypted at rest.

Purpose:

- isolate execution from the user wallet
- keep the user wallet only on approval / signature boundaries
- allow the runtime to execute approved actions later through the bound agent wallet

### 2. Builder approval

The browser signs `approve_builder_code` for the configured builder code:

- `PACIFICA_BUILDER_CODE`
- `AIRI3_PACIFICA_BUILDER_MAX_FEE_RATE`

The runtime then submits that approval to Pacifica.

### 3. Agent wallet binding

The browser signs `bind_agent_wallet`, then the runtime binds the prepared agent wallet to the user account.

### 4. Account overview

The runtime exposes:

- account equity
- available balance
- withdrawable balance
- open positions
- current market position detail
- maker / taker fee and funding reference data

### 5. Market universe

The runtime maintains a cached universe of Pacifica markets used by the UI for:

- manual token selection
- leverage limits
- lot size handling
- market ordering by volume

### 6. Order creation

Proposal approval routes validate:

- builder approval presence
- beta access status
- available collateral
- leverage bounds
- market lot size
- bound agent wallet state

After validation, the runtime submits Pacifica market orders using the bound agent wallet.

### 7. Position close

The runtime can submit market-close actions against current positions from the Airifica interface.

## Server-side state

The runtime stores the following binding data locally:

- wallet address
- bound agent wallet address
- encrypted agent wallet private key
- builder approval snapshot

This state must persist across restarts if you want users to reconnect without repeating the full Pacifica onboarding flow.

## Operational guidance

- keep market-universe caching separate from account-context caching
- keep account state refresh separate from the main chat request path
- do not treat Pacifica account overview as static metadata
- never send orders if `collateral > available`
- always quantize order size using live market metadata rather than a hardcoded symbol assumption

## User-facing failure states

Important Pacifica failures should be mapped to structured UI states instead of raw API errors, especially:

- missing builder approval
- missing beta access
- account not activated
- insufficient available collateral
- symbol lot size mismatch
