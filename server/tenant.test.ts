import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  listFunctionsForUser: vi.fn(),
}));

vi.mock("./db", () => ({
  listFunctionsForUser: dbMocks.listFunctionsForUser,
  createFunction: vi.fn(),
  getFunctionByTriggerId: vi.fn(),
  createInvocation: vi.fn(),
  listInvocationsForUser: vi.fn(),
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

describe("tenant-scoped function procedures", () => {
  beforeEach(() => {
    dbMocks.listFunctionsForUser.mockReset();
  });

  it("only requests functions belonging to the authenticated tenant", async () => {
    dbMocks.listFunctionsForUser.mockResolvedValue([]);
    const caller = appRouter.createCaller(createTenantContext(42));

    await caller.functions.list();

    expect(dbMocks.listFunctionsForUser).toHaveBeenCalledWith(42);
    expect(dbMocks.listFunctionsForUser).not.toHaveBeenCalledWith(7);
  });
});
