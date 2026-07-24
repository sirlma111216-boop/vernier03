/**
 * Supabase share-session client.
 *
 * Connection details come from the server (/api/share-config) so no key is ever
 * committed to the repo. When the server is not configured (or we are offline,
 * e.g. plain `vite dev` with no Functions runtime) the sharing feature simply
 * stays off — the local experiment must keep working either way.
 *
 * The database table is RLS-locked with zero policies; only these two RPCs are
 * granted to anon, which is what makes the publishable key safe to expose.
 */

import type { SharePayload } from "./sharePayload";

/** Code alphabet with confusable characters (0 O 1 I L) removed. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
export const SHARE_EXPIRY_DAYS = 7;
const STORAGE_KEY = "pasco-motion.shareCode";

const config: { url: string | null; key: string | null; ready: boolean; checked: boolean } = {
  url: null,
  key: null,
  ready: false,
  checked: false,
};

/** Normalizes a pasted code: uppercase, strip separators, max 6 chars. */
export function normalizeCode(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);
}

export async function loadShareConfig(): Promise<boolean> {
  if (config.checked) return config.ready;
  config.checked = true;
  try {
    const res = await fetch("/api/share-config", { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { configured?: boolean; url?: string; anonKey?: string };
    if (data?.configured && data.url && data.anonKey) {
      // People paste the URL including '/rest/v1/' — strip it so we never build
      // '/rest/v1/rest/v1/rpc/...'.
      config.url = String(data.url).trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
      config.key = data.anonKey;
      config.ready = true;
    }
  } catch {
    /* not configured / offline — sharing stays disabled */
  }
  return config.ready;
}

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly pgCode?: string,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

async function shareRpc(fn: string, args: unknown): Promise<unknown> {
  if (!(await loadShareConfig())) throw new ShareError("NOT_CONFIGURED");
  const res = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: config.key as string,
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    // A raise exception in the function surfaces as { code:'P0001', message }.
    const b = body as { message?: string; code?: string } | null;
    throw new ShareError(b?.message ?? `SERVER_${res.status}`, res.status, b?.code);
  }
  return body;
}

/** Uploads a payload and returns the issued 6-character code. */
export async function createShareSession(payload: SharePayload): Promise<string> {
  const result = await shareRpc("create_share_session", { p_payload: payload });
  // The function returns a scalar text, so the parsed body is the code itself.
  const code = typeof result === "string" ? result : String(result ?? "");
  if (!CODE_PATTERN.test(code)) throw new ShareError("NO_CODE");
  return code;
}

/** Fetches a payload by code. Throws ShareError(400/P0001) when missing/expired. */
export async function getShareSession(code: string): Promise<unknown> {
  const result = await shareRpc("get_share_session", { p_code: code });
  // The deployed function returns the payload directly; tolerate a
  // { status, payload } envelope too (the optional schema variant).
  const envelope = result as { status?: string; payload?: unknown } | null;
  if (envelope && typeof envelope === "object" && envelope.status && envelope.payload) {
    return envelope.payload;
  }
  return result;
}

/** True when a ShareError means "no such code, or it expired". */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof ShareError && (err.status === 400 || err.pgCode === "P0001");
}

export function isNotConfiguredError(err: unknown): boolean {
  return err instanceof ShareError && err.message === "NOT_CONFIGURED";
}

// ---- issued-code persistence (survives a refresh) ----

export interface StoredCode {
  code: string;
  groupLabel: string;
  at: number;
}

export function rememberIssuedCode(code: string, groupLabel: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, groupLabel, at: Date.now() }));
  } catch {
    /* private mode / storage full — non-fatal */
  }
}

export function recallIssuedCode(): StoredCode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCode;
    if (!parsed?.code || !CODE_PATTERN.test(parsed.code)) return null;
    // Drop it once the server-side expiry has passed.
    if (Date.now() - parsed.at > SHARE_EXPIRY_DAYS * 86400_000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
