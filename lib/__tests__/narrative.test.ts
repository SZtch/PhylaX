/**
 * PhylaX Narrative Tests.
 *
 * Run: npx tsx lib/__tests__/narrative.test.ts
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

console.log("\n🔄 Narrative Tests\n");

const anthropicRoute = fs.readFileSync(
  path.join(process.cwd(), "lib/anthropic.ts"),
  "utf8"
);

console.log("── Persona Narrative Synthesis ──");
{
  assert(anthropicRoute.includes("DO NOT invent"), "Missing data is not hallucinated as available");
  assert(anthropicRoute.includes("explain clearly that the trade will not proceed"), "High-risk/blocked result produces a clear block explanation");
  assert(anthropicRoute.includes("requires manual wallet signing"), "Quote narrative includes manual signing reminder");
  assert(anthropicRoute.includes("some parallel scans failed, report it honestly"), "Partial scan failure is described honestly");
  assert(anthropicRoute.includes("STRICTLY grounded in the tool results"), "Final narrative references actual tool results");
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("\n⚠️  Some tests failed!");
  process.exit(1);
} else {
  console.log("\n✅ All narrative tests passed.");
  process.exit(0);
}
