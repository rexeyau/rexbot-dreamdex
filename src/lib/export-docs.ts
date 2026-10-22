import type { Evidence, FeedbackDraft } from "@/lib/desk-store";
import { SDK_VERSION, HIDEKI_CHAIN_ID } from "@/lib/freshness";

export function evidenceMarkdown(rows: Evidence[]): string {
  const lines = [
    "# REXBOT transaction evidence",
    "",
    "Pasted hashes are not confirmations. Confirmed means the wallet path returned a receipt with status success.",
    "",
    "| Time (UTC) | Status | Market | Side | Qty | Price | Type | Wallet | Hash | Explorer | SDK | Chain |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((e) => {
      const time = new Date(e.at).toISOString();
      return `| ${time} | ${e.status} | ${e.symbol} | ${e.side} | ${e.quantity || "—"} | ${e.price || "—"} | ${e.orderType} | ${e.wallet || "—"} | \`${e.tx}\` | ${e.explorer} | ${e.sdkVersion} | ${e.chainId} |`;
    }),
    "",
  ];
  return lines.join("\n");
}

export function evidenceJson(rows: Evidence[]): string {
  return JSON.stringify(
    rows.map((e) => ({
      tx: e.tx,
      status: e.status,
      symbol: e.symbol,
      side: e.side,
      quantity: e.quantity,
      price: e.price,
      orderType: e.orderType,
      wallet: e.wallet,
      owner: e.owner ?? "",
      signer: e.signer ?? "",
      explorer: e.explorer,
      at: new Date(e.at).toISOString(),
      sdkVersion: e.sdkVersion,
      chainId: e.chainId,
      note: e.note,
    })),
    null,
    2,
  );
}

const KIND: Record<FeedbackDraft["kind"], string> = {
  confirmed: "Confirmed reproducible protocol or SDK issue",
  possible: "Possible issue requiring further investigation",
  markside: "REXBOT frontend issue",
};

export function feedbackMarkdown(d: FeedbackDraft): string {
  return [
    `# ${d.title || "Untitled"}`,
    "",
    `Severity: ${d.severity}`,
    `Area: ${d.area}`,
    `Classification: ${KIND[d.kind]}`,
    "",
    "## Summary",
    "",
    d.summary || "_Not filled in._",
    "",
    "## Steps to reproduce",
    "",
    d.steps || "1.\n2.\n3.",
    "",
    "## Expected behaviour",
    "",
    d.expected || "_Not filled in._",
    "",
    "## Actual behaviour",
    "",
    d.actual || "_Not filled in._",
    "",
    "## Evidence",
    "",
    d.evidence || "_No request, response, log, or transaction hash attached._",
    "",
    "## Environment",
    "",
    `SDK version: ${SDK_VERSION}`,
    "Network: Somnia Hideki testnet",
    `Chain ID: ${HIDEKI_CHAIN_ID}`,
    `Wallet address: ${d.wallet || "none"}`,
    `Browser: ${d.browser || "unspecified"}`,
    `Timestamp: ${new Date(d.at).toISOString()}`,
    "",
  ].join("\n");
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
