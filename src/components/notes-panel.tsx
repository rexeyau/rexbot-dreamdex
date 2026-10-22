import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useDesk, type FeedbackDraft, type FeedbackKind } from "@/lib/desk-store";
import { downloadText, feedbackMarkdown } from "@/lib/export-docs";
import { useSession } from "@/lib/session";

const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: "possible", label: "Possible issue — needs more investigation" },
  { id: "confirmed", label: "Confirmed reproducible protocol or SDK issue" },
  { id: "markside", label: "REXBOT frontend issue" },
];

export function NotesPanel() {
  const saved = useDesk((s) => s.feedback);
  const saveFeedback = useDesk((s) => s.saveFeedback);
  const removeFeedback = useDesk((s) => s.removeFeedback);
  const address = useSession((s) => s.address);
  const [draft, setDraft] = useState<FeedbackDraft>(() => blank(address));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Feedback draft</h2>
        <p className="mt-2 text-xs leading-relaxed text-amber">
          Security issues are not exported. Send those privately to security@dreamdex.io. Do not attach a key, a seed, or an unpublished exploit in a public file.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          One confirmed indexer report is already in the repo: nested Order filters through Market return a database error, while market_id filters work. That file is a confirmed repro. This form does not file anything on its own.
        </p>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveFeedback({ ...draft, at: draft.at || Date.now(), wallet: draft.wallet || address || "" });
            setDraft(blank(address));
          }}
        >
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Short title" className="rounded-md border border-line bg-bg px-3 py-2 text-sm" required />
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as FeedbackDraft["severity"] })} className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
              <option value="normal">normal</option>
              <option value="major">major</option>
              <option value="critical">critical</option>
            </select>
            <select value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value as FeedbackDraft["area"] })} className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
              {(["API", "SDK", "docs", "app", "contracts"] as const).map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as FeedbackKind })} className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={draft.security} onChange={(e) => setDraft({ ...draft, security: e.target.checked })} />
            This is a security report and must not be exported
          </label>
          <Area label="Summary" value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} />
          <Area label="Steps" value={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} />
          <Area label="Expected" value={draft.expected} onChange={(expected) => setDraft({ ...draft, expected })} />
          <Area label="Actual" value={draft.actual} onChange={(actual) => setDraft({ ...draft, actual })} />
          <Area label="Evidence" value={draft.evidence} onChange={(evidence) => setDraft({ ...draft, evidence })} />
          <input value={draft.browser} onChange={(e) => setDraft({ ...draft, browser: e.target.value })} placeholder="Browser" className="rounded-md border border-line bg-bg px-3 py-2 text-sm" />
          <button type="submit" className="rounded-md bg-lime px-3 py-2 text-sm font-semibold text-lime-ink">Save draft</button>
        </form>
      </section>
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Saved drafts</h2>
        {saved.length === 0 ? <p className="mt-3 text-sm text-muted">None yet. A draft stays in this browser until you export it.</p> : null}
        <ul className="mt-3 flex flex-col gap-3">
          {saved.map((item) => (
            <li key={item.id} className="rounded-md border border-line p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{item.title}</p>
                  <p className="font-mono text-xs text-muted">{item.severity} · {item.area} · {item.kind}{item.security ? " · private" : ""}</p>
                </div>
                <button type="button" aria-label="Delete draft" onClick={() => removeFeedback(item.id)} className="text-muted"><Trash2 className="size-3.5" /></button>
              </div>
              {item.security ? (
                <p className="mt-2 text-xs text-amber">Export is off. Email security@dreamdex.io instead of publishing this note.</p>
              ) : (
                <button type="button" className="mt-2 text-xs text-lime" onClick={() => downloadText(fileName(item.title), feedbackMarkdown(item), "text/markdown")}>
                  Export Markdown
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg" />
    </label>
  );
}

function blank(wallet: string | null): FeedbackDraft {
  return {
    id: `${Date.now()}`,
    title: "",
    severity: "normal",
    area: "API",
    kind: "possible",
    security: false,
    summary: "",
    steps: "",
    expected: "",
    actual: "",
    evidence: "",
    wallet: wallet ?? "",
    browser: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 180),
    at: Date.now(),
  };
}

function fileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "issue";
  return `${slug}.md`;
}
