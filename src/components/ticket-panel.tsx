import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import { liveQuote, marketTape, poolRisk, quoteMax, accountSnapshot, botPermissions } from "@/lib/markets";
import { useDesk } from "@/lib/desk-store";
import { useSession } from "@/lib/session";
import {
  fmtBpsPerHour,
  fmtPx,
  fmtQty,
  fmtUsd,
  fundingLabel,
  limitFromBook,
  liqPrice,
  orderMarginUtilization,
  quantityForNotional,
  rawToNumber,
  visibleFill,
  type Market,
} from "@/lib/perp-math";
import {
  chainReadFresh,
  executionBlock,
  explorerTx,
  HIDEKI_CHAIN_ID,
  HIDEKI_RPC,
  indexState,
  markState,
  SDK_VERSION,
  shortAddr,
} from "@/lib/freshness";
import { limitedByHint, tradeChecks } from "@/lib/risk";
import { sendPerpOrder, sendPerpOrderFor, setAccountLeverage, type SendOutcome } from "@/lib/wallet";
import { unlockBot, useBotSession } from "@/lib/bot-session";
import { grantConnected } from "@/lib/operator";
import { BOT_READY_TEXT, botLinkLabel, botLinkStatus, sendButton } from "@/lib/bot-status";
import { openOwnerPositions } from "@/lib/desk-nav";
import { annualizedProjection, FUNDING_PROJECTION_NOTE, fundingVerified, readUsable } from "@/lib/data-status";

const UNAVAILABLE =
  "Unavailable: the protocol does not expose enough information for an exact client-side liquidation estimate.";

export function Ticket({ market }: { market: Market }) {
  const notional = useDesk((s) => s.notional);
  const setNotional = useDesk((s) => s.setNotional);
  const leverage = useDesk((s) => s.leverage);
  const setLeverage = useDesk((s) => s.setLeverage);
  const isLong = useDesk((s) => s.isLong);
  const setIsLong = useDesk((s) => s.setIsLong);
  const maker = useDesk((s) => s.maker);
  const setMaker = useDesk((s) => s.setMaker);
  const stop = useDesk((s) => s.stop);
  const setStop = useDesk((s) => s.setStop);
  const target = useDesk((s) => s.target);
  const setTarget = useDesk((s) => s.setTarget);
  const mode = useDesk((s) => s.mode);
  const openPaper = useDesk((s) => s.openPaper);
  const addEvidence = useDesk((s) => s.addEvidence);
  const updateEvidence = useDesk((s) => s.updateEvidence);
  const removeEvidence = useDesk((s) => s.removeEvidence);
  const address = useSession((s) => s.address);
  const chainId = useSession((s) => s.chainId);
  const [capDraft, setCapDraft] = useState("");
  const [capNote, setCapNote] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const sent = useRef(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [warnLiveBot, setWarnLiveBot] = useState(false);
  const [signer, setSigner] = useState<"injected" | "bot">("injected");
  const [botPassword, setBotPassword] = useState("");
  const [botUnlockNote, setBotUnlockNote] = useState<string | null>(null);
  const bot = useBotSession();
  const botOwner = useDesk((s) => s.botOwner);
  const qc = useQueryClient();

  const tape = useQuery({
    queryKey: ["tape", market.id],
    queryFn: () => marketTape({ data: { marketId: market.id } }),
    refetchInterval: 12_000,
  });
  const risk = useQuery({
    queryKey: ["risk", market.pool],
    queryFn: () => poolRisk({ data: { pool: market.pool } }),
    enabled: /^0x[a-fA-F0-9]{40}$/.test(market.pool),
    refetchInterval: 20_000,
  });
  const bid = tape.data?.bids[0];
  const ask = tape.data?.asks[0];
  const bookFresh = tape.data ? chainReadFresh(tape.data.fetchedAt) : "unknown";
  const limit = limitFromBook({
    isLong,
    cross: !maker,
    tickRaw: market.tickRaw,
    quoteDecimals: market.quoteDecimals,
    bidRaw: bid?.priceRaw ?? null,
    askRaw: ask?.priceRaw ?? null,
  });
  const sized = limit.ok
    ? quantityForNotional(market, limit.priceRaw, notional)
    : { quantityRaw: "0", unsnappedRaw: "0", qty: 0, notional: 0, belowMin: true };
  const fill = visibleFill({
    isLong,
    cross: !maker,
    limit: limit.price,
    qty: sized.qty,
    bids: tape.data?.bids ?? [],
    asks: tape.data?.asks ?? [],
    mark: market.mark,
  });
  const spreadBps =
    bid && ask && ask.price >= bid.price ? ((ask.price - bid.price) / ((ask.price + bid.price) / 2)) * 10_000 : null;
  const markGapBps = limit.ok && market.mark > 0 ? (Math.abs(limit.price - market.mark) / market.mark) * 10_000 : null;
  const blocked = executionBlock(market);
  const usingBot = mode === "live" && signer === "bot";
  const injected = address && /^0x[a-fA-F0-9]{40}$/.test(address) ? address : "";
  const ownerOk = /^0x[a-fA-F0-9]{40}$/.test(botOwner) && botOwner.toLowerCase() !== (bot.address ?? "").toLowerCase();
  const account = usingBot ? (ownerOk ? botOwner : "") : injected;
  const wallet = usingBot ? "bot" : !injected ? "none" : chainId === HIDEKI_CHAIN_ID ? "ok" : "wrong-network";
  const quoteReady = usingBot ? ownerOk : wallet === "ok";
  const perms = useQuery({
    queryKey: ["bot-perms", "ticket", market.pool.toLowerCase(), botOwner.toLowerCase(), (bot.address ?? "").toLowerCase()],
    queryFn: () =>
      botPermissions({
        data: {
          owner: botOwner,
          operator: bot.address as `0x${string}`,
          pools: [{ pool: market.pool, symbol: market.symbol }],
        },
      }),
    enabled: ownerOk && Boolean(bot.address),
    refetchInterval: 15_000,
  });
  const grantRow = perms.data?.markets[0] ?? null;
  const botStt = perms.data?.operatorStt != null ? Number(perms.data.operatorStt) : null;
  const ticketGranted = perms.isSuccess && !perms.isError && grantConnected(grantRow) ? 1 : 0;
  const ticketReading = Boolean(ownerOk && bot.address && (perms.isLoading || (perms.isFetching && !perms.data)));
  const ticketStatus = botLinkStatus({
    hasBot: Boolean(bot.address),
    ownerSet: ownerOk,
    reading: ticketReading,
    readError: Boolean(perms.isError),
    granted: ticketGranted,
    stt: botStt != null && Number.isFinite(botStt) ? botStt : null,
  });
  const botVerified = ticketStatus === "ready";
  const snap = useQuery({
    queryKey: ["snapshot", account.toLowerCase()],
    queryFn: () => accountSnapshot({ data: { account } }),
    enabled: Boolean(account),
    refetchInterval: 20_000,
  });
  const quote = useQuery({
    queryKey: ["live-quote", market.pool, account.toLowerCase(), limit.priceRaw, sized.quantityRaw, isLong, maker, usingBot],
    queryFn: () =>
      liveQuote({
        data: {
          pool: market.pool,
          marginBank: market.marginBank,
          account,
          isBid: isLong,
          price: limit.priceRaw,
          quantity: sized.quantityRaw,
          asMaker: maker,
          autoPull: !usingBot,
        },
      }),
    enabled:
      mode === "live" &&
      quoteReady &&
      limit.ok &&
      !sized.belowMin &&
      /^0x[a-fA-F0-9]{40}$/.test(market.marginBank),
    refetchInterval: 15_000,
  });
  const maxQ = useQuery({
    queryKey: ["max", market.pool, account.toLowerCase(), isLong, limit.priceRaw, usingBot],
    queryFn: () =>
      quoteMax({
        data: {
          pool: market.pool,
          marginBank: market.marginBank,
          account,
          isBid: isLong,
          price: limit.priceRaw,
          autoPull: !usingBot,
        },
      }),
    enabled: mode === "live" && quoteReady && limit.ok && /^0x[a-fA-F0-9]{40}$/.test(market.marginBank),
    refetchInterval: 15_000,
  });

  const lev = Math.min(leverage, market.maxLeverage);
  const simMargin = sized.notional / Math.max(lev, 1);
  const simLiq =
    mode === "paper" && limit.ok && !blocked ? liqPrice(limit.price, lev, market.initialMarginBps, isLong) : null;
  const quoted = mode === "live" ? quote.data : undefined;
  const maxData = mode === "live" ? maxQ.data : undefined;
  const protocolLiq =
    quoted?.liquidation?.priceable && quoted.liquidation.projectedRaw
      ? rawToNumber(quoted.liquidation.projectedRaw, market.quoteDecimals)
      : null;
  const projectedSize = quoted?.liquidation?.projectedSize ?? null;
  const flatAfter = projectedSize === "0";
  const projectedEquity =
    quoted?.liquidation?.projectedEquity != null ? Number(quoted.liquidation.projectedEquity) : null;
  const liqReliable = protocolLiq != null && projectedEquity != null && projectedEquity > 0;
  const levAfter =
    quoted?.liquidation?.leverageBps != null && projectedEquity != null && projectedEquity > 0
      ? Number(quoted.liquidation.leverageBps) / 10_000
      : null;
  const bookOk = readUsable(bookFresh);
  const fundingOk = fundingVerified(market, Date.now());
  const markOk = readUsable(markState(market));
  const carry = fundingOk ? fundingLabel(market.fundingHourly, sized.notional || notional, isLong) : null;
  const dayCarry = carry ? (carry.kind === "paid" ? -carry.perHour : carry.perHour) * 24 : null;
  const mmBps = risk.data?.risk ? Number(risk.data.risk.maintenanceMarginBps) : null;
  const imFloor = risk.data?.risk ? Number(risk.data.risk.initialMarginBps) : null;
  const effectiveImf =
    risk.data?.health && risk.data.health.priceable ? Number(risk.data.health.effectiveImfBps) : null;
  const equity = quoted?.margin ? Number(quoted.margin.equity) : null;
  const unlocked = quoted?.margin ? Number(quoted.margin.unlocked) : null;
  const existingIm = quoted?.order?.imRequirement != null ? Number(quoted.order.imRequirement) : null;
  const initialMargin = quoted?.order?.initialMarginPortion != null ? Number(quoted.order.initialMarginPortion) : null;
  const lock = quoted?.order?.lockAmount != null ? Number(quoted.order.lockAmount) : null;
  const surcharge = quoted?.order?.leverageSurcharge != null ? Number(quoted.order.leverageSurcharge) : null;
  const mmAfter = quoted?.liquidation?.projectedMmReq != null ? Number(quoted.liquidation.projectedMmReq) : null;
  const topUp = quoted?.order?.topUpRequired != null ? Number(quoted.order.topUpRequired) : null;
  const previewEquity = quoted?.order?.equity != null ? Number(quoted.order.equity) : null;
  const util = orderMarginUtilization({
    equity: previewEquity,
    existingIm,
    lockAmount: lock,
    surcharge,
    topUp,
  });
  const stt = snap.data?.stt != null ? Number(snap.data.stt) : null;
  const maxQty = maxData?.maxQuantity ? rawToNumber(maxData.maxQuantity, market.baseDecimals) : null;

  const blocks: { title: string; why: string; action: string; value?: string }[] = [];
  if (mode === "live") {
    if (usingBot) {
      if (!bot.available) {
        blocks.push({
          title: "Bot signing is unavailable",
          why: "This browser has no Web Crypto. REXBOT will not invent a bot key.",
          action: "Use Bot Execution Mode and sign on your own machine.",
        });
      } else if (!bot.address) {
        blocks.push({
          title: "No REXBOT bot key",
          why: "placeOrderFor needs a local bot key. A watched address cannot sign.",
          action: "Create the bot on the Wallet tab. The private key stays encrypted in this browser.",
        });
      } else if (!bot.unlocked) {
        blocks.push({
          title: "Bot key is locked",
          why: "The encrypted key is on this device, but it is not unlocked.",
          action: "Enter the local password below. It is not sent to a server.",
        });
      } else if (!ownerOk) {
        blocks.push({
          title: "DreamDEX owner address is missing",
          why: "The owner is the public DreamDEX wallet. It is not the bot address and it is not a private key.",
          action: "Enter the owner on the Wallet tab.",
        });
      } else if (perms.isLoading || (perms.isFetching && !perms.data)) {
        blocks.push({
          title: "Perps permission is still loading",
          why: "Ready to trade is only shown after isOperatorAuthorized returns.",
          action: "Wait for the pool read.",
        });
      } else if (perms.isError || !grantConnected(grantRow)) {
        blocks.push({
          title: "Perps permission is not granted",
          why: "This market has not authorized the bot to place, cancel, and reduce for the owner.",
          action: "Link the bot in DreamDEX, enable Perps, wait for Access granted, then let this read refresh.",
          value: grantRow ? `place ${String(grantRow.place)} cancel ${String(grantRow.cancel)} reduce ${String(grantRow.reduce)}` : perms.error instanceof Error ? perms.error.message : "unread",
        });
      } else if (botStt == null) {
        blocks.push({
          title: "Bot STT balance was not read",
          why: "The bot pays gas. The owner's STT does not.",
          action: "Retry the permission read.",
        });
      } else if (botStt <= 0) {
        blocks.push({
          title: "Bot STT gas balance is insufficient",
          why: "placeOrderFor is paid by the REXBOT bot.",
          action: "Leave Send it for gas enabled in DreamDEX, or send testnet STT to the bot. USDso does not pay gas.",
          value: `${botStt} STT`,
        });
      }
    } else if (wallet === "none" && !botVerified) {
      blocks.push({
        title: "No injected wallet",
        why: "A live order has to be signed by an injected wallet or by a verified DreamDEX bot. REXBOT will not invent a fill.",
        action: "Connect a wallet, or create the bot, link it in DreamDEX, and fund its STT.",
      });
    } else if (wallet === "wrong-network") {
      blocks.push({
        title: "Wallet is on the wrong network",
        why: "Hideki orders are only valid on chain 50383.",
        action: "Switch the wallet to Hideki.",
        value: `chain ${chainId ?? "unknown"}`,
      });
    }
    if (blocked) {
      blocks.push({
        title: "Mark or index is not fresh",
        why: "The protocol rejects an increasing order when the mark feed is stale, and a stale index makes basis unsafe.",
        action: "Wait for getPerpState to return a live mark and index.",
        value: blocked,
      });
    }
    if (!tape.data || bookFresh === "unknown") {
      blocks.push({
        title: "Order book has not loaded",
        why: "The limit is taken from the best bid and best ask, not from the mark.",
        action: "Wait for the indexer book read.",
      });
    } else if (bookFresh === "stale") {
      blocks.push({
        title: "Order book is stale",
        why: "A limit built from an old book can rest or cross the wrong side.",
        action: "Wait for a book read newer than 60 seconds.",
        value: `age ${bookFresh}`,
      });
    }
    if (tape.data && (!bid || !ask)) {
      blocks.push({
        title: "Order book is one-sided",
        why: "There is no two-sided touch to price a rest or a cross against.",
        action: "Pick another market or wait for both a bid and an ask.",
        value: `bids ${tape.data.bids.length} asks ${tape.data.asks.length}`,
      });
    }
    if (limit.error) {
      blocks.push({
        title: "No valid limit",
        why: limit.error,
        action: "Change Rest or Cross, or wait for a two-sided book.",
        value: `tick ${market.tickRaw}`,
      });
    }
    if (sized.belowMin) {
      blocks.push({
        title: "Quantity is below the minimum",
        why: "The pool rejects size under minQuantity after the lot snap.",
        action: "Raise notional.",
        value: `min ${market.minQtyRaw} raw, sized ${sized.quantityRaw}`,
      });
    }
    if (limit.ok && BigInt(market.tickRaw || "1") > 0n && BigInt(limit.priceRaw) % BigInt(market.tickRaw || "1") !== 0n) {
      blocks.push({
        title: "Price is not aligned with tickSize",
        why: "The pool rejects a limit that is off the tick grid.",
        action: "Use the snapped limit. Do not send a hand-edited price.",
        value: `price ${limit.priceRaw} tick ${market.tickRaw}`,
      });
    }
    if (limit.ok && BigInt(market.lotRaw || "1") > 0n && BigInt(sized.quantityRaw) % BigInt(market.lotRaw || "1") !== 0n) {
      blocks.push({
        title: "Quantity is not aligned with lotSize",
        why: "The pool rejects a quantity that is off the lot grid.",
        action: "Use the snapped quantity.",
        value: `qty ${sized.quantityRaw} lot ${market.lotRaw}`,
      });
    }
    if (!maker && limit.ok && (fill.avg == null || fill.marketableQty + 1e-9 < sized.qty)) {
      blocks.push({
        title: "Cross 1 tick cannot fill this size",
        why: "The visible book inside the limit is smaller than the order. An IOC would cancel the rest, and that is not a full fill.",
        action: "Lower notional until the visible quantity covers the order.",
        value: `visible ${fmtQty(fill.marketableQty)} / order ${fmtQty(sized.qty)}`,
      });
    }
    if (wallet === "ok" && (snap.isError || stt == null)) {
      blocks.push({
        title: "STT balance was not read",
        why: "Gas is paid in STT. Without the balance, the order cannot be judged.",
        action: "Retry the account read.",
        value: snap.error instanceof Error ? snap.error.message : undefined,
      });
    } else if (wallet === "ok" && stt != null && stt <= 0) {
      blocks.push({
        title: "STT gas balance is insufficient",
        why: "A Hideki transaction cannot be broadcast without STT. The exact gas is not known until the wallet prices the transaction.",
        action: "Fund the wallet with testnet STT. USDso margin does not pay gas.",
        value: `${stt} STT`,
      });
    }
    if (risk.isError) {
      blocks.push({
        title: "Market risk parameters were not read",
        why: "Initial and maintenance rates come from the pool. Without them the ticket will not invent a margin rate.",
        action: "Retry. If getPerpRiskParams keeps failing, treat it as an SDK or RPC failure.",
        value: risk.error instanceof Error ? risk.error.message : undefined,
      });
    }
    if (capDraft.trim() !== "" && wallet === "ok") {
      const drafted = Number(capDraft);
      const confirmed = quote.data?.capX ?? null;
      const matches = confirmed != null && drafted === confirmed;
      if (!matches) {
        blocks.push({
          title: "Leverage cap is not confirmed",
          why: "A number typed here is not on chain. The account cap changes the order's leverage surcharge. It does not change the liquidation formula. previewPerpLiquidationPrice ignores the draft.",
          action: "Apply the cap and wait for a success receipt, or clear the box. Review stays off until the draft matches the confirmed cap or is empty.",
          value: confirmed == null ? "cap unread" : confirmed === 0 ? "on-chain cap unset" : `on-chain cap ${confirmed}x`,
        });
      }
    }
    if (applying) {
      blocks.push({
        title: "Leverage cap transaction is in flight",
        why: "A new cap is not active until the receipt succeeds and getPerpMaxLeverage is read back. The liquidation price does not use this transaction.",
        action: "Wait for the wallet and the receipt.",
      });
    }
    if (quoteReady && quote.isLoading) {
      blocks.push({
        title: "Protocol margin preview is still loading",
        why: "Initial margin and liquidation are unread.",
        action: "Wait for previewPerpOrderMargin and previewPerpLiquidationPrice.",
      });
    }
    if (quote.isError || quote.data?.errors.length) {
      blocks.push({
        title: "A protocol read failed",
        why: "Live margin or liquidation could not be calculated, so it is not replaced with an estimate.",
        action: "Read the error and retry. If it persists, treat it as an SDK or RPC failure.",
        value: quote.data?.errors[0] ?? (quote.error instanceof Error ? quote.error.message : undefined),
      });
    }
    if (quote.data?.order && !quote.data.order.priceable) {
      blocks.push({
        title: "Order is not priceable",
        why: "previewPerpOrderMargin refused the mark. The pool would revert an increasing order.",
        action: "Wait for a fresh mark.",
      });
    }
    if (quote.data?.order?.priceable && quote.data.order.sufficient === false) {
      const topUp = quote.data.order.topUpRequired;
      blocks.push({
        title: quote.data.order.walletCoversTopUp === false ? "Available margin is insufficient" : "The protocol would reject this order",
        why: quote.data.order.walletCoversTopUp === false
          ? "previewPerpOrderMargin says the order is not sufficient. The two collateral gates can pass while the wallet still cannot cover the auto-pull."
          : "previewPerpOrderMargin.sufficient is false. REXBOT will not send an order the preview says the pool would reject.",
        action: usingBot
          ? "Deposit USDso into the DreamDEX owner's perps account, or lower the size. The bot cannot deposit or withdraw."
          : "Deposit USDso into the perps account or the wallet, or lower the size.",
        value: `top-up ${topUp ?? "—"} lock ${quote.data.order.lockAmount ?? "—"} walletCovers ${String(quote.data.order.walletCoversTopUp)}`,
      });
    }
    if (quote.data?.order?.priceable && quote.data.order.meetsInitialMargin === false) {
      blocks.push({
        title: "Initial margin is not met",
        why: "Post-lock equity would sit under the initial-margin requirement, including any leverage-cap surcharge.",
        action: "Add equity or reduce the order. A stricter account cap raises this bar.",
        value: `surcharge ${quote.data.order.leverageSurcharge ?? "0"}`,
      });
    }
    if (quote.data?.order?.voucherBlocked) {
      blocks.push({
        title: "Voucher blocks this increase",
        why: "Paper USDso cannot increase this market, or the voucher cap is unset.",
        action: "Use a voucher-eligible market or fund real testnet USDso.",
      });
    }
    if (maxQ.data?.priceable === false) {
      blocks.push({
        title: "getMaxPerpOrderSize is not priceable",
        why: "The pool has no live mark to size against.",
        action: "Do not send.",
      });
    }
    if (maxQ.data?.placeable === false) {
      blocks.push({
        title: "Size is above the maximum placeable",
        why: limitedByHint(maxQ.data.limitedBy) || "The pool would reject the next lot.",
        action: "Shrink the order or fund the gate named by limitedBy.",
        value: maxQ.data.limitedBy ?? undefined,
      });
    }
    if (maxQty != null && sized.qty > maxQty) {
      blocks.push({
        title: "Quantity is above the quoted maximum",
        why: "getMaxPerpOrderSize returned a smaller maximum.",
        action: "Lower notional.",
        value: `max ${fmtQty(maxQty)}`,
      });
    }
    if (
      quoteReady &&
      limit.ok &&
      !sized.belowMin &&
      bookFresh !== "stale" &&
      bookFresh !== "unknown" &&
      !quote.isLoading &&
      !flatAfter &&
      !liqReliable
    ) {
      blocks.push({
        title: "Liquidation cannot be evaluated",
        why: UNAVAILABLE,
        action: "Do not send until previewPerpLiquidationPrice returns a projected price.",
        value: quote.data?.liquidation?.priceable === false ? "priceable false" : undefined,
      });
    }
  }

  const checks = tradeChecks({
    mode,
    markFresh: markState(market),
    indexFresh: indexState(market),
    wallet: mode !== "live" ? "ok" : usingBot ? (botVerified && bot.unlocked ? "bot" : "bot-off") : wallet === "wrong-network" ? "wrong-network" : wallet === "ok" ? "ok" : "none",
    botVerified,
    leverage: lev,
    maxLeverage: market.maxLeverage,
    liqDistance:
      mode === "paper"
        ? simLiq && limit.price
          ? Math.abs(limit.price - simLiq) / limit.price
          : null
        : markOk && liqReliable && protocolLiq && market.mark
          ? Math.abs(market.mark - protocolLiq) / market.mark
          : null,
    liqNote: mode === "paper" ? "Simulated liquidation is withheld until the book and mark are usable." : UNAVAILABLE,
    skipLeverage: mode === "live",
    spreadBps,
    slippageBps: fill.slippageBps,
    depthNotional: !maker && tape.data ? fill.marketableQty * (fill.avg ?? 0) : null,
    notional: sized.notional || notional,
    belowMin: sized.belowMin,
    hourlyFunding: carry ? (carry.kind === "paid" ? -carry.perHour : carry.perHour) : null,
    dailyFunding: dayCarry,
    targetMove: null,
    rewardRisk: null,
    stopInvalid: false,
    maxPlaceable: maxQty,
    qty: sized.qty,
    placeable: maxData?.placeable ?? null,
    limitedBy: maxData?.limitedBy ?? null,
    priceable: maxData?.priceable ?? null,
    equity: mode === "live" ? previewEquity : null,
    margin:
      mode === "live"
        ? existingIm != null && lock != null && surcharge != null
          ? existingIm + lock + surcharge
          : 0
        : simMargin,
  });
  const canLive = mode === "live" && blocks.length === 0 && (usingBot ? botVerified && bot.unlocked : wallet === "ok");

  const dry = botText({ market, isLong, maker, notional, limitRaw: limit.priceRaw, qtyRaw: sized.quantityRaw, dry: true });
  const liveBot = botText({
    market,
    isLong,
    maker,
    notional,
    limitRaw: limit.priceRaw,
    qtyRaw: sized.quantityRaw,
    dry: false,
  });

  async function applyCap() {
    const next = Number(capDraft);
    if (!account || !Number.isInteger(next) || next < 1 || next > market.maxLeverage) return;
    setApplying(true);
    setCapNote(null);
    const result = await setAccountLeverage({
      address: account as `0x${string}`,
      pool: market.pool as `0x${string}`,
      marginBank: market.marginBank as `0x${string}`,
      leverageX: next,
    });
    setApplying(false);
    setCapNote(`${result.title}. ${result.action}`);
    if (result.status === "confirmed") {
      setCapDraft("");
      await qc.invalidateQueries({ queryKey: ["live-quote"] });
    }
  }

  function draftEvidence(status: "prepared" | "signature"): string {
    return addEvidence({
      tx: "",
      status,
      symbol: market.symbol,
      side: isLong ? "long" : "short",
      quantity: String(sized.qty),
      price: limit.ok ? String(limit.price) : "",
      orderType: maker ? "limit" : "ioc",
      wallet: usingBot ? (bot.address ?? "") : account,
      owner: account,
      signer: usingBot ? (bot.address ?? "") : account,
      explorer: "",
      sdkVersion: SDK_VERSION,
      chainId: HIDEKI_CHAIN_ID,
      note:
        status === "prepared"
          ? usingBot
            ? `Prepared placeOrderFor for owner ${account}. Not signed.`
            : "Prepared. Not signed."
          : usingBot
            ? "Bot signature requested. No hash yet."
            : "Signature requested. No hash yet.",
    });
  }

  function openReview() {
    if (!canLive || !limit.ok) return;
    sent.current = false;
    const id = draftEvidence("prepared");
    setEvidenceId(id);
    setOutcome(null);
    setOpen(true);
  }

  async function confirm() {
    if (!account || !canLive || sending || !limit.ok || sent.current) return;
    if (outcome?.status === "confirmed") return;
    if (usingBot && (!bot.address || !bot.unlocked || !botVerified)) return;
    sent.current = true;
    setSending(true);
    setOutcome(null);
    const id = evidenceId ?? draftEvidence("signature");
    setEvidenceId(id);
    updateEvidence(id, { status: "signature", note: usingBot ? "Bot signature requested. No hash yet." : "Signature requested. No hash yet." });
    const onPhase = (phase: "signature" | "submitted" | "pending", hash: string | null) => {
      updateEvidence(id, {
        status: phase === "signature" ? "signature" : phase === "submitted" ? "submitted" : "pending",
        tx: hash ?? "",
        explorer: hash ? explorerTx(hash) : "",
        note: phase === "pending" ? "Pending receipt. Not confirmed." : phase === "submitted" ? "Submitted. Waiting for the receipt." : usingBot ? "Bot signature requested." : "Signature requested.",
      });
    };
    const result = usingBot
      ? await sendPerpOrderFor(
          {
            owner: account as `0x${string}`,
            pool: market.pool as `0x${string}`,
            isBid: isLong,
            price: BigInt(limit.priceRaw),
            quantity: BigInt(sized.quantityRaw),
            orderType: maker ? 0 : 2,
          },
          onPhase,
        )
      : await sendPerpOrder(
          {
            address: account as `0x${string}`,
            pool: market.pool as `0x${string}`,
            isBid: isLong,
            price: BigInt(limit.priceRaw),
            quantity: BigInt(sized.quantityRaw),
            orderType: maker ? 0 : 2,
          },
          onPhase,
        );
    setOutcome(result);
    setSending(false);
    const status: "confirmed" | "pending" | "failed" | "rejected" =
      result.status === "confirmed" && result.hash
        ? "confirmed"
        : result.status === "rejected"
          ? "rejected"
          : result.status === "unknown" && result.hash
            ? "pending"
            : result.hash
              ? "failed"
              : "failed";
    if (status !== "confirmed") sent.current = false;
    updateEvidence(id, {
      tx: result.hash ?? "",
      status,
      explorer: result.hash ? explorerTx(result.hash) : "",
      owner: account,
      signer: usingBot ? (bot.address ?? "") : account,
      note: usingBot
        ? `${result.title} placeOrderFor. Owner ${account}. Signer ${bot.address ?? ""}.`
        : result.title,
    });
    if (status === "confirmed") {
      useDesk.setState((s) => ({
        checklist: { ...s.checklist, txRecorded: true, realOrder: true },
      }));
      void qc.invalidateQueries({ queryKey: ["snapshot"] });
      void qc.invalidateQueries({ queryKey: ["tape"] });
      void qc.invalidateQueries({ queryKey: ["live-quote"] });
      void qc.invalidateQueries({ queryKey: ["bot-perms"] });
    }
  }

  function closeModal() {
    if (sending) return;
    if (evidenceId) {
      const row = useDesk.getState().evidence.find((item) => item.id === evidenceId);
      if (row && (row.status === "prepared" || row.status === "signature") && !row.tx) removeEvidence(evidenceId);
    }
    setOpen(false);
  }

  const capX = mode === "live" ? quote.data?.capX : undefined;
  const spreadCost = bid && ask && sized.qty > 0 ? (ask.price - bid.price) * sized.qty : null;
  const touchQty = !maker
    ? isLong
      ? (ask?.qty ?? 0)
      : (bid?.qty ?? 0)
    : 0;

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Ticket</h2>
        <span className={"font-mono text-xs " + (mode === "live" ? "text-amber" : "text-lime")}>
          {mode === "live" ? "TESTNET LIVE" : "PAPER"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setIsLong(true)} className={"rounded-md px-3 py-2 text-sm font-medium " + (isLong ? "bg-lime text-lime-ink" : "border border-line text-muted")}>Long</button>
        <button type="button" onClick={() => setIsLong(false)} className={"rounded-md px-3 py-2 text-sm font-medium " + (!isLong ? "bg-down text-lime-ink" : "border border-line text-muted")}>Short</button>
      </div>
      <label className="mt-4 block text-xs text-muted">
        Notional
        <div className="mt-1 flex items-center gap-2">
          <input type="number" min={1} value={notional} onChange={(e) => setNotional(Number(e.target.value) || 0)} className="w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-fg" />
          <span className="font-mono text-xs text-muted">USDso</span>
        </div>
      </label>
      <div className="mt-2 flex gap-2">
        {[20, 50, 100, 250].map((n) => (
          <button key={n} type="button" onClick={() => setNotional(n)} className={"rounded-md px-2 py-1 font-mono text-xs " + (notional === n ? "bg-surface-2 text-fg" : "text-muted")}>{n}</button>
        ))}
      </div>
      {mode === "paper" ? (
        <label className="mt-4 block text-xs text-muted">
          Simulated leverage {lev}x
          <input type="range" min={1} max={market.maxLeverage} value={lev} onChange={(e) => setLeverage(Number(e.target.value))} className="mt-2 w-full" />
        </label>
      ) : (
        <div className="mt-4">
          <p className="text-xs text-muted">
            Confirmed account cap{" "}
            <span className="font-mono text-fg">{capX == null ? (wallet === "none" && !usingBot ? "needs a wallet" : "unread") : capX === 0 ? "unset (market IMF)" : `${capX}x`}</span>
          </p>
          {usingBot ? <p className="mt-1 text-xs text-muted">The bot cannot call setPerpLeverage. The owner sets any account cap in DreamDEX. This box does not change liquidation.</p> : null}
          <div className="mt-2 flex gap-2">
            <input value={capDraft} onChange={(e) => setCapDraft(e.target.value)} inputMode="numeric" placeholder="set cap" className="w-24 rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs" />
            <button type="button" disabled={applying || wallet !== "ok" || !/^\d+$/.test(capDraft)} onClick={() => void applyCap()} className="rounded-md border border-line px-2 py-1.5 text-xs disabled:opacity-40">
              {applying ? "Waiting for wallet…" : "Apply cap on chain"}
            </button>
          </div>
          {capNote ? <p className="mt-1 text-xs text-muted">{capNote}</p> : null}
        </div>
      )}
      <details className="mt-2">
        <summary className="text-xs text-muted">Simulated leverage vs protocol margin</summary>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Paper leverage is a browser simulation of an isolated position. Hideki is cross-margin. setPerpLeverage writes an account cap. A stricter cap adds a surcharge on a new order. It does not create an isolated liquidation price. The live liquidation number is previewPerpLiquidationPrice, and only after that read returns.
        </p>
      </details>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMaker(true)} className={"rounded-md px-2 py-2 text-xs " + (maker ? "bg-surface-2 text-fg" : "text-muted")}>Rest 1 tick</button>
        <button type="button" onClick={() => setMaker(false)} className={"rounded-md px-2 py-2 text-xs " + (!maker ? "bg-surface-2 text-fg" : "text-muted")}>Cross 1 tick</button>
      </div>
      <p className="mt-2 text-xs text-muted">{limit.ok ? `${limit.behaviour}. ${limit.detail}` : limit.error}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">Stop (optional)<input value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs text-fg" /></label>
        <label className="text-xs text-muted">Target (optional)<input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs text-fg" /></label>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted">Size</dt>
        <dd className="text-right font-mono">{fmtQty(sized.qty)} {market.base}</dd>
        <dt className="text-muted">Limit</dt>
        <dd className="text-right font-mono">{limit.ok ? fmtPx(limit.price) : "—"}</dd>
        <dt className="text-muted">Best bid / ask</dt>
        <dd className="text-right font-mono">{bookOk && bid ? fmtPx(bid.price) : "N/A"} / {bookOk && ask ? fmtPx(ask.price) : "N/A"}</dd>
        <dt className="text-muted">Spread</dt>
        <dd className="text-right font-mono">{bookOk && spreadBps != null ? `${spreadBps.toFixed(1)} bp` : "N/A"}</dd>
        <dt className="text-muted">Spread width × size</dt>
        <dd className="text-right font-mono">{spreadCost == null ? "—" : fmtUsd(spreadCost)}</dd>
        <dt className="text-muted">Vs mark</dt>
        <dd className="text-right font-mono">{markGapBps == null ? "—" : `${markGapBps.toFixed(1)} bp`}</dd>
        {mode === "paper" ? (
          <>
            <dt className="text-muted">Simulated margin</dt>
            <dd className="text-right font-mono">{fmtUsd(simMargin)}</dd>
            <dt className="text-muted">Estimated simulated liquidation</dt>
            <dd className="text-right font-mono">{bookOk && simLiq ? fmtPx(simLiq) : "N/A"}</dd>
          </>
        ) : (
          <>
            <dt className="text-muted">Protocol initial margin</dt>
            <dd className="text-right font-mono">{initialMargin == null ? "unavailable" : fmtUsd(initialMargin)}</dd>
            <dt className="text-muted">Collateral locked</dt>
            <dd className="text-right font-mono">{lock == null ? "unavailable" : fmtUsd(lock)}</dd>
            <dt className="text-muted">Account equity</dt>
            <dd className="text-right font-mono">{equity == null ? "unavailable" : fmtUsd(equity)}</dd>
            <dt className="text-muted">Available margin</dt>
            <dd className="text-right font-mono">{unlocked == null ? "unavailable" : fmtUsd(unlocked)}</dd>
            <dt className="text-muted">Maintenance margin</dt>
            <dd className="text-right font-mono">{mmAfter == null ? "unavailable" : fmtUsd(mmAfter)}</dd>
            <dt className="text-muted">Margin utilization</dt>
            <dd className="text-right font-mono">{util == null ? "unavailable" : `${util.toFixed(1)}%`}</dd>
            <dt className="text-muted">Leverage after fill</dt>
            <dd className="text-right font-mono">{levAfter == null ? "unavailable" : `${levAfter.toFixed(2)}x`}</dd>
            <dt className="text-muted">Protocol liquidation</dt>
            <dd className="text-right font-mono">{!markOk ? "N/A" : flatAfter ? "flat after fill" : liqReliable ? fmtPx(protocolLiq!) : "N/A"}</dd>
          </>
        )}
        <dt className="text-muted">Hourly funding</dt>
        <dd className={"text-right font-mono " + (!carry ? "text-muted" : carry.kind === "received" ? "text-lime" : carry.kind === "paid" ? "text-down" : "text-muted")}>
          {carry ? `${fmtBpsPerHour(market.fundingHourly)} bp/h · ${fmtUsd(carry.kind === "paid" ? -carry.perHour : carry.perHour, 4)}` : "N/A"}
        </dd>
        <dt className="text-muted">Funding per day</dt>
        <dd className="text-right font-mono">{dayCarry == null ? "N/A" : fmtUsd(dayCarry, 4)}</dd>
        <dt className="text-muted">Who pays</dt>
        <dd className="text-right font-mono">{fundingOk ? (market.fundingHourly > 0 ? "Longs pay shorts" : market.fundingHourly < 0 ? "Shorts pay longs" : "Neither side pays") : "N/A"}</dd>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-muted">{fundingOk ? `${annualizedProjection(market.fundingApr)}. ${FUNDING_PROJECTION_NOTE}` : "Annualized funding projection: N/A. Funding is withheld until getPerpState confirms the rate."}</p>
      {mode === "live" && quoteReady && !flatAfter && !liqReliable ? <p className="mt-2 text-xs leading-relaxed text-muted">{projectedEquity != null && projectedEquity <= 0 ? "Unavailable: projected equity after the fill is not positive, so a liquidation distance would not be reliable." : UNAVAILABLE}</p> : null}
      {blocks.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {blocks.map((block) => (
            <li key={block.title} className="rounded-md border border-line bg-bg p-2">
              <p className="text-xs font-medium text-down">{block.title}</p>
              <p className="text-xs leading-relaxed text-muted">{block.why}</p>
              <p className="text-xs text-fg">{block.action}</p>
              {block.value ? <p className="break-all font-mono text-[11px] text-muted">{block.value}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <TradeCheck items={checks.items} level={checks.level} />
      <details className="mt-3">
        <summary className="text-xs text-muted">Calculation details</summary>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[11px]">
          <dt className="text-muted">Mark</dt><dd className="text-right font-mono">{fmtPx(market.mark)} {market.markSource}</dd>
          <dt className="text-muted">Index</dt><dd className="text-right font-mono">{fmtPx(market.index)} {market.indexSource}</dd>
          <dt className="text-muted">Best bid raw</dt><dd className="text-right break-all font-mono">{bid?.priceRaw ?? "—"}</dd>
          <dt className="text-muted">Best ask raw</dt><dd className="text-right break-all font-mono">{ask?.priceRaw ?? "—"}</dd>
          <dt className="text-muted">Tick / lot / min</dt><dd className="text-right break-all font-mono">{market.tickRaw} / {market.lotRaw} / {market.minQtyRaw}</dd>
          <dt className="text-muted">Raw price</dt><dd className="text-right break-all font-mono">{limit.ok ? limit.targetRaw : "—"}</dd>
          <dt className="text-muted">Rounded price</dt><dd className="text-right break-all font-mono">{limit.priceRaw}</dd>
          <dt className="text-muted">Raw quantity</dt><dd className="text-right break-all font-mono">{sized.unsnappedRaw}</dd>
          <dt className="text-muted">Rounded quantity</dt><dd className="text-right break-all font-mono">{sized.quantityRaw}</dd>
          <dt className="text-muted">Order notional</dt><dd className="text-right font-mono">{fmtUsd(sized.notional)}</dd>
          <dt className="text-muted">IMF floor</dt><dd className="text-right font-mono">{imFloor == null ? "unread" : `${imFloor} bps`}</dd>
          <dt className="text-muted">Effective IMF</dt><dd className="text-right font-mono">{effectiveImf == null ? "unavailable" : `${effectiveImf} bps`}</dd>
          <dt className="text-muted">Required initial margin</dt><dd className="text-right font-mono">{initialMargin == null ? "unavailable" : fmtUsd(initialMargin)}</dd>
          <dt className="text-muted">Maintenance rate</dt><dd className="text-right font-mono">{mmBps == null ? "unread" : `${mmBps} bps`}</dd>
          <dt className="text-muted">Required maintenance</dt><dd className="text-right font-mono">{mmAfter == null ? "unavailable" : fmtUsd(mmAfter)}</dd>
          <dt className="text-muted">Lock / adverse / surcharge</dt><dd className="text-right font-mono">{lock == null ? "—" : fmtUsd(lock)} / {quoted?.order?.adverseGapPortion == null ? "—" : fmtUsd(Number(quoted.order.adverseGapPortion))} / {surcharge == null ? "—" : fmtUsd(surcharge)}</dd>
          <dt className="text-muted">Equity / available</dt><dd className="text-right font-mono">{equity == null ? "—" : fmtUsd(equity)} / {unlocked == null ? "—" : fmtUsd(unlocked)}</dd>
          <dt className="text-muted">Utilization after</dt><dd className="text-right font-mono">{util == null ? "unavailable" : `${util.toFixed(1)}%`}</dd>
          <dt className="text-muted">Qty at touch</dt><dd className="text-right font-mono">{fmtQty(touchQty)}</dd>
          <dt className="text-muted">Visible fill</dt><dd className="text-right font-mono">{maker ? "resting" : `${fmtQty(fill.marketableQty)} @ ${fill.avg ? fmtPx(fill.avg) : "—"}`}</dd>
          <dt className="text-muted">Book age</dt><dd className="text-right font-mono">{bookFresh} {tape.data ? new Date(tape.data.fetchedAt).toISOString() : ""}</dd>
          <dt className="text-muted">Mark read</dt><dd className="text-right font-mono">{market.chainFetchedAt ? new Date(market.chainFetchedAt).toISOString() : "—"}</dd>
          <dt className="text-muted">Index time</dt><dd className="text-right font-mono">{market.indexUpdatedAt ? new Date(market.indexUpdatedAt * 1000).toISOString() : "—"}</dd>
          <dt className="text-muted">Preview block</dt><dd className="text-right font-mono">{quoted?.liquidation?.asOfBlock ?? "—"}</dd>
          <dt className="text-muted">SDK</dt><dd className="text-right font-mono">{SDK_VERSION}</dd>
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Live liquidation is previewPerpLiquidationPrice only: long mark − (equity − mmReq) × oneBase × 10000 / (|size| × (10000 − mmBps)); short uses (10000 + mmBps). The account leverage cap is not an input. Protocol initial margin is initialMarginPortion. Collateral locked is lockAmount, which also includes the adverse mark-to-entry gap. Margin utilization is (existing imRequirement + lockAmount + leverageSurcharge) / (equity + topUpRequired), all from previewPerpOrderMargin at one block. It is not notional divided by a leverage slider, and it is not mixed with the liquidation preview's block. Zero equity and no top-up stays unavailable. Paper uses a separate isolated simulation: entry × (1 ∓ (1/leverage − initialMarginBps/20000)). That simulation is not the chain.
        </p>
      </details>
      {mode === "paper" ? (
        <>
          <button type="button" disabled={!limit.ok || sized.belowMin || !bookOk} onClick={() => openPaper({ marketId: market.id, symbol: market.symbol, base: market.base, isLong, qty: sized.qty, entry: limit.price, leverage: lev, notional: sized.notional })} className="mt-4 w-full rounded-md bg-lime px-3 py-2.5 text-sm font-semibold text-lime-ink disabled:opacity-40">
            Park on paper
          </button>
          <p className="mt-2 text-xs leading-relaxed text-muted">Simulated leverage, simulated margin, estimated simulated liquidation. Nothing is signed.</p>
        </>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSigner("injected")} className={"rounded-md px-2 py-2 text-xs " + (!usingBot ? "bg-surface-2 text-fg" : "text-muted")}>Injected wallet</button>
            <button type="button" onClick={() => setSigner("bot")} className={"rounded-md px-2 py-2 text-xs " + (usingBot ? "bg-surface-2 text-fg" : "text-muted")}>DreamDEX bot</button>
          </div>
          {usingBot ? (
            <div className="mt-2">
              <p className="text-xs leading-relaxed text-muted">
                placeOrderFor. Owner {ownerOk ? shortAddr(botOwner) : "not set"}. Signer {bot.address ? shortAddr(bot.address) : "no bot"}. Gas is paid by the bot. The owner keeps the margin and the position. {botVerified ? "Ready to trade on this market." : botLinkLabel(ticketStatus) || "Permission required."}
              </p>
              {bot.address && !bot.unlocked ? (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void unlockBot(botPassword)
                      .then(() => {
                        setBotPassword("");
                        setBotUnlockNote("Unlocked in this tab. The key was not sent.");
                      })
                      .catch((cause: unknown) => setBotUnlockNote(cause instanceof Error ? cause.message : "Unlock failed."));
                  }}
                >
                  <input type="password" autoComplete="current-password" value={botPassword} onChange={(e) => setBotPassword(e.target.value)} placeholder="Local password" className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs" />
                  <button type="submit" className="rounded-md border border-line px-2 py-1.5 text-xs">Unlock</button>
                </form>
              ) : null}
              {botUnlockNote ? <p className="mt-1 text-xs text-muted">{botUnlockNote}</p> : null}
            </div>
          ) : null}
          <button type="button" disabled={!canLive} onClick={openReview} className="mt-4 w-full rounded-md bg-lime px-3 py-2.5 text-sm font-semibold text-lime-ink disabled:opacity-40">
            {usingBot ? "Review bot order" : "Review testnet order"}
          </button>
          {(usingBot && botVerified && bot.unlocked) || (!usingBot && botVerified && wallet !== "ok") ? <p className="mt-3 text-xs leading-relaxed text-lime">{BOT_READY_TEXT}</p> : null}
          <BotBox dry={dry} live={liveBot} warn={warnLiveBot} setWarn={setWarnLiveBot} />
        </>
      )}
      {open && limit.ok ? (
        <Confirm
          market={market}
          isLong={isLong}
          maker={maker}
          qty={sized.qty}
          notional={sized.notional}
          limit={limit.price}
          behaviour={limit.behaviour}
          bid={bid?.price ?? null}
          ask={ask?.price ?? null}
          spreadBps={spreadBps}
          spreadCost={spreadCost}
          avg={fill.avg}
          slip={fill.slippageBps}
          visible={fill.marketableQty}
          bookAt={tape.data?.fetchedAt ?? null}
          bookFresh={bookFresh}
          protocolMargin={initialMargin}
          equity={equity}
          unlocked={unlocked}
          mmReq={mmAfter}
          util={util}
          liq={markOk && liqReliable ? protocolLiq : null}
          carry={carry}
          address={usingBot ? (bot.address ?? "") : account}
          chainId={usingBot ? HIDEKI_CHAIN_ID : chainId}
          method={usingBot ? "placeOrderFor" : "placeOrder"}
          signerLine={usingBot ? `Bot ${bot.address ? shortAddr(bot.address) : "—"}` : `Injected ${account ? shortAddr(account) : "—"}`}
          gasPayer={usingBot ? `Bot ${bot.address ? shortAddr(bot.address) : "—"}` : "Injected wallet"}
          ownerLine={usingBot ? botOwner : account}
          sending={sending}
          outcome={outcome}
          onClose={closeModal}
          onConfirm={() => void confirm()}
          onViewPosition={() => {
            const hash = outcome?.hash;
            if (outcome?.status !== "confirmed" || !hash) return;
            setOpen(false);
            openOwnerPositions({ account, marketId: market.id, isLong, hash });
          }}
        />
      ) : null}
    </section>
  );
}

function botText(input: {
  market: Market;
  isLong: boolean;
  maker: boolean;
  notional: number;
  limitRaw: string;
  qtyRaw: string;
  dry: boolean;
}): string {
  const header = `export NETWORK=hideki
export STRATEGY=perp-funding
export PERP_SYMBOL=${input.market.symbol}
export PERP_SIDE=${input.isLong ? "long" : "short"}
export PERP_NOTIONAL_USDSO=${Math.round(input.notional)}
export PERP_LIMIT_PRICE=${input.limitRaw}
export PERP_QUANTITY=${input.qtyRaw}
export PERP_ORDER_TYPE=${input.maker ? "limit" : "ioc"}
export DRY_RUN=${input.dry ? "true" : "false"}
export OWNER_ADDRESS=0xYOUR_OWNER_ADDRESS
export PRIVATE_KEY=0xYOUR_BOT_KEY`;
  const sdk = input.dry
    ? `node --input-type=module -e 'console.log("DRY_RUN", ${JSON.stringify({
        symbol: input.market.symbol,
        side: input.isLong ? "long" : "short",
        price: input.limitRaw,
        quantity: input.qtyRaw,
        orderType: input.maker ? "limit" : "ioc",
        network: "hideki",
      })})'`
    : `node --input-type=module <<'EOF'
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
if (process.env.DRY_RUN !== "false") throw new Error("Refusing to broadcast. DRY_RUN must be the string false.");
const owner = process.env.OWNER_ADDRESS ?? "";
const key = process.env.PRIVATE_KEY ?? "";
if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) throw new Error("OWNER_ADDRESS must be the public DreamDEX wallet, not a private key.");
if (!/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("PRIVATE_KEY must be the bot key in this shell. Do not paste it into REXBOT.");
const price = BigInt(process.env.PERP_LIMIT_PRICE ?? "0");
const quantity = BigInt(process.env.PERP_QUANTITY ?? "0");
if (price <= 0n || quantity <= 0n) throw new Error("Refusing to broadcast. Price and quantity must be positive tick- and lot-aligned integers.");
const account = privateKeyToAccount(key);
const expiry = (1_000_000_000n + 50n * 365n * 24n * 60n * 60n) * 1_000_000_000n;
const data = encodeFunctionData({
  abi: parseAbi(["function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)"]),
  functionName: "placeOrderFor",
  args: [owner, ${input.isLong}, 0n, price, quantity, expiry, ${input.maker ? 0 : 2}, 0, "0x0000000000000000000000000000000000000000", 0n],
});
if (!data.startsWith("0x80054449")) throw new Error("placeOrderFor selector mismatch. Nothing was sent.");
const transport = http("${HIDEKI_RPC}");
const wallet = createWalletClient({ account, chain: hidekiTestnet, transport });
const hash = await wallet.sendTransaction({ to: "${input.market.pool}", data, value: 0n, chain: hidekiTestnet });
const receipt = await createPublicClient({ chain: hidekiTestnet, transport }).waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("receipt not success");
console.log(hash);
EOF`;
  return `${header}\n\n# Run outside REXBOT. The bot key stays in your shell.\n# placeOrderFor names OWNER_ADDRESS. trader.placePerpOrder would trade as the key itself and is not this path.\n${sdk}\n`;
}

function TradeCheck({
  items,
  level,
}: {
  items: { id: string; level: "green" | "amber" | "red"; title: string; detail: string }[];
  level: "green" | "amber" | "red";
}) {
  const tone = level === "green" ? "text-lime" : level === "amber" ? "text-amber" : "text-down";
  const loud = items.filter((item) => item.level !== "green");
  const quiet = items.filter((item) => item.level === "green");
  return (
    <div className="mt-4 rounded-md border border-line bg-bg p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Trade check</h3>
        <span className={"font-mono text-xs " + tone}>{level}</span>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {loud.map((item) => (
          <li key={item.id}>
            <p className={"text-xs font-medium " + (item.level === "red" ? "text-down" : "text-amber")}>{item.title}</p>
            <p className="text-xs leading-relaxed text-muted">{item.detail}</p>
          </li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="text-xs text-muted">Passing checks ({quiet.length})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {quiet.map((item) => (
            <li key={item.id} className="text-xs text-muted"><span className="text-lime">{item.title}. </span>{item.detail}</li>
          ))}
        </ul>
      </details>
      <p className="mt-2 text-xs text-muted">Not financial advice.</p>
    </div>
  );
}

function BotBox({
  dry,
  live,
  warn,
  setWarn,
}: {
  dry: string;
  live: string;
  warn: boolean;
  setWarn: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState<"dry" | "live" | null>(null);
  async function copy(which: "dry" | "live", text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1200);
  }
  return (
    <div className="mt-3 rounded-md border border-line p-3">
      <h3 className="text-xs font-medium tracking-wide text-amber uppercase">Bot execution mode</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        The safe copy is DRY_RUN=true. REXBOT never asks for a private key and never puts one in the copied text.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <button type="button" onClick={() => void copy("dry", dry)} className="inline-flex items-center justify-center gap-1 rounded-md border border-line px-2 py-2 text-xs">
          <Copy className="size-3" />
          {copied === "dry" ? "Copied" : "Copy safe dry-run environment"}
        </button>
        <button type="button" onClick={() => setWarn(true)} className="rounded-md border border-line px-2 py-2 text-xs">
          Prepare testnet live environment
        </button>
      </div>
      {warn ? (
        <div className="mt-2 rounded-md border border-amber/40 p-2">
          <p className="text-xs leading-relaxed text-amber">
            You are preparing a real Somnia testnet order. This will sign and broadcast transactions using the private key configured on your own machine. REXBOT does not receive or store that key.
          </p>
          <button type="button" onClick={() => void copy("live", live)} className="mt-2 rounded-md bg-lime px-2 py-1.5 text-xs font-semibold text-lime-ink">
            {copied === "live" ? "Copied" : "Copy live environment"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Confirm(props: {
  market: Market;
  isLong: boolean;
  maker: boolean;
  qty: number;
  notional: number;
  limit: number;
  behaviour: string;
  bid: number | null;
  ask: number | null;
  spreadBps: number | null;
  spreadCost: number | null;
  avg: number | null;
  slip: number | null;
  visible: number;
  bookAt: number | null;
  bookFresh: string;
  protocolMargin: number | null;
  equity: number | null;
  unlocked: number | null;
  mmReq: number | null;
  util: number | null;
  liq: number | null;
  carry: { text: string; perHour: number; kind: string } | null;
  address: string;
  chainId: number | null;
  method: string;
  signerLine: string;
  gasPayer: string;
  ownerLine: string;
  sending: boolean;
  outcome: SendOutcome | null;
  onClose: () => void;
  onConfirm: () => void;
  onViewPosition: () => void;
}) {
  const submitted = props.outcome?.status === "confirmed" && Boolean(props.outcome.hash);
  const button = sendButton({ sending: props.sending, confirmed: submitted });
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="max-h-[90vh] w-full max-w-md overflow-auto rounded-md border border-line bg-surface p-4">
        <h2 id="confirm-title" className="text-sm font-medium">Confirm testnet order</h2>
        <p className="mt-1 font-mono text-xs text-amber">Prepared. Nothing is signed until you confirm.</p>
        <p className="mt-2 text-xs leading-relaxed text-amber">This is Hideki testnet. It spends testnet STT and locks testnet USDso. It is not mainnet.</p>
        {props.method === "placeOrderFor" ? <p className="mt-2 text-xs leading-relaxed text-muted">The bot signs placeOrderFor. It cannot withdraw. The position and the margin stay on the DreamDEX owner.</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-muted">Market</dt><dd className="text-right font-mono">{props.market.symbol}</dd>
          <dt className="text-muted">Side</dt><dd className="text-right font-mono">{props.isLong ? "Long" : "Short"}</dd>
          <dt className="text-muted">Type</dt><dd className="text-right font-mono">{props.maker ? "Limit, resting" : "IOC, marketable"}</dd>
          <dt className="text-muted">Behaviour</dt><dd className="text-right font-mono">{props.behaviour}</dd>
          <dt className="text-muted">Best bid</dt><dd className="text-right font-mono">{props.bid == null ? "—" : fmtPx(props.bid)}</dd>
          <dt className="text-muted">Best ask</dt><dd className="text-right font-mono">{props.ask == null ? "—" : fmtPx(props.ask)}</dd>
          <dt className="text-muted">Spread</dt><dd className="text-right font-mono">{props.spreadBps == null ? "—" : `${props.spreadBps.toFixed(1)} bp`}</dd>
          <dt className="text-muted">Spread width × size</dt><dd className="text-right font-mono">{props.spreadCost == null ? "—" : fmtUsd(props.spreadCost)}</dd>
          <dt className="text-muted">Selected limit</dt><dd className="text-right font-mono">{fmtPx(props.limit)}</dd>
          <dt className="text-muted">Quantity</dt><dd className="text-right font-mono">{fmtQty(props.qty)}</dd>
          <dt className="text-muted">Notional</dt><dd className="text-right font-mono">{fmtUsd(props.notional)}</dd>
          <dt className="text-muted">Average fill</dt><dd className="text-right font-mono">{props.maker ? "resting, none assumed" : props.avg ? fmtPx(props.avg) : "—"}</dd>
          <dt className="text-muted">Slippage</dt><dd className="text-right font-mono">{props.slip == null ? "—" : `${props.slip.toFixed(1)} bp`}</dd>
          <dt className="text-muted">Visible liquidity</dt><dd className="text-right font-mono">{props.maker ? "not taking" : fmtQty(props.visible)}</dd>
          <dt className="text-muted">Book</dt><dd className="text-right font-mono">{props.bookFresh} {props.bookAt ? new Date(props.bookAt).toISOString() : ""}</dd>
          <dt className="text-muted">Protocol initial margin</dt><dd className="text-right font-mono">{props.protocolMargin == null ? "unavailable" : fmtUsd(props.protocolMargin)}</dd>
          <dt className="text-muted">Equity</dt><dd className="text-right font-mono">{props.equity == null ? "unavailable" : fmtUsd(props.equity)}</dd>
          <dt className="text-muted">Available</dt><dd className="text-right font-mono">{props.unlocked == null ? "unavailable" : fmtUsd(props.unlocked)}</dd>
          <dt className="text-muted">Maintenance</dt><dd className="text-right font-mono">{props.mmReq == null ? "unavailable" : fmtUsd(props.mmReq)}</dd>
          <dt className="text-muted">Utilization</dt><dd className="text-right font-mono">{props.util == null ? "unavailable" : `${props.util.toFixed(1)}%`}</dd>
          <dt className="text-muted">Protocol liquidation</dt><dd className="text-right font-mono">{props.liq == null ? "unavailable" : fmtPx(props.liq)}</dd>
          <dt className="text-muted">Funding per hour</dt><dd className="text-right font-mono">{props.carry ? fmtUsd(props.carry.kind === "paid" ? -props.carry.perHour : props.carry.perHour, 4) : "N/A"}</dd>
          <dt className="text-muted">Call</dt><dd className="text-right font-mono">{props.method}</dd>
          <dt className="text-muted">Owner</dt><dd className="text-right font-mono">{shortAddr(props.ownerLine)}</dd>
          <dt className="text-muted">Signer</dt><dd className="text-right font-mono">{props.signerLine}</dd>
          <dt className="text-muted">Gas payer</dt><dd className="text-right font-mono">{props.gasPayer}</dd>
          <dt className="text-muted">Wallet</dt><dd className="text-right font-mono">{shortAddr(props.address)}</dd>
          <dt className="text-muted">Network</dt><dd className="text-right font-mono">{props.chainId === HIDEKI_CHAIN_ID ? "Hideki 50383" : `chain ${props.chainId ?? "—"}`}</dd>
        </dl>
        {props.outcome ? (
          <div className="mt-3 rounded-md border border-line bg-bg p-3 text-xs" aria-live="polite">
            <p className={props.outcome.status === "confirmed" ? "text-lime" : "text-down"}>{props.outcome.title}</p>
            <p className="mt-1 text-muted">{props.outcome.action}</p>
            {props.outcome.hash ? (
              <a className="mt-2 block break-all font-mono text-lime underline" href={explorerTx(props.outcome.hash)} target="_blank" rel="noreferrer">{props.outcome.hash}</a>
            ) : (
              <p className="mt-2 text-muted">No transaction hash was returned. Nothing was marked confirmed.</p>
            )}
            {submitted && props.outcome.hash ? (
              <div className="mt-3 flex flex-col gap-2">
                <a href={explorerTx(props.outcome.hash)} target="_blank" rel="noreferrer" className="rounded-md border border-line px-3 py-2 text-center text-sm text-fg">View transaction</a>
                <button type="button" onClick={props.onViewPosition} className="rounded-md border border-line px-3 py-2 text-sm">View position</button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={props.onClose} disabled={props.sending} className="flex-1 rounded-md border border-line px-3 py-2 text-sm">Close</button>
          <button type="button" onClick={props.onConfirm} disabled={button.disabled} className="flex-1 rounded-md bg-lime px-3 py-2 text-sm font-semibold text-lime-ink disabled:opacity-40">
            {button.label}
          </button>
        </div>
      </div>
    </div>
  );
}
