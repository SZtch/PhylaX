import { NextResponse } from "next/server";
import { isLiveExecutionEnabled } from "../../../lib/risk-policy";
import { isRedisAvailable, isKillSwitchActive } from "../../../lib/redis";
import { isDbAvailable } from "../../../lib/db";
import { isMarketStructureAvailable, getHardCapUsd } from "../../../lib/live-execution";

export async function GET(req: Request) {
  const liveExecutionEnabled = isLiveExecutionEnabled();
  
  const dependenciesConfigured = isDbAvailable() && isRedisAvailable() && 
                                !!process.env.PRIVY_APP_SECRET && 
                                !!process.env.OKX_PROJECT_ID;

  let killSwitch = false;
  try { killSwitch = await isKillSwitchActive(); } catch (e) {}

  const coarseStatus = {
    status: killSwitch ? "degraded" : "ok",
    liveExecutionConfigured: liveExecutionEnabled,
    dependenciesConfigured,
  };

  const authHeader = req.headers.get("authorization");
  const isAdmin = process.env.ADMIN_SECRET && authHeader === `Bearer ${process.env.ADMIN_SECRET}`;

  if (!isAdmin) {
    return NextResponse.json(coarseStatus);
  }

  return NextResponse.json({
    ...coarseStatus,
    details: {
      databaseConfigured: isDbAvailable(),
      redisConfigured: isRedisAvailable(),
      privyConfigured: !!process.env.PRIVY_APP_SECRET && !!process.env.NEXT_PUBLIC_PRIVY_APP_ID,
      okxConfigured: !!process.env.OKX_PROJECT_ID,
      approvalSecretConfigured: !!process.env.APPROVAL_SECRET,
      maxTradeUsdHardCapConfigured: getHardCapUsd() > 0,
      marketStructureScriptAvailable: isMarketStructureAvailable(),
      killSwitchActive: killSwitch,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    }
  });
}
