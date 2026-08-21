import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  rollbackFunctionForUser: vi.fn(),
}));

vi.mock("./db", () => ({
  listFunctionsForUser: vi.fn(),
  getFunctionByNameForUser: vi.fn(),
  createFunction: vi.fn(),
  createFunctionVersion: vi.fn(),
  listFunctionVersionsForUser: vi.fn(),
  rollbackFunctionForUser: dbMocks.rollbackFunctionForUser,
  rotateTriggerSecretForUser: vi.fn(),
  getFunctionByTriggerId: vi.fn(),
  createInvocation: vi.fn(),
  listInvocationsForUser: vi.fn(),
  getOrCreateTenantBudget: vi.fn(),
  listUsageForUserSince: vi.fn(),
  updateTenantBudget: vi.fn(),
}));

import { appRouter } from "./routers";

function createTenantContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `tenant-${userId}`,
      name: `Tenant ${userId}`,
      email: `tenant-${userId}@example.com`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("function lifecycle", () => {
  beforeEach(() => dbMocks.rollbackFunctionForUser.mockReset());

  it("passes the authenticated tenant identity when restoring a version", async () => {
    dbMocks.rollbackFunctionForUser.mockResolvedValue({ id: 17, name: "telemetry-ingest", currentVersion: 2 });
    const caller = appRouter.createCaller(createTenantContext(42));

    const result = await caller.functions.rollback({ functionId: 17, version: 2 });

    expect(dbMocks.rollbackFunctionForUser).toHaveBeenCalledWith(42, 17, 2);
    expect(result.currentVersion).toBe(2);
  });
});
