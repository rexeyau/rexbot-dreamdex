import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { BOT_KDF_ITERATIONS, BOT_VAULT_KEY, deleteBotRecord, openBotKey, readBotRecord, saveBotRecord, sealBotKey } from "./bot-vault.ts";

function memory() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
    raw: () => rows.get(BOT_VAULT_KEY) ?? "",
  };
}

test("sealed bot key round-trips and the stored record has no private key", async () => {
  const store = memory();
  const privateKey = generatePrivateKey();
  const record = await sealBotKey(privateKey, "local-test-password", 20_000);
  saveBotRecord(record, store);
  const stored = store.raw();
  assert.equal(stored.includes(privateKey), false);
  assert.equal(stored.includes(privateKey.slice(2)), false);
  assert.equal(/0x[a-fA-F0-9]{64}/.test(stored), false);
  const opened = await openBotKey(readBotRecord(store)!, "local-test-password");
  assert.equal(opened, privateKey);
  await assert.rejects(() => openBotKey(record, "wrong-password"), /Password did not decrypt/);
  deleteBotRecord(store);
  assert.equal(readBotRecord(store), null);
});

test("production key stretching is not a toy iteration count", () => {
  assert.ok(BOT_KDF_ITERATIONS >= 100_000);
});
