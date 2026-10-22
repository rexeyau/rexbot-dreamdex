import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { useDesk, type CheckKey, type Evidence } from "@/lib/desk-store";
import { downloadText, evidenceJson, evidenceMarkdown } from "@/lib/export-docs";
import { explorerTx, SDK_VERSION, shortAddr } from "@/lib/freshness";

const CHECKS: { key: CheckKey; label: string }[] = [
  { key: "whitelist", label: "DoraHacks email whitelisted" },
  { key: "github", label: "GitHub repository added" },
  { key: "readme", label: "README completed" },
  { key: "realOrder", label: "Real testnet order placed" },
  { key: "txRecorded", label: "Transaction hash recorded" },
  { key: "video", label: "Demo video recorded" },
  { key: "posts", label: "Two or three X posts published" },
  { key: "postLinks", label: "X post links added to the README" },
  { key: "feedback", label: "Feedback reports exported" },
  { key: "submitted", label: "Final DoraHacks submission completed" },
];

const POSTS = [
  "REXBOT is a funding-aware perps execution and risk terminal built on dreamDEX. It ranks funding opportunities, explains the risk behind each setup, sizes trades against real account limits and produces verifiable Somnia testnet execution. @DreamDEXSomnia",
  "On Hideki the indexed mark only moves when funding settles. REXBOT reads getPerpState for the live mark, blocks testnet orders when that mark or the index is stale, and keeps paper trades labeled simulated. @DreamDEXSomnia",
  "While integrating the Hideki indexer, filtering Order through a nested Market returned a database error. Filtering Order by market_id works. The repro is in the REXBOT feedback folder. That is a confirmed query failure, not a claim about the rest of the API. @DreamDEXSomnia",
];

export function ShipPanel() {
  const evidence = useDesk((s) => s.evidence);
  const addEvidence = useDesk((s) => s.addEvidence);
  const removeEvidence = useDesk((s) => s.removeEvidence);
  const checklist = useDesk((s) => s.checklist);
  const toggleCheck = useDesk((s) => s.toggleCheck);
  const [tx, setTx] = useState("");
  const [symbol, setSymbol] = useState("BTC-PERP");
  const [note, setNote] = useState("");
  const [wallet, setWallet] = useState("");
  const done = CHECKS.filter((c) => checklist[c.key]).length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Submission checklist</h2>
          <span className="font-mono text-xs text-muted">{done}/{CHECKS.length}</span>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {CHECKS.map((item) => (
            <li key={item.key}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={checklist[item.key]} onChange={() => toggleCheck(item.key)} className="mt-1" />
                <span>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <ol className="mt-4 flex flex-col gap-3 text-sm text-muted">
          <li>
            <span className="text-fg">Whitelist. </span>
            Only a whitelisted DoraHacks email can submit. Ask in{" "}
            <a className="text-lime underline" href="https://discord.gg/dreamdex" target="_blank" rel="noreferrer">Discord</a>{" "}
            or the{" "}
            <a className="text-lime underline" href="https://t.me/+s_oRMnGpOyQ3ODQ0" target="_blank" rel="noreferrer">SomniaHacks Telegram</a>.
          </li>
          <li>
            <span className="text-fg">Register. </span>
            <a className="text-lime underline" href="https://dorahacks.io/hackathon/dreamdex-perps-bounty" target="_blank" rel="noreferrer">dreamDEX Perps Builder Bounty</a>.
            Deadline 1 Nov 2026, 23:59 UTC.
          </li>
          <li>
            <span className="text-fg">Place one real order. </span>
            Connect a wallet here, or run the bot kit outside the browser with DRY_RUN=false. A pasted hash stays marked pasted until you have a receipt.
          </li>
        </ol>
      </section>
      <div className="flex flex-col gap-4">
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Posts to publish</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {POSTS.map((post) => (
              <li key={post}>
                <p className="text-sm text-muted">{post}</p>
                <button type="button" onClick={() => void navigator.clipboard.writeText(post)} className="mt-1 inline-flex items-center gap-1 text-xs text-lime">
                  <Copy className="size-3" /> Copy
                </button>
              </li>
            ))}
          </ul>
        </section>
        <EvidenceLocker
          evidence={evidence}
          tx={tx}
          setTx={setTx}
          symbol={symbol}
          setSymbol={setSymbol}
          note={note}
          setNote={setNote}
          wallet={wallet}
          setWallet={setWallet}
          addEvidence={addEvidence}
          removeEvidence={removeEvidence}
        />
      </div>
    </div>
  );
}

function statusLabel(status: Evidence["status"]): string {
  if (status === "pasted") return "pasted, unverified";
  if (status === "signature") return "signature requested";
  if (status === "unknown") return "pending, unverified";
  if (status === "rejected") return "signature rejected";
  return status;
}

function EvidenceLocker({
  evidence,
  tx,
  setTx,
  symbol,
  setSymbol,
  note,
  setNote,
  wallet,
  setWallet,
  addEvidence,
  removeEvidence,
}: {
  evidence: Evidence[];
  tx: string;
  setTx: (v: string) => void;
  symbol: string;
  setSymbol: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  wallet: string;
  setWallet: (v: string) => void;
  addEvidence: (e: Omit<Evidence, "id" | "at">) => void;
  removeEvidence: (id: string) => void;
}) {
  const bad = tx.trim() !== "" && !/^0x[a-fA-F0-9]{64}$/.test(tx.trim());
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <h2 className="text-sm font-medium">Evidence locker</h2>
      <p className="mt-1 text-xs text-muted">
        Confirmed rows are written only after a receipt with status success. A hash you paste is stored as pasted. No private keys.
      </p>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const hash = tx.trim();
          if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return;
          addEvidence({
            tx: hash,
            status: "pasted",
            symbol: symbol.trim() || "PERP",
            side: "long",
            quantity: "",
            price: "",
            orderType: "limit",
            wallet: /^0x[a-fA-F0-9]{40}$/.test(wallet.trim()) ? wallet.trim() : "",
            explorer: explorerTx(hash),
            sdkVersion: SDK_VERSION,
            chainId: 50383,
            note: note.trim() || "Pasted by hand. Not a confirmation.",
          });
          setTx("");
          setNote("");
        }}
      >
        <input value={tx} onChange={(e) => setTx(e.target.value)} placeholder="0x transaction hash" className="rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs" />
        {bad ? <p className="text-xs text-down">A hash is 0x plus 64 hex characters. This one is not saved.</p> : null}
        <div className="flex gap-2">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-32 rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs" />
          <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="wallet (optional)" className="w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs" />
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="rounded-md border border-line bg-bg px-3 py-2 text-xs" />
        <button type="submit" className="rounded-md bg-lime px-3 py-2 text-sm font-semibold text-lime-ink">Save pasted hash</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!evidence.length} onClick={() => downloadText("rexbot-evidence.md", evidenceMarkdown(evidence), "text/markdown")} className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40">Export Markdown</button>
        <button type="button" disabled={!evidence.length} onClick={() => downloadText("rexbot-evidence.json", evidenceJson(evidence), "application/json")} className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40">Export JSON</button>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {evidence.map((row) => (
          <li key={row.id} className="rounded-md border border-line p-2 text-xs">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-fg">{row.symbol} · {row.side} · {statusLabel(row.status)}</p>
                <p className="break-all font-mono text-muted">{row.tx}</p>
                <p className="text-muted">{row.quantity || "—"} @ {row.price || "—"} · {row.orderType} · {row.owner ? `owner ${shortAddr(row.owner)} · ` : ""}{row.signer ? `signer ${shortAddr(row.signer)} · ` : ""}{row.wallet ? shortAddr(row.wallet) : "no wallet"} · SDK {row.sdkVersion} · chain {row.chainId}</p>
              </div>
              <button type="button" onClick={() => removeEvidence(row.id)} aria-label="Remove evidence" className="text-muted"><Trash2 className="size-3.5" /></button>
            </div>
            <div className="mt-1 flex gap-3">
              <button type="button" onClick={() => void navigator.clipboard.writeText(row.tx)} className="text-lime">Copy hash</button>
              <a className="text-lime underline" href={row.explorer || explorerTx(row.tx)} target="_blank" rel="noreferrer">Open explorer</a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
