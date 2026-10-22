import assert from "node:assert/strict";
import test from "node:test";
import { botLinkLabel, botLinkStatus, positionVisible, sendButton } from "./bot-status.ts";

test("a local bot is not ready until permission and gas are both verified", () => {
  assert.equal(botLinkStatus({ hasBot: false, ownerSet: false, reading: false, readError: false, granted: 0, stt: null }), "none");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: false, reading: false, readError: false, granted: 0, stt: null }), "bot-created");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: true, reading: true, readError: false, granted: 0, stt: null }), "checking");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: true, reading: true, readError: true, granted: 0, stt: null }), "checking");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: true, reading: false, readError: true, granted: 3, stt: 1 }), "bot-created");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: true, reading: false, readError: false, granted: 0, stt: 1 }), "permission");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: true, reading: false, readError: false, granted: 2, stt: 0 }), "gas");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: true, reading: false, readError: false, granted: 2, stt: null }), "gas");
  assert.equal(botLinkStatus({ hasBot: true, ownerSet: true, reading: false, readError: false, granted: 1, stt: 0.01 }), "ready");
  assert.equal(botLinkLabel("bot-created"), "Bot created");
  assert.equal(botLinkLabel("checking"), "Checking access");
  assert.equal(botLinkLabel("ready"), "Ready to trade");
  assert.equal(botLinkLabel("permission"), "Permission required");
  assert.equal(botLinkLabel("gas"), "Gas required");
});

test("the send button locks only after a confirmed receipt", () => {
  assert.deepEqual(sendButton({ sending: false, confirmed: false }), { label: "Sign and send", disabled: false });
  assert.deepEqual(sendButton({ sending: true, confirmed: false }), { label: "Signature requested…", disabled: true });
  assert.deepEqual(sendButton({ sending: false, confirmed: true }), { label: "Order submitted", disabled: true });
});

test("a position is visible only when the fresh account row matches", () => {
  const rows = [{ marketId: "0xABC", isLong: true }];
  assert.equal(positionVisible(rows, "0xabc", true), true);
  assert.equal(positionVisible(rows, "0xabc", false), false);
  assert.equal(positionVisible([], "0xabc", true), false);
});
