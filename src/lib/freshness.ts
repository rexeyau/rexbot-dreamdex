export type Freshness = "live" | "delayed" | "stale" | "unknown";

export function freshness(unixSec: number, now = Date.now()): Freshness {
  if (!unixSec || !Number.isFinite(unixSec)) return "unknown";
  const age = now / 1000 - unixSec;
  if (age < 0) return "live";
  if (age < 15) return "live";
  if (age < 60) return "delayed";
  return "stale";
}

export function worse(a: Freshness, b: Freshness): Freshness {
  const rank: Record<Freshness, number> = { live: 0, delayed: 1, unknown: 2, stale: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export const SDK_VERSION = "0.32.1";
export const HIDEKI_CHAIN_ID = 50383;
export const HIDEKI_RPC = "https://api.hideki2.infra.testnet.somnia.network";
export const HIDEKI_WS = "wss://api.hideki2.infra.testnet.somnia.network/ws";
export const HIDEKI_INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";

/** Hideki explorer named in the dreamDEX perps testnet docs (`/tokyo`). The markets SDK chain definition does not set a block explorer. */
export function explorerTx(hash: string): string {
  return `https://explorer.testnet.somnia.network/tokyo/tx/${hash}`;
}

export function chainReadFresh(fetchedAtMs: number, now = Date.now()): Freshness {
  if (!fetchedAtMs) return "unknown";
  return freshness(Math.floor(fetchedAtMs / 1000), now);
}

export function markState(
  m: { markOk: boolean; markSource: string; chainFetchedAt: number; chainError: string | null },
  now = Date.now(),
): Freshness {
  if (m.markSource !== "chain" || !m.markOk || !m.chainFetchedAt) {
    return m.chainError || m.chainFetchedAt ? "stale" : "unknown";
  }
  return chainReadFresh(m.chainFetchedAt, now);
}

export function indexState(
  m: { indexSource: string; indexUpdatedAt: number; chainError: string | null },
  now = Date.now(),
): Freshness {
  if (m.indexSource !== "chain" || !m.indexUpdatedAt) return m.chainError ? "stale" : "unknown";
  return freshness(m.indexUpdatedAt, now);
}

export function executionBlock(m: {
  markOk: boolean;
  markSource: string;
  chainFetchedAt: number;
  chainError: string | null;
  indexSource: string;
  indexUpdatedAt: number;
}, now = Date.now()): string | null {
  const mark = markState(m, now);
  const index = indexState(m, now);
  if (m.chainError && m.markSource !== "chain") return `Chain read failed: ${m.chainError}`;
  if (!m.markOk || mark === "stale" || mark === "unknown") {
    return mark === "unknown"
      ? "Live mark has not arrived from getPerpState. Submission stays off."
      : "Mark is stale or markPriceOk is false. Submission stays off until a fresh chain mark arrives.";
  }
  if (index === "stale" || index === "unknown") {
    return "Index is missing or older than 60 seconds. Basis is withheld and submission stays off.";
  }
  return null;
}

export function shortAddr(addr: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
