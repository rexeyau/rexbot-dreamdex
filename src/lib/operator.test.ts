import assert from "node:assert/strict";
import test from "node:test";
import { grantConnected, placeOrderForSelector, PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR, REDUCE_ORDER_FOR_SELECTOR, encodePlaceOrderFor } from "./operator.ts";
import { toFunctionSelector } from "viem";

test("operator selectors match the dreamDEX registry", () => {
  assert.equal(placeOrderForSelector(), PLACE_ORDER_FOR_SELECTOR);
  assert.equal(toFunctionSelector("function cancelOrderFor(address owner, uint128 orderId)"), CANCEL_ORDER_FOR_SELECTOR);
  assert.equal(
    toFunctionSelector("function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)"),
    REDUCE_ORDER_FOR_SELECTOR,
  );
});

test("placeOrderFor calldata starts with the place selector and names the owner", () => {
  const data = encodePlaceOrderFor({
    owner: "0x0000000000000000000000000000000000000001",
    isBid: true,
    price: 10n,
    quantity: 10n,
    orderType: 0,
  });
  assert.equal(data.slice(0, 10), PLACE_ORDER_FOR_SELECTOR);
  assert.match(data, /0{24}0{23}1/);
});

test("connected requires place, cancel, and reduce with no read error", () => {
  assert.equal(grantConnected({ place: true, cancel: true, reduce: true, error: null }), true);
  assert.equal(grantConnected({ place: true, cancel: true, reduce: false, error: null }), false);
  assert.equal(grantConnected({ place: false, cancel: false, reduce: false, error: null }), false);
  assert.equal(grantConnected({ place: true, cancel: true, reduce: true, error: "rpc" }), false);
  assert.equal(grantConnected(undefined), false);
});
