import { chainReadFresh, type Freshness } from "./freshness.ts";

export type DeskLink =
  | "Connecting to DreamDEX"
  | "Live data ready"
  | "Partial data available"
  | "Live data unavailable";

export const MARK_WAIT =
  "Waiting for the latest DreamDEX chain mark. Market browsing remains available, but live orders are disabled until the mark is verified.";

export const FUNDING_PROJECTION_NOTE =
  "This projection assumes the current hourly funding rate remains unchanged for one year. Funding rates change frequently, so this is not a prediction of future returns or costs.";

export const INDEX_WAIT =
  "Transaction confirmed. Waiting for DreamDEX to index the position.";

export const SECURITY_LINE =
  "REXBOT uses an authorized bot signer for trading actions. Positions and margin remain on the DreamDEX owner account. REXBOT never requests the owner wallet’s private key or recovery phrase.";

export function deskLink(input: {
  marketCount: number;
  indexerError: boolean;
  chainError: boolean;
  chainFetching: boolean;
  chainRows: number;
  freshMarks: number;
}): DeskLink {
  if (input.marketCount === 0 && !input.indexerError) return "Connecting to DreamDEX";
  if (input.marketCount === 0) return "Live data unavailable";
  if (input.chainRows === 0 && input.chainFetching && !input.chainError) return "Connecting to DreamDEX";
  if (input.freshMarks > 0 && input.freshMarks === input.marketCount) return "Live data ready";
  if (input.chainError && input.chainRows === 0 && !input.chainFetching) return "Partial data available";
  if (input.chainRows === 0 && !input.chainFetching) return "Partial data available";
  return "Partial data available";
}

export function readUsable(state: Freshness): boolean {
  return state === "live" || state === "delayed";
}

/** Chain funding is usable only after a fresh getPerpState read whose settlement is not past two intervals. */
export function fundingVerified(
  market: {
    fundingSource: string;
    chainFetchedAt: number;
    fundingUpdatedAt: number;
    intervalSec: number;
  },
  now = Date.now(),
): boolean {
  if (market.fundingSource !== "chain") return false;
  if (!readUsable(chainReadFresh(market.chainFetchedAt, now))) return false;
  if (!market.fundingUpdatedAt || !market.intervalSec) return false;
  const age = now / 1000 - market.fundingUpdatedAt;
  if (age < -30) return false;
  return age <= market.intervalSec * 2;
}

export function annualizedProjection(aprFraction: number): string {
  if (!Number.isFinite(aprFraction)) return "N/A";
  const pct = aprFraction * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `Annualized funding projection: ${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function clockLabel(unixSec: number): string {
  if (!unixSec || !Number.isFinite(unixSec)) return "—";
  return `${new Date(unixSec * 1000).toISOString().slice(11, 19)} UTC`;
}

export function scrubReport(text: string): string {
  return text
    .replace(/0x[a-fA-F0-9]{64}\b/g, "[redacted]")
    .replace(/\b(?:seed phrase|mnemonic|recovery phrase|private key)\b[^\n]*/gi, "[redacted]");
}

export function bugReport(lines: Record<string, string>): string {
  const body = ["REXBOT diagnostics", ...Object.entries(lines).map(([key, value]) => `${key}: ${value}`)].join("\n");
  return scrubReport(body);
}
