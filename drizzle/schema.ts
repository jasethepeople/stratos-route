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
  triggerSecret: varchar("triggerSecret", { length: 96 }).notNull(),
  currentVersion: int("currentVersion").default(1).notNull(),
  rateLimitPerMinute: int("rateLimitPerMinute").default(60).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("functions_user_idx").on(table.userId),
  uniqueIndex("functions_trigger_unique").on(table.triggerId),
  uniqueIndex("functions_user_name_unique").on(table.userId, table.name),
]);

export const functionVersions = mysqlTable("function_versions", {
  id: int("id").autoincrement().primaryKey(),
  functionId: int("functionId").notNull().references(() => functions.id, { onDelete: "cascade" }),
  version: int("version").notNull(),
  runtime: mysqlEnum("runtime", ["javascript", "python"]).notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("function_versions_function_idx").on(table.functionId),
  uniqueIndex("function_versions_function_version_unique").on(table.functionId, table.version),
]);

export const tenantBudgets = mysqlTable("tenant_budgets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  monthlyLimitMicros: int("monthlyLimitMicros").default(2_000_000).notNull(),
  alertThresholdPercent: int("alertThresholdPercent").default(80).notNull(),
  webhookUrl: varchar("webhookUrl", { length: 2048 }),
  lastAlertPeriod: varchar("lastAlertPeriod", { length: 7 }),
  lastAlertStatus: varchar("lastAlertStatus", { length: 24 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("tenant_budgets_user_unique").on(table.userId)]);

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
export type FunctionVersionRecord = typeof functionVersions.$inferSelect;
export type TenantBudgetRecord = typeof tenantBudgets.$inferSelect;
