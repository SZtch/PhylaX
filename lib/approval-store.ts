import { randomUUID } from "crypto";
import { Approval } from "./schemas";

// Simple in-memory store for demo MVP purposes
// In production, this would be Redis or a database
const store = new Map<string, Approval>();

export function createApproval(
  tokenAddress: string,
  chain: string,
  budgetUsd: number,
  slippageLimitPercent: number
): string {
  const id = randomUUID();
  const approval: Approval = {
    id,
    tokenAddress,
    chain,
    budgetUsd,
    slippageLimitPercent,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes expiration
    used: false
  };
  
  store.set(id, approval);
  return id;
}

export function validateAndConsumeApproval(id: string): { valid: boolean; reason?: string; approval?: Approval } {
  const approval = store.get(id);
  
  if (!approval) {
    return { valid: false, reason: "Approval ID is missing or invalid." };
  }

  if (approval.used) {
    return { valid: false, reason: "Approval ID has already been used." };
  }

  if (Date.now() > approval.expiresAt) {
    return { valid: false, reason: "Approval ID is expired." };
  }

  // Consume the approval
  approval.used = true;
  store.set(id, approval);

  return { valid: true, approval };
}
