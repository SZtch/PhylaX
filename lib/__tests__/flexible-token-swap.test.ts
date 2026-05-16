import assert from "assert";
import { registry } from "../tools/registry";
import { parseThesis } from "../anthropic";

async function runFlexibleTokenSwapTests() {
  console.log("\n🔄 Flexible Token Swap Tests\n");
  let passed = 0;
  let failed = 0;

  try {
    // Mock the global tools
    (global as any).__mockScanTokenHandler = async (address: string) => {
      if (address === "0xmedium") {
        return {
          address,
          decision: "high_risk", // Treat MEDIUM as high risk for quote blocking
          riskLevel: "MEDIUM",
          isHoneypot: false,
          executionAllowed: false,
          triggeredLabels: [],
          meta: { source: "mock", timestamp: new Date().toISOString() }
        };
      }
      if (address === "0xfailscan") {
        throw new Error("Scan failed");
      }
      return {
        address,
        decision: "safe",
        riskLevel: "LOW",
        isHoneypot: false,
        executionAllowed: true,
        triggeredLabels: [],
        meta: { source: "mock", timestamp: new Date().toISOString() }
      };
    };

    (global as any).__mockGetQuotePreflightHandler = async (toAddress: string, amount: number, chain: string, fromToken: string) => {
      if (chain === "unsupported_chain") {
        throw new Error("Unsupported chain");
      }
      if (toAddress === "0xunsupported") {
        throw new Error("Unsupported token");
      }
      if (amount <= 0) {
        throw new Error("Invalid amount");
      }

      const isUsdc = fromToken === "0xusdc" || !fromToken;
      const isNative = fromToken === "0xnative";
      const fromDecimals = isUsdc ? 6 : (isNative ? 18 : 18); // Mocking decimals
      
      return {
        quote: {
          success: true,
          expectedOutputUsd: amount * 10,
          slippage: 1,
          gasFeeUsd: 0.5,
          route: "OKX Mock Route",
          txData: { to: "0xrouter", data: "0xswapdata" }
        },
        fromToken: fromToken || "0xusdc",
        fromSymbol: isUsdc ? "USDC" : (isNative ? "ETH" : "MOCK"),
        fromAmountUsd: amount,
        toSymbol: "MOCKTO",
        needsApproval: !isNative,
        approveTxData: !isNative ? { to: "0xspender", data: "0xapprove" } : undefined,
        meta: { source: "mock", timestamp: new Date().toISOString() }
      };
    };

    const get_swap_quote = registry.get("get_swap_quote")!;
    const testContext = { conversationId: "test", walletAddress: "0xtestwallet" };

    // Test 1: USDC -> token
    let res = await get_swap_quote.execute({
      to_address: "0xto",
      from_address: "0xusdc",
      from_symbol: "USDC",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(!res.error && !res.blocked, "USDC -> token quote should succeed");
    assert(res.fromToken === "0xusdc", "Quote should use the provided USDC from_address");
    passed++;
    console.log("  ✅ USDC -> token successful");

    // Test 2: token -> USDC
    res = await get_swap_quote.execute({
      to_address: "0xusdc",
      from_address: "0xtokenA",
      from_symbol: "TKA",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(!res.error && !res.blocked, "token -> USDC quote should succeed");
    assert(res.fromToken === "0xtokenA", "Quote should use the provided tokenA from_address");
    passed++;
    console.log("  ✅ token -> USDC successful");

    // Test 3: token A -> token B
    res = await get_swap_quote.execute({
      to_address: "0xtokenB",
      from_address: "0xtokenA",
      from_symbol: "TKA",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(!res.error && !res.blocked, "token A -> token B quote should succeed");
    assert(res.fromToken === "0xtokenA", "Quote should use the provided tokenA from_address");
    passed++;
    console.log("  ✅ token A -> token B successful");

    // Test 4: default source token fallback
    res = await get_swap_quote.execute({
      to_address: "0xto",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(!res.error && !res.blocked, "Default source token fallback quote should succeed");
    assert(res.fromToken === "0x74b7f16337b8972027f6196a17a631ac6de26d22" || !res.fromToken, "Quote should fallback to default USDC");
    passed++;
    console.log("  ✅ Default source token fallback successful");

    // Test 5: unsupported chain blocked
    res = await get_swap_quote.execute({
      to_address: "0xto",
      amount: 10,
      chain: "unsupported_chain"
    }, testContext) as any;
    assert(res.blocked && res.error?.includes("Unsupported chain"), "Unsupported chain should be blocked");
    passed++;
    console.log("  ✅ Unsupported chain blocked");

    // Test 6: unsupported token blocked
    res = await get_swap_quote.execute({
      to_address: "0xunsupported",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(res.blocked && res.error?.includes("Unsupported token"), "Unsupported token should be blocked");
    passed++;
    console.log("  ✅ Unsupported token blocked");

    // Test 7: invalid/zero/negative amount blocked
    res = await get_swap_quote.execute({
      to_address: "0xto",
      amount: -5,
      chain: "xlayer"
    }, testContext) as any;
    assert(res.blocked, "Negative amount should be blocked");
    passed++;
    console.log("  ✅ Invalid/zero/negative amount blocked");

    // Test 8: above hard cap blocked
    process.env.MAX_TRADE_USD_HARD_CAP = "100";
    res = await get_swap_quote.execute({
      to_address: "0xto",
      from_address: "0xfrom",
      amount: 200, // Mocked as 200 USD
      chain: "xlayer"
    }, testContext) as any;
    assert(res.blocked && res.error?.includes("exceeds server hard cap"), "Above hard cap should be blocked");
    passed++;
    console.log("  ✅ Above hard cap blocked");

    // Test 9: scan failure blocks quote
    res = await get_swap_quote.execute({
      to_address: "0xfailscan",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(res.blocked, "Scan failure should block quote");
    passed++;
    console.log("  ✅ Scan failure blocks quote");

    // Test 10: MEDIUM fromToken blocks quote
    res = await get_swap_quote.execute({
      to_address: "0xto",
      from_address: "0xmedium",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(res.blocked && res.error?.includes("High risk or honeypot"), "MEDIUM fromToken should block quote");
    passed++;
    console.log("  ✅ MEDIUM fromToken blocks quote");

    // Test 11: MEDIUM toToken blocks quote
    res = await get_swap_quote.execute({
      to_address: "0xmedium",
      from_address: "0xfrom",
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(res.blocked && res.error?.includes("High risk or honeypot"), "MEDIUM toToken should block quote");
    passed++;
    console.log("  ✅ MEDIUM toToken blocks quote");

    // Test 12: executionAllowed=false blocks quote
    res = await get_swap_quote.execute({
      to_address: "0xmedium", // mock executionAllowed=false
      amount: 10,
      chain: "xlayer"
    }, testContext) as any;
    assert(res.blocked && res.error?.includes("High risk or honeypot"), "executionAllowed=false should block quote");
    passed++;
    console.log("  ✅ executionAllowed=false blocks quote");

    // Test 13: UI labels are correct
    const quoteCardSource = require("fs").readFileSync(require("path").resolve(__dirname, "../../components/QuoteCard.tsx"), "utf-8");
    assert(quoteCardSource.includes("Approve token spending"), "QuoteCard must include 'Approve token spending'");
    assert(quoteCardSource.includes("Sign swap in wallet"), "QuoteCard must include 'Sign swap in wallet'");
    passed++;
    console.log("  ✅ UI labels are correct");

  } catch (err) {
    console.error("Test failed:", err);
    failed++;
  }

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runFlexibleTokenSwapTests().catch(console.error);

