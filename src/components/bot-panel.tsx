import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy } from "lucide-react";
import { accountSnapshot, botPermissions } from "@/lib/markets";
import { useDesk } from "@/lib/desk-store";
import { createBot, deleteBot, lockBot, unlockBot, useBotSession } from "@/lib/bot-session";
import { grantConnected } from "@/lib/operator";
import { botLinkLabel, botLinkStatus } from "@/lib/bot-status";
import { SECURITY_LINE } from "@/lib/data-status";
import { HIDEKI_CHAIN_ID, SDK_VERSION, shortAddr } from "@/lib/freshness";
import { fmtUsd, type Market } from "@/lib/perp-math";

const DREAMDEX = "https://app.testnet.dreamdex.io";

export function BotPanel({ markets }: { markets: Market[] }) {
  const bot = useBotSession();
  const owner = useDesk((s) => s.botOwner);
  const setOwner = useDesk((s) => s.setBotOwner);
  const [ownerDraft, setOwnerDraft] = useState(owner);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [regen, setRegen] = useState(false);
  const [locking, setLocking] = useState(false);
  const pools = markets
    .filter((market) => /^0x[a-fA-F0-9]{40}$/.test(market.pool))
    .slice(0, 40)
    .map((market) => ({ pool: market.pool, symbol: market.symbol }));
  const ownerOk = isAddress(owner) && owner.toLowerCase() !== (bot.address ?? "").toLowerCase();
  const perms = useQuery({
    queryKey: ["bot-perms", owner.toLowerCase(), (bot.address ?? "").toLowerCase(), pools.map((pool) => pool.pool.toLowerCase()).join("|")],
    queryFn: () => botPermissions({ data: { owner, operator: bot.address as `0x${string}`, pools } }),
    enabled: Boolean(bot.address) && ownerOk && pools.length > 0,
    refetchInterval: 20_000,
  });
  const ownerSnap = useQuery({
    queryKey: ["snapshot", owner.toLowerCase()],
    queryFn: () => accountSnapshot({ data: { account: owner } }),
    enabled: ownerOk,
    refetchInterval: 20_000,
  });
  const rows = perms.data?.markets ?? [];
  const granted = perms.isSuccess && !perms.isError ? rows.filter((row) => grantConnected(row)).length : 0;
  const reading = Boolean(bot.address && ownerOk && pools.length > 0 && (perms.isLoading || (perms.isFetching && !perms.data)));
  const stt = perms.data?.operatorStt == null ? null : Number(perms.data.operatorStt);
  const status = botLinkStatus({
    hasBot: Boolean(bot.address),
    ownerSet: ownerOk,
    reading,
    readError: perms.isError,
    granted,
    stt: Number.isFinite(stt) ? stt : null,
  });
  const statusTone = status === "ready" ? "text-lime" : status === "permission" || status === "gas" ? "text-amber" : "text-muted";

  async function onCreate(): Promise<boolean> {
    setError(null);
    setNote(null);
    if (password.length < 8) {
      setError("Use at least 8 characters. This password never leaves the browser.");
      return false;
    }
    if (password !== confirm) {
      setError("The passwords do not match. No key was created.");
      return false;
    }
    setBusy(true);
    try {
      const next = await createBot(password);
      setPassword("");
      setConfirm("");
      setNote(`Bot address ${next} is encrypted in this browser. Only the public address is shown.`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The bot key was not created.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onUnlock() {
    setError(null);
    setBusy(true);
    try {
      await unlockBot(password);
      setPassword("");
      setNote("Bot key unlocked in this tab. It was not sent anywhere.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unlock failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    if (!bot.address) return;
    await navigator.clipboard.writeText(bot.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">DreamDEX bot connection</h2>
        <span className={"font-mono text-xs " + statusTone}>{botLinkLabel(status)}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        The bot can place, cancel, and reduce orders for one DreamDEX wallet. It cannot withdraw or transfer that wallet's funds. Link it to Wallet 2 or Wallet 3, and move in only the test margin you want it to trade. {SECURITY_LINE}
      </p>
      {!bot.available ? (
        <p className="mt-3 text-xs leading-relaxed text-down">
          Web Crypto is unavailable here, so REXBOT will not invent a bot key. Use Bot Execution Mode on the ticket and run the signer on your own machine. Nothing is marked ready to trade.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-4">
          <li>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">1. Create bot wallet</h3>
            {bot.address ? (
              <div className="mt-2">
                <p className="break-all font-mono text-sm text-fg">{bot.address}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copyAddress()} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs">
                    <Copy className="size-3" />
                    {copied ? "Copied" : "Copy public address"}
                  </button>
                  <button type="button" onClick={() => { setLocking(true); setError(null); }} className="rounded-md border border-line px-2 py-1.5 text-xs">
                    Disconnect locally
                  </button>
                  <button type="button" onClick={() => { setRegen((value) => !value); setError(null); }} className="rounded-md border border-line px-2 py-1.5 text-xs">
                    Regenerate bot wallet
                  </button>
                </div>
                {locking ? (
                  <div className="mt-2 rounded-md border border-amber/40 bg-bg p-2">
                    <p className="text-xs leading-relaxed text-amber">
                      Disconnecting may remove access to the current local signer until you unlock the same key. The encrypted key stays on this device and is not shown. This does not remove the DreamDEX grant.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => { lockBot(); setLocking(false); setNote("Locked locally. The encrypted key remains in this browser."); }} className="rounded-md border border-line px-2 py-1.5 text-xs">Lock signer</button>
                      <button type="button" onClick={() => setLocking(false)} className="rounded-md border border-line px-2 py-1.5 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : null}
                {regen ? (
                  <div className="mt-2 rounded-md border border-amber/40 bg-bg p-2">
                    <p className="text-xs leading-relaxed text-amber">
                      Regenerating replaces {bot.address} and may remove access to the current local signer. The old key is deleted from this browser and is not shown. Remove that address in DreamDEX (Bots, Remove access) or the grant stays behind. Clearing storage later has the same effect on whichever key is current.
                    </p>
                    <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New local password" className="mt-2 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs" />
                    <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" className="mt-2 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs" />
                    <button type="button" disabled={busy} onClick={() => void onCreate().then((ok) => { if (ok) setRegen(false); })} className="mt-2 rounded-md border border-down/50 px-2 py-1.5 text-xs text-down">
                      Replace local key
                    </button>
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-muted">{bot.unlocked ? "Unlocked in this tab. The private key is not shown." : "Locked. Enter the local password to sign."}</p>
                {!bot.unlocked && !regen ? (
                  <div className="mt-2 flex gap-2">
                    <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Local password" className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs" />
                    <button type="button" disabled={busy || password.length < 8} onClick={() => void onUnlock()} className="rounded-md border border-line px-2 py-1.5 text-xs disabled:opacity-40">Unlock</button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Local password" className="rounded-md border border-line bg-bg px-3 py-2 text-sm" />
                <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" className="rounded-md border border-line bg-bg px-3 py-2 text-sm" />
                <button type="button" disabled={busy} onClick={() => void onCreate()} className="rounded-md bg-lime px-3 py-2 text-sm font-semibold text-lime-ink disabled:opacity-40">
                  {busy ? "Creating…" : "Create REXBOT bot connection"}
                </button>
                <p className="text-xs leading-relaxed text-muted">Generated in this browser. The private key is encrypted with your password and stored only on this device. It is not shown, logged, or sent.</p>
              </div>
            )}
          </li>
          <li>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">2. Link inside DreamDEX</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
              <li>Open DreamDEX testnet.</li>
              <li>Open the wallet menu.</li>
              <li>Select the DreamDEX wallet holding Perps margin. Prefer Wallet 2 or Wallet 3, not the main wallet.</li>
              <li>Select Link a bot.</li>
              <li>Paste the REXBOT bot public address.</li>
              <li>Enable Perps.</li>
              <li>Leave Send it for gas enabled.</li>
              <li>Press Add bot.</li>
              <li>Wait for Access granted.</li>
            </ol>
            <a href={DREAMDEX} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-lime underline">Open DreamDEX testnet</a>
            <p className="mt-2 text-xs leading-relaxed text-muted">Perps access is per market. A market listed later needs the bot added again. Removing the bot is the red X on the Bots tab, then Remove access. Clearing this browser's storage deletes the local key, so remove that bot in DreamDEX as well.</p>
          </li>
          <li>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">3. DreamDEX owner address</h3>
            <form
              className="mt-2 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                const next = ownerDraft.trim();
                if (/^(0x)?[a-fA-F0-9]{64}$/.test(next)) {
                  setError("That looks like a private key. Paste the public DreamDEX address only.");
                  return;
                }
                if (!isAddress(next)) {
                  setError("Paste the public DreamDEX address. It is 0x and 40 hex characters, not a private key.");
                  return;
                }
                setError(null);
                setOwner(next);
              }}
            >
              <input value={ownerDraft} onChange={(e) => setOwnerDraft(e.target.value)} placeholder="0x public address, not a private key" spellCheck={false} className="w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm" />
              <button type="submit" disabled={!ownerDraft.trim()} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-40">Use owner</button>
            </form>
            <p className="mt-1 text-xs text-muted">This is the public trading wallet. REXBOT cannot sign as it.</p>
          </li>
          <li>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">4. Verify on-chain</h3>
            <p className="mt-1 text-xs text-muted">Ready to trade appears only after place, cancel, and reduce are authorized for this owner and the bot has STT for gas. There is no manual verified switch. A local bot wallet by itself is not a connection.</p>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-muted">DreamDEX owner</dt><dd className="text-right break-all font-mono">{ownerOk ? owner : "—"}</dd>
              <dt className="text-muted">Bot signer</dt><dd className="text-right break-all font-mono">{bot.address ?? "—"}</dd>
              <dt className="text-muted">Gas payer</dt><dd className="text-right break-all font-mono">{bot.address ?? "—"}</dd>
              <dt className="text-muted">Network</dt><dd className="text-right font-mono">Hideki {perms.data?.chainId ?? HIDEKI_CHAIN_ID}</dd>
              <dt className="text-muted">Permission</dt><dd className="text-right font-mono">{botLinkLabel(status) || "—"}{perms.isSuccess ? ` · ${granted} / ${perms.data.markets.length}` : ""}</dd>
              <dt className="text-muted">Bot STT</dt><dd className="text-right font-mono">{perms.data?.operatorStt == null ? "—" : perms.data.operatorStt}</dd>
              <dt className="text-muted">Owner equity</dt><dd className="text-right font-mono">{ownerSnap.data?.margin ? fmtUsd(Number(ownerSnap.data.margin.equity)) : "—"}</dd>
              <dt className="text-muted">Available margin</dt><dd className="text-right font-mono">{ownerSnap.data?.margin ? fmtUsd(Number(ownerSnap.data.margin.unlocked)) : "—"}</dd>
              <dt className="text-muted">Open positions</dt><dd className="text-right font-mono">{ownerSnap.data ? String(ownerSnap.data.positions.length) : "—"}</dd>
              <dt className="text-muted">Open orders</dt><dd className="text-right font-mono">{ownerSnap.data ? String(ownerSnap.data.orders.length) : "—"}</dd>
              <dt className="text-muted">SDK</dt><dd className="text-right font-mono">{perms.data?.sdkVersion ?? SDK_VERSION}</dd>
              <dt className="text-muted">Registry</dt><dd className="text-right break-all font-mono">{perms.data?.registry ? shortAddr(perms.data.registry) : "—"} {perms.data?.registrySource ?? ""}</dd>
            </dl>
            {perms.data?.registryError ? <p className="mt-2 text-xs text-down">{perms.data.registryError}</p> : null}
            {perms.isError ? <p className="mt-2 text-xs text-down">{perms.error instanceof Error ? perms.error.message : "Permission read failed. Not ready to trade."}</p> : null}
            {perms.data?.errors.length ? <p className="mt-2 text-xs text-down">{perms.data.errors[0]}</p> : null}
            {perms.data?.markets.length ? (
              <ul className="mt-2 flex flex-col gap-1">
                {perms.data.markets.map((row) => (
                  <li key={row.pool} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="font-mono text-muted">{row.symbol}</span>
                    <span className={"font-mono " + (grantConnected(row) ? "text-lime" : "text-muted")}>
                      {row.error ? "read failed" : `place ${yn(row.place)} · cancel ${yn(row.cancel)} · reduce ${yn(row.reduce)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        </ol>
      )}
      {bot.address ? (
        <div className="mt-4 border-t border-line pt-3">
          <button type="button" onClick={() => setRemoving((value) => !value)} className="text-xs text-down">Delete local bot key</button>
          {removing ? (
            <div className="mt-2">
              <p className="text-xs leading-relaxed text-muted">
                Deleting {bot.address} removes the encrypted key from this browser. It does not remove the DreamDEX grant. Open DreamDEX, Bots, and press Remove access for this address before you delete it. Clearing browser storage later has the same effect.
              </p>
              <button
                type="button"
                className="mt-2 rounded-md border border-down/50 px-2 py-1.5 text-xs text-down"
                onClick={() => {
                  deleteBot();
                  setRemoving(false);
                  setNote("Local bot key deleted. Remove the same address in DreamDEX if it is still linked.");
                }}
              >
                Delete local key
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {note ? <p className="mt-3 text-xs text-lime">{note}</p> : null}
      {error ? <p className="mt-3 text-xs text-down">{error}</p> : null}
    </section>
  );
}

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function yn(value: boolean | null): string {
  if (value == null) return "—";
  return value ? "yes" : "no";
}
