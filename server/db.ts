import { and, desc, eq, gte, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { FunctionRecord, functionVersions, functions, InsertUser, invocations, InvocationRecord, tenantBudgets, TenantBudgetRecord, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function listFunctionsForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.select().from(functions).where(eq(functions.userId, userId)).orderBy(desc(functions.updatedAt));
}

export async function getFunctionForUser(userId: number, functionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.select().from(functions).where(eq(functions.id, functionId)).limit(1);
  return result.find(item => item.userId === userId);
}

export async function getFunctionByNameForUser(userId: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.select().from(functions).where(and(eq(functions.userId, userId), eq(functions.name, name))).limit(1);
  return result[0];
}

export async function getFunctionByTriggerId(triggerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.select().from(functions).where(eq(functions.triggerId, triggerId)).limit(1);
  return result[0];
}

export async function createFunction(userId: number, values: Pick<FunctionRecord, "name" | "runtime" | "source" | "triggerId" | "triggerSecret">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(functions).values({ userId, ...values, currentVersion: 1 });
  const functionId = Number(result[0].insertId);
  await db.insert(functionVersions).values({ functionId, version: 1, runtime: values.runtime, source: values.source });
  return getFunctionForUser(userId, functionId);
}

export async function createFunctionVersion(userId: number, functionId: number, values: Pick<FunctionRecord, "runtime" | "source">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const functionRecord = await getFunctionForUser(userId, functionId);
  if (!functionRecord) return undefined;
  const versionRows = await db.select({ latest: max(functionVersions.version) }).from(functionVersions).where(eq(functionVersions.functionId, functionId));
  const nextVersion = (versionRows[0]?.latest ?? 0) + 1;
  await db.insert(functionVersions).values({ functionId, version: nextVersion, ...values });
  await db.update(functions).set({ ...values, currentVersion: nextVersion }).where(eq(functions.id, functionId));
  return getFunctionForUser(userId, functionId);
}

export async function listFunctionVersionsForUser(userId: number, functionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const functionRecord = await getFunctionForUser(userId, functionId);
  if (!functionRecord) return undefined;
  return db.select().from(functionVersions).where(eq(functionVersions.functionId, functionId)).orderBy(desc(functionVersions.version));
}

export async function rollbackFunctionForUser(userId: number, functionId: number, version: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const functionRecord = await getFunctionForUser(userId, functionId);
  if (!functionRecord) return undefined;
  const target = await db.select().from(functionVersions).where(and(eq(functionVersions.functionId, functionId), eq(functionVersions.version, version))).limit(1);
  if (!target[0]) return undefined;
  await db.update(functions).set({ runtime: target[0].runtime, source: target[0].source, currentVersion: target[0].version }).where(eq(functions.id, functionId));
  return getFunctionForUser(userId, functionId);
}

export async function rotateTriggerSecretForUser(userId: number, functionId: number, triggerSecret: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const functionRecord = await getFunctionForUser(userId, functionId);
  if (!functionRecord) return undefined;
  await db.update(functions).set({ triggerSecret }).where(eq(functions.id, functionId));
  return getFunctionForUser(userId, functionId);
}

export async function updateFunctionRateLimitForUser(userId: number, functionId: number, rateLimitPerMinute: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const functionRecord = await getFunctionForUser(userId, functionId);
  if (!functionRecord) return undefined;
  await db.update(functions).set({ rateLimitPerMinute }).where(eq(functions.id, functionId));
  return getFunctionForUser(userId, functionId);
}

export async function createInvocation(record: Omit<InvocationRecord, "id">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(invocations).values(record);
  return { id: Number(result[0].insertId), ...record };
}

export async function listInvocationsForUser(userId: number, limit = 80) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.select({
    id: invocations.id,
    functionId: invocations.functionId,
    functionName: functions.name,
    provider: invocations.provider,
    status: invocations.status,
    durationMs: invocations.durationMs,
    billableUnits: invocations.billableUnits,
    costMicros: invocations.costMicros,
    timestampMs: invocations.timestampMs,
  }).from(invocations).innerJoin(functions, eq(invocations.functionId, functions.id)).where(eq(invocations.userId, userId)).orderBy(desc(invocations.timestampMs)).limit(limit);
}

export async function getOrCreateTenantBudget(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(tenantBudgets).values({ userId }).onDuplicateKeyUpdate({ set: { userId } });
  const result = await db.select().from(tenantBudgets).where(eq(tenantBudgets.userId, userId)).limit(1);
  return result[0]!;
}

export async function updateTenantBudget(userId: number, values: Pick<TenantBudgetRecord, "monthlyLimitMicros" | "alertThresholdPercent" | "webhookUrl">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await getOrCreateTenantBudget(userId);
  await db.update(tenantBudgets).set(values).where(eq(tenantBudgets.userId, userId));
  return getOrCreateTenantBudget(userId);
}

export async function markTenantBudgetAlert(userId: number, period: string, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await getOrCreateTenantBudget(userId);
  await db.update(tenantBudgets).set({ lastAlertPeriod: period, lastAlertStatus: status }).where(eq(tenantBudgets.userId, userId));
}

export async function listUsageForUserSince(userId: number, timestampMs: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.select().from(invocations).where(and(eq(invocations.userId, userId), gte(invocations.timestampMs, timestampMs)));
}
