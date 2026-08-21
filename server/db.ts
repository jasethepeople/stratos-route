import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { FunctionRecord, functions, InsertUser, invocations, InvocationRecord, users } from "../drizzle/schema";
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

export async function getFunctionByTriggerId(triggerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.select().from(functions).where(eq(functions.triggerId, triggerId)).limit(1);
  return result[0];
}

export async function createFunction(userId: number, values: Pick<FunctionRecord, "name" | "runtime" | "source" | "triggerId">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(functions).values({ userId, ...values });
  return getFunctionForUser(userId, Number(result[0].insertId));
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
