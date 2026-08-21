import { COOKIE_NAME } from "@shared/const";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import * as db from "./db";
import { buildBudgetAlertPreview, maybeDispatchBudgetAlert, normalizeWebhookUrl } from "./budgetAlerts";
import { createTriggerSecret } from "./gatewaySecurity";
import { calculateExecution, getProviderMetrics, selectOptimalProvider } from "./routing";
import { publishInvocation } from "./telemetry";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const deploymentInput = z.object({
  name: z.string().trim().min(3).max(80).regex(/^[a-z][a-z0-9-]*$/, "Use lowercase letters, numbers, and hyphens."),
  runtime: z.enum(["javascript", "python"]),
  source: z.string().trim().min(1).max(20000),
});

function usageTimeline(records: Awaited<ReturnType<typeof db.listInvocationsForUser>>) {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(Date.now() - (6 - offset) * 86_400_000);
    return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString("en-US", { weekday: "short" }), invocations: 0, units: 0, costMicros: 0 };
  });
  const byKey = new Map(days.map(day => [day.key, day]));
  records.forEach(record => {
    const day = byKey.get(new Date(record.timestampMs).toISOString().slice(0, 10));
    if (day) {
      day.invocations += 1;
      day.units += record.billableUnits;
      day.costMicros += record.costMicros;
    }
  });
  return days;
}

function startOfMonthMs() {
  const date = new Date();
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  functions: router({
    list: protectedProcedure.query(({ ctx }) => db.listFunctionsForUser(ctx.user.id)),
    deploy: protectedProcedure.input(deploymentInput).mutation(async ({ ctx, input }) => {
      const existing = await db.getFunctionByNameForUser(ctx.user.id, input.name);
      const functionRecord = existing
        ? await db.createFunctionVersion(ctx.user.id, existing.id, input)
        : await db.createFunction(ctx.user.id, { ...input, triggerId: `fn_${nanoid(14)}`, triggerSecret: createTriggerSecret() });
      if (!functionRecord) throw new Error("Function deployment did not return a record");
      return functionRecord;
    }),
    versions: protectedProcedure.input(z.object({ functionId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const versions = await db.listFunctionVersionsForUser(ctx.user.id, input.functionId);
      if (!versions) throw new Error("Function not found for this tenant");
      return versions;
    }),
    rollback: protectedProcedure.input(z.object({ functionId: z.number().int().positive(), version: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const functionRecord = await db.rollbackFunctionForUser(ctx.user.id, input.functionId, input.version);
      if (!functionRecord) throw new Error("Rollback target not found for this tenant");
      return functionRecord;
    }),
    rotateTriggerSecret: protectedProcedure.input(z.object({ functionId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const functionRecord = await db.rotateTriggerSecretForUser(ctx.user.id, input.functionId, createTriggerSecret());
      if (!functionRecord) throw new Error("Function not found for this tenant");
      return functionRecord;
    }),
    updateRateLimit: protectedProcedure.input(z.object({ functionId: z.number().int().positive(), rateLimitPerMinute: z.number().int().min(1).max(10_000) })).mutation(async ({ ctx, input }) => {
      const functionRecord = await db.updateFunctionRateLimitForUser(ctx.user.id, input.functionId, input.rateLimitPerMinute);
      if (!functionRecord) throw new Error("Function not found for this tenant");
      return functionRecord;
    }),
  }),
  gateway: router({
    // A raw trigger ID is deliberately a capability URL for invocation. Tenant-scoped
    // management data remains exclusively behind protected procedures above and below.
    inspect: publicProcedure.input(z.object({ triggerId: z.string().min(1) })).query(async ({ input }) => {
      const functionRecord = await db.getFunctionByTriggerId(input.triggerId);
      if (!functionRecord) return null;
      return { id: functionRecord.id, name: functionRecord.name, runtime: functionRecord.runtime, triggerId: functionRecord.triggerId };
    }),
    invoke: protectedProcedure.input(z.object({ triggerId: z.string().min(1), payload: z.unknown().optional() })).mutation(async ({ ctx, input }) => {
      const functionRecord = await db.getFunctionByTriggerId(input.triggerId);
      if (!functionRecord || functionRecord.userId !== ctx.user.id) throw new Error("Unknown function trigger for this tenant");
      const timestampMs = Date.now();
      const provider = selectOptimalProvider(timestampMs, functionRecord.id);
      const execution = calculateExecution(input.payload ? 4 : 0, functionRecord.source.length, provider);
      const invocation = await db.createInvocation({
        userId: functionRecord.userId,
        functionId: functionRecord.id,
        provider: provider.id,
        status: "success",
        ...execution,
        timestampMs,
      });
      publishInvocation(functionRecord.userId, {
        id: invocation.id,
        timestampMs,
        functionName: functionRecord.name,
        provider: provider.name,
        durationMs: invocation.durationMs,
        status: invocation.status,
        billableUnits: invocation.billableUnits,
      });
      await maybeDispatchBudgetAlert(functionRecord.userId);
      return { invocation, provider, functionName: functionRecord.name, response: { ok: true, provider: provider.name, runtime: functionRecord.runtime, received: input.payload ?? null } };
    }),
  }),
  operations: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const [functions, invocations, budget, monthlyUsage] = await Promise.all([db.listFunctionsForUser(ctx.user.id), db.listInvocationsForUser(ctx.user.id), db.getOrCreateTenantBudget(ctx.user.id), db.listUsageForUserSince(ctx.user.id, startOfMonthMs())]);
      const totalCostMicros = invocations.reduce((sum, row) => sum + row.costMicros, 0);
      const totalUnits = invocations.reduce((sum, row) => sum + row.billableUnits, 0);
      const averageLatency = invocations.length ? Math.round(invocations.reduce((sum, row) => sum + row.durationMs, 0) / invocations.length) : 0;
      return {
        functions,
        invocations,
        providers: getProviderMetrics(Date.now(), ctx.user.id),
        metrics: { totalInvocations: invocations.length, totalUnits, totalCostMicros, averageLatency },
        budget: {
          ...budget,
          monthlySpendMicros: monthlyUsage.reduce((sum, invocation) => sum + invocation.costMicros, 0),
          alertPreview: buildBudgetAlertPreview(ctx.user.id, budget, monthlyUsage.reduce((sum, invocation) => sum + invocation.costMicros, 0)),
        },
        timeline: usageTimeline(invocations),
      };
    }),
  }),
  budget: router({
    update: protectedProcedure.input(z.object({ monthlyLimitMicros: z.number().int().min(10_000).max(1_000_000_000), alertThresholdPercent: z.number().int().min(1).max(100), webhookUrl: z.string().max(2048) })).mutation(({ ctx, input }) => db.updateTenantBudget(ctx.user.id, { ...input, webhookUrl: normalizeWebhookUrl(input.webhookUrl) })),
  }),
});

export type AppRouter = typeof appRouter;
