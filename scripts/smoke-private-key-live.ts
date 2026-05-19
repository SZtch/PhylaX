/**
 * PhylaX Local-Only Private Key Live Transaction Smoke Test
 * 
 * Tests the entire execution firewall and optional live transaction broadcast
 * using a disposable burner wallet loaded from .env.local.
 * 
 * Do NOT use in production. Do NOT commit .env.local. Do NOT use a wallet with significant funds.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createWalletClient, createPublicClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

// 1. Refuse to run in production
if (process.env.NODE_ENV === "production") {
  console.error("❌ ERROR: This script cannot be run in production.");
  process.exit(1);
}

// 2. Load .env.local explicitly
dotenv.config({ path: ".env.local" });

async function runSmokeTest() {
  console.log("🔥 Starting PhylaX Local Smoke Test 🔥\n");

  // 5. Confirm .env.local is gitignored
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    if (!gitignoreContent.includes(".env.local")) {
      console.error("❌ ERROR: .env.local is not in .gitignore. Exiting for safety.");
      process.exit(1);
    }
    console.log("✅ Verified .env.local is gitignored.");
  } else {
    console.warn("⚠️  WARNING: .gitignore not found. Proceed with caution.");
  }

  // 3. Verify TEST_WALLET_PRIVATE_KEY exists and is valid (without printing it)
  const pkStr = process.env.TEST_WALLET_PRIVATE_KEY;
  if (!pkStr) {
    console.error("❌ ERROR: TEST_WALLET_PRIVATE_KEY is missing from .env.local.");
    process.exit(1);
  }

  let account;
  try {
    account = privateKeyToAccount(pkStr.startsWith("0x") ? (pkStr as `0x${string}`) : `0x${pkStr}`);
  } catch (err) {
    console.error("❌ ERROR: TEST_WALLET_PRIVATE_KEY is invalid.");
    process.exit(1);
  }

  // 4. Derive and print only the wallet address
  const walletAddress = account.address;
  console.log(`✅ Loaded burner wallet: ${walletAddress}`);

  // 6. Confirm X Layer RPC is reachable
  const rpcUrl = process.env.RPC_URL_196 || "https://rpc.xlayer.tech";
  
  const xlayer = defineChain({
    id: 196,
    name: 'X Layer',
    network: 'xlayer',
    nativeCurrency: { decimals: 18, name: 'OKB', symbol: 'OKB' },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  });

  const publicClient = createPublicClient({
    chain: xlayer,
    transport: http(rpcUrl),
  });

  let blockNumber;
  try {
    blockNumber = await publicClient.getBlockNumber();
    console.log(`✅ X Layer RPC is reachable. Block: ${blockNumber}`);
  } catch (err) {
    console.error(`❌ ERROR: Could not reach X Layer RPC (${rpcUrl}).`, err);
    process.exit(1);
  }

  // 7. Check OKB gas balance
  const balance = await publicClient.getBalance({ address: walletAddress });
  const balanceOKB = formatEther(balance);
  console.log(`✅ Wallet OKB Balance: ${balanceOKB} OKB`);

  // 8. Build a small test swap
  // We'll test swapping 0.001 OKB to USDC
  // USDC on X Layer: 0x74b7f16337b8972027f6196a17a631ac6de26d22
  const tokenAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22";
  const fromToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // Native OKB
  const fromSymbol = "OKB";
  const amountToSell = 0.001;
  const chainId = "196";

  console.log(`\n── 9. Running PhylaX Safety Sequence ──`);

  const { scanToken, simulateSwap, getSwapTxData, simulateTransaction } = await import("../lib/okx");

  // Step A: Token scan (scanning the token we are buying: USDC)
  console.log(`[A] Scanning token: ${tokenAddress}...`);
  const scanResult = await scanToken(tokenAddress, chainId);
  if (!scanResult.executionAllowed) {
    console.error(`❌ ERROR: Token scan failed. Risk level: ${scanResult.riskLevel}`);
    process.exit(1);
  }
  console.log(`✅ Token scan passed (Risk: ${scanResult.riskLevel})`);

  // Step B: Quote / Preflight
  console.log(`[B] Requesting quote for ${amountToSell} ${fromSymbol} to USDC...`);
  const quoteData = await simulateSwap(tokenAddress, amountToSell, "x-layer", fromToken, fromSymbol);
  console.log(`✅ Quote received: Expected output ~$${quoteData.simulation.expectedOutputUsd}`);

  // Step C: Build Swap Tx Data
  console.log(`[C] Building swap tx data...`);
  const swapData = await getSwapTxData(
    tokenAddress,
    amountToSell,
    chainId,
    walletAddress,
    fromToken,
    1.0 // 1% slippage
  );

  if (swapData.error || !swapData.txData) {
    console.error(`❌ ERROR: Failed to build swap tx data: ${swapData.error}`);
    process.exit(1);
  }
  console.log(`✅ Swap tx data built (To: ${swapData.txData.to})`);

  // Step D: Pre-sign simulation via gateway
  console.log(`[D] Simulating transaction via OKX gateway...`);
  const simResult = await simulateTransaction({
    from: walletAddress,
    to: swapData.txData.to,
    data: swapData.txData.data,
    value: swapData.txData.value,
    chain: "xlayer"
  });

  // 10. If simulation fails, stop
  if (!simResult.ok || simResult.reverted) {
    console.error(`❌ ERROR: Simulation REVERTED!`);
    console.error(`Reason: ${simResult.failReason}`);
    process.exit(1);
  }
  console.log(`✅ Pre-sign simulation passed! (Gas used: ${simResult.gasUsed})`);

  // 11. Live execution check
  if (process.env.ENABLE_LIVE_SMOKE_TX !== "true") {
    console.log(`\n============================================================`);
    console.log(`🟢 DRY RUN PASS 🟢`);
    console.log(`============================================================`);
    console.log(`All safety checks and simulations passed.`);
    console.log(`ENABLE_LIVE_SMOKE_TX is not true, stopping before signing.`);
    process.exit(0);
  }

  // 12. Sign and Broadcast
  console.log(`\n============================================================`);
  console.log(`⚠️  LIVE TRANSACTION EXECUTION ENABLED ⚠️`);
  console.log(`============================================================`);

  const walletClient = createWalletClient({
    account,
    chain: xlayer,
    transport: http(rpcUrl)
  });

  console.log(`Signing and broadcasting transaction...`);
  
  try {
    const txHash = await walletClient.sendTransaction({
      to: swapData.txData.to as `0x${string}`,
      data: swapData.txData.data as `0x${string}`,
      value: BigInt(swapData.txData.value || "0")
    });

    // Print tx hash only
    console.log(`\n🚀 Broadcast Success!`);
    console.log(`Tx Hash: ${txHash}`);

    console.log(`Tracking receipt...`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`Status: ${receipt.status}`);
  } catch (err: any) {
    console.error(`\n❌ ERROR: Transaction broadcast failed!`);
    console.error(err.message || String(err));
    process.exit(1);
  }

  console.log(`\nSmoke test finished. Stopping after one transaction.`);
  process.exit(0);
}

runSmokeTest().catch((err) => {
  console.error("Unhandled error in smoke test:", err);
  process.exit(1);
});
