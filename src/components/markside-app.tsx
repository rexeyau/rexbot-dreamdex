import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Radio, Trash2 } from "lucide-react";
import { liveChain, listPerps, marketTape } from "@/lib/markets";
import { migrateLegacyDesk, useDesk } from "@/lib/desk-store";
import { useSession } from "@/lib/session";
import { applyChain, ageLabel, basis, fmtBpsPerHour, fmtCountdown, fmtPct, fmtPx, fmtQty, fmtUsd, fundingDollars, nextFundingMs, receiverSide, type Market } from "@/lib/perp-math";
import { chainReadFresh, executionBlock, HIDEKI_CHAIN_ID, indexState, markState, shortAddr, type Freshness } from "@/lib/freshness";
import { opportunityScore, type ScorePart } from "@/lib/score";
import { annualizedProjection, clockLabel, deskLink, FUNDING_PROJECTION_NOTE, fundingVerified, MARK_WAIT, readUsable, SECURITY_LINE } from "@/lib/data-status";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { connectWallet, getProvider, switchToHideki } from "@/lib/wallet";
import { Ticket } from "@/components/ticket-panel";
import { WalletPanel } from "@/components/wallet-panel";
import { ShipPanel } from "@/components/ship-panel";
import { NotesPanel } from "@/components/notes-panel";
import { useDeskNav } from "@/lib/desk-nav";

type Tab = "desk" | "wallet" | "ship" | "notes";
type SortKey = "funding" | "score" | "oi" | "spread" | "liquidity" | "freshness";

type Ranked = Market & { score: number; parts: ScorePart[]; fresh: Freshness; oiNotional: number };

export function MarksideApp({ initial }: { initial: { markets: Market[]; fetchedAt: number } }) {
  const [tab, setTab] = useState<Tab>("desk");
  const nav = useDeskNav();
  const [now, setNow] = useState<number | null>(null);
  const marketsQuery = useQuery({
    queryKey: ["perps"],
    queryFn: () => listPerps(),
    initialData: initial,
    refetchInterval: (q) => backoff(q.state.fetchFailureCount),
  });
  const chainQuery = useQuery({
    queryKey: ["chain"],
    queryFn: async () => {
      const row = await liveChain();
      if (row.error && row.rows.length === 0) throw new Error(row.error);
      return row;
    },
    refetchInterval: (q) => backoff(q.state.fetchFailureCount, 12_000),
    retry: 1,
  });
  const mode = useDesk((s) => s.mode);
  const setMode = useDesk((s) => s.setMode);
  const marketId = useDesk((s) => s.marketId);
  const setMarketId = useDesk((s) => s.setMarketId);
  const address = useSession((s) => s.address);
  const chainId = useSession((s) => s.chainId);
  const setSession = useSession((s) => s.setSession);
  const connectError = useSession((s) => s.connectError);
  const setConnectError = useSession((s) => s.setConnectError);

  useEffect(() => {
    const unsub = useDesk.persist.onFinishHydration(() => migrateLegacyDesk());
    void useDesk.persist.rehydrate();
    return () => unsub();
  }, []);

  useEffect(() => {
    if (nav.tab) setTab(nav.tab);
  }, [nav]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const eth = getProvider();
    if (!eth?.on) return;
    void eth.request({ method: "eth_accounts" }).then((accounts) => {
      const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
      if (!first) return;
      void eth.request({ method: "eth_chainId" }).then((hex) => {
        setSession({ address: first, chainId: typeof hex === "string" ? Number(hex) : null });
      });
    }).catch(() => undefined);
    const onAccounts = (...args: unknown[]) => {
      const list = Array.isArray(args[0]) ? args[0] : [];
      const next = typeof list[0] === "string" ? list[0] : null;
      setSession({ address: next, chainId: useSession.getState().chainId });
    };
    const onChain = (...args: unknown[]) => {
      const hex = args[0];
      setSession({ address: useSession.getState().address, chainId: typeof hex === "string" ? Number(hex) : null });
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [setSession]);

  const clock = now ?? marketsQuery.data.fetchedAt;
  const ranked = useMemo(() => {
    const byId = new Map((chainQuery.data?.rows ?? []).map((row) => [row.id.toLowerCase(), row]));
    const fetchedAt = chainQuery.data?.fetchedAt ?? 0;
    return marketsQuery.data.markets.map((market) => {
      const next = applyChain(market, byId.get(market.id.toLowerCase()), fetchedAt);
      const fresh = markState(next, clock);
      const funded = fundingVerified(next, clock);
      const markOk = readUsable(fresh);
      const readFresh = chainReadFresh(next.chainFetchedAt, clock);
      const oiOk = next.oiSource === "chain" && markOk && readUsable(readFresh);
      const oiNotional = oiOk ? next.oiBase * next.mark : 0;
      const scored = opportunityScore({
        fundingHourly: funded ? next.fundingHourly : 0,
        fundingVerified: funded,
        oiNotional,
        volumeQuote: next.volumeQuote,
        freshness: worseOf(fresh, indexState(next, clock)),
        spreadBps: readUsable(readFresh) ? next.spreadBps : null,
      });
      return { ...next, score: scored.score, parts: scored.parts, fresh, oiNotional };
    });
  }, [marketsQuery.data, chainQuery.data, clock]);

  useEffect(() => {
    if (!marketId && ranked[0]) setMarketId(ranked[0].id);
    if (marketId && ranked.length && !ranked.some((m) => m.id === marketId)) setMarketId(ranked[0]?.id ?? null);
  }, [marketId, ranked, setMarketId]);

  const market = ranked.find((m) => m.id === marketId) ?? ranked[0];
  const listError = marketsQuery.error instanceof Error ? marketsQuery.error.message : null;
  const chainError = chainQuery.error instanceof Error ? chainQuery.error.message : chainQuery.data?.error ?? null;
  const chainAt = chainQuery.data?.fetchedAt ?? 0;
  const freshMarks = ranked.filter((row) => readUsable(markState(row, clock))).length;
  const status = deskLink({
    marketCount: marketsQuery.data.markets.length,
    indexerError: Boolean(listError),
    chainError: Boolean(chainError),
    chainFetching: chainQuery.isFetching && (chainQuery.data?.rows.length ?? 0) === 0,
    chainRows: chainQuery.data?.rows.length ?? 0,
    freshMarks,
  });
  const waitingMark = !market || !readUsable(markState(market, clock));

  async function connect() {
    setConnectError(null);
    try {
      const next = await connectWallet();
      setSession(next);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Connect failed");
    }
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <Header
        tab={tab}
        setTab={setTab}
        mode={mode}
        setMode={setMode}
        count={ranked.length}
        listError={listError}
        status={status}
        chainAt={chainAt}
        fetching={marketsQuery.isFetching || chainQuery.isFetching}
        failures={chainQuery.failureCount}
        address={address}
        chainId={chainId}
        connectError={connectError}
        onConnect={() => void connect()}
        onSwitch={() => void switchToHideki().then(() => address && setSession({ address, chainId: HIDEKI_CHAIN_ID })).catch((error: unknown) => setConnectError(error instanceof Error ? error.message : "Switch failed"))}
        left={now == null ? null : nextFundingMs(now)}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
        <DataBanner
          status={status}
          chainAt={chainAt}
          now={clock}
          fetching={chainQuery.isFetching || marketsQuery.isFetching}
          waitingMark={Boolean(market) && waitingMark}
          onRetry={() => {
            void marketsQuery.refetch();
            void chainQuery.refetch();
          }}
        />
        {tab === "desk" && market ? (
          <>
            <Desk markets={ranked} market={market} now={clock} chainError={chainError} />
            <Blotter markets={ranked} now={clock} />
          </>
        ) : null}
        {tab === "desk" && !market ? <p className="text-sm text-muted">No perp markets returned. Market browsing will show names when the indexer answers. Live orders stay off.</p> : null}
        {tab === "wallet" ? <WalletPanel markets={ranked} /> : null}
        {tab === "ship" ? <ShipPanel /> : null}
        {tab === "notes" ? <NotesPanel /> : null}
        <DiagnosticsPanel
          market={market}
          markets={ranked}
          now={clock}
          indexerError={listError}
          indexerFetching={marketsQuery.isFetching}
          indexerAt={marketsQuery.data.fetchedAt}
          chainError={chainError}
          chainFetching={chainQuery.isFetching}
          chainAt={chainAt}
          blocker={market ? executionBlock(market, clock) : "No market is selected."}
        />
      </main>
    </div>
  );
}

function backoff(failures: number, base = 15_000): number {
  if (failures <= 0) return base;
  return Math.min(60_000, base * 2 ** Math.min(failures, 2));
}

function worseOf(a: Freshness, b: Freshness): Freshness {
  const rank: Record<Freshness, number> = { live: 0, delayed: 1, unknown: 2, stale: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function Header(props: {
  tab: Tab;
  setTab: (t: Tab) => void;
  mode: "paper" | "live";
  setMode: (m: "paper" | "live") => void;
  count: number;
  listError: string | null;
  status: string;
  chainAt: number;
  fetching: boolean;
  failures: number;
  address: string | null;
  chainId: number | null;
  connectError: string | null;
  onConnect: () => void;
  onSwitch: () => void;
  left: number | null;
}) {
  const wrong = props.address != null && props.chainId !== HIDEKI_CHAIN_ID;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-lime text-lime-ink">
            <Radio className="size-4" strokeWidth={2.4} />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-sm font-semibold tracking-wide">REXBOT</div>
            <div className="text-xs text-muted">dreamDEX perps · Hideki 50383</div>
          </div>
        </div>
        <nav className="flex rounded-md border border-line bg-surface p-1">
          {([
            ["desk", "Desk"],
            ["wallet", "Wallet"],
            ["ship", "Ship"],
            ["notes", "Notes"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => props.setTab(id)} className={"rounded-md px-3 py-1.5 text-sm " + (props.tab === id ? "bg-lime text-lime-ink" : "text-muted hover:text-fg")}>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex rounded-md border border-line p-1" role="group" aria-label="Execution mode">
          <button type="button" onClick={() => props.setMode("paper")} className={"rounded-md px-2 py-1 text-xs " + (props.mode === "paper" ? "bg-lime text-lime-ink" : "text-muted")}>Paper</button>
          <button type="button" onClick={() => props.setMode("live")} className={"rounded-md px-2 py-1 text-xs " + (props.mode === "live" ? "bg-amber text-lime-ink" : "text-muted")}>Testnet Live</button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className={"size-1.5 rounded-full " + (props.status === "Live data ready" ? "bg-lime" : props.status === "Live data unavailable" ? "bg-amber" : props.fetching ? "bg-amber" : "bg-amber")} />
            {props.status}
          </span>
          {props.failures > 0 ? <span>backoff {Math.round(backoff(props.failures, 12_000) / 1000)}s</span> : null}
          <span className="font-mono">funding <span className="text-fg">{props.left == null ? "—" : fmtCountdown(props.left)}</span></span>
          <button type="button" onClick={props.onConnect} className="rounded-md border border-line px-2 py-1 text-fg">
            {props.address ? shortAddr(props.address) : "Connect wallet"}
          </button>
        </div>
      </div>
      {props.mode === "live" ? <p className="mx-auto w-full max-w-6xl px-4 pb-2 font-mono text-xs text-amber">TESTNET LIVE · chain 50383 · signs only after confirmation</p> : null}
      {wrong ? (
        <p className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 pb-3 text-sm text-down">
          Wallet is on chain {props.chainId ?? "unknown"}, not Hideki 50383.
          <button type="button" onClick={props.onSwitch} className="rounded-md border border-line px-2 py-1 text-xs text-fg">Switch to Hideki</button>
        </p>
      ) : null}
      {props.connectError ? <p className="mx-auto w-full max-w-6xl px-4 pb-3 text-sm text-down">{props.connectError}</p> : null}
    </header>
  );
}

function DataBanner(props: {
  status: string;
  chainAt: number;
  now: number;
  fetching: boolean;
  waitingMark: boolean;
  onRetry: () => void;
}) {
  const tone =
    props.status === "Live data ready"
      ? "border-lime/40 text-lime"
      : props.status === "Live data unavailable"
        ? "border-amber/50 text-amber"
        : "border-line text-fg";
  const last = props.chainAt ? `${clockLabel(Math.floor(props.chainAt / 1000))} · ${ageLabel(Math.floor(props.chainAt / 1000), props.now)}` : "not yet";
  return (
    <section className={"rounded-md border bg-surface px-3 py-3 " + tone}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium">{props.status}</p>
          <p className="mt-1 text-xs text-muted">Last successful chain read {last}.</p>
          {props.waitingMark ? <p className="mt-2 text-sm leading-relaxed text-fg">{MARK_WAIT}</p> : null}
          <p className="mt-2 text-xs leading-relaxed text-muted">{SECURITY_LINE}</p>
        </div>
        <button type="button" onClick={props.onRetry} disabled={props.fetching} className="rounded-md border border-line px-3 py-2 text-sm text-fg disabled:opacity-40">
          {props.fetching ? "Reading…" : "Retry live data"}
        </button>
      </div>
    </section>
  );
}

function Desk({ markets, market, now, chainError }: { markets: Ranked[]; market: Ranked; now: number; chainError: string | null }) {
  const block = executionBlock(market, now);
  const markReady = readUsable(markState(market, now));
  return (
    <>
      {block && markReady ? (
        <div className="rounded-md border border-amber/40 bg-surface px-3 py-2 text-sm text-fg">
          {block} {chainError ? `Last read note: ${chainError}` : "Live orders stay disabled. This is missing data, not a failed order."}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        <MarketList markets={markets} activeId={market.id} now={now} />
        <MarketDetail market={market} now={now} />
        <Ticket market={market} />
      </div>
    </>
  );
}

function MarketList({ markets, activeId, now }: { markets: Ranked[]; activeId: string; now: number }) {
  const setMarketId = useDesk((s) => s.setMarketId);
  const [sort, setSort] = useState<SortKey>("funding");
  const [longsPay, setLongsPay] = useState(false);
  const [shortsPay, setShortsPay] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const [minOi, setMinOi] = useState("");
  const [maxSpread, setMaxSpread] = useState("");
  const [minScore, setMinScore] = useState("");
  const rows = markets.filter((m) => {
    const funded = fundingVerified(m, now);
    const spreadOk = readUsable(chainReadFresh(m.chainFetchedAt, now));
    if (longsPay && !(funded && m.fundingHourly > 0)) return false;
    if (shortsPay && !(funded && m.fundingHourly < 0)) return false;
    if (liveOnly && m.fresh !== "live") return false;
    if (minOi.trim() && m.oiNotional < Number(minOi)) return false;
    if (maxSpread.trim() && (!spreadOk || m.spreadBps == null || m.spreadBps > Number(maxSpread))) return false;
    if (minScore.trim() && m.score < Number(minScore)) return false;
    return true;
  });
  const sorted = [...rows].sort((a, b) => {
    if (sort === "score") return b.score - a.score;
    if (sort === "oi") return b.oiNotional - a.oiNotional;
    if (sort === "spread") {
      const as = readUsable(chainReadFresh(a.chainFetchedAt, now)) ? a.spreadBps : null;
      const bs = readUsable(chainReadFresh(b.chainFetchedAt, now)) ? b.spreadBps : null;
      return (as ?? 9e9) - (bs ?? 9e9);
    }
    if (sort === "liquidity") return b.volumeQuote - a.volumeQuote;
    if (sort === "freshness") return rankFresh(a.fresh) - rankFresh(b.fresh);
    const fa = fundingVerified(a, now) ? Math.abs(a.fundingHourly) : -1;
    const fb = fundingVerified(b, now) ? Math.abs(b.fundingHourly) : -1;
    return fb - fa;
  });
  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface">
      <header className="border-b border-line px-3 py-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Funding rank</h2>
          <span className="font-mono text-xs text-muted">score</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">Unverified funding is N/A and is not ranked. A repeated rate is shown only when getPerpState returned it.</p>
        <label className="mt-2 block text-xs text-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1 text-xs text-fg">
            <option value="funding">Funding rate</option>
            <option value="score">Opportunity score</option>
            <option value="oi">Open interest</option>
            <option value="spread">Spread</option>
            <option value="liquidity">Liquidity</option>
            <option value="freshness">Data freshness</option>
          </select>
        </label>
        <div className="mt-2 flex flex-col gap-1 text-xs text-muted">
          <label className="flex gap-2"><input type="checkbox" checked={longsPay} onChange={(e) => setLongsPay(e.target.checked)} /> Longs pay shorts</label>
          <label className="flex gap-2"><input type="checkbox" checked={shortsPay} onChange={(e) => setShortsPay(e.target.checked)} /> Shorts pay longs</label>
          <label className="flex gap-2"><input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} /> Live data only</label>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          <input value={minOi} onChange={(e) => setMinOi(e.target.value)} placeholder="min OI" className="rounded-md border border-line bg-bg px-1 py-1 font-mono text-[11px]" />
          <input value={maxSpread} onChange={(e) => setMaxSpread(e.target.value)} placeholder="max bp" className="rounded-md border border-line bg-bg px-1 py-1 font-mono text-[11px]" />
          <input value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="min score" className="rounded-md border border-line bg-bg px-1 py-1 font-mono text-[11px]" />
        </div>
      </header>
      <ul className="max-h-[28rem] overflow-auto">
        {sorted.length === 0 ? <li className="px-3 py-4 text-sm text-muted">No market matches these filters.</li> : null}
        {sorted.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => setMarketId(m.id)} className={"flex w-full items-center gap-2 border-l-2 px-3 py-2.5 text-left " + (m.id === activeId ? "border-lime bg-surface-2" : "border-transparent hover:bg-surface-2")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.base}</span>
                <span className="block truncate font-mono text-xs text-muted">{readUsable(m.fresh) ? fmtPx(m.mark) : "N/A"} · {m.score}</span>
              </span>
              <span className={"font-mono text-xs " + (fundingVerified(m, now) ? (m.fundingHourly > 0 ? "text-down" : m.fundingHourly < 0 ? "text-lime" : "text-muted") : "text-muted")}>{fundingVerified(m, now) ? fmtBpsPerHour(m.fundingHourly) : "N/A"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function rankFresh(f: Freshness): number {
  if (f === "live") return 0;
  if (f === "delayed") return 1;
  if (f === "unknown") return 2;
  return 3;
}

function MarketDetail({ market, now }: { market: Ranked; now: number }) {
  const notional = useDesk((s) => s.notional);
  const isLong = useDesk((s) => s.isLong);
  const tape = useQuery({
    queryKey: ["tape", market.id],
    queryFn: () => marketTape({ data: { marketId: market.id } }),
    refetchInterval: (q) => backoff(q.state.fetchFailureCount, 12_000),
  });
  const markFresh = markState(market, now);
  const idxFresh = indexState(market, now);
  const bookFresh = chainReadFresh(tape.data?.fetchedAt ?? 0, now);
  const markOk = readUsable(markFresh);
  const indexOk = readUsable(idxFresh);
  const bookOk = readUsable(bookFresh);
  const funded = fundingVerified(market, now);
  const oiOk = market.oiSource === "chain" && markOk && readUsable(chainReadFresh(market.chainFetchedAt, now));
  const showBasis = markOk && indexOk;
  const b = basis(market);
  const paid = receiverSide(market.fundingHourly);
  const who = paid === "shorts" ? "Longs pay shorts" : paid === "longs" ? "Shorts pay longs" : "Neither side pays";
  const carry = funded ? fundingDollars(market.fundingHourly, notional, isLong) : null;
  const bidQty = (tape.data?.bids ?? []).reduce((s, l) => s + l.qty, 0);
  const askQty = (tape.data?.asks ?? []).reduce((s, l) => s + l.qty, 0);
  const imbalance = bidQty + askQty > 0 ? (bidQty - askQty) / (bidQty + askQty) : 0;
  const lastPrint = tape.data?.fills[0]?.timestamp ?? 0;
  const fundState: Freshness = funded ? chainReadFresh(market.chainFetchedAt, now) : market.fundingSource === "chain" ? "stale" : "unknown";

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-lg font-semibold">{market.symbol}</h2>
              <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-xs text-muted">{market.maxLeverage}x</span>
              <span className={"rounded-md px-1.5 py-0.5 font-mono text-xs " + (market.voucher ? "bg-lime/15 text-lime" : "border border-line text-muted")}>{market.voucher ? "paper USDso" : "no voucher"}</span>
              <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-xs text-muted">score {market.score}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{market.trades.toLocaleString("en-US")} trades · mark {markOk ? market.markSource : "N/A"}</p>
          </div>
          <div className="text-right">
            <div className={"font-mono text-3xl font-semibold tabular-nums " + (markOk ? "" : "text-muted")}>{markOk ? fmtPx(market.mark) : "N/A"}</div>
            <div className={"font-mono text-sm " + (showBasis ? (b >= 0 ? "text-lime" : "text-down") : "text-muted")}>
              {showBasis ? `basis ${fmtPct(b)} vs index ${fmtPx(market.index)}` : "basis N/A"}
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="Who pays" v={funded ? who : "N/A"} />
          <Stat k="Hourly funding" v={funded ? `${fmtBpsPerHour(market.fundingHourly)} bp/h` : "N/A"} />
          <Stat k="Projection" v={funded ? annualizedProjection(market.fundingApr).replace("Annualized funding projection: ", "") : "N/A"} />
          <Stat k="Open interest" v={oiOk ? `${fmtQty(market.oiBase)} ${market.base}` : "N/A"} />
        </dl>
        <div className="mt-3 text-sm">
          <p className="text-fg">{funded ? annualizedProjection(market.fundingApr) : "Annualized funding projection: N/A"}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{funded ? FUNDING_PROJECTION_NOTE : "Funding is N/A until a fresh getPerpState read confirms the rate. It is not ranked and it is not used in the score."}</p>
          <p className="mt-2 font-mono text-xs text-muted">
            Selected {fmtUsd(notional)} {isLong ? "long" : "short"} · per hour {carry == null ? "N/A" : fmtUsd(carry, 4)} · per day {carry == null ? "N/A" : fmtUsd(carry * 24, 4)}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
          <Age label="chain mark" state={markFresh} age={ageLabel(market.chainFetchedAt ? Math.floor(market.chainFetchedAt / 1000) : 0, now)} source={market.markSource} when={clockLabel(market.chainFetchedAt ? Math.floor(market.chainFetchedAt / 1000) : 0)} />
          <Age label="index" state={idxFresh} age={ageLabel(market.indexUpdatedAt, now)} source={market.indexSource} when={clockLabel(market.indexUpdatedAt)} />
          <Age label="funding" state={fundState} age={ageLabel(market.fundingUpdatedAt, now)} source={market.fundingSource} when={clockLabel(market.fundingUpdatedAt)} />
          <Age label="open interest" state={oiOk ? chainReadFresh(market.chainFetchedAt, now) : "unknown"} age={ageLabel(market.oiUpdatedAt, now)} source={market.oiSource} when={clockLabel(market.oiUpdatedAt)} />
          <Age label="order book" state={tape.isError && !tape.data ? "unknown" : bookFresh} age={ageLabel(tape.data ? Math.floor(tape.data.fetchedAt / 1000) : 0, now)} source="indexer" when={clockLabel(tape.data ? Math.floor(tape.data.fetchedAt / 1000) : 0)} />
          <Age label="recent trades" state={lastPrint && bookOk ? bookFresh : "unknown"} age={ageLabel(lastPrint, now)} source="indexer" when={clockLabel(lastPrint)} />
        </div>
        <details className="mt-3">
          <summary className="text-xs text-muted">How the score is built — not a recommendation</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {market.parts.map((part) => (
              <li key={part.label} className="text-xs text-muted">
                <span className="font-mono text-fg">{part.label} {part.points.toFixed(0)}/{part.max}. </span>
                {part.note}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Resting book</h3>
            <span className="font-mono text-xs text-muted">{bookOk && tape.data ? `skew ${fmtPct(imbalance)}` : "N/A"}</span>
          </div>
          {!bookOk ? (
            <p className="text-sm text-muted">{tape.isLoading && !tape.data ? "Waiting for the order book." : tape.isError ? "N/A. The order book could not be read." : "N/A. The order book is missing or older than 60 seconds."}</p>
          ) : (
            <Book bids={tape.data?.bids ?? []} asks={tape.data?.asks ?? []} loading={false} />
          )}
        </div>
        <div className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Prints</h3>
          {!bookOk ? (
            <p className="text-sm text-muted">{tape.isLoading && !tape.data ? "Waiting for recent trades." : "N/A. Recent trades are not verified."}</p>
          ) : (
            <Tape fills={tape.data?.fills ?? []} loading={false} failed={false} />
          )}
        </div>
      </div>
      <FundingStrip points={tape.data?.funding ?? []} verified={funded} />
    </section>
  );
}

function Age({ label, state, age, source, when }: { label: string; state: Freshness; age: string; source: string; when: string }) {
  const tone = state === "live" ? "text-lime" : state === "delayed" ? "text-amber" : "text-muted";
  const word = state === "live" ? "live" : state === "delayed" ? "delayed" : state === "stale" ? "stale" : "unknown";
  return <span className={tone}>{label} {word} {age} · {when} · {source}</span>;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="font-mono text-sm text-fg">{v}</dd>
    </div>
  );
}

function Book({ bids, asks, loading }: { bids: { price: number; qty: number }[]; asks: { price: number; qty: number }[]; loading: boolean }) {
  if (loading) return <div className="flex flex-col gap-1">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-4 animate-pulse rounded-sm bg-surface-2" />)}</div>;
  if (!bids.length && !asks.length) return <p className="text-sm text-muted">No resting size. The book is empty or already matched.</p>;
  const rows = [...asks.slice(0, 5).reverse().map((l) => ({ ...l, side: "ask" as const })), ...bids.slice(0, 5).map((l) => ({ ...l, side: "bid" as const }))];
  const max = Math.max(...rows.map((r) => r.qty), 1);
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row, i) => (
        <li key={`${row.side}-${row.price}-${i}`} className="relative font-mono text-xs">
          <span className={"absolute inset-y-0 right-0 " + (row.side === "bid" ? "bg-lime/15" : "bg-down/15")} style={{ width: `${Math.max(8, (row.qty / max) * 100)}%` }} />
          <span className="relative flex justify-between px-1 py-1">
            <span className={row.side === "bid" ? "text-lime" : "text-down"}>{fmtPx(row.price)}</span>
            <span className="text-muted">{fmtQty(row.qty)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tape({ fills, loading, failed }: { fills: { price: number; qty: number; takerIsBid: boolean; timestamp: number; txHash: string }[]; loading: boolean; failed: boolean }) {
  if (loading) return <p className="text-sm text-muted">Waiting for prints…</p>;
  if (failed) return <p className="text-sm text-down">Prints could not be read.</p>;
  if (!fills.length) return <p className="text-sm text-muted">No fills indexed for this pool yet.</p>;
  return (
    <ul className="flex flex-col">
      {fills.slice(0, 8).map((f, i) => (
        <li key={`${f.txHash}-${f.timestamp}-${i}`} className="flex items-center justify-between gap-2 py-1 font-mono text-xs">
          <span className="inline-flex items-center gap-1">
            {f.takerIsBid ? <ArrowUpRight className="size-3 text-lime" /> : <ArrowDownRight className="size-3 text-down" />}
            <span className={f.takerIsBid ? "text-lime" : "text-down"}>{fmtPx(f.price)}</span>
          </span>
          <span className="text-muted">{fmtQty(f.qty)}</span>
          <span className="text-muted">{ageLabel(f.timestamp)}</span>
        </li>
      ))}
    </ul>
  );
}

function FundingStrip({ points, verified }: { points: { timestamp: number; fundingPerWindow: number }[]; verified: boolean }) {
  if (!verified || points.length < 2) return null;
  const values = points.map((p) => p.fundingPerWindow);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const w = 280;
  const h = 48;
  const d = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Funding settlements</h3>
        <span className="font-mono text-xs text-muted">{points.length} updates</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" role="img" aria-label="Funding rate history">
        <path d={d} fill="none" stroke="var(--color-lime)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function Blotter({ markets, now }: { markets: Market[]; now: number }) {
  const positions = useDesk((s) => s.positions);
  const closePaper = useDesk((s) => s.closePaper);
  const byId = new Map(markets.map((m) => [m.id, m]));
  const rows = positions.map((p) => {
    const m = byId.get(p.marketId);
    const fresh = m ? markState(m, now) : "unknown";
    const markOk = m ? readUsable(fresh) : false;
    const mark = markOk && m ? m.mark : null;
    const pnl = mark == null ? null : (mark - p.entry) * p.qty * (p.isLong ? 1 : -1);
    return { ...p, mark, pnl, fresh };
  });
  const known = rows.filter((r) => r.pnl != null);
  const total = known.length === rows.length ? known.reduce((s, r) => s + (r.pnl ?? 0), 0) : null;
  return (
    <section className="rounded-md border border-line bg-surface">
      <header className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium">Paper blotter · simulated</h2>
        <span className={"font-mono text-sm " + (total == null ? "text-muted" : total >= 0 ? "text-lime" : "text-down")}>{total == null ? "N/A" : `${total >= 0 ? "+" : "−"}${fmtUsd(Math.abs(total))}`}</span>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">Nothing parked. Paper rows never receive a transaction hash.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">SIM</span>
              <span className="min-w-24 font-mono text-sm">{r.symbol}</span>
              <span className={"text-xs " + (r.isLong ? "text-lime" : "text-down")}>{r.isLong ? "LONG" : "SHORT"} {r.leverage}x</span>
              <span className="font-mono text-xs text-muted">{fmtQty(r.qty)} @ {fmtPx(r.entry)} → {r.mark == null ? "N/A" : fmtPx(r.mark)} ({r.fresh})</span>
              <span className={"ml-auto font-mono text-sm " + (r.pnl == null ? "text-muted" : r.pnl >= 0 ? "text-lime" : "text-down")}>{r.pnl == null ? "N/A" : `${r.pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(r.pnl))}`}</span>
              <button type="button" onClick={() => closePaper(r.id)} className="rounded-md p-2 text-muted hover:text-fg" aria-label={`Close simulated ${r.symbol}`}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
