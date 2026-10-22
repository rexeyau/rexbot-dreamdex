import assert from "node:assert/strict";
import test from "node:test";
import { fundingHourlyFraction, fundingLabel, limitFromBook, liqPrice, orderMarginUtilization, quantityForNotional, visibleFill } from "./perp-math.ts";

const market = {
  baseDecimals: 18,
  quoteDecimals: 18,
  lotRaw: "1000000000000000",
  minQtyRaw: "1000000000000000",
};

test("resting long is one tick under the ask and does not cross", () => {
  const tick = 10n ** 18n;
  const bid = (100n * tick).toString();
  const ask = (110n * tick).toString();
  const limit = limitFromBook({ isLong: true, cross: false, tickRaw: tick.toString(), quoteDecimals: 18, bidRaw: bid, askRaw: ask });
  assert.equal(limit.ok, true);
  assert.equal(limit.behaviour, "resting");
  assert.equal(limit.priceRaw, (109n * tick).toString());
});

test("crossing long is one tick above the ask", () => {
  const tick = 10n ** 18n;
  const limit = limitFromBook({
    isLong: true,
    cross: true,
    tickRaw: tick.toString(),
    quoteDecimals: 18,
    bidRaw: (100n * tick).toString(),
    askRaw: (110n * tick).toString(),
  });
  assert.equal(limit.priceRaw, (111n * tick).toString());
  assert.equal(limit.behaviour, "marketable");
});

test("resting short is one tick above the bid", () => {
  const tick = 10n ** 18n;
  const limit = limitFromBook({
    isLong: false,
    cross: false,
    tickRaw: tick.toString(),
    quoteDecimals: 18,
    bidRaw: (100n * tick).toString(),
    askRaw: (110n * tick).toString(),
  });
  assert.equal(limit.priceRaw, (101n * tick).toString());
  assert.equal(limit.behaviour, "resting");
});

test("crossing short is one tick below the bid", () => {
  const tick = 10n ** 18n;
  const limit = limitFromBook({
    isLong: false,
    cross: true,
    tickRaw: tick.toString(),
    quoteDecimals: 18,
    bidRaw: (100n * tick).toString(),
    askRaw: (110n * tick).toString(),
  });
  assert.equal(limit.priceRaw, (99n * tick).toString());
  assert.equal(limit.behaviour, "marketable");
});

test("one-sided book does not invent a price", () => {
  const limit = limitFromBook({
    isLong: true,
    cross: false,
    tickRaw: "1",
    quoteDecimals: 18,
    bidRaw: "10",
    askRaw: null,
  });
  assert.equal(limit.ok, false);
});

test("locked book is rejected", () => {
  const limit = limitFromBook({
    isLong: true,
    cross: true,
    tickRaw: "1",
    quoteDecimals: 18,
    bidRaw: "10",
    askRaw: "10",
  });
  assert.equal(limit.ok, false);
});

test("crossing size larger than the visible book is reported short", () => {
  const fill = visibleFill({
    isLong: true,
    cross: true,
    limit: 111,
    qty: 5,
    bids: [{ price: 100, qty: 2 }],
    asks: [{ price: 110, qty: 1 }],
    mark: 105,
  });
  assert.equal(fill.marketableQty, 1);
  assert.ok(fill.marketableQty < 5);
});

test("positive funding makes a long pay and a short receive", () => {
  assert.equal(fundingLabel(0.0001, 50, true).text, "Estimated funding paid per hour");
  assert.equal(fundingLabel(0.0001, 50, false).text, "Estimated funding received per hour");
  assert.equal(fundingLabel(-0.0001, 50, false).text, "Estimated funding paid per hour");
  assert.equal(fundingLabel(-0.0001, 50, true).text, "Estimated funding received per hour");
});

test("paper short at 2x is an isolated simulation and is not 5% initial margin", () => {
  const entry = 83_000;
  const liq = liqPrice(entry, 2, 500, false);
  assert.ok(liq != null);
  assert.ok(Math.abs(liq - entry * 1.475) < 1);
  assert.equal(50 * (500 / 10_000), 2.5);
  assert.ok(liq > entry);
});

test("hourly funding uses the window, not the settlement interval", () => {
  const perWindow = 0.0008;
  assert.equal(fundingHourlyFraction(perWindow, 28800), 0.0001);
  assert.equal(fundingHourlyFraction(perWindow, 28800), perWindow * (3600 / 28800));
});

test("live margin utilization uses the lock, not notional over a leverage slider", () => {
  const util = orderMarginUtilization({
    equity: 10,
    existingIm: 0,
    lockAmount: 2.5,
    surcharge: 0,
    topUp: 0,
  });
  assert.equal(util, 25);
  assert.notEqual(util, ((50 / 2) / 10) * 100);
  assert.equal(
    orderMarginUtilization({ equity: 0, existingIm: 0, lockAmount: 2.5, surcharge: 0, topUp: 0 }),
    null,
  );
  assert.equal(
    orderMarginUtilization({ equity: 0, existingIm: 0, lockAmount: 2.5, surcharge: 0, topUp: 2.5 }),
    100,
  );
});

test("quantity snaps down to the lot", () => {
  const tick = 10n ** 18n;
  const sized = quantityForNotional(market, (100n * tick).toString(), 50);
  assert.equal(sized.belowMin, false);
  assert.equal(BigInt(sized.quantityRaw) % BigInt(market.lotRaw), 0n);
  assert.ok(BigInt(sized.unsnappedRaw) >= BigInt(sized.quantityRaw));
});
