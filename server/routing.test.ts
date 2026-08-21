import { describe, expect, it } from "vitest";
import { getProviderMetrics, selectOptimalProvider } from "./routing";

describe("smart routing", () => {
  it("chooses the provider with the lowest combined latency and cost score", () => {
    const now = 1_725_000_000_000;
    const metrics = getProviderMetrics(now, 3);
    const selected = selectOptimalProvider(now, 3);
    const expected = [...metrics].sort((left, right) => left.routeScore - right.routeScore)[0];

    expect(selected.id).toBe(expected?.id);
    expect(selected.routeScore).toBeLessThanOrEqual(Math.max(...metrics.map(metric => metric.routeScore)));
  });

  it("includes both latency and cost measurements for every route candidate", () => {
    for (const metric of getProviderMetrics(1_725_000_000_000, 1)) {
      expect(metric.latencyMs).toBeGreaterThan(0);
      expect(metric.costPerMillionMicros).toBeGreaterThan(0);
      expect(metric.routeScore).toBeGreaterThan(0);
    }
  });
});
