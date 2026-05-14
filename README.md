# AegisX

**Risk-gated KOL signal trading agent for OKX.**

> Natural-language DeFi agent that discovers KOL token signals, filters risky assets, simulates swaps, and executes approved trades through OKX.

---

## Problem

Fully autonomous trading bots are dangerous — they buy into rugs, honeypots, and high-slippage traps without verification. Pure copy-trading bots blindly replicate KOL activity with no risk gating. AegisX solves this by making every step explainable and approval-gated.

---

## How It Works

1. **Thesis** — Natural language input (e.g. "Copy top 5 KOL signals, max $50, skip risky tokens")
2. **Intent Parsing** — Claude API (or fallback parser) extracts budget, chain, risk mode, slippage limit
3. **Signal Discovery** — OKX DEX Signal API finds recent KOL/smart-money token buys
4. **Risk Screening** — OKX Security Token Scan checks every token for honeypots, rugs, low liquidity
5. **Trade Plan** — Table of safe vs. skipped tokens. High-risk tokens are blocked automatically.
6. **Simulation** — OKX DEX Aggregator quote validates slippage and price impact before any spend
7. **Approval Gate** — One-time, expiring approval ID generated only after simulation passes
8. **Execution** — Trade runs only after explicit user click (simulated by default)

---

## OKX Skills Used

| Skill | Integration Method | Endpoint |
|---|---|---|
| `okx-dex-signal` | REST API | `GET /api/v5/dex/market/signal-list` |
| `okx-security` | REST API | `POST /api/v6/security/token-scan` |
| `okx-dex-swap` | REST API | `GET /api/v5/dex/aggregator/quote` |

> Skills are invoked as documented HTTP REST APIs (per each SKILL.md's API fallback spec), not as CLI subprocesses.

---

## Chain Strategy

| Mode | Chain | OKX chainIndex |
|---|---|---|
| Primary | X Layer | 196 |
| Fallback | Base | 8453 |

Switch chains with the `OKX_CHAIN` env var or the UI chain selector.

---

## Local Real-Data Testing

To run against **live OKX APIs** locally:

```bash
cp .env.example .env.local
# Fill in OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, OKX_PROJECT_ID
```

Set:
```
DATA_MODE=real
OKX_NETWORK=testnet
OKX_CHAIN=x-layer
ENABLE_LIVE_EXECUTION=false
```

The app will call real OKX APIs for signals, security scans, and swap quotes.  
If an API call fails, the UI shows a clear **OKX Integration Error** banner — it will **not** silently fall back to demo data.

---

## Production Mainnet Switch

To switch from testnet to mainnet:
```
OKX_NETWORK=mainnet
```

To enable real execution (use with extreme caution):
```
ENABLE_LIVE_EXECUTION=true
```

---

## Demo / Fallback Mode

For demos without API keys:
```
DATA_MODE=fallback
ENABLE_DEMO_FALLBACK=true
```

All data will be clearly labeled **Demo Data** in the UI. Fallback is never used silently when `DATA_MODE=real`.

---

## Safety Model

- No private keys stored or transmitted client-side
- Approval IDs are one-time use and expire in 5 minutes
- Mandatory simulation step before any execution
- Budget hard-cap enforced server-side
- Slippage over limit blocks execution server-side
- High-risk / unscanned tokens cannot be executed
- `ENABLE_LIVE_EXECUTION=false` returns `simulated_execution` regardless of intent

---

## Demo Input

> "Copy top 5 KOL token signals from the last 1 hour, max $50, skip risky tokens, simulate first."

---

## Setup Instructions

```bash
git clone <repo>
cd aegisx-okx-agent
npm install
cp .env.example .env.local
# Edit .env.local with your keys
npm run dev
```

Open: http://localhost:3000

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATA_MODE` | `real` or `fallback` | `fallback` |
| `OKX_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `OKX_CHAIN` | Primary chain | `x-layer` |
| `OKX_API_KEY` | OKX API key | — |
| `OKX_SECRET_KEY` | OKX secret key | — |
| `OKX_PASSPHRASE` | OKX passphrase | — |
| `OKX_PROJECT_ID` | OKX project ID | — |
| `OKX_WALLET_ADDRESS` | Execution wallet | — |
| `ANTHROPIC_API_KEY` | Claude API key (optional) | — |
| `ENABLE_LIVE_EXECUTION` | Allow real trades | `false` |
| `ENABLE_DEMO_FALLBACK` | Enable demo mode | `true` |

Get OKX credentials: https://web3.okx.com/onchain-os/dev-portal

---

## Demo Video

[Placeholder for demo video link]

---

## Submission Notes

See `docs/submission.md`. Participant ID: `2054917885347762176`.
