export type RiskLevel = "green" | "amber" | "red";

export type RiskItem = {
  id: string;
  level: RiskLevel;
  title: string;
  detail: string;
};

export function tradeChecks(input: {
  mode: "paper" | "live";
  markFresh: "live" | "delayed" | "stale" | "unknown";
  indexFresh: "live" | "delayed" | "stale" | "unknown";
  wallet: "none" | "ok" | "wrong-network" | "bot" | "bot-off";
  botVerified?: boolean;
  leverage: number;
  maxLeverage: number;
  liqDistance: number | null;
  spreadBps: number | null;
  slippageBps: number | null;
  depthNotional: number | null;
  notional: number;
  belowMin: boolean;
  hourlyFunding: number | null;
  dailyFunding: number | null;
  targetMove: number | null;
  rewardRisk: number | null;
  stopInvalid: boolean;
  maxPlaceable: number | null;
  qty: number;
  placeable: boolean | null;
  limitedBy: string | null;
  priceable: boolean | null;
  equity: number | null;
  margin: number;
  skipLeverage?: boolean;
  liqNote?: string;
}): { level: RiskLevel; items: RiskItem[] } {
  const items: RiskItem[] = [];
  const push = (level: RiskLevel, id: string, title: string, detail: string) =>
    items.push({ level, id, title, detail });

  if (input.markFresh === "stale" || input.markFresh === "unknown") {
    push(
      "red",
      "mark",
      "Stale mark price",
      input.markFresh === "unknown"
        ? "The chain mark has not arrived. Live submission stays off until getPerpState returns."
        : "The mark is older than 60 seconds or the feed reported markPriceOk false. Live submission is off. Change nothing about size until the oracle read is fresh.",
    );
  } else if (input.markFresh === "delayed") {
    push(
      "amber",
      "mark",
      "Mark is delayed",
      "The chain mark is 15–60 seconds old. You can still submit, but re-check the ticket before you sign.",
    );
  } else {
    push("green", "mark", "Mark is live", "Chain mark from getPerpState is under 15 seconds old.");
  }

  if (input.indexFresh === "stale" || input.indexFresh === "unknown") {
    push(
      "red",
      "index",
      "Stale index price",
      "Basis and funding context use the oracle index. It is missing or older than 60 seconds, so those estimates are withheld and live submission is off.",
    );
  } else if (input.indexFresh === "delayed") {
    push("amber", "index", "Index is delayed", "Oracle index timestamp is 15–60 seconds old.");
  } else {
    push("green", "index", "Index is live", "Oracle indexUpdatedAt is under 15 seconds old.");
  }

  if (input.mode === "live" && input.wallet === "none") {
    if (input.botVerified) {
      push(
        "green",
        "wallet",
        "Bot Execution Mode",
        "Bot Execution Mode ready. Orders are signed by the authorized bot wallet and positions remain on the DreamDEX owner account.",
      );
    } else {
      push(
        "red",
        "wallet",
        "No injected wallet",
        "Testnet Live needs an injected wallet on chain 50383, or a DreamDEX bot with Perps permission and STT for gas. REXBOT will not invent a fill.",
      );
    }
  } else if (input.wallet === "wrong-network") {
    push(
      "red",
      "network",
      "Wallet is on the wrong network",
      "The wallet is not on chain 50383 (Hideki). Switch network before signing. An order signed for another chain is not a Hideki perp fill.",
    );
  } else if (input.wallet === "bot-off") {
    push(
      "red",
      "wallet",
      "DreamDEX bot is not ready",
      "The bot key, the owner address, or the on-chain Perps grant is missing. A watched address cannot sign, and a local bot wallet is not a connection.",
    );
  } else if (input.wallet === "bot") {
    push(
      "green",
      "wallet",
      "Bot Execution Mode",
      "Bot Execution Mode ready. Orders are signed by the authorized bot wallet and positions remain on the DreamDEX owner account.",
    );
  } else if (input.mode === "live") {
    push("green", "wallet", "Wallet on Hideki", "Injected account is on chain 50383.");
  }

  if (input.skipLeverage) {
    push(
      "green",
      "lev",
      "Paper leverage is not used",
      "Testnet Live does not read the simulated leverage slider. Margin and liquidation come from the chain preview.",
    );
  } else if (input.leverage >= input.maxLeverage * 0.75) {
    push(
      "amber",
      "lev",
      "Leverage is high",
      `${input.leverage}x is at least 75% of this market's ${input.maxLeverage}x cap. Lower the leverage slider to move liquidation farther from entry.`,
    );
  } else {
    push("green", "lev", "Leverage has room", `${input.leverage}x of ${input.maxLeverage}x max.`);
  }

  if (input.liqDistance == null) {
    push(
      "red",
      "liq",
      "Liquidation is not available",
      input.liqNote ?? "No fresh mark, so the liquidation estimate is not shown.",
    );
  } else if (input.liqDistance < 0.01) {
    push(
      "red",
      "liq",
      "Liquidation is too close to entry",
      `A move of ${(input.liqDistance * 100).toFixed(2)}% against you reaches the maintenance estimate. Cut leverage or notional.`,
    );
  } else if (input.liqDistance < 0.03) {
    push(
      "amber",
      "liq",
      "Liquidation is close",
      `About ${(input.liqDistance * 100).toFixed(1)}% of mark sits between entry and the maintenance estimate.`,
    );
  } else {
    push(
      "green",
      "liq",
      "Liquidation distance",
      `${(input.liqDistance * 100).toFixed(1)}% from the limit to the maintenance estimate.`,
    );
  }

  if (input.belowMin) {
    push(
      "red",
      "min",
      "Quantity is below minimum",
      "After snapping down to lot size the quantity is under minQuantity. Raise notional.",
    );
  } else {
    push("green", "grid", "Tick and lot aligned", "Price is snapped to tickSize and quantity is snapped down to lotSize.");
  }

  if (input.spreadBps == null) {
    push("amber", "spread", "Spread unknown", "The book has no two-sided top, so spread is not estimated.");
  } else if (input.spreadBps > 20) {
    push(
      "amber",
      "spread",
      "Spread is unusually wide",
      `${input.spreadBps.toFixed(1)} bp between best bid and ask. A taker crosses that gap. Rest one tick instead, or pick a tighter market.`,
    );
  } else {
    push("green", "spread", "Spread", `${input.spreadBps.toFixed(1)} bp.`);
  }

  if (input.slippageBps != null && input.slippageBps > 10) {
    push(
      "amber",
      "slip",
      "Estimated slippage is high",
      `${input.slippageBps.toFixed(1)} bp between the estimated average fill and the touch. This is book slippage, not distance from the mark.`,
    );
  } else if (input.slippageBps != null) {
    push("green", "slip", "Slippage versus the touch", `${input.slippageBps.toFixed(1)} bp from the best price on the taking side.`);
  }

  if (input.depthNotional != null && input.notional > input.depthNotional && input.notional > 0) {
    push(
      "amber",
      "depth",
      "Visible liquidity is insufficient",
      `Notional ${input.notional.toFixed(2)} USDso is larger than the visible opposing book (${input.depthNotional.toFixed(2)} USDso). The rest will rest or fail if you send IOC.`,
    );
  } else if (input.depthNotional != null) {
    push(
      "green",
      "depth",
      "Size versus visible book",
      `${input.notional.toFixed(2)} USDso against ${input.depthNotional.toFixed(2)} USDso shown on the taking side.`,
    );
  }

  if (input.equity != null && input.equity > 0) {
    const pct = (input.margin / input.equity) * 100;
    if (pct > 80) {
      push(
        "red",
        "margin",
        "Insufficient collateral headroom",
        `This ticket uses about ${pct.toFixed(0)}% of account equity. Lower notional or leverage, or deposit USDso into the perps account.`,
      );
    } else if (pct > 40) {
      push("amber", "collateral", "Account risk", `${pct.toFixed(0)}% of equity would margin this ticket.`);
    } else {
      push("green", "collateral", "Account risk", `${pct.toFixed(0)}% of equity.`);
    }
  } else if (input.mode === "live" && input.equity == null) {
    push("amber", "collateral", "Collateral not read", "Connect a wallet so previewPerpOrderMargin can check equity.");
  } else if (input.mode === "live") {
    push(
      "red",
      "collateral",
      "Account equity is not positive",
      "previewPerpOrderMargin returned no positive equity. Margin utilization is unavailable, and an increasing order cannot be judged as funded.",
    );
  }

  if (input.priceable === false) {
    push(
      "red",
      "max",
      "Order is not priceable",
      "getMaxPerpOrderSize returned priceable false. The pool has no live mark to size against. Do not send.",
    );
  } else if (input.placeable === false) {
    push(
      "red",
      "max",
      "Order exceeds maximum placeable size",
      `The pool would reject this size. getMaxPerpOrderSize says limitedBy ${input.limitedBy ?? "unknown"}. Max quantity is ${input.maxPlaceable ?? 0}. Shrink the order or fund the limit named by limitedBy.`,
    );
  } else if (input.maxPlaceable != null && input.qty > input.maxPlaceable) {
    push(
      "red",
      "maxqty",
      "Quantity is above the quoted maximum",
      `Quoted max is ${input.maxPlaceable}. Lower notional so quantity fits.`,
    );
  } else if (input.placeable === true) {
    push(
      "green",
      "max",
      "Maximum placeable quantity",
      input.maxPlaceable == null ? "The quote is placeable." : `Up to ${input.maxPlaceable} base, limited next by ${input.limitedBy ?? "the margin gates"}.`,
    );
  }

  if (input.hourlyFunding == null || input.dailyFunding == null) {
    push("amber", "fundflow", "Funding is N/A", "The hourly rate is withheld until getPerpState confirms it. Projections are not shown.");
  } else if (input.targetMove != null && input.targetMove > 0 && Math.abs(input.dailyFunding) > input.targetMove * 0.5) {
    push(
      "amber",
      "fund",
      "Funding may consume the expected profit",
      `About ${Math.abs(input.dailyFunding).toFixed(4)} USDso of funding would accrue per day if this hourly rate stayed constant, more than half the move to your target (${input.targetMove.toFixed(4)} USDso). Shorten the hold or flip to the side that receives funding. This is not a prediction.`,
    );
  } else {
    push(
      input.hourlyFunding < 0 ? "amber" : "green",
      "fundflow",
      input.hourlyFunding >= 0 ? "Hourly funding income" : "Hourly funding cost",
      `${input.hourlyFunding >= 0 ? "You receive" : "You pay"} about ${Math.abs(input.hourlyFunding).toFixed(4)} USDso per hour at the current rate, about ${Math.abs(input.dailyFunding).toFixed(4)} per day if that hourly rate stayed constant. This is not a prediction.`,
    );
  }

  if (input.stopInvalid) {
    push(
      "red",
      "stop",
      "Stop or target is on the wrong side",
      "For a long, stop must be below entry and target above. For a short, the opposite. Reward-to-risk is withheld until that is true.",
    );
  } else if (input.rewardRisk != null) {
    push(
      input.rewardRisk >= 1.5 ? "green" : "amber",
      "rr",
      "Reward-to-risk",
      `${input.rewardRisk.toFixed(2)} to 1 using your stop and target. This is distance math, not a probability.`,
    );
  }

  const level: RiskLevel = items.some((i) => i.level === "red")
    ? "red"
    : items.some((i) => i.level === "amber")
      ? "amber"
      : "green";
  return { level, items };
}

export function limitedByHint(limitedBy: string | null): string {
  switch (limitedBy) {
    case "collateral":
      return "Unlocked perps margin cannot cover the next lot. Deposit USDso into the perps account.";
    case "initialMargin":
      return "Post-lock equity would fall under initial margin. Reduce size or add margin.";
    case "maxPositionSize":
      return "The next lot would pass this market's per-account position cap.";
    case "voucherBlocked":
      return "Paper USDso cannot increase a position on this market. Fund the account with real testnet USDso or pick a voucher market.";
    case "walletBalance":
      return "Auto-pull needs more USDso in the wallet than it holds.";
    case "walletAllowance":
      return "The wallet holds USDso but has not approved the MarginBank.";
    case "mainWallet":
      return "The linked main wallet cannot cover the residual pull.";
    case "mainFundingBlocked":
      return "A prior funding payer is still owed. Repay that before the main wallet can top up.";
    case "restricted":
      return "The market is close-only. This order would increase exposure.";
    case "isolated":
      return "Isolated margin blocks this market while the account has a footprint elsewhere.";
    default:
      return limitedBy ? `The SDK reported limitedBy ${limitedBy}.` : "";
  }
}
