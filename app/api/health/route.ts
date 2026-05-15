import { NextResponse } from "next/server";
import { isLiveExecutionEnabled } from "../../../lib/risk-policy";
import { isRedisAvailable, isKillSwitchActive } from "../../../lib/redis";
import { isDbAvailable } from "../../../lib/db";
import { isMarketStructureAvailable, getHardCapUsd } from "../../../lib/live-execution";

export async function GET() {
  const liveExecutionEnabled = isLiveExecutionEnabled();
  
  const status = {
    status: "ok",
    liveExecutionEnabled,
    databaseConfigured: isDbAvailable(),
    redisConfigured: isRedisAvailable(),
    privyConfigured: !!process.env.PRIVY_APP_SECRET && !!process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    okxConfigured: !!process.env.OKX_PROJECT_ID,
    approvalSecretConfigured: !!process.env.APPROVAL_SECRET,
    maxTradeUsdHardCapConfigured: getHardCapUsd() > 0,
    marketStructureScriptAvailable: isMarketStructureAvailable(),
    killSwitchActive: await isKillSwitchActive(),
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  };

  return NextResponse.json(status);
}
