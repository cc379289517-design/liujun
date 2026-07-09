"use client";

import { useEffect } from "react";

type MetricName = "navigation" | "lcp" | "cls" | "longtask" | "interaction" | "visibility";

type MetricSample = {
  name: MetricName;
  value: number;
  ts: number;
  rating?: "good" | "needs-improvement" | "poor";
  metadata?: Record<string, number | string | boolean>;
};

type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
};

type LargestContentfulPaintEntry = PerformanceEntry & {
  renderTime?: number;
  loadTime?: number;
};

type EventTimingEntry = PerformanceEntry & {
  interactionId?: number;
  processingStart?: number;
  processingEnd?: number;
  duration: number;
};

const SESSION_KEY = "spad_client_metrics_session_id";
const MAX_QUEUE = 60;
const FLUSH_INTERVAL_MS = 30_000;

function enabled() {
  return process.env.NEXT_PUBLIC_CLIENT_METRICS_ENABLED !== "0";
}

function stableSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function currentRole() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return "anonymous";
    const parsed = JSON.parse(raw) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : "unknown";
  } catch {
    return "unknown";
  }
}

function connectionInfo() {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  };
  return {
    effectiveType: nav.connection?.effectiveType,
    downlink: nav.connection?.downlink,
    rtt: nav.connection?.rtt,
    saveData: nav.connection?.saveData,
  };
}

function ratingFor(name: MetricName, value: number): MetricSample["rating"] {
  if (name === "lcp") return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
  if (name === "cls") return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
  if (name === "interaction") return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
  if (name === "longtask") return value <= 100 ? "good" : value <= 250 ? "needs-improvement" : "poor";
  return undefined;
}

export default function ClientPerformanceReporter() {
  useEffect(() => {
    if (!enabled()) return;
    if (typeof PerformanceObserver === "undefined") return;

    const sessionId = stableSessionId();
    const queue: MetricSample[] = [];
    const observers: PerformanceObserver[] = [];
    let clsValue = 0;
    let lastClsSent = 0;
    let lastLcp: MetricSample | null = null;
    let maxInteraction: MetricSample | null = null;
    let visibleSince = performance.now();

    const enqueue = (sample: Omit<MetricSample, "rating"> & { rating?: MetricSample["rating"] }) => {
      queue.push({
        ...sample,
        value: Math.round(sample.value * 10) / 10,
        rating: sample.rating ?? ratingFor(sample.name, sample.value),
      });
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    };

    const flush = (reason: string) => {
      if (lastLcp) {
        queue.push(lastLcp);
        lastLcp = null;
      }
      if (maxInteraction) {
        queue.push(maxInteraction);
        maxInteraction = null;
      }
      if (clsValue !== lastClsSent) {
        lastClsSent = clsValue;
        enqueue({ name: "cls", value: clsValue, ts: Date.now() });
      }
      if (queue.length === 0) return;

      const metrics = queue.splice(0, queue.length);
      const payload = JSON.stringify({
        sessionId,
        path: location.pathname,
        role: currentRole(),
        reason,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        connection: connectionInfo(),
        metrics,
      });

      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon("/api/client-metrics", blob)) return;
      }
      void fetch("/api/client-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    };

    const observe = (type: string, callback: PerformanceObserverCallback) => {
      try {
        const observer = new PerformanceObserver(callback);
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        // Some WebView versions do not support every entry type.
      }
    };

    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      enqueue({
        name: "navigation",
        value: navigation.loadEventEnd || navigation.domContentLoadedEventEnd || performance.now(),
        ts: Date.now(),
        metadata: {
          domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
          transferSize: navigation.transferSize || 0,
        },
      });
    }

    observe("largest-contentful-paint", (list) => {
      const entry = list.getEntries().at(-1) as LargestContentfulPaintEntry | undefined;
      if (!entry) return;
      const value = entry.renderTime || entry.loadTime || entry.startTime;
      lastLcp = { name: "lcp", value, ts: Date.now(), rating: ratingFor("lcp", value) };
    });

    observe("layout-shift", (list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
    });

    observe("longtask", (list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 100) continue;
        enqueue({
          name: "longtask",
          value: entry.duration,
          ts: Date.now(),
          metadata: { startTime: Math.round(entry.startTime) },
        });
      }
    });

    observe("event", (list) => {
      for (const entry of list.getEntries() as EventTimingEntry[]) {
        if (entry.duration < 80) continue;
        const value = entry.duration;
        if (!maxInteraction || value > maxInteraction.value) {
          maxInteraction = {
            name: "interaction",
            value,
            ts: Date.now(),
            rating: ratingFor("interaction", value),
            metadata: {
              event: entry.name,
              interactionId: entry.interactionId || 0,
              processingMs: Math.round((entry.processingEnd || 0) - (entry.processingStart || 0)),
            },
          };
        }
      }
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        enqueue({
          name: "visibility",
          value: performance.now() - visibleSince,
          ts: Date.now(),
          metadata: { state: "hidden" },
        });
        flush("hidden");
      } else {
        visibleSince = performance.now();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", () => flush("pagehide"));
    const timer = window.setInterval(() => flush("interval"), FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observers.forEach((observer) => observer.disconnect());
      flush("unmount");
    };
  }, []);

  return null;
}
