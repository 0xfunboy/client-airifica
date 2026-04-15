# ElizaOS integration

This package is designed to run inside ElizaOS as the web agent client used by Airifica.

## Integration model

The current Airifica stack keeps the existing client id and route namespace:

- ElizaOS client key: `airi3`
- HTTP namespace: `/api/airi3/*`
- env prefix: `AIRI3_*`

That is intentional. It lets the package replace the previous runtime without forcing a route or state migration in the webapp.

## Files to update inside ElizaOS

The current integration in the AIR3 monorepo touches these files:

- `agent/package.json`
- `agent/src/index.ts`
- `packages/core/src/types.ts`
- `characters/<your-character>.character.json`
- `.env`

## 1. Add the package dependency

If you vendor this repo inside the ElizaOS workspace, add the package to `agent/package.json`.

Example from the current runtime:

```json
"@elizaos/client-airi3": "workspace:*"
```

If you rename the package import path for your workspace, keep the runtime client id as `airi3` unless you are also migrating the frontend routes and storage keys.

## 2. Register the client enum

In `packages/core/src/types.ts`, make sure the client enum includes:

```ts
export enum Clients {
  ...
  AIRI3 = "airi3",
}
```

This is the selector used in the character file and in `agent/src/index.ts`.

## 3. Import and start the client

In `agent/src/index.ts`, add the client import:

```ts
import { AirificaClientInterface } from "client-airifica";
```

For drop-in compatibility with the existing workspace package, the legacy export is also available:

```ts
import { Airi3ClientInterface } from "@elizaos/client-airi3";
```

Then register the client where ElizaOS starts runtime clients:

```ts
if (clientTypes.includes(Clients.AIRI3)) {
    const airificaClient = await AirificaClientInterface.start(runtime);
    if (airificaClient) clients.airi3 = airificaClient;
}
```

## 4. Enable the client in the character

In the character file, add `airi3` to the `clients` list:

```json
{
  "clients": [
    "twitter",
    "discord",
    "telegram",
    "airi3"
  ]
}
```

The current AIR3 runtime does this in:

- `characters/bairbi.character.json`

## 5. Configure the environment

Minimum required variables in `.env`:

```env
AIRI3_AUTH_SECRET=
AIRI3_ENCRYPTION_KEY=
AIRI3_PUBLIC_APP_URL=
PACIFICA_BUILDER_CODE=
PACIFICA_API_BASE=https://api.pacifica.fi
AIRI3_PACIFICA_PUBLIC_API_BASE=https://api.pacifica.fi/api/v1
```

Recommended production variables:

```env
AIRI3_CORS_ORIGIN=
AIRI3_PACIFICA_BUILDER_MAX_FEE_RATE=0.001
AIRI3_PACIFICA_MIN_DEPOSIT_USD=10
AIRI3_DEFAULT_NOTIONAL_USD=100
```

Use the repository `.env.example` as the canonical reference for the client block.

## 6. Build and run

Inside the package:

```bash
pnpm install
pnpm build
```

Inside ElizaOS:

- ensure the workspace resolves the package
- rebuild the monorepo if needed
- restart the agent process so the new client is registered

## Practical note

If you want to rename the runtime key from `airi3` to `airifica`, that is a broader migration.

You would need to update:

- frontend route names
- frontend client identifiers
- server route paths
- session and state expectations
- ElizaOS client enum and character entries

This repository intentionally keeps the `airi3` runtime contract so it can be adopted without that migration.
