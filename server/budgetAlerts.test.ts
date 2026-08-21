import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getOrCreateTenantBudget: vi.fn(),
  listUsageForUserSince: vi.fn(),
  markTenantBudgetAlert: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

import { maybeDispatchBudgetAlert, normalizeWebhookUrl } from "./budgetAlerts";

describe("budget webhook alerting", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    dbMocks.getOrCreateTenantBudget.mockReset();
    dbMocks.listUsageForUserSince.mockReset();
    dbMocks.markTenantBudgetAlert.mockReset();
  });

  it("delivers a webhook once when tenant spend crosses the threshold", async () => {
    dbMocks.getOrCreateTenantBudget.mockResolvedValue({ webhookUrl: "https://alerts.example.com/stratos", monthlyLimitMicros: 1_000, alertThresholdPercent: 80, lastAlertPeriod: null });
    dbMocks.listUsageForUserSince.mockResolvedValue([{ costMicros: 850 }]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await maybeDispatchBudgetAlert(42);

    expect(result).toEqual({ delivered: true, reason: "delivered" });
    expect(fetchMock).toHaveBeenCalledWith("https://alerts.example.com/stratos", expect.objectContaining({ method: "POST" }));
    expect(dbMocks.markTenantBudgetAlert).toHaveBeenCalledWith(42, expect.any(String), "delivered");
  });

  it("accepts public HTTPS endpoints and rejects private or insecure ones", () => {
    expect(normalizeWebhookUrl("https://alerts.example.com/stratos")).toBe("https://alerts.example.com/stratos");
    expect(() => normalizeWebhookUrl("http://alerts.example.com/stratos")).toThrow();
    expect(() => normalizeWebhookUrl("https://127.0.0.1/hook")).toThrow();
  });
});
