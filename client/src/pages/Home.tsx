import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { buildSignedRequestSnippet, type SnippetLanguage } from "@/lib/requestSnippets";
import {
  Activity,
  Box,
  Braces,
  Check,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  Code2,
  Copy,
  Cpu,
  Gauge,
  GitBranch,
  Hexagon,
  History,
  KeyRound,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

type Runtime = "javascript" | "python";
type FunctionItem = { id: number; name: string; runtime: Runtime; source: string; triggerId: string; currentVersion?: number; triggerSecret?: string; rateLimitPerMinute?: number };
type LogItem = {
  id: string;
  timestampMs: number;
  functionName: string;
  provider: string;
  durationMs: number;
  status: "success" | "error";
  billableUnits: number;
};

const codeByRuntime: Record<Runtime, string> = {
  javascript: `export default async function handler(request) {
  const region = request.headers?.["x-region"] ?? "orbit";
  return {
    status: 200,
    body: { message: "Telemetry locked", region },
  };
}`,
  python: `def handler(request):
    region = request.get("region", "orbit")
    return {
        "status": 200,
        "body": {"message": "Telemetry locked", "region": region},
    }`,
};

const demoFunctions: FunctionItem[] = [
  { id: -1, name: "telemetry-ingest", runtime: "javascript", source: codeByRuntime.javascript, triggerId: "demo_telemetry", currentVersion: 3, triggerSecret: "demo-signing-secret", rateLimitPerMinute: 60 },
  { id: -2, name: "orbit-health", runtime: "python", source: codeByRuntime.python, triggerId: "demo_orbit", currentVersion: 2, triggerSecret: "demo-signing-secret", rateLimitPerMinute: 120 },
];

const demoProviders = [
  { id: "cloudflare", name: "Cloudflare Workers", latencyMs: 19, costPerMillionMicros: 1450000, healthScore: 99, routeScore: 33.0 },
  { id: "gcp", name: "GCP Cloud Functions", latencyMs: 27, costPerMillionMicros: 1850000, healthScore: 97, routeScore: 44.0 },
  { id: "aws", name: "AWS Lambda", latencyMs: 34, costPerMillionMicros: 2200000, healthScore: 98, routeScore: 54.0 },
];

const demoLogs: LogItem[] = [
  { id: "seed-1", timestampMs: Date.now() - 312, functionName: "telemetry-ingest", provider: "Cloudflare Workers", durationMs: 23, status: "success", billableUnits: 3 },
  { id: "seed-2", timestampMs: Date.now() - 1820, functionName: "orbit-health", provider: "GCP Cloud Functions", durationMs: 34, status: "success", billableUnits: 4 },
  { id: "seed-3", timestampMs: Date.now() - 4088, functionName: "telemetry-ingest", provider: "AWS Lambda", durationMs: 42, status: "success", billableUnits: 5 },
  { id: "seed-4", timestampMs: Date.now() - 7461, functionName: "orbit-health", provider: "Cloudflare Workers", durationMs: 21, status: "success", billableUnits: 3 },
];

const demoTimeline = [
  { label: "MON", invocations: 63, units: 214, costMicros: 3290 },
  { label: "TUE", invocations: 82, units: 270, costMicros: 4105 },
  { label: "WED", invocations: 71, units: 245, costMicros: 3710 },
  { label: "THU", invocations: 119, units: 391, costMicros: 5832 },
  { label: "FRI", invocations: 136, units: 443, costMicros: 6540 },
  { label: "SAT", invocations: 97, units: 320, costMicros: 4724 },
  { label: "SUN", invocations: 142, units: 476, costMicros: 7021 },
];

function formatClock(timestampMs: number) {
  const iso = new Date(timestampMs).toISOString();
  return iso.slice(11, 23);
}

function formatCost(micros: number) {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function ProviderGlyph({ provider }: { provider: string }) {
  const glyph = provider.toLowerCase().includes("cloudflare") ? "CF" : provider.toLowerCase().includes("aws") ? "λ" : "G";
  return <span className="grid h-7 w-7 shrink-0 place-items-center border border-[#F5A623]/35 bg-[#F5A623]/[0.06] text-[10px] font-semibold text-[#F5A623]">{glyph}</span>;
}

function PanelTitle({ children, marker = "SYS" }: { children: React.ReactNode; marker?: string }) {
  return <div className="panel-heading"><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 bg-[#F5A623]" />{children}</span><span className="text-[#F5A623]/60">{marker}</span></div>;
}

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();
  const { data: liveOverview } = trpc.operations.overview.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 4000 });
  const [now, setNow] = useState(() => Date.now());
  const [runtime, setRuntime] = useState<Runtime>("javascript");
  const [functionName, setFunctionName] = useState("telemetry-ingest");
  const [source, setSource] = useState(codeByRuntime.javascript);
  const [activeFunctionId, setActiveFunctionId] = useState<number>(-1);
  const [localLogs, setLocalLogs] = useState<LogItem[]>([]);
  const [showSecret, setShowSecret] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("2.00");
  const [webhookDraft, setWebhookDraft] = useState("");
  const [rateLimitDraft, setRateLimitDraft] = useState("60");
  const [snippetLanguage, setSnippetLanguage] = useState<SnippetLanguage>("javascript");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const stream = new EventSource("/api/telemetry/stream");
    const onInvocation = (event: MessageEvent<string>) => {
      const telemetry = JSON.parse(event.data) as LogItem;
      setLocalLogs(current => [{ ...telemetry, id: `stream-${telemetry.id}` }, ...current.filter(item => item.id !== `stream-${telemetry.id}`)].slice(0, 12));
      utils.operations.overview.invalidate();
    };
    stream.addEventListener("invocation", onInvocation);
    return () => {
      stream.removeEventListener("invocation", onInvocation);
      stream.close();
    };
  }, [isAuthenticated, utils]);

  const deployFunction = trpc.functions.deploy.useMutation({
    onSuccess: deployed => {
      toast.success(`Function ${deployed.name} deployed`, { description: "HTTP trigger is armed and routing is active." });
      setActiveFunctionId(deployed.id);
      utils.functions.list.invalidate();
      utils.operations.overview.invalidate();
    },
    onError: error => toast.error("Deployment rejected", { description: error.message }),
  });

  const invokeFunction = trpc.gateway.invoke.useMutation({
    onSuccess: result => {
      setLocalLogs(current => [{
        id: `live-${result.invocation.id}`,
        timestampMs: result.invocation.timestampMs,
        functionName: result.functionName,
        provider: result.provider.name,
        durationMs: result.invocation.durationMs,
        status: result.invocation.status as "success" | "error",
        billableUnits: result.invocation.billableUnits,
      }, ...current].slice(0, 12));
      utils.operations.overview.invalidate();
      toast.success("Invocation complete", { description: `${result.provider.name} executed in ${result.invocation.durationMs} ms.` });
    },
    onError: error => toast.error("Invocation failed", { description: error.message }),
  });

  const rollbackFunction = trpc.functions.rollback.useMutation({
    onSuccess: rolledBack => {
      toast.success(`Restored ${rolledBack.name} to v${rolledBack.currentVersion}`, { description: "The selected snapshot is active." });
      utils.operations.overview.invalidate();
      utils.functions.versions.invalidate();
    },
    onError: error => toast.error("Rollback failed", { description: error.message }),
  });

  const rotateSecret = trpc.functions.rotateTriggerSecret.useMutation({
    onSuccess: rotated => {
      toast.success("Trigger secret rotated", { description: "Update external callers with the new credential." });
      setShowSecret(true);
      setActiveFunctionId(rotated.id);
      utils.operations.overview.invalidate();
    },
    onError: error => toast.error("Secret rotation failed", { description: error.message }),
  });

  const updateBudget = trpc.budget.update.useMutation({
    onSuccess: () => {
      toast.success("Tenant budget updated", { description: "Alert telemetry has been recalibrated." });
      utils.operations.overview.invalidate();
    },
    onError: error => toast.error("Budget update failed", { description: error.message }),
  });

  const updateRateLimit = trpc.functions.updateRateLimit.useMutation({
    onSuccess: updated => {
      toast.success(`Rate policy updated to ${updated.rateLimitPerMinute} rpm`);
      utils.operations.overview.invalidate();
      setActiveFunctionId(updated.id);
    },
    onError: error => toast.error("Rate policy update failed", { description: error.message }),
  });

  const tenantFunctions = liveOverview?.functions as FunctionItem[] | undefined;
  const functions = tenantFunctions && tenantFunctions.length > 0 ? tenantFunctions : demoFunctions;
  const activeFunction = functions.find(item => item.id === activeFunctionId) ?? functions[0];
  const { data: versionHistory } = trpc.functions.versions.useQuery({ functionId: activeFunction?.id ?? 0 }, { enabled: isAuthenticated && (activeFunction?.id ?? 0) > 0 });
  const providers = liveOverview?.providers ?? demoProviders;
  const remoteLogs: LogItem[] = (liveOverview?.invocations ?? []).map(record => ({ ...record, id: `db-${record.id}`, status: record.status as "success" | "error" }));
  const logs = [...localLogs, ...(remoteLogs.length ? remoteLogs : demoLogs)].slice(0, 7);
  const timeline = liveOverview?.timeline?.map(day => ({ ...day, label: day.label.toUpperCase() })) ?? demoTimeline;
  const metrics = liveOverview?.metrics ?? { totalInvocations: 710, totalUnits: 2359, totalCostMicros: 35222, averageLatency: 29 };
  const budget = liveOverview?.budget ?? { monthlyLimitMicros: 2_000_000, alertThresholdPercent: 80, monthlySpendMicros: 35_222, webhookUrl: null, lastAlertStatus: null };
  const budgetPercent = Math.min(100, Math.round((budget.monthlySpendMicros / Math.max(1, budget.monthlyLimitMicros)) * 100));
  const budgetAlert = budgetPercent >= budget.alertThresholdPercent;
  const triggerUrl = activeFunction ? `${window.location.origin}/trigger/${activeFunction.triggerId}` : "";
  const signingSecret = activeFunction?.triggerSecret ?? "Sign in and select a deployed function";
  const maskedSecret = signingSecret.length > 14 ? `${signingSecret.slice(0, 7)}••••••••${signingSecret.slice(-5)}` : signingSecret;
  const selectedProvider = [...providers].sort((a, b) => a.routeScore - b.routeScore)[0];
  const readiness = loading ? "AUTH SYNC" : isAuthenticated ? "TENANT LINKED" : "SIMULATION MODE";

  useEffect(() => {
    if (liveOverview?.budget?.webhookUrl !== undefined) setWebhookDraft(liveOverview.budget.webhookUrl ?? "");
  }, [liveOverview?.budget?.webhookUrl]);

  const handleRuntimeChange = (next: Runtime) => {
    setRuntime(next);
    setSource(codeByRuntime[next]);
  };

  const handleDeploy = () => {
    if (!isAuthenticated) {
      toast.message("Sign in to persist this deployment", { description: "The control center preview remains available in simulation mode." });
      return;
    }
    deployFunction.mutate({ name: functionName, runtime, source });
  };

  const handleInvoke = () => {
    if (!activeFunction) return;
    if (isAuthenticated && activeFunction.id > 0) {
      invokeFunction.mutate({ triggerId: activeFunction.triggerId, payload: { source: "console", at: now } });
      return;
    }
    const provider = selectedProvider ?? demoProviders[0];
    const durationMs = Math.round(provider.latencyMs + 6);
    setLocalLogs(current => [{ id: `sim-${now}`, timestampMs: now, functionName: activeFunction.name, provider: provider.name, durationMs, status: "success" as const, billableUnits: Math.ceil(durationMs / 10) }, ...current].slice(0, 12));
    toast.success("Simulated trigger accepted", { description: `${provider.name} selected by latency + cost score.` });
  };

  const copyTrigger = async () => {
    await navigator.clipboard.writeText(triggerUrl);
    toast.success("Trigger URL copied");
  };

  const copySigningSecret = async () => {
    await navigator.clipboard.writeText(signingSecret);
    toast.success("Signing secret copied", { description: "Treat this value as a credential." });
  };

  const selectFunction = (item: FunctionItem) => {
    setActiveFunctionId(item.id);
    setFunctionName(item.name);
    setRuntime(item.runtime);
    setSource(item.source);
    setShowSecret(false);
    setRateLimitDraft(String(item.rateLimitPerMinute ?? 60));
  };

  const saveBudget = () => {
    const monthlyLimitMicros = Math.round(Number(budgetDraft) * 1_000_000);
    if (!Number.isFinite(monthlyLimitMicros) || monthlyLimitMicros < 10_000) {
      toast.error("Enter a budget of at least $0.01");
      return;
    }
    updateBudget.mutate({ monthlyLimitMicros, alertThresholdPercent: budget.alertThresholdPercent, webhookUrl: webhookDraft.trim() });
  };

  const saveRatePolicy = () => {
    const rateLimitPerMinute = Number(rateLimitDraft);
    if (!activeFunction || activeFunction.id <= 0 || !Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1) {
      toast.error("Set an integer policy of at least 1 request per minute");
      return;
    }
    updateRateLimit.mutate({ functionId: activeFunction.id, rateLimitPerMinute });
  };

  const requestSnippet = buildSignedRequestSnippet({ language: snippetLanguage, triggerUrl, triggerId: activeFunction?.triggerId ?? "fn_example", signingSecret });

  const copyRequestSnippet = async () => {
    await navigator.clipboard.writeText(requestSnippet);
    toast.success(`${snippetLanguage === "javascript" ? "JavaScript" : "Python"} request snippet copied`);
  };

  return (
    <div className="command-surface">
      <header className="border-b border-[#F5A623]/20 bg-[#1C1F26]/90 px-4 backdrop-blur-xl lg:px-7">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 place-items-center border border-[#F5A623] bg-[#F5A623] text-[#1C1F26]"><Hexagon className="h-5 w-5 fill-current" /></div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-[0.12em] text-[#F5A623]">STRATOS / ROUTE</div>
              <div className="mt-0.5 text-[8px] tracking-[0.18em] text-[#838B9A]">MULTI-CLOUD FUNCTION CONTROL</div>
            </div>
            <div className="ml-3 hidden items-center gap-2 border-l border-white/10 pl-4 text-[9px] text-[#838B9A] md:flex"><Radio className="h-3 w-3 text-[#F5A623]" /> ORBITAL MESH <span className="text-[#F5A623]">ONLINE</span></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 border border-[#F5A623]/25 px-2.5 py-1.5 text-[9px] tracking-[0.12em] text-[#C9CED8] sm:flex"><span className="live-pulse status-dot h-1.5 w-1.5 rounded-full bg-[#F5A623]" />{readiness}</div>
            {isAuthenticated ? <Button variant="outline" onClick={logout} className="h-8 border-[#F5A623]/35 bg-transparent px-3 text-[10px] text-[#F5A623] hover:bg-[#F5A623] hover:text-[#1C1F26]">{user?.name?.split(" ")[0] ?? "OPERATOR"} / EXIT</Button> : <Button onClick={() => startLogin()} className="h-8 bg-[#F5A623] px-3 text-[10px] font-semibold text-[#1C1F26] hover:bg-[#ffc45b]">IDENTIFY OPERATOR</Button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-5 lg:px-7">
        <div className="mb-5 flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
          <div>
            <div className="fine-label mb-1">Routing control // sector 01</div>
            <h1 className="m-0 text-lg font-medium tracking-tight text-[#F4EEE4]">Serverless <span className="text-[#F5A623]">Flight Deck</span></h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[9px] text-[#838B9A]"><span>UTC <span className="ml-1 text-[#F5A623]">{formatClock(now)}</span></span><span>ROUTING MODE <span className="ml-1 text-[#F5A623]">BALANCED / COST × LATENCY</span></span><span>GATEWAY <span className="ml-1 text-[#B7D7BB]">NOMINAL</span></span></div>
        </div>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.72fr)]">
          <div className="panel min-w-0">
            <PanelTitle marker="DEPLOYMENT">Function deployment bay</PanelTitle>
            <div className="grid gap-0 lg:grid-cols-[190px_minmax(0,1fr)]">
              <aside className="border-b border-[#F5A623]/14 p-3 lg:border-b-0 lg:border-r">
                <div className="fine-label mb-3">Deployed functions</div>
                <div className="space-y-1">
                  {functions.map(item => <button key={item.id} onClick={() => selectFunction(item)} className={`flex w-full items-center justify-between border px-2.5 py-2 text-left transition-colors ${activeFunction?.id === item.id ? "border-[#F5A623]/50 bg-[#F5A623]/[0.07] text-[#F5A623]" : "border-transparent text-[#A8B0BE] hover:border-white/10 hover:bg-white/[0.03]"}`}><span className="truncate">{item.name}</span><span className="flex items-center gap-1 text-[8px]"><span>v{item.currentVersion ?? 1}</span><ChevronRight className="h-3 w-3 shrink-0" /></span></button>)}
                </div>
                <div className="mt-4 border-t border-white/10 pt-3"><div className="mb-2 flex items-center justify-between fine-label"><span>Version log</span><History className="h-3 w-3 text-[#F5A623]" /></div>{isAuthenticated && activeFunction && activeFunction.id > 0 ? <div className="space-y-1">{versionHistory?.slice(0, 4).map(version => <div key={version.id} className="flex items-center justify-between border border-white/[0.08] px-2 py-1.5 text-[9px]"><span className={version.version === activeFunction.currentVersion ? "text-[#F5A623]" : "text-[#AEB5C0]"}>v{version.version}{version.version === activeFunction.currentVersion ? " / LIVE" : ""}</span>{version.version !== activeFunction.currentVersion && <button onClick={() => rollbackFunction.mutate({ functionId: activeFunction.id, version: version.version })} disabled={rollbackFunction.isPending} className="text-[#F5A623] hover:text-[#ffc45b] disabled:opacity-40">ROLLBACK</button>}</div>)}</div> : <div className="text-[9px] leading-relaxed text-[#838B9A]">Authenticate to inspect immutable source snapshots and restore a stable version.</div>}</div>
                <div className="mt-4 border-t border-white/10 pt-3 text-[9px] leading-relaxed text-[#838B9A]">Each flight path receives a tenant-isolated trigger. Provider credentials are never required in this simulation.</div>
              </aside>
              <div className="min-w-0 p-3">
                <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_150px]">
                  <label className="block"><span className="fine-label mb-1.5 block">Function identifier</span><Input value={functionName} onChange={event => setFunctionName(event.target.value)} className="h-9 border-[#F5A623]/25 bg-black/20 text-[#F4EEE4] placeholder:text-[#5E6570] focus-visible:ring-[#F5A623]" /></label>
                  <label className="block"><span className="fine-label mb-1.5 block">Runtime</span><select value={runtime} onChange={event => handleRuntimeChange(event.target.value as Runtime)} className="h-9 w-full border border-[#F5A623]/25 bg-[#1C1F26] px-2 text-[#F4EEE4] outline-none focus:border-[#F5A623]"><option value="javascript">JavaScript / 22</option><option value="python">Python / 3.11</option></select></label>
                </div>
                <div className="scanline border border-[#F5A623]/22 bg-[#101217]">
                  <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.025] px-3 py-2"><span className="flex items-center gap-2 text-[9px] text-[#838B9A]"><Code2 className="h-3.5 w-3.5 text-[#F5A623]" />/src/handler.{runtime === "javascript" ? "js" : "py"}</span><span className="text-[9px] text-[#F5A623]/70">EDITABLE</span></div>
                  <Textarea value={source} onChange={event => setSource(event.target.value)} spellCheck={false} className="min-h-[236px] resize-y rounded-none border-0 bg-transparent p-3 font-mono text-[11px] leading-6 text-[#DAD5CA] focus-visible:ring-0" />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-[9px] text-[#838B9A]"><span className="text-[#F5A623]">●</span> STATIC ANALYSIS PASS / SOURCE {source.length.toLocaleString()} B / {isAuthenticated && activeFunction?.name === functionName ? "NEW VERSION ON DEPLOY" : "NEW FUNCTION"}</div><Button onClick={handleDeploy} disabled={deployFunction.isPending} className="h-9 bg-[#F5A623] px-4 text-[10px] font-semibold text-[#1C1F26] hover:bg-[#ffc45b] disabled:opacity-60"><Zap className="mr-1.5 h-3.5 w-3.5" />{deployFunction.isPending ? "ARMING..." : "DEPLOY FUNCTION"}</Button></div>
              </div>
            </div>
          </div>

          <div className="panel">
            <PanelTitle marker="HEALTH">Provider health array</PanelTitle>
            <div className="space-y-0 divide-y divide-white/[0.07] px-3 py-1">
              {providers.map(provider => <div key={provider.id} className="py-3"><div className="flex items-center gap-2"><ProviderGlyph provider={provider.name} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-[11px] text-[#E8E3D9]">{provider.name}</span><span className={`text-[9px] ${provider.id === selectedProvider?.id ? "text-[#F5A623]" : "text-[#9DA7B5]"}`}>{provider.id === selectedProvider?.id ? "ROUTE LEAD" : "STANDBY"}</span></div><div className="mt-1.5 flex items-center gap-3 text-[9px] text-[#838B9A]"><span>LAT <b className="font-medium text-[#C9CED8]">{provider.latencyMs} ms</b></span><span>UNIT <b className="font-medium text-[#C9CED8]">{formatCost(provider.costPerMillionMicros)}</b></span></div></div></div><div className="mt-2 flex items-center gap-2"><span className="w-8 text-[8px] text-[#838B9A]">HLTH</span><div className="h-1 flex-1 bg-white/[0.07]"><div className="metric-spark h-full" style={{ "--meter": `${provider.healthScore}%` } as React.CSSProperties} /></div><span className="w-6 text-right text-[9px] text-[#F5A623]">{provider.healthScore}</span></div></div>)}
            </div>
            <div className="m-3 border border-[#F5A623]/20 bg-[#F5A623]/[0.045] p-3 text-[9px] leading-relaxed text-[#AEB5C0]"><div className="mb-1 flex items-center gap-2 text-[#F5A623]"><GitBranch className="h-3 w-3" />DECISION VECTOR</div><span className="text-[#E8E3D9]">route score</span> = 0.72 × latency + 13.5 × cost (per million µs). Current lead: <span className="text-[#F5A623]">{selectedProvider?.name ?? "Calculating"}</span>.</div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.72fr)]">
          <div className="panel min-w-0">
            <PanelTitle marker="GATEWAY">API gateway / HTTP trigger</PanelTitle>
            <div className="p-3">
              <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 border border-white/10 bg-black/20 px-3 py-2"><div className="fine-label mb-1">Active trigger / {activeFunction?.name ?? "--"}</div><div className="flex items-center gap-2"><span className="truncate text-[11px] text-[#F5A623]">{triggerUrl}</span><button onClick={copyTrigger} aria-label="Copy trigger URL" className="shrink-0 text-[#838B9A] hover:text-[#F5A623]"><Copy className="h-3.5 w-3.5" /></button></div></div>
                <Button onClick={handleInvoke} disabled={invokeFunction.isPending} className="h-auto min-h-12 bg-[#F5A623] px-5 text-[10px] font-semibold text-[#1C1F26] hover:bg-[#ffc45b]"><Play className="mr-1.5 h-3.5 w-3.5 fill-current" />{invokeFunction.isPending ? "IN FLIGHT" : "INVOKE HTTP"}</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3"><div className="border border-white/[0.08] bg-white/[0.02] p-2.5"><div className="fine-label">Method</div><div className="mt-1 text-[11px] text-[#E8E3D9]">POST / ANY</div></div><div className="border border-white/[0.08] bg-white/[0.02] p-2.5"><div className="fine-label">Selected route</div><div className="mt-1 text-[11px] text-[#F5A623]">{selectedProvider?.name ?? "--"}</div></div><div className="border border-white/[0.08] bg-white/[0.02] p-2.5"><div className="fine-label">Tenant scope</div><div className="mt-1 flex items-center gap-1 text-[11px] text-[#B7D7BB]"><ShieldCheck className="h-3 w-3" />{isAuthenticated ? "AUTHENTICATED" : "PREVIEW"}</div></div></div>
              <div className="mt-2 border border-[#F5A623]/20 bg-[#F5A623]/[0.035] p-2.5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="fine-label flex items-center gap-1"><KeyRound className="h-3 w-3 text-[#F5A623]" /> Signed trigger / HMAC-SHA256</div><div className="flex items-center gap-2 text-[8px] text-[#B7D7BB]"><ShieldCheck className="h-3 w-3" />{activeFunction?.rateLimitPerMinute ?? 60} REQ / MIN</div></div><div className="mt-2 flex items-center gap-2"><span className="min-w-0 flex-1 truncate border border-white/[0.1] bg-black/20 px-2 py-1.5 text-[9px] text-[#F5A623]">{showSecret ? signingSecret : maskedSecret}</span><button onClick={() => setShowSecret(value => !value)} className="border border-[#F5A623]/35 px-2 py-1.5 text-[8px] text-[#F5A623] hover:bg-[#F5A623] hover:text-[#1C1F26]">{showSecret ? "MASK" : "REVEAL"}</button><button onClick={copySigningSecret} className="border border-[#F5A623]/35 px-2 py-1.5 text-[8px] text-[#F5A623] hover:bg-[#F5A623] hover:text-[#1C1F26]">COPY</button>{isAuthenticated && activeFunction && activeFunction.id > 0 && <button onClick={() => rotateSecret.mutate({ functionId: activeFunction.id })} disabled={rotateSecret.isPending} className="border border-[#F5A623]/35 px-2 py-1.5 text-[8px] text-[#F5A623] hover:bg-[#F5A623] hover:text-[#1C1F26]"><RotateCcw className="h-3 w-3" /></button>}</div><div className="mt-2 grid gap-2 border-t border-[#F5A623]/15 pt-2 sm:grid-cols-[1fr_auto]"><div><div className="fine-label mb-1">Function rate policy</div><Input aria-label="Function requests per minute" value={rateLimitDraft} onChange={event => setRateLimitDraft(event.target.value)} className="h-7 border-[#F5A623]/25 bg-black/20 px-2 text-[9px] text-[#F4EEE4]" /></div><Button onClick={saveRatePolicy} disabled={updateRateLimit.isPending || !isAuthenticated || !activeFunction || activeFunction.id <= 0} className="h-7 self-end bg-[#F5A623] px-2 text-[8px] text-[#1C1F26] hover:bg-[#ffc45b]">SET RPM</Button></div><div className="mt-1.5 text-[8px] text-[#838B9A]">Send <span className="text-[#F5A623]">x-stratos-timestamp</span> and <span className="text-[#F5A623]">x-stratos-signature</span>; signatures expire after 5 minutes.</div></div>
            </div>
          </div>

          <div className="panel">
            <PanelTitle marker="ROUTER">Flight computer</PanelTitle>
            <div className="grid grid-cols-3 divide-x divide-white/[0.08] p-3"><div className="px-2 first:pl-0"><div className="fine-label">Candidates</div><div className="mt-1 text-lg text-[#F4EEE4]">03</div></div><div className="px-2"><div className="fine-label">Lead score</div><div className="mt-1 text-lg text-[#F5A623]">{selectedProvider?.routeScore.toFixed(1) ?? "--"}</div></div><div className="px-2 pr-0"><div className="fine-label">Decision</div><div className="mt-1 text-lg text-[#B7D7BB]">LIVE</div></div></div>
            <div className="border-t border-white/[0.08] px-3 py-2 text-[9px] leading-relaxed text-[#838B9A]">All invocations are evaluated independently against live simulated provider telemetry. The provider with the lowest combined score clears the gate.</div>
          </div>
        </section>

        <section className="panel mt-4 min-w-0">
          <PanelTitle marker="CLIENT">Signed request generator</PanelTitle>
          <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="border-b border-[#F5A623]/14 p-3 lg:border-b-0 lg:border-r"><div className="fine-label mb-3">Flight client</div><div className="space-y-1"><button onClick={() => setSnippetLanguage("javascript")} className={`w-full border px-2.5 py-2 text-left text-[10px] ${snippetLanguage === "javascript" ? "border-[#F5A623]/45 bg-[#F5A623]/[0.07] text-[#F5A623]" : "border-transparent text-[#AEB5C0] hover:border-white/10"}`}>JAVASCRIPT / NODE</button><button onClick={() => setSnippetLanguage("python")} className={`w-full border px-2.5 py-2 text-left text-[10px] ${snippetLanguage === "python" ? "border-[#F5A623]/45 bg-[#F5A623]/[0.07] text-[#F5A623]" : "border-transparent text-[#AEB5C0] hover:border-white/10"}`}>PYTHON / REQUESTS</button></div><div className="mt-5 border-t border-white/10 pt-3 text-[9px] leading-relaxed text-[#838B9A]">A timestamped HMAC signature covers the method, trigger path, and raw request body. Paste this snippet into a trusted server environment.</div></div>
            <div className="p-3"><div className="mb-2 flex items-center justify-between"><div className="fine-label">{snippetLanguage === "javascript" ? "JavaScript" : "Python"} / POST invocation</div><Button onClick={copyRequestSnippet} className="h-7 bg-[#F5A623] px-2 text-[8px] text-[#1C1F26] hover:bg-[#ffc45b]"><Copy className="mr-1 h-3 w-3" />COPY SNIPPET</Button></div><pre className="scanline max-h-[310px] overflow-auto border border-[#F5A623]/22 bg-[#101217] p-3 text-[10px] leading-5 text-[#DAD5CA]"><code>{requestSnippet}</code></pre></div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.72fr)]">
          <div className="panel min-w-0">
            <PanelTitle marker="STREAM">Live execution log</PanelTitle>
            <div className="scanline overflow-x-auto"><table className="w-full min-w-[610px] border-collapse text-left"><thead className="border-b border-white/[0.08] bg-black/15 text-[8px] tracking-[0.14em] text-[#838B9A]"><tr><th className="px-3 py-2 font-medium">TIMESTAMP UTC</th><th className="px-3 py-2 font-medium">FUNCTION</th><th className="px-3 py-2 font-medium">ROUTE</th><th className="px-3 py-2 font-medium">DURATION</th><th className="px-3 py-2 font-medium">UNITS</th><th className="px-3 py-2 font-medium">STATUS</th></tr></thead><tbody>{logs.map((log, index) => <tr key={log.id} className="border-b border-white/[0.045] text-[10px] last:border-b-0"><td className="px-3 py-2.5 text-[#F5A623] amber-glow">[{formatClock(log.timestampMs)}]</td><td className="px-3 py-2.5 text-[#D7D3CA]">{log.functionName}</td><td className="px-3 py-2.5 text-[#AEB5C0]">{log.provider}</td><td className="px-3 py-2.5 text-[#F4EEE4]">{log.durationMs} ms</td><td className="px-3 py-2.5 text-[#AEB5C0]">{log.billableUnits}</td><td className="px-3 py-2.5"><span className="inline-flex items-center gap-1 text-[#B7D7BB]"><Check className="h-3 w-3" />{log.status.toUpperCase()}</span></td></tr>)}</tbody></table></div>
            <div className="flex items-center justify-between border-t border-[#F5A623]/13 px-3 py-2 text-[8px] tracking-[0.1em] text-[#838B9A]"><span><span className="live-pulse mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#F5A623]" />{isAuthenticated ? "SSE STREAM ARMED" : "SIMULATION STREAM"}</span><span>PRECISION: ±1 MS</span></div>
          </div>

          <div className="panel min-w-0">
            <PanelTitle marker="METERING">Tenant metering</PanelTitle>
            <div className="grid grid-cols-2 gap-px bg-white/[0.08]"><div className="bg-[#1C1F26] p-3"><div className="fine-label">Invocations</div><div className="mt-1 text-xl text-[#F4EEE4]">{metrics.totalInvocations.toLocaleString()}</div></div><div className="bg-[#1C1F26] p-3"><div className="fine-label">Billable units</div><div className="mt-1 text-xl text-[#F5A623]">{metrics.totalUnits.toLocaleString()}</div></div><div className="bg-[#1C1F26] p-3"><div className="fine-label">Average latency</div><div className="mt-1 text-xl text-[#F4EEE4]">{metrics.averageLatency} <span className="text-[10px] text-[#838B9A]">ms</span></div></div><div className="bg-[#1C1F26] p-3"><div className="fine-label">Accrued cost</div><div className="mt-1 text-xl text-[#F4EEE4]">{formatCost(metrics.totalCostMicros)}</div></div></div>
            <div className="h-[151px] px-1 pt-3"><ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}><defs><linearGradient id="usageGlow" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#F5A623" stopOpacity={0.38} /><stop offset="100%" stopColor="#F5A623" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#838B9A", fontSize: 9, fontFamily: "IBM Plex Mono" }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "#838B9A", fontSize: 9, fontFamily: "IBM Plex Mono" }} /><Tooltip cursor={{ stroke: "rgba(245,166,35,0.35)" }} contentStyle={{ background: "#1C1F26", border: "1px solid rgba(245,166,35,0.3)", color: "#F4EEE4", fontSize: 10 }} formatter={(value: number) => [`${value} units`, "Billable units"]} /><Area type="monotone" dataKey="units" stroke="#F5A623" strokeWidth={1.5} fill="url(#usageGlow)" /></AreaChart></ResponsiveContainer></div>
            <div className="mx-3 border-t border-[#F5A623]/15 py-2.5"><div className="mb-1.5 flex items-center justify-between"><span className="fine-label flex items-center gap-1"><CircleDollarSign className="h-3 w-3 text-[#F5A623]" /> Monthly budget</span><span className={budgetAlert ? "text-[9px] text-[#F5A623]" : "text-[9px] text-[#B7D7BB]"}>{budgetPercent}% / {budget.alertThresholdPercent}% alert</span></div><div className="h-1.5 bg-white/[0.07]"><div className={`h-full ${budgetAlert ? "bg-[#F5A623]" : "bg-[#B7D7BB]"}`} style={{ width: `${budgetPercent}%` }} /></div><div className="mt-2 flex gap-2"><Input aria-label="Monthly tenant budget" value={budgetDraft} onChange={event => setBudgetDraft(event.target.value)} className="h-7 border-[#F5A623]/25 bg-black/20 px-2 text-[9px] text-[#F4EEE4]" /><Button onClick={saveBudget} disabled={updateBudget.isPending || !isAuthenticated} className="h-7 bg-[#F5A623] px-2 text-[8px] text-[#1C1F26] hover:bg-[#ffc45b]">SET BUDGET</Button></div><div className="mt-2"><div className="fine-label mb-1">Alert webhook / HTTPS</div><Input aria-label="Budget alert webhook" value={webhookDraft} onChange={event => setWebhookDraft(event.target.value)} placeholder="https://alerts.example.com/stratos" className="h-7 border-[#F5A623]/25 bg-black/20 px-2 text-[9px] text-[#F4EEE4] placeholder:text-[#606978]" /></div><div className="mt-1.5 text-[8px] text-[#838B9A]">{formatCost(budget.monthlySpendMicros)} of {formatCost(budget.monthlyLimitMicros)} used this UTC month. {budget.lastAlertStatus ? `Latest delivery: ${budget.lastAlertStatus}.` : "Alert sends once when the threshold is crossed each UTC month."}</div></div>
            <div className="flex items-center justify-between px-3 pb-3 text-[8px] tracking-[0.1em] text-[#838B9A]"><span>7-DAY USAGE VECTOR</span><span className="flex items-center gap-1 text-[#F5A623]"><Activity className="h-3 w-3" />RECHARTS / LIVE</span></div>
          </div>
        </section>

        <footer className="flex flex-col justify-between gap-2 border-t border-white/[0.08] py-4 text-[8px] tracking-[0.1em] text-[#606978] sm:flex-row"><span>STRATOS ROUTE CONTROL // MOCK PROVIDER SIMULATION</span><span className="flex items-center gap-1"><Cpu className="h-3 w-3 text-[#F5A623]" /> NO INFRASTRUCTURE IS MANAGED BY THIS PLATFORM</span></footer>
      </main>
    </div>
  );
}
