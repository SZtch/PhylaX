# PhylaX Trading Agent

**PhylaX** is a secure, flexible, and fully agentic intent-based DeFi trading assistant built for the **Build X-Agent Hackathon**. 

> [!IMPORTANT]
> **Live Mode Notice**: Live-money execution is currently enabled for **X Layer only**. Support for Base, BSC, and Solana is visible in the UI as "Coming Soon" and is currently disabled for live execution for safety during the initial smoke test phase. PhylaX server never broadcasts transactions; user wallet remains the only signer.

It uses the capabilities of OKX's Web3 ecosystem and XAgent skills to enable users to define high-level trading intents (e.g., "Find the best yield on X Layer" or "Swap 100 USDC to OKB") and have an AI agent autonomously plan, quote, scan for risks, and build execution-ready transactions for their wallet.

## Build X-Agent Hackathon Integration

PhylaX tightly integrates OKX Web3 concepts for intelligent routing, security, and market analysis, translating these capabilities into safe execution via `lib/okx.ts`.

### Runtime Integration Boundary
To ensure deterministic execution and safety, PhylaX establishes a clear runtime boundary:
- **Agent/Development Workflow**: XAgent skills are installed and used for agent/dev/submission workflow.
- **Runtime PhylaX Execution**: Runtime PhylaX uses OKX Onchain/DEX integration through `lib/okx.ts` and `lib/okx-xagent-adapter.ts`. The web application does NOT blindly execute autonomous shell commands in the browser. This guarantees that all quotes, security scans, and transaction generation operations are reproducible, rate-limited, and sandboxed.

### Demo Flow
1. **User Intent**: The user asks PhylaX to execute a trade (e.g., "Swap 50 USDC for OKB on X Layer").
2. **Agent Planning**: PhylaX parses the intent and pulls optimal quotes.
3. **Security Scan**: Every token involved in the trade is proactively scanned for risks.
4. **Allowance Check**: PhylaX checks current spender allowance and, if needed, generates an `Approve token spending` transaction.
5. **Execution Prep**: The user approves the spend, and the agent generates a final, unsigned transaction payload.
6. **User Signature**: The user securely signs the transaction using their embedded or injected wallet. PhylaX *never* signs on behalf of the user.

### Production Safety Features
- **Strict Server-Side Hard Caps**: Global `$MAX_TRADE_USD_HARD_CAP` is enforced server-side, preventing unbounded losses.
- **Atomic Double-Scanning**: Both source (`fromToken`) and destination (`toToken`) tokens are scanned before any quote is generated.
- **Conservative Risk Policy**: User intents are clamped to `conservative` risk modes, with honeypots unconditionally blocked.
- **No-Broadcast Guarantee**: The `/api/execute` endpoint returns only unsigned `txData`. The client wallet is entirely responsible for broadcasting.

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
cd phylax-okx-agent
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
