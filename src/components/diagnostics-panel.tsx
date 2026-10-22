import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountSnapshot, botPermissions, marketTape } from "@/lib/markets";
import { useDesk } from "@/lib/desk-store";
import { useBotSession } from "@/lib/bot-session";
import { botLinkLabel, botLinkStatus } from "@/lib/bot-status";
import { grantConnected } from "@/lib/operator";
import { bugReport, clockLabel } from "@/lib/data-status";
import { ageLabel, type Market } from "@/lib/perp-math";
import { chainReadFresh, HIDEKI_CHAIN_ID, indexState, markState, shortAddr } from "@/lib/freshness";
import { useSession } from "@/lib/session";

export function DiagnosticsPanel({
  market,
  markets,
  now,
  indexerError,
  indexerFetching,
  indexerAt,
  chainError,
  chainFetching,
  chainAt,
  blocker,
}: {
  market: Market | undefined;
  markets: Market[];
  now: number;
  indexerError: string | null;
  indexerFetching: boolean;
  indexerAt: number;
  chainError: string | null;
  chainFetching: boolean;
  chainAt: number;
  blocker: string | null;
}) {
  const bot = useBotSession();
  const owner = useDesk((s) => s.botOwner);
  const evidence = useDesk((s) => s.evidence);
  const walletChain = useSession((s) => s.chainId);
  const [copied, setCopied] = useState(false);
  const pools = markets
    .filter((row) => /^0x[a-fA-F0-9]{40}$/.test(row.pool))
    .slice(0, 40)
    .map((row) => ({ pool: row.pool, symbol: row.symbol }));
  const ownerOk = /^0x[a-fA-F0-9]{40}$/.test(owner) && owner.toLowerCase() !== (bot.address ?? "").toLowerCase();
  const perms = useQuery({
    queryKey: ["bot-perms", owner.toLowerCase(), (bot.address ?? "").toLowerCase(), pools.map((pool) => pool.pool.toLowerCase()).join("|")],
    queryFn: () => botPermissions({ data: { owner, operator: bot.address as `0x${string}`, pools } }),
    enabled: Boolean(bot.address) && ownerOk && pools.length > 0,
    refetchInterval: 20_000,
  });
  const tape = useQuery({
    queryKey: ["tape", market?.id ?? ""],
    queryFn: () => marketTape({ data: { marketId: market?.id ?? "" } }),
    enabled: Boolean(market?.id),
    refetchInterval: (q) => (q.state.fetchFailureCount > 0 ? 30_000 : 12_000),
  });
  const snap = useQuery({
    queryKey: ["snapshot", ownerOk ? owner.toLowerCase() : ""],
    queryFn: () => accountSnapshot({ data: { account: owner } }),
    enabled: ownerOk,
    refetchInterval: 20_000,
  });
  const granted = perms.isSuccess && !perms.isError ? (perms.data?.markets ?? []).filter((row) => grantConnected(row)).length : 0;
  const reading = Boolean(bot.address && ownerOk && (perms.isLoading || (perms.isFetching && !perms.data)));
  const stt = perms.data?.operatorStt == null ? null : Number(perms.data.operatorStt);
  const link = botLinkStatus({
    hasBot: Boolean(bot.address),
    ownerSet: ownerOk,
    reading,
    readError: perms.isError,
    granted,
    stt: Number.isFinite(stt) ? stt : null,
  });
  const last = evidence.find((row) => /^0x[a-fA-F0-9]{64}$/.test(row.tx));
  const markFresh = market ? markState(market, now) : "unknown";
  const indexFresh = market ? indexState(market, now) : "unknown";
  const bookFresh = chainReadFresh(tape.data?.fetchedAt ?? 0, now);
  const rows: [string, string][] = [
    ["Network", `Hideki ${HIDEKI_CHAIN_ID}`],
    ["Wallet chain", walletChain == null ? "no injected wallet" : String(walletChain)],
    ["RPC", chainError ? `error: ${chainError}` : chainFetching ? "reading" : chainAt ? "ok" : "not read"],
    ["Indexer", indexerError ? `error: ${indexerError}` : indexerFetching ? "reading" : indexerAt ? "ok" : "not read"],
    ["Selected market", market?.symbol ?? "none"],
    ["Mark", market ? `${market.markSource} ${markFresh} ${clockLabel(market.chainFetchedAt ? Math.floor(market.chainFetchedAt / 1000) : 0)}` : "N/A"],
    ["Index", market ? `${market.indexSource} ${indexFresh} ${clockLabel(market.indexUpdatedAt)}` : "N/A"],
    ["Funding", market ? `${market.fundingSource} ${clockLabel(market.fundingUpdatedAt)}` : "N/A"],
    ["Book", `${bookFresh} ${clockLabel(tape.data ? Math.floor(tape.data.fetchedAt / 1000) : 0)}`],
    ["Bot permission", botLinkLabel(link) || "none"],
    ["Bot STT", stt == null || !Number.isFinite(stt) ? "N/A" : String(stt)],
    ["Owner", ownerOk ? shortAddr(owner) : "none"],
    ["Bot address", bot.address ? shortAddr(bot.address) : "none"],
    ["Last transaction", last ? `${last.tx.slice(0, 8)}…${last.tx.slice(-4)}` : "none"],
    ["Last receipt", last?.status ?? "none"],
    ["Last account refresh", snap.data ? clockLabel(Math.floor(snap.data.fetchedAt / 1000)) : "none"],
    ["Submission blocker", blocker ?? "none"],
  ];

  async function copy() {
    const text = bugReport(Object.fromEntries(rows));
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <details className="rounded-md border border-line bg-surface px-3 py-2">
      <summary className="cursor-pointer text-sm text-fg">Data diagnostics</summary>
      <dl className="mt-3 grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-2">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted">{key}</dt>
            <dd className="break-all font-mono text-fg sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-muted">Ages: mark {market ? ageLabel(market.chainFetchedAt ? Math.floor(market.chainFetchedAt / 1000) : 0, now) : "—"}, book {ageLabel(tape.data ? Math.floor(tape.data.fetchedAt / 1000) : 0, now)}.</p>
      <button type="button" onClick={() => void copy()} className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs">
        {copied ? "Copied" : "Copy bug report"}
      </button>
    </details>
  );
}
