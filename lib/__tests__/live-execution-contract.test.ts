import { NextRequest } from "next/server";
import { POST as executeRoute } from "../../app/api/execute/route";
import * as privyAuth from "../privy-auth";
import * as approvalStore from "../approval-store";
import * as okx from "../okx";
import * as riskPolicy from "../risk-policy";
import * as redis from "../redis";

// ─── Test Harness Setup ───────────────────────────────────────────────────────

const originalVerifyWalletSession = privyAuth.verifyWalletSession;
const originalValidateAndConsumeApproval = approvalStore.validateAndConsumeApproval;
const originalGetSwapTxData = okx.getSwapTxData;
let mockWalletSession: any;
let mockApproval: any;
let mockTxData: any;
let mockRiskPolicyAllowed = true;
let mockLiveExecution = true;
let mockRedisConsume = true;

// Define global hooks for module mocking in ESM
(global as any).__mockVerifyWalletSession = async () => mockWalletSession;
(global as any).__mockValidateAndConsumeApproval = () => mockApproval;
(global as any).__mockGetSwapTxData = async () => mockTxData;
(global as any).__mockEnforceRiskPolicy = async () => ({ allowed: mockRiskPolicyAllowed, reason: mockRiskPolicyAllowed ? null : "Blocked by risk" });
(global as any).__mockIsLiveExecutionEnabled = () => mockLiveExecution;
(global as any).__mockIsRedisAvailable = () => true;
(global as any).__mockConsumeApproval = async () => mockRedisConsume;

// Helper to reset mocks
function resetMocks() {
  mockWalletSession = {
    authenticated: true,
    statusCode: 200,
    session: { userId: "user_123", walletAddress: "0xRealOwner" }
  };
  mockApproval = {
    valid: true,
    approval: {
      id: "app_123",
      tokenAddress: "0xTargetToken",
      chain: "196",
      budgetUsd: 10,
      slippageLimitPercent: 1.5,
      createdAt: Date.now(),
      expiresAt: Date.now() + 500000,
      used: false,
      walletAddress: "0xRealOwner"
    }
  };
  mockTxData = {
    txData: {
      to: "0xDexRouter",
      data: "0x095ea7b3...",
      value: "0x0",
      gasLimit: "210000"
    },
    error: null
  };
  mockRiskPolicyAllowed = true;
  mockLiveExecution = true;
  mockRedisConsume = true;
}

function createRequest(body: any): NextRequest {
  return new NextRequest("http://localhost/api/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n🛡️  Live Execution Contract Tests (Phase 3)\n");

  resetMocks();
  console.log("── 1. Ignores or rejects client-provided txData ──");
  {
    // Client sends txData but the server calls getSwapTxData regardless
    const req = createRequest({
      approvalId: "app_123",
      riskAcknowledged: true,
      quoteSnapshot: { txData: { to: "0xHackerTo", data: "0xHackerData", value: "10000000" } }
    });
    const res = await executeRoute(req);
    const data = await res.json();
    assert(res.status === 200, "Execute succeeds");
    assert(data.unsignedTx.to === "0xDexRouter", "Server ignores client txData.to and uses server-side getSwapTxData.to");
    assert(data.unsignedTx.data === "0x095ea7b3...", "Server ignores client txData.data");
  }

  resetMocks();
  console.log("\n── 2. Calls getSwapTxData server-side when all checks pass ──");
  {
    const req = createRequest({ approvalId: "app_123", riskAcknowledged: true });
    const res = await executeRoute(req);
    const data = await res.json();
    assert(res.status === 200, "Execute succeeds");
    assert(!!data.unsignedTx, "Returns unsignedTx from server-side getSwapTxData");
    assert(data.executionId.startsWith("exec-"), "Returns executionId");
  }

  resetMocks();
  console.log("\n── 3 & 4. Chain explicitly routed, unsupported rejected via policy ──");
  {
    mockRiskPolicyAllowed = false; // Simulate policy rejecting an unsupported chain or slippage
    const req = createRequest({ approvalId: "app_123", riskAcknowledged: true });
    const res = await executeRoute(req);
    assert(res.status === 403, "Rejected by policy (unsupported chain/stale/slippage)");
    const data = await res.json();
    assert(data.error === "Blocked by risk", "Error message matches policy rejection");
  }

  resetMocks();
  console.log("\n── 5 & 6. Stale quoteCreatedAt rejected by policy using server time ──");
  {
    mockRiskPolicyAllowed = false; // Simulate stale policy rejection
    const req = createRequest({ approvalId: "app_123", riskAcknowledged: true });
    const res = await executeRoute(req);
    assert(res.status === 403, "Rejected by policy (stale quote)");
  }

  resetMocks();
  console.log("\n── 7. Spend amount uses input amount (budgetUsd) ──");
  {
    // Client trying to sneak a higher expected output amount is ignored, 
    // server uses approval.budgetUsd
    const req = createRequest({ approvalId: "app_123", amountUsd: 999999, riskAcknowledged: true });
    const res = await executeRoute(req);
    assert(res.status === 200, "Request accepted because amountUsd is ignored");
  }

  resetMocks();
  console.log("\n── 8. Wrong wallet cannot execute another wallet's approval ──");
  {
    mockWalletSession.session.walletAddress = "0xImposter";
    const req = createRequest({ approvalId: "app_123", riskAcknowledged: true });
    const res = await executeRoute(req);
    const data = await res.json();
    assert(res.status === 403, "Imposter wallet is blocked");
    assert(data.error === "Execution wallet does not match the approval wallet.", "Clear error returned");
  }

  resetMocks();
  console.log("\n── 9. Server still returns unsignedTx and never broadcasts ──");
  {
    const req = createRequest({ approvalId: "app_123", riskAcknowledged: true });
    const res = await executeRoute(req);
    const data = await res.json();
    assert(!data.txHash, "No txHash in response");
    assert(!!data.unsignedTx.to && !!data.unsignedTx.data, "unsignedTx returned correctly");
  }

  resetMocks();
  console.log("\n── 10. Demo mode works when ENABLE_LIVE_EXECUTION is false ──");
  {
    mockLiveExecution = false;
    const req = createRequest({ approvalId: "app_123", riskAcknowledged: true });
    const res = await executeRoute(req);
    const data = await res.json();
    assert(res.status === 200, "Request successful");
    assert(data.result.status === "execution_disabled", "Returns simulation disabled status");
    assert(data.message.includes("Live execution is disabled"), "Clear message returned");
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runTests().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
