# Architecture

`client-airifica` is the server-side bridge between the Airifica webapp and an active ElizaOS runtime.

## Main runtime blocks

### Auth and session boundary

The client exposes a Solana signature challenge flow:

1. `POST /api/auth/challenge`
2. wallet signature in the browser
3. `POST /api/auth/verify`
4. token-backed session access for the web agent

This is the boundary used by chat, history, Pacifica status, and execution routes.

### Message routing

`/api/airi3/message` accepts the browser payload, rebuilds runtime state, then hands the message to the Eliza runtime through the internal message manager.

The message manager is responsible for:

- state composition
- action routing
- market / chart action shaping
- trade proposal extraction
- structured fallback handling

### Pacifica execution layer

The Pacifica layer manages:

- builder approval payloads
- agent wallet preparation
- agent wallet binding
- account overview
- position snapshots
- market order creation
- position closing

The server keeps Pacifica account context independent from the main chat request path so the web client does not need to fetch account state inline with every prompt.

### Market universe cache

The client maintains a cached Pacifica market universe used for:

- ticker selection in the UI
- market metadata lookup
- leverage / lot size / order sizing constraints

This cache can be warmed on boot and refreshed on a longer TTL than account state.

### Local state store

The state store persists the data needed to reconnect user sessions and Pacifica bindings without forcing a full re-onboarding flow every time:

- approved builder state
- bound agent wallet address
- encrypted agent wallet private key material

## Request flow

### Chat

1. browser verifies wallet and creates a session
2. browser posts `/api/airi3/session`
3. browser posts `/api/airi3/message`
4. client rebuilds runtime state
5. ElizaOS generates a response
6. response and optional proposal payload return to the webapp

### Pacifica onboarding

1. browser requests `prepare-agent`
2. client creates a dedicated agent wallet
3. browser signs `approve_builder_code`
4. browser signs `bind_agent_wallet`
5. client stores the encrypted binding
6. overview and position routes become available for the bound account

### Trade execution

1. browser submits a proposal approval request
2. client validates account state, collateral, leverage, lot size, and builder approval
3. client signs the Pacifica market order with the bound agent wallet
4. Pacifica returns execution status

## Compatibility note

The repository name is `client-airifica`, but the live Airifica stack still depends on:

- `AIRI3_*` environment variables
- `/api/airi3/*` route names
- ElizaOS client key `airi3`

Those names are preserved intentionally so the package can replace the previous runtime without requiring a frontend route migration.
