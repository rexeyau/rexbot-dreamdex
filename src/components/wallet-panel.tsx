import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { accountSnapshot, botPermissions } from "@/lib/markets";
import { useDesk } from "@/lib/desk-store";
import { useSession } from "@/lib/session";
import { ageLabel, fmtPx, fmtQty, fmtUsd, fundingDollars, rawToNumber, type Market } from "@/lib/perp-math";
import { explorerTx, HIDEKI_CHAIN_ID, markState, shortAddr } from "@/lib/freshness";
import { connectWallet, switchToHideki } from "@/lib/wallet";
import { BotPanel } from "@/components/bot-panel";
import { BOT_READY_TEXT, botLinkStatus, positionVisible } from "@/lib/bot-status";
import { INDEX_WAIT, fundingVerified, readUsable } from "@/lib/data-status";
import { useBotSession } from "@/lib/bot-session";
import { grantConnected } from "@/lib/operator";
import { useDeskNav } from "@/lib/desk-nav";

export function WalletPanel({ markets }: { markets: Market[] }) {
  const account = useDesk((s) => s.account);
  const setAccount = useDesk((s) => s.setAccount);
  const address = useSession((s) => s.address);
  const chainId = useSession((s) => s.chainId);
  const setSession = useSession((s) => s.setSession);
  const connectError = useSession((s) => s.connectError);
  const setConnectError = useSession((s) => s.setConnectError);
  const [draft, setDraft] = useState(account);
  const [busy, setBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [awaitingPosition, setAwaitingPosition] = useState(false);
  const [settledSeq, setSettledSeq] = useState(0);
  const [watchUntil, setWatchUntil] = useState(0);
  const qc = useQueryClient();
  const nav = useDeskNav();
  const bot = useBotSession();
  const botOwner = useDesk((s) => s.botOwner);

  const lookup = account.trim();
  const valid = /^0x[a-fA-F0-9]{40}$/.test(lookup);
  const q = useQuery({
    queryKey: ["snapshot", lookup.toLowerCase()],
    queryFn: () => accountSnapshot({ data: { account: lookup } }),
    enabled: valid,
    refetchInterval: 20_000,
  });
  const pools = markets
    .filter((market) => /^0x[a-fA-F0-9]{40}$/.test(market.pool))
    .slice(0, 40)
    .map((market) => ({ pool: market.pool, symbol: market.symbol }));
  const ownerOk = /^0x[a-fA-F0-9]{40}$/.test(botOwner) && botOwner.toLowerCase() !== (bot.address ?? "").toLowerCase();
  const perms = useQuery({
    queryKey: ["bot-perms", botOwner.toLowerCase(), (bot.address ?? "").toLowerCase(), pools.map((pool) => pool.pool.toLowerCase()).join("|")],
    queryFn: () => botPermissions({ data: { owner: botOwner, operator: bot.address as `0x${string}`, pools } }),
    enabled: Boolean(bot.address) && ownerOk && pools.length > 0,
    refetchInterval: 20_000,
  });
  const granted = perms.isSuccess && !perms.isError ? (perms.data?.markets ?? []).filter((row) => grantConnected(row)).length : 0;
  const reading = Boolean(bot.address && ownerOk && pools.length > 0 && (perms.isLoading || (perms.isFetching && !perms.data)));
  const stt = perms.data?.operatorStt == null ? null : Number(perms.data.operatorStt);
  const linkStatus = botLinkStatus({
    hasBot: Boolean(bot.address),
    ownerSet: ownerOk,
    reading,
    readError: perms.isError,
    granted,
    stt: Number.isFinite(stt) ? stt : null,
  });
  const botReady = linkStatus === "ready";
  useEffect(() => {
    if (!nav.seq || !/^0x[a-fA-F0-9]{40}$/.test(nav.account)) return;
    setAccount(nav.account);
    setDraft(nav.account);
    setAwaitingPosition(true);
    setWatchUntil(Date.now() + 45_000);
    let cancel = false;
    void qc.invalidateQueries({ queryKey: ["snapshot", nav.account.toLowerCase()] }).finally(() => {
      if (!cancel) {
        setAwaitingPosition(false);
        setSettledSeq(nav.seq);
      }
    });
    return () => {
      cancel = true;
    };
  }, [nav.seq, nav.account, qc, setAccount]);
  useEffect(() => {
    if (!nav.seq) return;
    document.getElementById("open-positions")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [nav.seq, q.dataUpdatedAt, awaitingPosition]);
  const byId = new Map(markets.map((m) => [m.id.toLowerCase(), m]));
  const focused = Boolean(nav.hash) && lookup.toLowerCase() === nav.account.toLowerCase();
  const waiting = focused && awaitingPosition;
  const positionSeen = focused && q.isSuccess && q.data ? positionVisible(q.data.positions, nav.marketId, nav.isLong) : false;
  const indexing = focused && !awaitingPosition && settledSeq === nav.seq && q.isSuccess && !positionSeen;
  useEffect(() => {
    if (!focused || positionSeen || watchUntil <= Date.now()) return;
    const id = window.setInterval(() => {
      if (Date.now() > watchUntil) return;
      void qc.invalidateQueries({ queryKey: ["snapshot", lookup.toLowerCase()] });
    }, 8_000);
    return () => window.clearInterval(id);
  }, [focused, positionSeen, watchUntil, lookup, qc]);

  async function connect() {
    setBusy(true);
    setConnectError(null);
    try {
      const next = await connectWallet();
      setSession(next);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Wallet className="size-4 text-lime" />
          <h2 className="text-sm font-medium">Wallet</h2>
          {address ? <span className="font-mono text-xs text-fg">{shortAddr(address)}</span> : null}
          <button type="button" onClick={() => void connect()} disabled={busy} className="ml-auto rounded-md bg-lime px-3 py-1.5 text-sm font-semibold text-lime-ink disabled:opacity-40">
            {address ? "Reconnect" : "Connect wallet"}
          </button>
        </div>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Injected wallets only. This connect button is the MetaMask-style signer. A watched address below is not a connection, and it cannot sign.
        </p>
        {address && chainId !== HIDEKI_CHAIN_ID ? (
          <div className="mt-3 rounded-md border border-down/40 bg-bg p-3 text-sm">
            <p className="text-down">Wrong network. This wallet is on chain {chainId ?? "unknown"}, not Hideki 50383.</p>
            <button
              type="button"
              className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs"
              onClick={() => void switchToHideki().then(() => setSession({ address, chainId: HIDEKI_CHAIN_ID })).catch((error: unknown) => setConnectError(error instanceof Error ? error.message : "Switch failed"))}
            >
              Switch to Hideki
            </button>
          </div>
        ) : null}
        {connectError ? <p className="mt-2 text-sm text-down">{connectError}</p> : null}
        {botReady ? (
          <p className="mt-3 text-xs leading-relaxed text-lime">{BOT_READY_TEXT}</p>
        ) : (
          <p className={"mt-3 text-xs " + (address ? "text-muted" : "text-down")}>{address ? `Injected signer ${shortAddr(address)} on chain ${chainId ?? "unknown"}.` : "No injected wallet is connected."}</p>
        )}
      </section>
      <BotPanel markets={markets} />
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Watch address</h2>
        <p className="mt-2 text-sm text-muted">Read-only. REXBOT can inspect this public address but cannot sign or trade for it.</p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const next = draft.trim();
            if (/^(0x)?[a-fA-F0-9]{64}$/.test(next)) {
              setWatchError("That looks like a private key. Paste a public address only. A watched address cannot sign.");
              return;
            }
            if (/^0x[a-fA-F0-9]{40}$/.test(next)) {
              setWatchError(null);
              setAccount(next);
            } else {
              setWatchError("Paste a public address. A watched address cannot sign.");
            }
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Public address to watch" spellCheck={false} className="w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm" />
          <button type="submit" disabled={!draft.trim()} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-40">
            Watch
          </button>
        </form>
        {watchError ? <p className="mt-2 text-xs text-down">{watchError}</p> : null}
      </section>
      {q.isLoading ? <p className="text-sm text-muted">Reading the watched address…</p> : null}
      {q.isError ? <p className="text-sm text-down">{q.error instanceof Error ? q.error.message : "Lookup failed"}</p> : null}
      {q.data ? (
        <div>
          <p className="text-xs text-muted">Watching {shortAddr(lookup)}. Read-only. This is not a connected wallet.</p>
          <div className="mt-3">
            <SnapshotView data={q.data} byId={byId} focused={focused} awaiting={waiting} indexing={indexing} seen={positionSeen} owner={lookup} navHash={nav.hash} navMarket={nav.marketId} navLong={nav.isLong} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SnapshotView({
  data,
  byId,
  focused,
  awaiting,
  indexing,
  seen,
  owner,
  navHash,
  navMarket,
  navLong,
}: {
  data: Awaited<ReturnType<typeof accountSnapshot>>;
  byId: Map<string, Market>;
  focused: boolean;
  awaiting: boolean;
  indexing: boolean;
  seen: boolean;
  owner: string;
  navHash: string;
  navMarket: string;
  navLong: boolean;
}) {
  return (
    <>
      <section className="rounded-md border border-line bg-surface p-4">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Balances</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="STT gas" v={data.stt == null ? "—" : fmtUsd(Number(data.stt)).replace("$", "")} />
          <Stat k="Voucher floor" v={data.voucherFloor == null ? "—" : fmtUsd(Number(data.voucherFloor))} />
          <Stat k="Available margin" v={data.margin ? fmtUsd(Number(data.margin.unlocked)) : "—"} />
          <Stat k="Locked margin" v={data.margin ? fmtUsd(Number(data.margin.locked)) : "—"} />
          <Stat k="Equity" v={data.margin ? fmtUsd(Number(data.margin.equity)) : "—"} />
          <Stat k="Withdrawable" v={data.margin ? fmtUsd(Number(data.margin.withdrawable)) : "—"} />
          <Stat k="Margin status" v={data.margin?.status ?? "—"} />
          <Stat k="Realized PnL" v="not in indexer" />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Voucher floor is the non-withdrawable paper USDso still on the account from getPerpVoucher. Available margin is unlocked collateral. Signed funding total {data.fundingTotal == null ? "is unavailable" : `is ${data.fundingTotal} USDso`}. The indexer does not document whether a positive FundingPayment is paid or received, so it is not renamed.
        </p>
        <p className="mt-1 font-mono text-xs text-muted">Read {ageLabel(Math.floor(data.fetchedAt / 1000))} ago · SDK {data.sdkVersion}</p>
        {data.errors.length ? (
          <details className="mt-2">
            <summary className="text-xs text-down">{data.errors.length} read error{data.errors.length === 1 ? "" : "s"}</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {data.errors.map((err) => (
                <li key={err} className="break-all text-xs text-muted">{err}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <section id="open-positions" className="rounded-md border border-line bg-surface">
        <header className="border-b border-line px-4 py-3 text-sm">Open positions</header>
        {focused && awaiting ? <p className="px-4 py-3 text-sm text-muted" aria-busy="true">Reading the owner account…</p> : null}
        {indexing && !seen ? <p className="px-4 py-3 text-sm text-muted">{INDEX_WAIT}</p> : null}
        {data.positions.length === 0 ? (
          focused ? null : <p className="px-4 py-4 text-sm text-muted">No open perp size on this account.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.positions.map((p) => {
              const m = byId.get(p.marketId.toLowerCase());
              const fresh = m ? markState(m) : "unknown";
              const markOk = m ? readUsable(fresh) : false;
              const funded = m ? fundingVerified(m) : false;
              const mark = markOk && m ? m.mark : null;
              const pnl = mark == null || !m ? null : (mark - p.entry) * p.size * (p.isLong ? 1 : -1);
              const carry = funded && m && mark != null ? fundingDollars(m.fundingHourly, p.size * mark, p.isLong) : null;
              const hash = focused && p.marketId.toLowerCase() === navMarket.toLowerCase() && p.isLong === navLong ? navHash : "";
              return (
                <li key={p.marketId + String(p.isLong)} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-2">
                  <div className="font-mono">
                    {p.base}-PERP <span className={p.isLong ? "text-lime" : "text-down"}>{p.isLong ? "LONG" : "SHORT"}</span>
                  </div>
                  <div className="font-mono text-xs text-muted sm:text-right">
                    {fmtQty(p.size)} @ {fmtPx(p.entry)}
                    {p.leverageX != null ? ` · ${p.leverageX.toFixed(2)}x` : ""}
                  </div>
                  <div className="font-mono text-xs text-muted">
                    Mark {mark == null ? "N/A" : fmtPx(mark)} {m ? `(${fresh})` : ""}
                  </div>
                  <div className="font-mono text-xs text-muted sm:text-right">Liq {markOk && p.liq != null ? fmtPx(p.liq) : "N/A"}</div>
                  <div className={"font-mono text-xs " + (pnl == null ? "text-muted" : pnl >= 0 ? "text-lime" : "text-down")}>
                    uPnL {pnl == null ? "N/A" : `${pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(pnl))}`}
                  </div>
                  <div className="font-mono text-xs text-muted sm:text-right">
                    Funding / h {carry == null ? "N/A" : `${carry >= 0 ? "+" : "−"}${fmtUsd(Math.abs(carry), 4)}`}
                  </div>
                  <button
                    type="button"
                    className="mt-1 w-fit rounded-md border border-line px-2 py-1 text-xs"
                    onClick={() => sharePositionCard({
                      base: p.base,
                      isLong: p.isLong,
                      size: fmtQty(p.size),
                      entry: fmtPx(p.entry),
                      mark: mark == null ? "N/A" : fmtPx(mark),
                      owner: shortAddr(owner),
                      hash,
                    })}
                  >
                    Share card
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="rounded-md border border-line bg-surface">
        <header className="border-b border-line px-4 py-3 text-sm">Open orders</header>
        {data.orders.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No resting orders indexed for this account.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.orders.map((o, i) => {
              const m = byId.get(o.marketId.toLowerCase());
              const px = rawToNumber(o.price, m?.quoteDecimals ?? 18);
              const qty = rawToNumber(o.qty, m?.baseDecimals ?? 18);
              return (
                <li key={`${o.marketId}-${o.price}-${i}`} className="flex flex-wrap gap-3 px-4 py-3 font-mono text-xs">
                  <span>{m?.base ?? shortAddr(o.marketId)}-PERP</span>
                  <span className={o.isBid ? "text-lime" : "text-down"}>{o.isBid ? "BID" : "ASK"}</span>
                  <span className="text-muted">{fmtQty(qty)} @ {fmtPx(px)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="rounded-md border border-line bg-surface">
        <header className="border-b border-line px-4 py-3 text-sm">Recent fills</header>
        {data.fills.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No fills indexed for this account.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.fills.map((f, i) => {
              const m = byId.get(f.marketId.toLowerCase());
              const px = rawToNumber(f.price, m?.quoteDecimals ?? 18);
              const qty = rawToNumber(f.qty, m?.baseDecimals ?? 18);
              return (
                <li key={`${f.txHash}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-3 font-mono text-xs">
                  <span>{m?.base ?? "PERP"}</span>
                  <span className={f.takerIsBid ? "text-lime" : "text-down"}>{fmtPx(px)}</span>
                  <span className="text-muted">{fmtQty(qty)}</span>
                  <span className="text-muted">{ageLabel(Number(f.timestamp))}</span>
                  <a className="ml-auto text-lime underline" href={explorerTx(f.txHash)} target="_blank" rel="noreferrer">
                    {f.txHash.slice(0, 10)}…
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-4 pb-3 text-xs text-muted">Explorer links open the Hideki explorer at explorer.testnet.somnia.network/tokyo.</p>
      </section>
    </>
  );
}

function sharePositionCard(input: { base: string; isLong: boolean; size: string; entry: string; mark: string; owner: string; hash: string }) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const pen = canvas.getContext("2d");
  if (!pen) return;
  pen.fillStyle = "#0e1210";
  pen.fillRect(0, 0, 960, 540);
  pen.fillStyle = "#d6f25c";
  pen.font = "600 28px monospace";
  pen.fillText("REXBOT", 48, 72);
  pen.fillStyle = "#9aa59c";
  pen.font = "18px monospace";
  pen.fillText("Hideki testnet · chain 50383", 48, 108);
  pen.fillStyle = "#e8eee4";
  pen.font = "600 48px monospace";
  pen.fillText(`${input.base}-PERP`, 48, 190);
  pen.fillStyle = input.isLong ? "#d6f25c" : "#ff6b5a";
  pen.font = "600 28px monospace";
  pen.fillText(input.isLong ? "LONG" : "SHORT", 48, 236);
  pen.fillStyle = "#e8eee4";
  pen.font = "22px monospace";
  const lines = [
    `Size ${input.size} @ ${input.entry}`,
    `Mark ${input.mark}`,
    `Owner ${input.owner}`,
    input.hash ? `Tx ${input.hash.slice(0, 10)}…${input.hash.slice(-4)}` : "No receipt stored on this device",
  ];
  lines.forEach((line, index) => pen.fillText(line, 48, 300 + index * 36));
  pen.fillStyle = "#8b978f";
  pen.font = "16px monospace";
  pen.fillText("Open position on the DreamDEX owner account. Not a forecast.", 48, 490);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `rexbot-${input.base}-${input.isLong ? "long" : "short"}.png`;
  link.click();
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="font-mono text-sm">{v}</dd>
    </div>
  );
}
