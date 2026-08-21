import { COOKIE_NAME } from "@shared/const";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import * as db from "./db";
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
      const functionRecord = await db.createFunction(ctx.user.id, { ...input, triggerId: `fn_${nanoid(14)}` });
      if (!functionRecord) throw new Error("Function deployment did not return a record");
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
    invoke: publicProcedure.input(z.object({ triggerId: z.string().min(1), payload: z.unknown().optional() })).mutation(async ({ input }) => {
      const functionRecord = await db.getFunctionByTriggerId(input.triggerId);
      if (!functionRecord) throw new Error("Unknown function trigger");
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
      return { invocation, provider, functionName: functionRecord.name, response: { ok: true, provider: provider.name, runtime: functionRecord.runtime, received: input.payload ?? null } };
    }),
  }),
  operations: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const [functions, invocations] = await Promise.all([db.listFunctionsForUser(ctx.user.id), db.listInvocationsForUser(ctx.user.id)]);
      const totalCostMicros = invocations.reduce((sum, row) => sum + row.costMicros, 0);
      const totalUnits = invocations.reduce((sum, row) => sum + row.billableUnits, 0);
      const averageLatency = invocations.length ? Math.round(invocations.reduce((sum, row) => sum + row.durationMs, 0) / invocations.length) : 0;
      return {
        functions,
        invocations,
        providers: getProviderMetrics(Date.now(), ctx.user.id),
        metrics: { totalInvocations: invocations.length, totalUnits, totalCostMicros, averageLatency },
        timeline: usageTimeline(invocations),
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
