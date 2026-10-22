import { useEffect, useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createBotRecord, deleteBotRecord, openBotKey, readBotRecord, vaultAvailable } from "@/lib/bot-vault";

type Snap = { address: Address | null; unlocked: boolean };

let secret: Hex | null = null;
let address: Address | null = null;
let current: Snap = { address: null, unlocked: false };
const listeners = new Set<() => void>();

function emit(): void {
  current = { address, unlocked: secret != null };
  for (const listener of listeners) listener();
}

function snapshot(): Snap {
  return current;
}

export function subscribeBot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hydrateBotAddress(): void {
  const record = readBotRecord();
  const next = record?.address ?? null;
  if (next !== address) {
    address = next;
    if (!next) secret = null;
    emit();
  }
}

export function useBotSession(): Snap & { available: boolean } {
  const snap = useSyncExternalStore(subscribeBot, snapshot, snapshot);
  useEffect(() => {
    hydrateBotAddress();
  }, []);
  return { ...snap, available: vaultAvailable() };
}

export function botSignerAddress(): Address | null {
  return address;
}

export function botKeyUnlocked(): boolean {
  return secret != null;
}

export function requireBotKey(): Hex {
  if (!secret) throw new Error("The bot key is locked. Unlock it in this browser. Nothing was signed.");
  return secret;
}

export function lockBot(): void {
  secret = null;
  emit();
}

export async function createBot(password: string): Promise<Address> {
  const record = await createBotRecord(password);
  const opened = await openBotKey(record, password);
  if (privateKeyToAccount(opened).address.toLowerCase() !== record.address.toLowerCase()) {
    deleteBotRecord();
    throw new Error("The new bot key failed its local check and was deleted.");
  }
  secret = opened;
  address = record.address;
  emit();
  return record.address;
}

export async function unlockBot(password: string): Promise<void> {
  const record = readBotRecord();
  if (!record) throw new Error("There is no local bot key to unlock.");
  const opened = await openBotKey(record, password);
  secret = opened;
  address = record.address;
  emit();
}

export function deleteBot(): void {
  secret = null;
  address = null;
  try {
    deleteBotRecord();
  } catch {
    address = null;
  }
  emit();
}

export function scrubSecret(text: string): string {
  if (!secret) return text;
  const bare = secret.slice(2);
  return text.split(secret).join("[redacted]").split(bare).join("[redacted]");
}
