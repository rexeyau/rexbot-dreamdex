import type { Freshness } from "./freshness.ts";

export type ScorePart = {
  label: string;
  points: number;
  max: number;
  note: string;
};

export function opportunityScore(input: {
  fundingHourly: number;
  fundingVerified: boolean;
  oiNotional: number;
  volumeQuote: number;
  freshness: Freshness;
  spreadBps: number | null;
}): { score: number; parts: ScorePart[] } {
  const bps = Math.abs(input.fundingHourly) * 10_000;
  const fundingPts = input.fundingVerified ? Math.max(0, Math.min(40, (bps / 2) * 40)) : 0;
  const oiPts =
    input.oiNotional > 0 ? Math.max(0, Math.min(20, (Math.log10(input.oiNotional / 1_000) / 3) * 20)) : 0;
  const volPts =
    input.volumeQuote > 0
      ? Math.max(0, Math.min(15, (Math.log10(input.volumeQuote / 1_000) / 3) * 15))
      : 0;
  const freshPts = input.freshness === "live" ? 15 : input.freshness === "delayed" ? 8 : 0;
  let spreadPts = 0;
  let spreadNote = "Spread is N/A, so it is not in the score.";
  if (input.spreadBps != null && Number.isFinite(input.spreadBps)) {
    const s = Math.max(0, input.spreadBps);
    spreadPts = s <= 5 ? 10 : s >= 50 ? 0 : 10 * (1 - (s - 5) / 45);
    spreadNote = `${s.toFixed(1)} bp between best bid and ask.`;
  }
  const parts: ScorePart[] = [
    {
      label: "Funding",
      points: fundingPts,
      max: 40,
      note: input.fundingVerified
        ? `${bps.toFixed(3)} bp/hour absolute from getPerpState. 2 bp/hour fills this part. Not a forecast.`
        : "Funding is N/A. An unverified or stale rate is excluded.",
    },
    {
      label: "Open interest",
      points: oiPts,
      max: 20,
      note: "Log scale of open interest in USDso. Thin markets score lower.",
    },
    {
      label: "Volume",
      points: volPts,
      max: 15,
      note: "Lifetime quote volume, log scale. It is activity, not edge.",
    },
    {
      label: "Freshness",
      points: freshPts,
      max: 15,
      note: "Live chain mark and index under 15s scores full. Stale scores zero.",
    },
    {
      label: "Spread",
      points: spreadPts,
      max: 10,
      note: spreadNote,
    },
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.points, 0));
  return { score: Math.max(0, Math.min(100, score)), parts };
}
