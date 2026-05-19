import { config } from "dotenv";
import { PrivyClient } from "@privy-io/node";

config({ path: ".env.local" });

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;

if (!appId || !appSecret) {
  console.error("Missing Privy App ID or Secret in .env.local");
  process.exit(1);
}

const client = new PrivyClient({ appId, appSecret });

async function verify() {
  try {
    const walletAddress = "0xe9f1d28c7136bbb1a57da9852f216b8cb39eb888";
    console.log(`Verifying wallet: ${walletAddress}...`);
    
    const user = await client.users().getByWalletAddress({ address: walletAddress });
    
    console.log("✅ Wallet lookup succeeded!");
    console.log(`User ID: ${user.id}`);
    
    const linkedWallets = user.linked_accounts
      .filter((a: any) => a.type === "wallet" || a.type === "smart_wallet")
      .map((a: any) => a.address?.toLowerCase());
      
    console.log(`Linked Wallets: ${linkedWallets.join(", ")}`);
    
    if (linkedWallets.includes(walletAddress.toLowerCase())) {
      console.log("✅ Backend wallet ownership validation verified successfully.");
    } else {
      console.error("❌ Wallet not found in linked accounts.");
    }
  } catch (err: any) {
    console.error("❌ Verification failed:");
    console.error(err.message);
  }
}

verify();
