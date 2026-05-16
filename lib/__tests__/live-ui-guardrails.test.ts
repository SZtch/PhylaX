/**
 * PhylaX Live UI Guardrails Tests
 *
 * Run: npx tsx lib/__tests__/live-ui-guardrails.test.ts
 */

import * as fs from "fs";
import * as path from "path";

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

console.log("\n🛡️ Live UI Guardrails Tests\n");

function runTests() {
  const quoteCardSource = fs.readFileSync(path.join(process.cwd(), "components/QuoteCard.tsx"), "utf8");
  const chatPanelSource = fs.readFileSync(path.join(process.cwd(), "components/ChatPanel.tsx"), "utf8");
  const appPageSource = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");
  const riskBadgeSource = fs.readFileSync(path.join(process.cwd(), "components/RiskBadge.tsx"), "utf8");

  console.log("── Live Mode Banner ──");
  assert(appPageSource.includes("LIVE MODE ACTIVE: REAL FUNDS MAY BE USED"), "Live banner text is present in app shell");
  assert(appPageSource.includes("EXECUTION_MODE === \"Live\""), "Live banner is conditional on EXECUTION_MODE === 'Live'");

  console.log("\n── Button Guardrails (QuoteCard) ──");
  // Check disabled condition
  assert(quoteCardSource.includes("disabled={(liveMode && !riskAcknowledged) || isExpired || isHighRisk || !!walletMismatch || execState !== \"idle\"}"), "Sign button disabled for risk limits, expiry, and mismatch");
  assert(quoteCardSource.includes("Sign swap in wallet"), "Button label explicitly says 'Sign swap in wallet'");
  
  // Check risk UI
  assert(quoteCardSource.includes("LOW risk by current scan"), "QuoteCard shows 'LOW risk by current scan' instead of 'Safe'");
  assert(quoteCardSource.includes("isHighRisk = scanDecision && scanDecision !== \"safe\""), "QuoteCard correctly identifies non-safe as high risk");
  
  // Expiry handling
  assert(quoteCardSource.includes("const [isExpired, setIsExpired] = useState(false)"), "QuoteCard has expiry state");
  assert(quoteCardSource.includes("Quote expired, request a new quote"), "QuoteCard shows expiry message");

  // Wallet Mismatch handling
  assert(quoteCardSource.includes("targetWalletAddress.toLowerCase() !== walletAddress.toLowerCase()"), "QuoteCard checks for wallet mismatch");
  assert(quoteCardSource.includes("Mismatch! Connect correct wallet."), "QuoteCard warns on wallet mismatch");

  console.log("\n── ChatPanel & Anthropic integration ──");
  const anthropicSource = fs.readFileSync(path.join(process.cwd(), "lib/anthropic.ts"), "utf8");
  assert(anthropicSource.includes("targetWalletAddress: walletAddress"), "Backend correctly exposes targetWalletAddress to the frontend pipeline");
  assert(chatPanelSource.includes("targetWalletAddress={data.targetWalletAddress}"), "ChatPanel passes targetWalletAddress to QuoteCard");
  assert(chatPanelSource.includes("chainConfig={selectedChain}"), "ChatPanel passes chain configuration to QuoteCard for clear display");

  console.log("\n── Terminology Hardening ──");
  assert(!riskBadgeSource.includes(">Safe<"), "RiskBadge removed 'Safe' terminology in favor of 'LOW Risk'");
  assert(riskBadgeSource.includes("LOW Risk"), "RiskBadge uses 'LOW Risk'");

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error("\n⚠️  Some UI Guardrail tests failed!");
    process.exit(1);
  } else {
    console.log("\n✅ All UI Guardrail tests passed.");
    process.exit(0);
  }
}

runTests();
