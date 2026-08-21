import { bigint, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const functions = mysqlTable("functions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  runtime: mysqlEnum("runtime", ["javascript", "python"]).notNull(),
  source: text("source").notNull(),
  triggerId: varchar("triggerId", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("functions_user_idx").on(table.userId),
  uniqueIndex("functions_trigger_unique").on(table.triggerId),
  uniqueIndex("functions_user_name_unique").on(table.userId, table.name),
]);

export const invocationStatus = ["success", "error"] as const;

export const invocations = mysqlTable("invocations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  functionId: int("functionId").notNull().references(() => functions.id, { onDelete: "cascade" }),
  provider: mysqlEnum("provider", ["aws", "cloudflare", "gcp"]).notNull(),
  status: mysqlEnum("status", invocationStatus).notNull(),
  durationMs: int("durationMs").notNull(),
  billableUnits: int("billableUnits").notNull(),
  costMicros: int("costMicros").notNull(),
  timestampMs: bigint("timestampMs", { mode: "number" }).notNull(),
}, table => [
  index("invocations_user_idx").on(table.userId),
  index("invocations_function_idx").on(table.functionId),
  index("invocations_timestamp_idx").on(table.timestampMs),
]);

export type FunctionRecord = typeof functions.$inferSelect;
export type InvocationRecord = typeof invocations.$inferSelect;
