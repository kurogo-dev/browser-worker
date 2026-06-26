/**
 * Static worker config (manifest.json). The dynamic state — categories +
 * harvested macros — lives in the DB; this file holds only the deploy-time
 * knobs. Edit manifest.json, not this (this just shapes + loads it).
 */
import { readFileSync } from "node:fs";

export interface WorkerConfig {
  worker_id: string;
  /** Hosts the worker may perform a REAL submit on (safety gate 4). */
  allowed_hosts: string[];
  /** URL fragments marking a safe test harness (safety bypass). */
  test_targets: string[];
  /** Goal text handed to harvest when building a new site macro. */
  goal: string;
}

export function loadConfig(path: string): WorkerConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<WorkerConfig>;
  if (!raw.worker_id) throw new Error("config_missing_worker_id");
  return {
    worker_id: raw.worker_id,
    allowed_hosts: raw.allowed_hosts ?? [],
    test_targets: raw.test_targets ?? [],
    goal: raw.goal ?? "Fill and submit the application form.",
  };
}
