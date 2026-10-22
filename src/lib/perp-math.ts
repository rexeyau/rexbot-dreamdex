export type Market = {
  id: string;
  base: string;
  symbol: string;
  mark: number;
  index: number;
  last: number;
  fundingPerWindow: number;
  fundingHourly: number;
  fundingApr: number;
  oiBase: number;
  volumeQuote: number;
  trades: number;
  baseDecimals: number;
  tick: number;
  lot: number;
  minQty: number;
  tickRaw: string;
  lotRaw: string;
  minQtyRaw: string;
  markRaw: string;
  initialMarginBps: number;
  maxLeverage: number;
  pool: string;
  marginBank: string;
  updatedAt: number;
  fundingUpdatedAt: number;
  oiUpdatedAt: number;
  indexUpdatedAt: number;
  quoteDecimals: number;
  markOk: boolean;
  markSource: "chain" | "indexer";
  indexSource: "chain" | "indexer";
  fundingSource: "chain" | "indexer";
  oiSource: "chain" | "indexer";
  chainFetchedAt: number;
  chainError: string | null;
  spreadBps: number | null;
  voucher: boolean;
  intervalSec: number;
  windowSec: number;
};

export type BookLevel = {
  price: number;
  qty: number;
  isBid: boolean;
  priceRaw: string;
  qtyRaw: string;
};

export type TapeFill = {
  price: number;
  qty: number;
  takerIsBid: boolean;
  timestamp: number;
  txHash: string;
};

export type FundingPoint = {
  timestamp: number;
  fundingPerWindow: number;
  mark: number;
};

export type ChainPosition = {
  marketId: string;
  isLong: boolean;
  size: number;
  entry: number;
  updatedAt: number;
};

export type BuiltOrder = {
  isBid: boolean;
  priceRaw: string;
  quantityRaw: string;
  price: number;
  qty: number;
  notional: number;
  belowMin: boolean;
  maker: boolean;
};

const VOUCHER = new Set([
  "BTC",
  "ETH",
  "HYPE",
  "SOL",
  "XRP",
  "ADA",
  "AVAX",
  "BNB",
  "DOGE",
  "LINK",
  "NEAR",
  "SUI",
  "XLM",
  "TAO",
  "WLD",
]);

export function voucherEligible(base: string): boolean {
  return VOUCHER.has(base);
}

function num(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function human(raw: string | number | null | undefined, decimals: number): number {
  return num(raw) / 10 ** decimals;
}

export type RawMarket = {
  id: string;
  baseSymbol: string | null;
  markPrice: string | null;
  indexPrice: string | null;
  lastPrice: string | null;
  fundingRate: string | null;
  fundingIntervalSec: number | null;
  fundingWindowSec: number | null;
  openInterest: string | null;
  cumulativeQuoteVolume: string | null;
  tradeCount: string | null;
  baseDecimals: number;
  quoteDecimals: number;
  tickSize: string | null;
  lotSize: string | null;
  minQuantity: string | null;
  initialMarginBps: number | null;
  poolAddress: string;
  marginBank: string | null;
  markPriceUpdatedAt: string | null;
  fundingUpdatedAt: string | null;
  openInterestUpdatedAt: string | null;
};

export function toMarket(row: RawMarket): Market {
  const base = row.baseSymbol ?? "—";
  const interval = row.fundingIntervalSec || 3600;
  const window = row.fundingWindowSec || 28800;
  const perWindow = human(row.fundingRate, 18);
  const hourly = fundingHourlyFraction(perWindow, window);
  const hoursInYear = 365 * 24;
  const bps = row.initialMarginBps || 500;
  return {
    id: row.id,
    base,
    symbol: `${base}-PERP`,
    mark: human(row.markPrice, row.quoteDecimals || 18),
    index: human(row.indexPrice, row.quoteDecimals || 18),
    last: human(row.lastPrice, row.quoteDecimals || 18),
    fundingPerWindow: perWindow,
    fundingHourly: hourly,
    fundingApr: perWindow * (hoursInYear / (window / 3600)),
    oiBase: human(row.openInterest, row.baseDecimals),
    volumeQuote: human(row.cumulativeQuoteVolume, 18),
    trades: num(row.tradeCount),
    baseDecimals: row.baseDecimals,
    tick: human(row.tickSize, 18),
    lot: human(row.lotSize, row.baseDecimals),
    minQty: human(row.minQuantity, row.baseDecimals),
    tickRaw: row.tickSize ?? "1",
    lotRaw: row.lotSize ?? "1",
    minQtyRaw: row.minQuantity ?? "0",
    markRaw: row.markPrice ?? "0",
    initialMarginBps: bps,
    maxLeverage: Math.max(1, Math.round(10000 / bps)),
    pool: row.poolAddress,
    marginBank: row.marginBank ?? "",
    updatedAt: num(row.markPriceUpdatedAt),
    fundingUpdatedAt: num(row.fundingUpdatedAt),
    oiUpdatedAt: num(row.openInterestUpdatedAt),
    indexUpdatedAt: 0,
    quoteDecimals: row.quoteDecimals || 18,
    markOk: num(row.markPrice) > 0,
    markSource: "indexer",
    indexSource: "indexer",
    fundingSource: "indexer",
    oiSource: "indexer",
    chainFetchedAt: 0,
    chainError: null,
    spreadBps: null,
    voucher: voucherEligible(base),
    intervalSec: interval,
    windowSec: window,
  };
}

export type ChainRow = {
  id: string;
  ok: boolean;
  error: string | null;
  markPriceOk: boolean;
  markRaw: string;
  indexRaw: string;
  indexUpdatedAt: number;
  fundingPerWindow: number;
  oiRaw: string;
  baseDecimals: number;
  quoteDecimals: number;
  lastFundingAt: number;
  intervalSec: number;
  windowSec: number;
  spreadBps: number | null;
  marginBank: string;
  initialMarginBps: number;
  tickRaw: string;
  lotRaw: string;
  minQtyRaw: string;
};

/** Overlay a live getPerpState read onto an indexer market. Keeps the last good mark if this read failed. */
export function applyChain(market: Market, row: ChainRow | undefined, fetchedAt: number): Market {
  if (!row) return market;
  if (!row.ok) {
    return {
      ...market,
      chainFetchedAt: fetchedAt,
      chainError: row.error,
      markOk: false,
      spreadBps: row.spreadBps ?? market.spreadBps,
    };
  }
  const quote = row.quoteDecimals || market.quoteDecimals || 18;
  const baseDecimals = row.baseDecimals || market.baseDecimals;
  const mark = human(row.markRaw, quote);
  const index = human(row.indexRaw, quote);
  const useMark = row.markPriceOk && mark > 0;
  const interval = row.intervalSec || market.intervalSec || 3600;
  const window = row.windowSec || market.windowSec || 28800;
  const hourly = fundingHourlyFraction(row.fundingPerWindow, window);
  const bps = row.initialMarginBps || market.initialMarginBps || 500;
  return {
    ...market,
    mark: useMark ? mark : market.mark,
    index: index > 0 ? index : market.index,
    markRaw: useMark ? row.markRaw : market.markRaw,
    fundingPerWindow: row.fundingPerWindow,
    fundingHourly: hourly,
    fundingApr: row.fundingPerWindow * ((365 * 24) / (window / 3600)),
    oiBase: human(row.oiRaw, baseDecimals),
    updatedAt: useMark ? Math.floor(fetchedAt / 1000) : market.updatedAt,
    fundingUpdatedAt: row.lastFundingAt || market.fundingUpdatedAt,
    oiUpdatedAt: Math.floor(fetchedAt / 1000),
    indexUpdatedAt: row.indexUpdatedAt,
    quoteDecimals: quote,
    baseDecimals,
    markOk: row.markPriceOk,
    markSource: useMark ? "chain" : "indexer",
    indexSource: index > 0 ? "chain" : market.indexSource,
    fundingSource: "chain",
    oiSource: "chain",
    chainFetchedAt: fetchedAt,
    chainError: row.markPriceOk ? null : "getPerpState reported markPriceOk false",
    spreadBps: row.spreadBps,
    marginBank: row.marginBank || market.marginBank,
    initialMarginBps: bps,
    maxLeverage: Math.max(1, Math.round(10000 / bps)),
    tickRaw: row.tickRaw || market.tickRaw,
    lotRaw: row.lotRaw || market.lotRaw,
    minQtyRaw: row.minQtyRaw || market.minQtyRaw,
    tick: human(row.tickRaw || market.tickRaw, quote),
    lot: human(row.lotRaw || market.lotRaw, baseDecimals),
    minQty: human(row.minQtyRaw || market.minQtyRaw, baseDecimals),
    intervalSec: interval,
    windowSec: window,
  };
}

export function rawToNumber(raw: string, decimals: number): number {
  if (!/^-?\d+$/.test(raw)) return 0;
  const neg = raw.startsWith("-");
  const digits = neg ? raw.slice(1) : raw;
  const pad = digits.padStart(decimals + 1, "0");
  const whole = pad.slice(0, pad.length - decimals);
  const frac = pad.slice(pad.length - decimals, pad.length - decimals + 8);
  const n = Number(`${whole}.${frac}`);
  return neg ? -n : n;
}

export function basis(m: Pick<Market, "mark" | "index">): number {
  if (!m.index) return 0;
  return (m.mark - m.index) / m.index;
}

export function maintenanceFraction(initialMarginBps: number): number {
  return initialMarginBps / 10000 / 2;
}

export function liqPrice(
  entry: number,
  leverage: number,
  initialMarginBps: number,
  isLong: boolean,
): number | null {
  if (entry <= 0 || leverage <= 0) return null;
  const room = 1 / leverage - maintenanceFraction(initialMarginBps);
  if (room <= 0) return null;
  return isLong ? entry * (1 - room) : entry * (1 + room);
}

export function fundingHourlyFraction(perWindow: number, windowSec: number): number {
  const window = windowSec > 0 ? windowSec : 28800;
  return perWindow * (3600 / window);
}

export function orderMarginUtilization(input: {
  equity: number | null;
  existingIm: number | null;
  lockAmount: number | null;
  surcharge: number | null;
  topUp: number | null;
}): number | null {
  if (
    input.equity == null ||
    input.existingIm == null ||
    input.lockAmount == null ||
    input.surcharge == null
  ) {
    return null;
  }
  const denom = input.equity + (input.topUp ?? 0);
  const num = input.existingIm + input.lockAmount + input.surcharge;
  if (!Number.isFinite(num) || !Number.isFinite(denom) || !(denom > 0) || num < 0) return null;
  return (num / denom) * 100;
}

export function fundingLabel(
  hourlyFraction: number,
  notional: number,
  isLong: boolean,
): { kind: "paid" | "received" | "flat"; perHour: number; text: string } {
  const flow = fundingDollars(hourlyFraction, notional, isLong);
  if (flow < 0) return { kind: "paid", perHour: Math.abs(flow), text: "Estimated funding paid per hour" };
  if (flow > 0) return { kind: "received", perHour: Math.abs(flow), text: "Estimated funding received per hour" };
  return { kind: "flat", perHour: 0, text: "Estimated funding is flat" };
}

export type BookLimit = {
  ok: boolean;
  priceRaw: string;
  targetRaw: string;
  price: number;
  crosses: boolean;
  behaviour: "resting" | "marketable";
  detail: string;
  error: string | null;
};

function asTick(raw: string): bigint {
  try {
    const tick = BigInt(raw);
    return tick > 0n ? tick : 1n;
  } catch {
    return 1n;
  }
}

/** Limit from the touch, snapped to tickSize. Never uses the mark. */
export function limitFromBook(input: {
  isLong: boolean;
  cross: boolean;
  tickRaw: string;
  quoteDecimals: number;
  bidRaw: string | null;
  askRaw: string | null;
}): BookLimit {
  const fail = (error: string): BookLimit => ({
    ok: false,
    priceRaw: "0",
    targetRaw: "0",
    price: 0,
    crosses: input.cross,
    behaviour: input.cross ? "marketable" : "resting",
    detail: "",
    error,
  });
  if (!input.bidRaw || !input.askRaw) {
    return fail("The book is one-sided or empty. There is no best bid and best ask to price from.");
  }
  let bid: bigint;
  let ask: bigint;
  try {
    bid = BigInt(input.bidRaw);
    ask = BigInt(input.askRaw);
  } catch {
    return fail("Best bid or best ask is not an integer price.");
  }
  const tick = asTick(input.tickRaw);
  if (bid <= 0n || ask <= 0n) return fail("Best bid or best ask is zero.");
  if (bid >= ask) return fail("The book is locked or crossed. Best bid is not below best ask.");
  let raw: bigint;
  let detail: string;
  if (input.isLong && !input.cross) {
    raw = ask - tick;
    detail = "Buy limit one tick below the best ask. It does not cross.";
  } else if (input.isLong && input.cross) {
    raw = ask + tick;
    detail = "Buy limit one tick above the best ask. It is immediately marketable.";
  } else if (!input.cross) {
    raw = bid + tick;
    detail = "Sell limit one tick above the best bid. It does not cross.";
  } else {
    raw = bid - tick;
    detail = "Sell limit one tick below the best bid. It is immediately marketable.";
  }
  const targetRaw = raw.toString();
  if (input.isLong && !input.cross) raw = (raw / tick) * tick;
  else if (input.isLong && input.cross) raw = raw % tick === 0n ? raw : (raw / tick) * tick + tick;
  else if (!input.cross) raw = raw % tick === 0n ? raw : (raw / tick) * tick + tick;
  else raw = (raw / tick) * tick;
  if (input.isLong && !input.cross && (raw <= 0n || raw >= ask)) {
    return fail("After snapping to tickSize the bid would cross the ask or be zero. Nothing is submitted.");
  }
  if (input.isLong && input.cross && raw < ask) {
    return fail("After snapping to tickSize the bid is below the best ask, so it would rest instead of cross.");
  }
  if (!input.isLong && !input.cross && raw <= bid) {
    return fail("After snapping to tickSize the ask would trade against the bid. Nothing is submitted.");
  }
  if (!input.isLong && input.cross && (raw <= 0n || raw > bid)) {
    return fail("After snapping to tickSize the ask is above the best bid, so it would not cross.");
  }
  return {
    ok: true,
    priceRaw: raw.toString(),
    targetRaw,
    price: rawToNumber(raw.toString(), input.quoteDecimals),
    crosses: input.cross,
    behaviour: input.cross ? "marketable" : "resting",
    detail,
    error: null,
  };
}

export function quantityForNotional(
  market: Pick<Market, "baseDecimals" | "quoteDecimals" | "lotRaw" | "minQtyRaw">,
  priceRaw: string,
  notional: number,
): { quantityRaw: string; unsnappedRaw: string; qty: number; notional: number; belowMin: boolean } {
  const lot = asTick(market.lotRaw);
  const minQ = BigInt(market.minQtyRaw || "0");
  let price = 0n;
  try {
    price = BigInt(priceRaw);
  } catch {
    price = 0n;
  }
  const micro = BigInt(Math.max(0, Math.round(notional * 1_000_000)));
  const scaleUp = BigInt(Math.max(0, market.quoteDecimals - 6));
  const notionalRaw = micro * 10n ** scaleUp;
  const scale = 10n ** BigInt(market.baseDecimals);
  const unsnapped = price > 0n ? (notionalRaw * scale) / price : 0n;
  const qty = (unsnapped / lot) * lot;
  const qtyHuman = rawToNumber(qty.toString(), market.baseDecimals);
  const pxHuman = price > 0n ? rawToNumber(price.toString(), market.quoteDecimals) : 0;
  return {
    quantityRaw: qty.toString(),
    unsnappedRaw: unsnapped.toString(),
    qty: qtyHuman,
    notional: qtyHuman * pxHuman,
    belowMin: qty < minQ || qty === 0n,
  };
}

export function visibleFill(input: {
  isLong: boolean;
  cross: boolean;
  limit: number;
  qty: number;
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
  mark: number;
}): { marketableQty: number; avg: number | null; slippageBps: number | null } {
  const touch = input.isLong ? input.asks[0]?.price : input.bids[0]?.price;
  const slipFrom = (px: number) =>
    touch && touch > 0 ? (Math.abs(px - touch) / touch) * 10_000 : null;
  if (!input.cross) return { marketableQty: 0, avg: null, slippageBps: null };
  const levels = input.isLong
    ? input.asks.filter((level) => level.price <= input.limit * 1.000000001)
    : input.bids.filter((level) => level.price >= input.limit * 0.999999999);
  let left = input.qty;
  let notional = 0;
  let filled = 0;
  for (const level of levels) {
    if (!(left > 0)) break;
    const take = Math.min(left, level.qty);
    notional += take * level.price;
    filled += take;
    left -= take;
  }
  const avg = filled > 0 ? notional / filled : null;
  return { marketableQty: filled, avg, slippageBps: avg == null ? null : slipFrom(avg) };
}
export function fundingDollars(hourlyFraction: number, notional: number, isLong: boolean): number {
  const flow = hourlyFraction * notional;
  const longsPay = hourlyFraction > 0;
  if (flow === 0) return 0;
  return isLong === longsPay ? -Math.abs(flow) : Math.abs(flow);
}

export function buildOrder(
  market: Market,
  isLong: boolean,
  notional: number,
  maker: boolean,
): BuiltOrder {
  const mark = BigInt(market.markRaw || "0");
  const tick = BigInt(market.tickRaw || "1");
  const lot = BigInt(market.lotRaw || "1");
  const minQ = BigInt(market.minQtyRaw || "0");
  const safeTick = tick > 0n ? tick : 1n;
  const safeLot = lot > 0n ? lot : 1n;
  const floor = (mark / safeTick) * safeTick;
  const ceil = mark % safeTick === 0n ? mark : floor + safeTick;
  let price: bigint;
  if (isLong) {
    price = maker ? (floor > safeTick ? floor - safeTick : floor) : ceil;
  } else {
    price = maker ? ceil + safeTick : floor > 0n ? floor : safeTick;
  }
  if (price <= 0n) price = safeTick;
  const micro = BigInt(Math.max(0, Math.round(notional * 1_000_000)));
  const scaleUp = BigInt(Math.max(0, market.quoteDecimals - 6));
  const notionalRaw = micro * 10n ** scaleUp;
  const scale = 10n ** BigInt(market.baseDecimals);
  let qty = price > 0n ? (notionalRaw * scale) / price : 0n;
  qty = (qty / safeLot) * safeLot;
  const qtyHuman = Number(qty) / 10 ** market.baseDecimals;
  const pxHuman = Number(price) / 10 ** market.quoteDecimals;
  return {
    isBid: isLong,
    priceRaw: price.toString(),
    quantityRaw: qty.toString(),
    price: pxHuman,
    qty: qtyHuman,
    notional: qtyHuman * pxHuman,
    belowMin: qty < minQ || qty === 0n,
    maker,
  };
}

export function fmtPx(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 5 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

export function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs === 0) return "0";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

export function fmtUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}m`;
  if (a >= 10_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  if (a >= 100) return `${sign}$${a.toFixed(0)}`;
  if (a >= 1) return `${sign}$${a.toFixed(digits)}`;
  if (a === 0) return "$0";
  return `${sign}$${a.toFixed(4)}`;
}

export function fmtBpsPerHour(hourly: number): string {
  const bps = hourly * 10_000;
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  return `${sign}${Math.abs(bps).toFixed(3)}`;
}

export function fmtPct(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(3)}%`;
}

export function ageLabel(unixSec: number, now = Date.now()): string {
  if (!unixSec) return "—";
  const d = Math.max(0, now / 1000 - unixSec);
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function nextFundingMs(now = Date.now()): number {
  const hour = 60 * 60 * 1000;
  return hour - (now % hour);
}

export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function receiverSide(hourly: number): "shorts" | "longs" | "flat" {
  if (hourly > 0) return "shorts";
  if (hourly < 0) return "longs";
  return "flat";
}
