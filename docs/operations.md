# Operations

## Install

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Recommended Runtime Checks

- `GET /api/airi3/health`
- auth challenge / verify flow
- `GET /api/airi3/market-context`
- `GET /api/airi3/pacifica/overview`
- Telegram internal heartbeat if Telegram is enabled

## Production Notes

- use explicit `AIRI3_CORS_ORIGIN`
- use a stable Solana RPC endpoint for onchain holdings sync
- monitor SQLite file size and disk availability
- keep admin wallet allowlist explicit
- restart the host runtime after env changes affecting auth, Telegram, or execution

## Troubleshooting

### Wallet auth succeeds but admin panel is hidden

- verify the wallet is present in `AIRI3_ADMIN_WALLETS`
- re-sign the session so the runtime reissues an admin-capable token

### Pacifica execution fails

Check:

- builder approval
- beta access
- collateral availability
- lot size / leverage bounds
- encryption key configured

### Telegram link works but alerts do not arrive

Check:

- `AIRI3_TELEGRAM_BOT_USERNAME`
- `AIRI3_TELEGRAM_INTERNAL_SECRET`
- Telegram runtime heartbeat freshness
- the wallet-to-chat link status in SQLite state
