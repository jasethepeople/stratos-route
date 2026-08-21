export const PROVIDERS = ["aws", "cloudflare", "gcp"] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export type ProviderMetric = {
  id: ProviderId;
  name: string;
  latencyMs: number;
  costPerMillionMicros: number;
  healthScore: number;
  routeScore: number;
};

const providerBaselines: Record<ProviderId, Omit<ProviderMetric, "latencyMs" | "healthScore" | "routeScore">> = {
  aws: { id: "aws", name: "AWS Lambda", costPerMillionMicros: 2200000 },
  cloudflare: { id: "cloudflare", name: "Cloudflare Workers", costPerMillionMicros: 1450000 },
  gcp: { id: "gcp", name: "GCP Cloud Functions", costPerMillionMicros: 1850000 },
};

const latencyBaselines: Record<ProviderId, number> = {
  aws: 34,
  cloudflare: 19,
  gcp: 27,
};

function signal(now: number, seed: number) {
  return Math.sin(now / 3700 + seed) * 4 + Math.cos(now / 9100 + seed * 2) * 3;
}

/**
 * Produces stable-but-changing provider telemetry. The score deliberately weighs
 * latency and unit cost so a low-latency but expensive route does not always win.
 */
export function getProviderMetrics(now = Date.now(), seed = 0): ProviderMetric[] {
  return PROVIDERS.map((id, index) => {
    const latencyMs = Math.max(8, Math.round(latencyBaselines[id] + signal(now, index + seed)));
    const base = providerBaselines[id];
    const costVariance = Math.round((Math.sin(now / 7000 + index + seed) + 1) * 26000);
    const costPerMillionMicros = base.costPerMillionMicros + costVariance;
    const healthScore = Math.max(82, Math.min(100, Math.round(99 - Math.abs(signal(now, index + seed)) * 1.4)));
    // 1 µUSD is converted to an equivalent routing penalty. Both signals affect every decision.
    const routeScore = Number((latencyMs * 0.72 + (costPerMillionMicros / 1000000) * 13.5).toFixed(2));

    return { ...base, latencyMs, costPerMillionMicros, healthScore, routeScore };
  });
}

export function selectOptimalProvider(now = Date.now(), seed = 0): ProviderMetric {
  return [...getProviderMetrics(now, seed)].sort((left, right) => left.routeScore - right.routeScore)[0]!;
}

export function calculateExecution(durationBase: number, sourceLength: number, provider: ProviderMetric) {
  const computeOverhead = 5 + (sourceLength % 23);
  const durationMs = Math.max(1, Math.round(provider.latencyMs + computeOverhead + durationBase));
  const billableUnits = Math.max(1, Math.ceil(durationMs / 10));
  const costMicros = Math.max(1, Math.ceil((provider.costPerMillionMicros / 1000000) * billableUnits));
  return { durationMs, billableUnits, costMicros };
}
