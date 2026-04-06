/**
 * Benchmark Reporter
 * 
 * Collects structured benchmark results from Jest test output
 * and provides utilities for comparison and reporting.
 */

export interface BenchmarkResult {
  test: string;
  iterations: number;
  totalMs: number;
  perIterMs: number;
  budgetPct: number;    // Percentage of 16.6ms frame budget consumed
  pass: boolean;
  timestamp: string;
}

export interface BenchmarkReport {
  timestamp: string;
  environment: {
    platform: string;
    nodeVersion: string;
    cpuCount: number;
  };
  results: BenchmarkResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    worstOffender: string;
    worstBudgetPct: number;
  };
}

const FRAME_BUDGET_MS = 16.6;

/**
 * Create a benchmark result from a timed test.
 */
export function createBenchmarkResult(
  testName: string,
  iterations: number,
  totalMs: number,
  threshold: number
): BenchmarkResult {
  const perIterMs = totalMs / iterations;
  const budgetPct = (totalMs / FRAME_BUDGET_MS) * 100;
  
  return {
    test: testName,
    iterations,
    totalMs: +totalMs.toFixed(2),
    perIterMs: +perIterMs.toFixed(4),
    budgetPct: +budgetPct.toFixed(1),
    pass: totalMs < threshold,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a full benchmark report from individual results.
 */
export function buildReport(results: BenchmarkResult[]): BenchmarkReport {
  const failed = results.filter(r => !r.pass);
  const worst = results.reduce((a, b) => a.budgetPct > b.budgetPct ? a : b, results[0]);
  
  return {
    timestamp: new Date().toISOString(),
    environment: {
      platform: typeof process !== 'undefined' ? process.platform : 'unknown',
      nodeVersion: typeof process !== 'undefined' ? process.version : 'unknown',
      cpuCount: typeof navigator !== 'undefined' 
        ? (navigator.hardwareConcurrency || 0) 
        : (typeof require !== 'undefined' ? require('os').cpus().length : 0),
    },
    results,
    summary: {
      totalTests: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      worstOffender: worst?.test || 'none',
      worstBudgetPct: worst?.budgetPct || 0,
    },
  };
}

/**
 * Compare two benchmark reports and return deltas.
 */
export function compareReports(
  baseline: BenchmarkReport,
  current: BenchmarkReport
): Array<{ test: string; baselineMs: number; currentMs: number; deltaMs: number; deltaPct: number; regression: boolean }> {
  const baseMap = new Map(baseline.results.map(r => [r.test, r]));
  
  return current.results.map(cur => {
    const base = baseMap.get(cur.test);
    if (!base) {
      return { test: cur.test, baselineMs: 0, currentMs: cur.totalMs, deltaMs: cur.totalMs, deltaPct: 100, regression: false };
    }
    const deltaMs = cur.totalMs - base.totalMs;
    const deltaPct = base.totalMs > 0 ? (deltaMs / base.totalMs) * 100 : 0;
    return {
      test: cur.test,
      baselineMs: base.totalMs,
      currentMs: cur.totalMs,
      deltaMs: +deltaMs.toFixed(2),
      deltaPct: +deltaPct.toFixed(1),
      regression: deltaPct > 10, // >10% slower = regression flag
    };
  });
}
