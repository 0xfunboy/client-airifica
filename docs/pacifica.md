# Pacifica and Spot Execution

`client-airifica` handles two execution families:

- **Pacifica perps**
- **Jupiter-linked spot**

They share the same user-facing conversation and state layer, but they do not execute the same way.

## Pacifica

### Supported Flow

1. prepare agent wallet
2. approve builder code
3. bind agent wallet
4. fetch live overview
5. approve and submit market order
6. close or manage open position

### Stored Runtime State

The runtime persists:

- user wallet
- agent wallet public key
- encrypted agent wallet private key
- builder approval snapshot
- trade ledger and notifications

### Validation Path

Before order submission the runtime validates:

- builder approval presence
- beta access
- collateral availability
- leverage bounds
- lot size constraints
- bound wallet state

## Jupiter-Linked Spot

Spot execution is tracked under the same wallet-aware state system, but the order itself is signed by the user wallet in the browser.

### Runtime Responsibilities

- identify spot-supported assets
- track onchain wallet holdings
- persist spot ledger entries
- notify Telegram and admin telemetry
- track TP/SL intent and trigger linkage when available

### Important Distinction

For spot:

- the runtime can track execution context and holdings
- the browser wallet signs the swap transaction
- TP/SL arm through separate Jupiter Trigger logic when supported and above minimum trigger size

## Ledger and History

Both Pacifica and Jupiter-linked spot feed the same wallet-scoped trade ledger.

That ledger is then used for:

- conversation context injection
- Telegram history
- admin overview
- latest-trade summaries
- allocation-aware assistant responses

## Failure Handling

Important execution failures should be mapped into structured states, not raw API blobs:

- missing builder approval
- beta access required
- collateral too low
- lot size mismatch
- trigger could not arm
- notification delivery failed
