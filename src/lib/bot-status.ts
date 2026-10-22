export type BotLinkStatus = "none" | "bot-created" | "checking" | "ready" | "permission" | "gas";

export function botLinkStatus(input: {
  hasBot: boolean;
  ownerSet: boolean;
  reading: boolean;
  readError: boolean;
  granted: number;
  stt: number | null;
}): BotLinkStatus {
  if (!input.hasBot) return "none";
  if (!input.ownerSet) return "bot-created";
  if (input.reading) return "checking";
  if (input.readError) return "bot-created";
  if (input.granted <= 0) return "permission";
  if (input.stt == null || !(input.stt > 0)) return "gas";
  return "ready";
}

export function botLinkLabel(status: BotLinkStatus): string {
  if (status === "bot-created") return "Bot created";
  if (status === "checking") return "Checking access";
  if (status === "ready") return "Ready to trade";
  if (status === "permission") return "Permission required";
  if (status === "gas") return "Gas required";
  return "";
}

export const BOT_READY_TEXT =
  "Bot Execution Mode ready. Orders are signed by the authorized bot wallet and positions remain on the DreamDEX owner account.";

export function sendButton(input: { sending: boolean; confirmed: boolean }): { label: string; disabled: boolean } {
  if (input.confirmed) return { label: "Order submitted", disabled: true };
  if (input.sending) return { label: "Signature requested…", disabled: true };
  return { label: "Sign and send", disabled: false };
}

export function positionVisible(
  positions: { marketId: string; isLong: boolean }[],
  marketId: string,
  isLong: boolean,
): boolean {
  const id = marketId.toLowerCase();
  return positions.some((row) => row.marketId.toLowerCase() === id && row.isLong === isLong);
}
