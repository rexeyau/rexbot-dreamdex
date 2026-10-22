import { useSyncExternalStore } from "react";

export type DeskTab = "desk" | "wallet" | "ship" | "notes";

export type PositionFocus = {
  seq: number;
  tab: DeskTab | null;
  account: string;
  marketId: string;
  isLong: boolean;
  hash: string;
};

const empty: PositionFocus = { seq: 0, tab: null, account: "", marketId: "", isLong: true, hash: "" };
let focus: PositionFocus = empty;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openOwnerPositions(input: { account: string; marketId: string; isLong: boolean; hash: string }): void {
  focus = { seq: focus.seq + 1, tab: "wallet", account: input.account, marketId: input.marketId, isLong: input.isLong, hash: input.hash };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): PositionFocus {
  return focus;
}

export function useDeskNav(): PositionFocus {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
