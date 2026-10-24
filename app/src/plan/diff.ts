// SPDX-License-Identifier: Apache-2.0
// Deep structural diff for snapshot payloads: flatten to leaf paths, then
// report only keys whose JSON values differ. Empty containers flatten to
// nothing, so absent-vs-empty never shows up as phantom noise.

export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export function flattenLeaves(value: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(value)) {
    value.forEach((v, i) => Object.assign(out, flattenLeaves(v, `${prefix}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(out, flattenLeaves(v, prefix ? `${prefix}.${k}` : k));
    }
  } else {
    out[prefix || "$"] = value;
  }
  return out;
}

export function diffFlattened(a: unknown, b: unknown): DiffEntry[] {
  const fa = flattenLeaves(a);
  const fb = flattenLeaves(b);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  const out: DiffEntry[] = [];
  for (const key of keys) {
    if (JSON.stringify(fa[key] ?? null) !== JSON.stringify(fb[key] ?? null)) {
      out.push({ path: key, before: fa[key], after: fb[key] });
    }
  }
  return out;
}
