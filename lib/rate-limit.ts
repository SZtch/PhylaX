import { checkRateLimit as redisCheckRateLimit, getRedis } from "./redis";

const inMemoryStore = new Map<string, { count: number; expiresAt: number }>();

export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    return await redisCheckRateLimit(identifier, maxRequests, windowSeconds);
  }

  // In-memory fallback
  const now = Date.now();
  const record = inMemoryStore.get(identifier);

  if (!record || now > record.expiresAt) {
    inMemoryStore.set(identifier, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return true;
  }

  record.count++;
  if (record.count > maxRequests) {
    return false;
  }

  return true;
}
