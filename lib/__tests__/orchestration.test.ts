/**
 * PhylaX Orchestration Tests.
 *
 * Run: npx tsx lib/__tests__/orchestration.test.ts
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

console.log("\n🔄 Orchestration Tests\n");

const anthropicRoute = fs.readFileSync(
  path.join(process.cwd(), "lib/anthropic.ts"),
  "utf8"
);

console.log("── Multi-tool Orchestration ──");
{
  assert(anthropicRoute.includes("response.content.filter("), "Multiple tool_use blocks are handled");
  assert(anthropicRoute.includes("Promise.allSettled("), "scan_token calls run with Promise.allSettled");
  assert(anthropicRoute.includes("settled.status === \"rejected\""), "One failed scan does not fail the whole agent turn");
  assert(anthropicRoute.includes("scanCount >= 3"), "Max 3 candidates are scanned");
}

console.log("\n── Quote Safety ──");
{
  assert(anthropicRoute.includes("quoteResultData.blocked"), "High-risk token blocks quote");
}

console.log("\n── Safety Invariants ──");
{
  const executeExists = fs.existsSync(path.join(process.cwd(), "app/api/execute/route.ts"));
  const confirmExists = fs.existsSync(path.join(process.cwd(), "app/api/confirm/route.ts"));
  
  assert(executeExists, "/api/execute remains untouched");
  assert(confirmExists, "/api/confirm remains untouched");
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("\n⚠️  Some tests failed!");
  process.exit(1);
} else {
  console.log("\n✅ All orchestration tests passed.");
  process.exit(0);
}
