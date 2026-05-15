# PhylaX

**Risk intelligence before every on-chain trade.**

> Wallet-gated chat-based natural-language on-chain trading assistant powered by OKX.

---

## How It Works

1. **Connect Wallet** — Privy handles wallet authentication and onboarding
2. **Chat with PhylaX** — Natural-language trading intent
3. **Parse Intent** — Structured intent extraction with clarification
4. **Risk Scan** — OKX Security token scan for honeypots and risk flags
5. **Quote** — Real OKX DEX Aggregator quote with slippage and gas
6. **Explicit Confirmation** — User reviews before proceeding
7. **Wallet Signature** — User-confirmed wallet signature (non-custodial)

---

## Safety Model

- PhylaX never stores private keys
- PhylaX does not execute without user confirmation
- User-confirmed wallet signature required
- Approval IDs are one-time use and expire in 5 minutes
- Mandatory simulation step before any execution
- Budget hard-cap enforced server-side
- `ENABLE_LIVE_EXECUTION=false` prevents transaction broadcast

---

## OKX Skills Used

| Skill | Endpoint |
|---|---|
| `okx-dex-signal` | `GET /api/v5/dex/market/signal-list` |
| `okx-security` | `POST /api/v6/security/token-scan` |
| `okx-dex-swap` | `GET /api/v5/dex/aggregator/quote` |

---

## Setup

```bash
git clone <repo>
cd aegisx-okx-agent
npm install
cp .env.example .env.local
npm run dev
```

Open: http://localhost:3000

Get OKX credentials: https://web3.okx.com/onchain-os/dev-portal
Get Privy credentials: https://dashboard.privy.io

---

## Submission

See `docs/submission.md`. Participant ID: `2054917885347762176`.
