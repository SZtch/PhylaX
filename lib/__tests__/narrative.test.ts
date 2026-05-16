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
  assert(anthropicRoute.includes("short (2–5 sentences)"), "Persona requires short responses");
  assert(anthropicRoute.includes("Action-Oriented"), "Persona is action-oriented");
  assert(anthropicRoute.includes("LOW risk by current scan"), "Uses specific risk scan wording");
  assert(anthropicRoute.includes("wallet signature required"), "Emphasizes wallet signature requirement");
  assert(anthropicRoute.includes("NO generic fillers"), "Explicitly forbids generic fillers");
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
