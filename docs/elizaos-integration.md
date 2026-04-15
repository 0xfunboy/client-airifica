# ElizaOS Integration

This package is meant to run inside an ElizaOS runtime as the Airifica web client.

## Compatibility Contract

The standalone package is named `client-airifica`, but the runtime contract intentionally keeps:

- Eliza client id: `airi3`
- route namespace: `/api/airi3/*`
- env compatibility: `AIRI3_*`

That preserves compatibility with the existing Airifica web stack.

## Files Typically Touched in the Host Runtime

- `agent/package.json`
- `agent/src/index.ts` or dedicated runtime entrypoint
- `packages/core/src/types.ts`
- `characters/<character>.character.json`
- `.env`

## Wiring Steps

### 1. Add the Dependency

Example:

```json
"client-airifica": "workspace:*"
```

### 2. Ensure the Client Enum Exists

The host runtime must expose `airi3` as a valid client id in the Eliza client enum.

### 3. Import and Start the Client

```ts
import { AirificaClientInterface } from "client-airifica";
```

Then register it during runtime bootstrap when `airi3` is enabled in the character.

### 4. Enable It in the Character

```json
{
  "clients": ["airi3"]
}
```

### 5. Configure the Runtime Env

Minimum required:

```env
AIRI3_AUTH_SECRET=
AIRI3_ENCRYPTION_KEY=
AIRI3_PUBLIC_APP_URL=
PACIFICA_BUILDER_CODE=
PACIFICA_API_BASE=https://api.pacifica.fi
AIRI3_PACIFICA_PUBLIC_API_BASE=https://api.pacifica.fi/api/v1
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Recommended:

```env
AIRI3_CORS_ORIGIN=
AIRI3_ADMIN_WALLETS=
AIRI3_TELEGRAM_BOT_USERNAME=
AIRI3_TELEGRAM_INTERNAL_SECRET=
```

## Operational Note

If you migrate the wire contract from `airi3` to `airifica`, that is a broader system migration:

- frontend routes
- frontend client ids
- browser session expectations
- Telegram callbacks
- admin dashboard assumptions

This standalone package intentionally avoids forcing that migration.
