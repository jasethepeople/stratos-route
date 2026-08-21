import { EventEmitter } from "node:events";

export type InvocationTelemetry = {
  id: number;
  timestampMs: number;
  functionName: string;
  provider: string;
  durationMs: number;
  status: "success" | "error";
  billableUnits: number;
};

const telemetryBus = new EventEmitter();
telemetryBus.setMaxListeners(0);

export function publishInvocation(userId: number, telemetry: InvocationTelemetry) {
  telemetryBus.emit(`invocation:${userId}`, telemetry);
}

export function subscribeToInvocations(userId: number, listener: (telemetry: InvocationTelemetry) => void) {
  const channel = `invocation:${userId}`;
  telemetryBus.on(channel, listener);
  return () => telemetryBus.off(channel, listener);
}
