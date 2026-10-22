import { SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { formatEther, createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import {
  human,
  toMarket,
  type BookLevel,
  type ChainPosition,
  type FundingPoint,
  type Market,
  type RawMarket,
  type TapeFill,
} from "@/lib/perp-math";
import { HIDEKI_INDEXER, HIDEKI_RPC, HIDEKI_CHAIN_ID, SDK_VERSION } from "@/lib/freshness";
import { CANCEL_ORDER_FOR_SELECTOR, HIDEKI_OPERATOR_REGISTRY, PLACE_ORDER_FOR_SELECTOR, REDUCE_ORDER_FOR_SELECTOR } from "@/lib/operator";
import { getSdk } from "@/lib/sdk";

const INDEXER = HIDEKI_INDEXER;

const MARKET_FIELDS = `
  id
  baseSymbol
  markPrice
  indexPrice
  lastPrice
  fundingRate
  fundingIntervalSec
  fundingWindowSec
  openInterest
  cumulativeQuoteVolume
  tradeCount
  baseDecimals
  quoteDecimals
  tickSize
  lotSize
  minQuantity
  initialMarginBps
  poolAddress
  marginBank
  markPriceUpdatedAt
  fundingUpdatedAt
  openInterestUpdatedAt
`;

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Hideki indexer returned ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "Indexer query failed");
  if (!json.data) throw new Error("Indexer returned no data");
  return json.data;
}

export const listPerps = createServerFn({ method: "GET" }).handler(async () => {
  const data = await gql<{ Market: RawMarket[] }>(`
    query {
      Market(
        where: { marketType: { _eq: PERP }, perpRegistered: { _eq: true } }
        order_by: { baseSymbol: asc }
      ) { ${MARKET_FIELDS} }
    }
  `);
  const markets: Market[] = data.Market.map(toMarket).sort(
    (a, b) => Math.abs(b.fundingHourly) - Math.abs(a.fundingHourly) || b.volumeQuote - a.volumeQuote,
  );
  return { markets, fetchedAt: Date.now() };
});

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const marketTape = createServerFn({ method: "GET" })
  .validator(z.object({ marketId: address }))
  .handler(async ({ data }) => {
    const id = data.marketId.toLowerCase();
    const result = await gql<{
      bids: { price: string; quantityRemaining: string; isBid: boolean }[];
      asks: { price: string; quantityRemaining: string; isBid: boolean }[];
      fills: {
        fillPrice: string;
        quantity: string;
        takerIsBid: boolean;
        timestamp: string;
        txHash: string;
      }[];
      funding: { timestamp: string; fundingRate: string; markPrice: string }[];
      meta: { baseDecimals: number }[];
    }>(
      `
      query Tape($id: String!) {
        bids: Order(
          where: { market_id: { _eq: $id }, status: { _eq: Open }, isBid: { _eq: true } }
          order_by: { price: desc }
          limit: 8
        ) { price quantityRemaining isBid }
        asks: Order(
          where: { market_id: { _eq: $id }, status: { _eq: Open }, isBid: { _eq: false } }
          order_by: { price: asc }
          limit: 8
        ) { price quantityRemaining isBid }
        fills: Fill(
          where: { market_id: { _eq: $id } }
          order_by: { timestamp: desc }
          limit: 14
        ) { fillPrice quantity takerIsBid timestamp txHash }
        funding: FundingRateUpdate(
          where: { market_id: { _eq: $id } }
          order_by: { timestamp: desc }
          limit: 16
        ) { timestamp fundingRate markPrice }
        meta: Market(where: { id: { _eq: $id } }, limit: 1) { baseDecimals }
      }
    `,
      { id },
    );
    const decimals = result.meta[0]?.baseDecimals ?? 18;
    const quoteDecimals = 18;
    const level = (row: { price: string; quantityRemaining: string; isBid: boolean }): BookLevel => ({
      price: human(row.price, quoteDecimals),
      qty: human(row.quantityRemaining, decimals),
      isBid: row.isBid,
      priceRaw: row.price,
      qtyRaw: row.quantityRemaining,
    });
    const fills: TapeFill[] = result.fills.map((row) => ({
      price: human(row.fillPrice, 18),
      qty: human(row.quantity, decimals),
      takerIsBid: row.takerIsBid,
      timestamp: Number(row.timestamp),
      txHash: row.txHash,
    }));
    const funding: FundingPoint[] = result.funding
      .map((row) => ({
        timestamp: Number(row.timestamp),
        fundingPerWindow: human(row.fundingRate, 18),
        mark: human(row.markPrice, 18),
      }))
      .reverse();
    return { bids: result.bids.map(level), asks: result.asks.map(level), fills, funding, fetchedAt: Date.now() };
  });

export const accountBook = createServerFn({ method: "GET" })
  .validator(z.object({ account: address }))
  .handler(async ({ data }) => {
    const account = data.account.toLowerCase();
    const result = await gql<{
      PerpPosition: {
        market_id: string;
        isLong: boolean;
        size: string;
        entryPriceX18: string;
        updatedAt: string;
        market: { baseDecimals: number; baseSymbol: string | null } | null;
      }[];
    }>(
      `
      query Book($account: String!) {
        PerpPosition(
          where: { account: { _eq: $account }, size: { _gt: "0" } }
          order_by: { updatedAt: desc }
          limit: 40
        ) {
          market_id
          isLong
          size
          entryPriceX18
          updatedAt
          market { baseDecimals baseSymbol }
        }
      }
    `,
      { account },
    );
    const positions: (ChainPosition & { base: string })[] = result.PerpPosition.map((row) => {
      const decimals = row.market?.baseDecimals ?? 18;
      return {
        marketId: row.market_id,
        base: row.market?.baseSymbol ?? "?",
        isLong: row.isLong,
        size: human(row.size, decimals),
        entry: human(row.entryPriceX18, 18),
        updatedAt: Number(row.updatedAt),
      };
    });
    return { account, positions };
  });

function httpClient() {
  return createPublicClient({ chain: hidekiTestnet, transport: http(HIDEKI_RPC) });
}

export type ChainOverlay = {
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

export const liveChain = createServerFn({ method: "GET" }).handler(async () => {
  const sdk = getSdk();
  const fetchedAt = Date.now();
  let perps;
  try {
    perps = await sdk.client.listPerpMarkets({ limit: 30 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "listPerpMarkets failed";
    return { fetchedAt, sdkVersion: SDK_VERSION, rows: [] as ChainOverlay[], error: message };
  }
  const rows = await Promise.all(
    perps.map(async (market): Promise<ChainOverlay> => {
      const id = market.id.toLowerCase();
      try {
        const [state, book] = await Promise.all([
          sdk.client.getPerpState(market.poolAddress),
          topSpread(id, market.quoteDecimals),
        ]);
        const quoteDecimals = market.quoteDecimals || 18;
        const perWindow = Number(state.fundingRate) / 1e18;
        return {
          id,
          ok: true,
          error: null,
          markPriceOk: state.markPriceOk,
          markRaw: state.markPrice.toString(),
          indexRaw: state.indexPrice.toString(),
          indexUpdatedAt: Number(state.indexUpdatedAt),
          fundingPerWindow: Number.isFinite(perWindow) ? perWindow : 0,
          oiRaw: state.openInterest.toString(),
          baseDecimals: market.baseDecimals,
          quoteDecimals,
          lastFundingAt: Number(state.lastFundingUpdateAt),
          intervalSec: state.fundingIntervalSec,
          windowSec: state.fundingWindowSec,
          spreadBps: book,
          marginBank: market.marginBank,
          initialMarginBps: market.initialMarginBps,
          tickRaw: market.tickSize,
          lotRaw: market.lotSize,
          minQtyRaw: market.minQuantity,
        };
      } catch (error) {
        return {
          id,
          ok: false,
          error: error instanceof Error ? error.message : "getPerpState failed",
          markPriceOk: false,
          markRaw: "0",
          indexRaw: "0",
          indexUpdatedAt: 0,
          fundingPerWindow: 0,
          oiRaw: "0",
          baseDecimals: market.baseDecimals,
          quoteDecimals: market.quoteDecimals || 18,
          lastFundingAt: 0,
          intervalSec: 0,
          windowSec: 0,
          spreadBps: null,
          marginBank: market.marginBank,
          initialMarginBps: market.initialMarginBps,
          tickRaw: market.tickSize,
          lotRaw: market.lotSize,
          minQtyRaw: market.minQuantity,
        };
      }
    }),
  );
  return { fetchedAt, sdkVersion: SDK_VERSION, rows, error: null as string | null };
});

async function topSpread(id: string, quoteDecimals: number): Promise<number | null> {
  try {
    const data = await gql<{
      bids: { price: string }[];
      asks: { price: string }[];
    }>(
      `
      query Top($id: String!) {
        bids: Order(
          where: { market_id: { _eq: $id }, status: { _eq: Open }, isBid: { _eq: true } }
          order_by: { price: desc }
          limit: 1
        ) { price }
        asks: Order(
          where: { market_id: { _eq: $id }, status: { _eq: Open }, isBid: { _eq: false } }
          order_by: { price: asc }
          limit: 1
        ) { price }
      }
    `,
      { id },
    );
    const bid = data.bids[0] ? Number(data.bids[0].price) / 10 ** quoteDecimals : 0;
    const ask = data.asks[0] ? Number(data.asks[0].price) / 10 ** quoteDecimals : 0;
    if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
    const mid = (bid + ask) / 2;
    return ((ask - bid) / mid) * 10_000;
  } catch {
    return null;
  }
}

export const quoteMax = createServerFn({ method: "POST" })
  .validator(
    z.object({
      pool: address,
      marginBank: address,
      account: address,
      isBid: z.boolean(),
      price: z.string().regex(/^\d+$/),
      autoPull: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const fetchedAt = Date.now();
    try {
      const max = await getSdk().client.getMaxPerpOrderSize({
        pool: data.pool as `0x${string}`,
        marginBank: data.marginBank as `0x${string}`,
        account: data.account as `0x${string}`,
        isBid: data.isBid,
        price: BigInt(data.price),
        autoPull: data.autoPull,
      });
      if (!max.priceable) {
        return { fetchedAt, priceable: false as const, placeable: null, maxQuantity: null, limitedBy: null, error: null };
      }
      return {
        fetchedAt,
        priceable: true as const,
        placeable: max.placeable,
        maxQuantity: max.maxQuantity.toString(),
        limitedBy: max.limitedBy,
        error: null,
      };
    } catch (error) {
      return {
        fetchedAt,
        priceable: null,
        placeable: null,
        maxQuantity: null,
        limitedBy: null,
        error: error instanceof Error ? error.message : "getMaxPerpOrderSize failed",
      };
    }
  });

export const accountSnapshot = createServerFn({ method: "GET" })
  .validator(z.object({ account: address }))
  .handler(async ({ data }) => {
    const account = data.account.toLowerCase() as `0x${string}`;
    const fetchedAt = Date.now();
    const errors: string[] = [];
    const bank = SOMNIA_HIDEKI_TESTNET_ADDRESSES.marginBank;
    if (!bank) errors.push("SDK address preset has no MarginBank.");

    let stt: string | null = null;
    try {
      const wei = await httpClient().getBalance({ address: account });
      stt = formatEther(wei);
    } catch (error) {
      errors.push(`STT balance: ${error instanceof Error ? error.message : "RPC failed"}`);
    }

    let positions: (ChainPosition & { base: string; liq: number | null; leverageX: number | null })[] = [];
    try {
      const result = await gql<{
        PerpPosition: {
          market_id: string;
          isLong: boolean;
          size: string;
          entryPriceX18: string;
          updatedAt: string;
          market: { baseDecimals: number; baseSymbol: string | null } | null;
        }[];
      }>(
        `
        query Book($account: String!) {
          PerpPosition(
            where: { account: { _eq: $account }, size: { _gt: "0" } }
            order_by: { updatedAt: desc }
            limit: 40
          ) {
            market_id
            isLong
            size
            entryPriceX18
            updatedAt
            market { baseDecimals baseSymbol }
          }
        }
      `,
        { account },
      );
      const rows: (ChainPosition & { base: string })[] = result.PerpPosition.map((row) => {
        const decimals = row.market?.baseDecimals ?? 18;
        return {
          marketId: row.market_id,
          base: row.market?.baseSymbol ?? "?",
          isLong: row.isLong,
          size: human(row.size, decimals),
          entry: human(row.entryPriceX18, 18),
          updatedAt: Number(row.updatedAt),
        };
      });
      if (bank) {
        positions = await Promise.all(
          rows.slice(0, 8).map(async (p) => {
            try {
              const ref = { marginBank: bank, account, pool: p.marketId as `0x${string}` };
              const [liq, lev] = await Promise.all([
                getSdk().client.getLiquidationPrice(ref),
                getSdk().client.getPerpLeverage(ref),
              ]);
              return {
                ...p,
                liq: liq == null ? null : human(liq.toString(), 18),
                leverageX: lev.positionLeverageBps == null ? null : Number(lev.positionLeverageBps) / 10_000,
              };
            } catch (error) {
              errors.push(`${p.base} risk: ${error instanceof Error ? error.message : "chain read failed"}`);
              return { ...p, liq: null, leverageX: null };
            }
          }),
        );
        if (rows.length > 8) {
          positions.push(...rows.slice(8).map((p) => ({ ...p, liq: null, leverageX: null })));
          errors.push("Liquidation reads were limited to the first 8 positions.");
        }
      } else {
        positions = rows.map((p) => ({ ...p, liq: null, leverageX: null }));
      }
    } catch (error) {
      errors.push(`Positions: ${error instanceof Error ? error.message : "indexer failed"}`);
    }

    let margin: {
      unlocked: string;
      locked: string;
      equity: string;
      withdrawable: string;
      status: string;
    } | null = null;
    if (bank) {
      try {
        const row = await getSdk().client.getMarginAccount(bank, account);
        margin = {
          unlocked: formatEther(row.unlockedCollateralBalance),
          locked: formatEther(row.lockedCollateral),
          equity: formatEther(row.equity),
          withdrawable: formatEther(row.withdrawable),
          status: row.marginStatus,
        };
      } catch (error) {
        errors.push(`Margin: ${error instanceof Error ? error.message : "getMarginAccount failed"}`);
      }
    }

    let voucherFloor: string | null = null;
    if (bank) {
      try {
        const voucher = await getSdk().client.getPerpVoucher(bank, account);
        voucherFloor = formatEther(voucher?.floor ?? 0n);
      } catch (error) {
        errors.push(`Voucher: ${error instanceof Error ? error.message : "getPerpVoucher failed"}`);
      }
    }

    let orders: { price: string; qty: string; isBid: boolean; marketId: string }[] = [];
    try {
      const result = await gql<{
        Order: { price: string; quantityRemaining: string; isBid: boolean; market_id: string }[];
      }>(
        `
        query Orders($account: String!) {
          Order(
            where: { owner: { _eq: $account }, status: { _eq: Open } }
            limit: 20
            order_by: { placedAtTimestamp: desc }
          ) { price quantityRemaining isBid market_id }
        }
      `,
        { account },
      );
      orders = result.Order.map((row) => ({
        price: row.price,
        qty: row.quantityRemaining,
        isBid: row.isBid,
        marketId: row.market_id,
      }));
    } catch (error) {
      errors.push(`Open orders: ${error instanceof Error ? error.message : "indexer failed"}`);
    }

    let fills: { price: string; qty: string; takerIsBid: boolean; timestamp: string; txHash: string; marketId: string }[] =
      [];
    try {
      const result = await gql<{
        Fill: {
          fillPrice: string;
          quantity: string;
          takerIsBid: boolean;
          timestamp: string;
          txHash: string;
          market_id: string;
        }[];
      }>(
        `
        query Fills($account: String!) {
          Fill(
            where: { _or: [{ taker: { _eq: $account } }, { maker: { _eq: $account } }] }
            order_by: { timestamp: desc }
            limit: 12
          ) { fillPrice quantity takerIsBid timestamp txHash market_id }
        }
      `,
        { account },
      );
      fills = result.Fill.map((row) => ({
        price: row.fillPrice,
        qty: row.quantity,
        takerIsBid: row.takerIsBid,
        timestamp: row.timestamp,
        txHash: row.txHash,
        marketId: row.market_id,
      }));
    } catch (error) {
      errors.push(`Fills: ${error instanceof Error ? error.message : "indexer failed"}`);
    }

    let fundingTotal: string | null = null;
    try {
      const result = await gql<{ FundingPayment: { amount: string }[] }>(
        `
        query Funding($account: String!) {
          FundingPayment(where: { account: { _eq: $account } }, limit: 200, order_by: { timestamp: desc }) {
            amount
          }
        }
      `,
        { account },
      );
      const sum = result.FundingPayment.reduce((s, row) => s + BigInt(row.amount), 0n);
      fundingTotal = formatEther(sum);
    } catch (error) {
      errors.push(`Funding payments: ${error instanceof Error ? error.message : "indexer failed"}`);
    }

    return {
      account,
      fetchedAt,
      sdkVersion: SDK_VERSION,
      stt,
      margin,
      voucherFloor,
      positions,
      orders,
      fills,
      fundingTotal,
      fundingSign: "signed-indexer-amount" as const,
      realizedPnl: null as string | null,
      errors,
      marginBank: bank ?? null,
    };
  });

function errText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const poolRisk = createServerFn({ method: "POST" })
  .validator(z.object({ pool: address }))
  .handler(async ({ data }) => {
    const fetchedAt = Date.now();
    const pool = data.pool as `0x${string}`;
    const errors: string[] = [];
    let risk: { initialMarginBps: string; maintenanceMarginBps: string; closeOutMarginBps: string } | null = null;
    let health: { priceable: false } | { priceable: true; effectiveImfBps: string; maintenanceMarginBps: string } | null = null;
    try {
      const row = await getSdk().client.getPerpRiskParams(pool);
      risk = {
        initialMarginBps: row.initialMarginBps.toString(),
        maintenanceMarginBps: row.maintenanceMarginBps.toString(),
        closeOutMarginBps: row.closeOutMarginBps.toString(),
      };
    } catch (error) {
      errors.push(`getPerpRiskParams: ${errText(error, "failed")}`);
    }
    try {
      const row = await getSdk().client.getPerpHealthSnapshot(pool);
      health = row.priceable
        ? {
            priceable: true,
            effectiveImfBps: row.effectiveImfBps.toString(),
            maintenanceMarginBps: row.maintenanceMarginBps.toString(),
          }
        : { priceable: false };
    } catch (error) {
      errors.push(`getPerpHealthSnapshot: ${errText(error, "failed")}`);
    }
    return { fetchedAt, risk, health, errors };
  });

export const liveQuote = createServerFn({ method: "POST" })
  .validator(
    z.object({
      pool: address,
      marginBank: address,
      account: address,
      isBid: z.boolean(),
      price: z.string().regex(/^\d+$/),
      quantity: z.string().regex(/^\d+$/),
      asMaker: z.boolean(),
      autoPull: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const fetchedAt = Date.now();
    const pool = data.pool as `0x${string}`;
    const bank = data.marginBank as `0x${string}`;
    const account = data.account as `0x${string}`;
    const price = BigInt(data.price);
    const quantity = BigInt(data.quantity);
    const client = getSdk().client;
    const errors: string[] = [];
    let capX: number | null = null;
    let margin: { unlocked: string; equity: string; mmReq: string; imReq: string; status: string } | null = null;
    let order: {
      priceable: boolean;
      lockAmount: string | null;
      initialMarginPortion: string | null;
      adverseGapPortion: string | null;
      leverageSurcharge: string | null;
      effectiveImfBps: string | null;
      imRequirement: string | null;
      hasCollateralForLock: boolean | null;
      meetsInitialMargin: boolean | null;
      voucherBlocked: boolean | null;
      restrictedBlocked: boolean | null;
      isolationBlocked: boolean | null;
      sufficient: boolean | null;
      walletCoversTopUp: boolean | null;
      topUpRequired: string | null;
      equity: string | null;
      unlocked: string | null;
    } | null = null;
    let liquidation: {
      priceable: boolean;
      projectedRaw: string | null;
      projectedMmReq: string | null;
      projectedEquity: string | null;
      projectedSize: string | null;
      leverageBps: string | null;
      asOfBlock: string;
    } | null = null;
    try {
      capX = await client.getPerpMaxLeverage({ marginBank: bank, account, pool });
    } catch (error) {
      errors.push(`getPerpMaxLeverage: ${errText(error, "failed")}`);
    }
    try {
      const row = await client.getMarginAccount(bank, account);
      margin = {
        unlocked: formatEther(row.unlockedCollateralBalance),
        equity: formatEther(row.equity),
        mmReq: formatEther(row.mmReq),
        imReq: formatEther(row.imReq),
        status: row.marginStatus,
      };
    } catch (error) {
      errors.push(`getMarginAccount: ${errText(error, "failed")}`);
    }
    try {
      const row = await client.previewPerpOrderMargin({
        pool,
        marginBank: bank,
        account,
        isBid: data.isBid,
        price,
        quantity,
        autoPull: data.autoPull,
      });
      if (!row.priceable) {
        order = {
          priceable: false,
          lockAmount: null,
          initialMarginPortion: null,
          adverseGapPortion: null,
          leverageSurcharge: null,
          effectiveImfBps: null,
          imRequirement: null,
          hasCollateralForLock: null,
          meetsInitialMargin: null,
          voucherBlocked: null,
          restrictedBlocked: null,
          isolationBlocked: null,
          sufficient: null,
          walletCoversTopUp: null,
          topUpRequired: null,
          equity: null,
          unlocked: null,
        };
      } else {
        order = {
          priceable: true,
          lockAmount: formatEther(row.lockAmount),
          initialMarginPortion: formatEther(row.initialMarginPortion),
          adverseGapPortion: formatEther(row.adverseGapPortion),
          leverageSurcharge: formatEther(row.leverageSurcharge),
          effectiveImfBps: row.effectiveImfBps.toString(),
          imRequirement: formatEther(row.imRequirement),
          hasCollateralForLock: row.hasCollateralForLock,
          meetsInitialMargin: row.meetsInitialMargin,
          voucherBlocked: row.voucherBlocked,
          restrictedBlocked: row.restrictedBlocked,
          isolationBlocked: row.isolationBlocked,
          sufficient: row.sufficient,
          walletCoversTopUp: row.walletCoversTopUp,
          topUpRequired: formatEther(row.topUpRequired),
          equity: formatEther(row.equity),
          unlocked: formatEther(row.unlockedCollateral),
        };
      }
    } catch (error) {
      errors.push(`previewPerpOrderMargin: ${errText(error, "failed")}`);
    }
    try {
      const row = await client.previewPerpLiquidationPrice(
        { pool, marginBank: bank, account, isBid: data.isBid, price, quantity, asMaker: data.asMaker },
      );
      liquidation = row.priceable
        ? {
            priceable: true,
            projectedRaw: row.projectedLiquidationPrice == null ? null : row.projectedLiquidationPrice.toString(),
            projectedMmReq: formatEther(row.projectedMmReq),
            projectedEquity: formatEther(row.projectedEquity),
            projectedSize: row.projectedSize.toString(),
            leverageBps: row.projectedPositionLeverageBps == null ? null : row.projectedPositionLeverageBps.toString(),
            asOfBlock: row.asOfBlock.toString(),
          }
        : {
            priceable: false,
            projectedRaw: null,
            projectedMmReq: null,
            projectedEquity: null,
            projectedSize: null,
            leverageBps: null,
            asOfBlock: row.asOfBlock.toString(),
          };
    } catch (error) {
      errors.push(`previewPerpLiquidationPrice: ${errText(error, "failed")}`);
    }
    return { fetchedAt, capX, margin, order, liquidation, errors };
  });

const poolRegistryAbi = parseAbi(["function getOperatorPermissionsRegistry() view returns (address)"]);
const authAbi = parseAbi([
  "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
]);
const registryAbi = parseAbi([
  "function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) view returns (bool)",
  "function isGloballyApproved(address owner, address operator, bytes4 selector) view returns (bool)",
]);

export const botPermissions = createServerFn({ method: "POST" })
  .validator(
    z.object({
      owner: address,
      operator: address,
      pools: z.array(z.object({ pool: address, symbol: z.string().min(1).max(32) })).min(1).max(40),
    }),
  )
  .handler(async ({ data }) => {
    const fetchedAt = Date.now();
    const owner = data.owner as Address;
    const operator = data.operator as Address;
    const errors: string[] = [];
    if (owner.toLowerCase() === operator.toLowerCase()) {
      return {
        fetchedAt,
        sdkVersion: SDK_VERSION,
        chainId: HIDEKI_CHAIN_ID,
        registry: null as string | null,
        registrySource: "unread" as const,
        registryError: "Owner and bot are the same address.",
        operatorStt: null as string | null,
        markets: data.pools.map((pool) => ({
          pool: pool.pool,
          symbol: pool.symbol,
          place: null as boolean | null,
          cancel: null as boolean | null,
          reduce: null as boolean | null,
          poolApproved: null as boolean | null,
          error: "Owner and bot must be different addresses.",
        })),
        errors: ["Owner and bot are the same address. Paste the DreamDEX public address, not the bot."],
      };
    }
    const client = createPublicClient({ chain: hidekiTestnet, transport: http(HIDEKI_RPC) });
    const lead = data.pools[0]!.pool as Address;
    let registry: string | null = null;
    let registrySource: "pool" | "documented" | "unread" = "unread";
    let registryError: string | null = null;
    try {
      const read = await client.readContract({
        address: lead,
        abi: poolRegistryAbi,
        functionName: "getOperatorPermissionsRegistry",
      });
      registry = read;
      registrySource = "pool";
    } catch (error) {
      registryError = errText(error, "getOperatorPermissionsRegistry failed");
      registry = HIDEKI_OPERATOR_REGISTRY;
      registrySource = "documented";
      errors.push(`Pool registry read failed. Raw slot reads use the documented Hideki registry and are not treated as a grant. ${registryError}`);
    }
    const selectors = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR, REDUCE_ORDER_FOR_SELECTOR] as const;
    const contracts = data.pools.flatMap((pool) =>
      selectors.map((selector) => ({
        address: pool.pool as Address,
        abi: authAbi,
        functionName: "isOperatorAuthorized" as const,
        args: [owner, operator, selector] as const,
      })),
    );
    let auth: { status: "success" | "failure"; result?: boolean; error?: unknown }[] = [];
    try {
      auth = await client.multicall({ contracts, allowFailure: true });
    } catch (error) {
      errors.push(`isOperatorAuthorized: ${errText(error, "multicall failed")}`);
    }
    const markets = data.pools.map((pool, index) => {
      const slice = auth.slice(index * 3, index * 3 + 3);
      const flag = (item: (typeof slice)[number] | undefined): boolean | null => {
        if (!item) return null;
        if (item.status === "success") return item.result === true;
        return null;
      };
      const failed = slice.find((item) => item && item.status === "failure");
      return {
        pool: pool.pool,
        symbol: pool.symbol,
        place: flag(slice[0]),
        cancel: flag(slice[1]),
        reduce: flag(slice[2]),
        poolApproved: null as boolean | null,
        error: failed ? errText(failed.error, "permission read failed") : auth.length ? null : "Permission read did not return.",
      };
    });
    if (registry) {
      try {
        const raw = await client.multicall({
          contracts: data.pools.map((pool) => ({
            address: registry as Address,
            abi: registryAbi,
            functionName: "isApprovedForPool" as const,
            args: [pool.pool as Address, owner, operator, PLACE_ORDER_FOR_SELECTOR as Hex] as const,
          })),
          allowFailure: true,
        });
        raw.forEach((item, index) => {
          const row = markets[index];
          if (!row) return;
          if (item.status === "success") row.poolApproved = item.result === true;
        });
      } catch (error) {
        errors.push(`isApprovedForPool: ${errText(error, "failed")}`);
      }
    }
    let operatorStt: string | null = null;
    try {
      operatorStt = formatEther(await client.getBalance({ address: operator }));
    } catch (error) {
      errors.push(`Bot STT: ${errText(error, "balance failed")}`);
    }
    return { fetchedAt, sdkVersion: SDK_VERSION, chainId: HIDEKI_CHAIN_ID, registry, registrySource, registryError, operatorStt, markets, errors };
  });


