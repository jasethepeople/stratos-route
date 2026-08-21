import type { TenantBudgetRecord } from "../drizzle/schema";
import * as db from "./db";

const ALERT_TIMEOUT_MS = 5_000;

export function getBudgetPeriod(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

export function normalizeWebhookUrl(value: string) {
  if (!value) return null;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const prohibited = hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.") || hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("169.254.");
  if (url.protocol !== "https:" || prohibited) throw new Error("Use a public HTTPS webhook URL");
  return url.toString();
}

export async function maybeDispatchBudgetAlert(userId: number) {
  const [budget, monthlyUsage] = await Promise.all([
    db.getOrCreateTenantBudget(userId),
    db.listUsageForUserSince(userId, Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
  ]);
  const monthlySpendMicros = monthlyUsage.reduce((sum, invocation) => sum + invocation.costMicros, 0);
  const percent = Math.floor((monthlySpendMicros / Math.max(1, budget.monthlyLimitMicros)) * 100);
  const period = getBudgetPeriod();
  if (!budget.webhookUrl || percent < budget.alertThresholdPercent || budget.lastAlertPeriod === period) {
    return { delivered: false, reason: "not_due" as const };
  }

  const payload = {
    event: "budget.threshold_crossed",
    tenantId: userId,
    period,
    thresholdPercent: budget.alertThresholdPercent,
    spendMicros: monthlySpendMicros,
    limitMicros: budget.monthlyLimitMicros,
    spendPercent: percent,
    occurredAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(budget.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Stratos-Route-Budget-Alert/1.0" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    const status = response.ok ? "delivered" : `http_${response.status}`;
    await db.markTenantBudgetAlert(userId, period, status);
    return { delivered: response.ok, reason: status };
  } catch {
    await db.markTenantBudgetAlert(userId, period, "delivery_failed");
    return { delivered: false, reason: "delivery_failed" as const };
  }
}

export function buildBudgetAlertPreview(userId: number, budget: TenantBudgetRecord, monthlySpendMicros: number) {
  return {
    event: "budget.threshold_crossed",
    tenantId: userId,
    period: getBudgetPeriod(),
    thresholdPercent: budget.alertThresholdPercent,
    spendMicros: monthlySpendMicros,
    limitMicros: budget.monthlyLimitMicros,
    spendPercent: Math.floor((monthlySpendMicros / Math.max(1, budget.monthlyLimitMicros)) * 100),
  };
}
