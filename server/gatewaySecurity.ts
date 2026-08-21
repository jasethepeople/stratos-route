import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SIGNATURE_TTL_MS = 5 * 60_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function createTriggerSecret() {
  return randomBytes(32).toString("base64url");
}

export function signTriggerRequest(secret: string, timestamp: string, method: string, path: string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}\n${method.toUpperCase()}\n${path}\n${rawBody}`).digest("hex");
}

export function verifyTriggerSignature(options: { secret: string; timestamp: string; signature: string; method: string; path: string; rawBody: string; now?: number }) {
  const timestampMs = Number(options.timestamp);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > SIGNATURE_TTL_MS || !options.signature) return false;
  const expected = signTriggerRequest(options.secret, options.timestamp, options.method, options.path, options.rawBody);
  const supplied = Buffer.from(options.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
}

export function consumeTriggerQuota(triggerId: string, now = Date.now(), limit = RATE_LIMIT) {
  const current = buckets.get(triggerId);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + RATE_WINDOW_MS } : current;
  bucket.count += 1;
  buckets.set(triggerId, bucket);
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

export const triggerSecurity = { SIGNATURE_TTL_MS, RATE_LIMIT, RATE_WINDOW_MS };
