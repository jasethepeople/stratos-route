import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import * as db from "../db";
import { consumeTriggerQuota, verifyTriggerSignature } from "../gatewaySecurity";
import { calculateExecution, selectOptimalProvider } from "../routing";
import { publishInvocation, subscribeToInvocations } from "../telemetry";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb", verify: (req, _res, buffer) => { (req as typeof req & { rawBody?: string }).rawBody = buffer.toString("utf8"); } }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/telemetry/stream", async (req, res) => {
    const context = await createContext({ req, res, info: {} as never });
    if (!context.user) {
      res.status(401).json({ error: "Authentication required for tenant telemetry" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ tenantId: context.user.id, timestampMs: Date.now() })}\n\n`);

    const unsubscribe = subscribeToInvocations(context.user.id, telemetry => {
      res.write(`event: invocation\ndata: ${JSON.stringify(telemetry)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      res.end();
    });
  });
  app.all("/trigger/:triggerId", async (req, res) => {
    try {
      const functionRecord = await db.getFunctionByTriggerId(req.params.triggerId);
      if (!functionRecord) {
        res.status(404).json({ error: "Function trigger not found" });
        return;
      }

      const rateLimit = consumeTriggerQuota(functionRecord.triggerId);
      if (!rateLimit.allowed) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000)).toString());
        res.status(429).json({ error: "Trigger rate limit exceeded", limit: 60, resetAt: rateLimit.resetAt });
        return;
      }

      const rawBody = (req as typeof req & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
      const signatureIsValid = verifyTriggerSignature({
        secret: functionRecord.triggerSecret,
        timestamp: req.get("x-stratos-timestamp") ?? "",
        signature: req.get("x-stratos-signature") ?? "",
        method: req.method,
        path: req.path,
        rawBody,
      });
      if (!signatureIsValid) {
        res.status(401).json({ error: "Invalid or expired trigger signature" });
        return;
      }

      const timestampMs = Date.now();
      const provider = selectOptimalProvider(timestampMs, functionRecord.id);
      const execution = calculateExecution(req.body ? 4 : 0, functionRecord.source.length, provider);
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

      res.setHeader("x-stratos-provider", provider.name);
      res.setHeader("x-stratos-duration-ms", execution.durationMs.toString());
      res.status(200).json({
        ok: true,
        function: functionRecord.name,
        runtime: functionRecord.runtime,
        provider: provider.name,
        executionMs: execution.durationMs,
        timestamp: new Date(timestampMs).toISOString(),
        received: req.body ?? null,
      });
    } catch (error) {
      console.error("[Gateway] Trigger invocation failed", error);
      res.status(500).json({ error: "Gateway invocation failed" });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
