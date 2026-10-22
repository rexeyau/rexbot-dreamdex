import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const BOT_VAULT_KEY = "markside-bot-vault-v1";
export const BOT_KDF_ITERATIONS = 210_000;

export type BotVaultRecord = {
  v: 1;
  address: Address;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  kdf: "PBKDF2-SHA-256";
  cipher: "AES-GCM";
};

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function vaultAvailable(): boolean {
  return typeof globalThis.crypto?.subtle?.importKey === "function" && typeof globalThis.crypto.getRandomValues === "function";
}

function storageOr(storage?: StorageLike): StorageLike {
  if (storage) return storage;
  if (typeof localStorage === "undefined") {
    throw new Error("This browser has no local storage. The bot key was not saved.");
  }
  return localStorage;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function readBotRecord(storage?: StorageLike): BotVaultRecord | null {
  let raw: string | null;
  try {
    raw = storageOr(storage).getItem(BOT_VAULT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BotVaultRecord>;
    if (parsed.v !== 1 || parsed.kdf !== "PBKDF2-SHA-256" || parsed.cipher !== "AES-GCM") return null;
    if (!parsed.address || !/^0x[a-fA-F0-9]{40}$/.test(parsed.address)) return null;
    if (!parsed.salt || !parsed.iv || !parsed.ciphertext || !parsed.iterations) return null;
    return parsed as BotVaultRecord;
  } catch {
    return null;
  }
}

export async function sealBotKey(privateKey: Hex, password: string, iterations = BOT_KDF_ITERATIONS): Promise<BotVaultRecord> {
  if (!vaultAvailable()) throw new Error("Web Crypto is unavailable. No bot key was created.");
  if (password.length < 8) throw new Error("Use at least 8 characters. The password stays in this browser.");
  const account = privateKeyToAccount(privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(privateKey),
  );
  return {
    v: 1,
    address: account.address,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(cipher)),
    iterations,
    kdf: "PBKDF2-SHA-256",
    cipher: "AES-GCM",
  };
}

export async function openBotKey(record: BotVaultRecord, password: string): Promise<Hex> {
  if (!vaultAvailable()) throw new Error("Web Crypto is unavailable. The bot key stays locked.");
  try {
    const key = await deriveKey(password, b64ToBytes(record.salt), record.iterations);
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(record.iv) as BufferSource },
      key,
      b64ToBytes(record.ciphertext) as BufferSource,
    );
    const privateKey = new TextDecoder().decode(clear);
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) throw new Error("The stored record did not decrypt to a key.");
    const account = privateKeyToAccount(privateKey as Hex);
    if (account.address.toLowerCase() !== record.address.toLowerCase()) {
      throw new Error("The decrypted key does not match the stored bot address. It was not kept.");
    }
    return privateKey as Hex;
  } catch (error) {
    if (error instanceof Error && /does not match|did not decrypt|unavailable/i.test(error.message)) throw error;
    throw new Error("Password did not decrypt the bot key.");
  }
}

export function saveBotRecord(record: BotVaultRecord, storage?: StorageLike): void {
  const json = JSON.stringify(record);
  if (/0x[a-fA-F0-9]{64}/.test(json)) {
    throw new Error("Refusing to store a record that contains a private key.");
  }
  storageOr(storage).setItem(BOT_VAULT_KEY, json);
}

export function deleteBotRecord(storage?: StorageLike): void {
  storageOr(storage).removeItem(BOT_VAULT_KEY);
}

export async function createBotRecord(password: string, storage?: StorageLike): Promise<BotVaultRecord> {
  if (!vaultAvailable()) throw new Error("Web Crypto is unavailable. No bot key was created.");
  const privateKey = generatePrivateKey();
  const record = await sealBotKey(privateKey, password);
  saveBotRecord(record, storage);
  return record;
}
