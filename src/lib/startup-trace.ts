const STARTUP_TRACE_ENABLED = (() => {
  const startupRaw = String(import.meta.env.VITE_STARTUP_TRACE ?? "").toLowerCase();
  if (startupRaw === "1" || startupRaw === "true" || startupRaw === "yes") {
    return true;
  }

  const perfRaw = String(import.meta.env.VITE_PERF_TRACE ?? "").toLowerCase();
  return perfRaw === "1" || perfRaw === "true" || perfRaw === "yes";
})();

const startupEpoch = performance.now();
const startupIpcCounts = new Map<string, number>();

type IdleHandle = number;
type IdleWork = () => void;

interface IdleCallbackDeadline {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
}

function hasRequestIdleCallback() {
  return (
    typeof window !== "undefined" &&
    typeof (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback === "function"
  );
}

export function startupTrace(label: string, extra?: string) {
  if (!STARTUP_TRACE_ENABLED) {
    return;
  }

  const elapsedMs = performance.now() - startupEpoch;
  console.debug(`[startup] ${label} +${elapsedMs.toFixed(1)}ms${extra ? ` (${extra})` : ""}`);
}

export function startupTraceDuration(label: string, startedAt: number, extra?: string) {
  if (!STARTUP_TRACE_ENABLED) {
    return;
  }

  const elapsedMs = performance.now() - startedAt;
  console.debug(`[startup] ${label} ${elapsedMs.toFixed(1)}ms${extra ? ` (${extra})` : ""}`);
}

export function recordStartupIpcCall(command: string) {
  const nextCount = (startupIpcCounts.get(command) ?? 0) + 1;
  startupIpcCounts.set(command, nextCount);
  startupTrace(`ipc.${command}.count`, `n=${nextCount}`);
}

export function scheduleIdleWork(task: IdleWork, timeoutMs = 900): () => void {
  if (hasRequestIdleCallback()) {
    const requestIdleCallback = (
      window as Window & {
        requestIdleCallback: (
          callback: (deadline: IdleCallbackDeadline) => void,
          options?: { timeout: number },
        ) => IdleHandle;
      }
    ).requestIdleCallback;
    const cancelIdleCallback = (window as Window & { cancelIdleCallback: (id: IdleHandle) => void })
      .cancelIdleCallback;

    const handle = requestIdleCallback(
      () => {
        task();
      },
      { timeout: timeoutMs },
    );
    return () => cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(task, 120);
  return () => {
    window.clearTimeout(handle);
  };
}
