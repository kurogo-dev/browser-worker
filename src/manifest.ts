/**
 * Worker manifest — the worker's identity, its HTTP endpoints, and its safety
 * allowlist. Loaded once at boot from manifest.json. Edit manifest.json, not
 * this file (this only declares the shape).
 */
import { readFileSync } from "node:fs";

export interface WorkerEndpoint {
  path: string;
  method: string;
  macro_id: string;
  params_schema: { type: string; required?: string[] };
  description?: string;
}

export interface WorkerManifest {
  worker_id: string;
  role: string;
  description?: string;
  /** Hosts the worker is allowed to act on (safety gate 2). */
  allowed_hosts: string[];
  endpoints: WorkerEndpoint[];
  auth: { api_keys: string[] };
}

export function loadManifest(path: string): WorkerManifest {
  const raw = JSON.parse(readFileSync(path, "utf8")) as WorkerManifest;
  if (!raw.worker_id) throw new Error("manifest_missing_worker_id");
  if (!Array.isArray(raw.endpoints) || raw.endpoints.length === 0) {
    throw new Error("manifest_needs_at_least_one_endpoint");
  }
  raw.allowed_hosts ??= [];
  raw.auth ??= { api_keys: [] };
  return raw;
}
