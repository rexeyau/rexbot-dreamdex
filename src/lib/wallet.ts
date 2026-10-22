import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets, TransactionOutcomeUnknownError, ContractRevertError } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, createWalletClient, custom, http, type Address, type Hash, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HIDEKI_CHAIN_ID, HIDEKI_INDEXER, HIDEKI_RPC } from "@/lib/freshness";
import { requireBotKey, scrubSecret } from "@/lib/bot-session";
import { encodePlaceOrderFor } from "@/lib/operator";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (ev: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (ev: string, fn: (...args: unknown[]) => void) => void;
};

export function getProvider(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: Eip1193 }).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

export async function connectWallet(): Promise<{ address: Address; chainId: number }> {
  const eth = getProvider();
  if (!eth) {
    throw new Error("No injected wallet on this page. Install MetaMask, or use Bot Execution Mode and sign outside the browser.");
  }
  let accounts: unknown;
  try {
    accounts = await eth.request({ method: "eth_requestAccounts" });
  } catch (error) {
    throw new Error(explainSendError(error).title);
  }
  const address = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("The wallet did not return an account.");
  }
  const chainId = await readChainId(eth);
  return { address: address as Address, chainId };
}

export async function readChainId(eth: Eip1193 = getProvider() ?? fail("No injected wallet.")): Promise<number> {
  const hex = await eth.request({ method: "eth_chainId" });
  return typeof hex === "string" ? Number(hex) : Number(hex);
}

export async function switchToHideki(): Promise<void> {
  const eth = getProvider();
  if (!eth) throw new Error("No injected wallet to switch.");
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc4cf" }] });
  } catch (error) {
    const code = codeOf(error);
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xc4cf",
            chainName: "Somnia Hideki Testnet",
            nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
            rpcUrls: [HIDEKI_RPC],
          },
        ],
      });
      return;
    }
    throw new Error(explainSendError(error).title);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

let browserSdk: SomniaMarkets | null = null;

function sdkFor(walletClient: WalletClient): SomniaMarkets {
  if (!browserSdk) {
    browserSdk = new SomniaMarkets({
      chain: hidekiTestnet,
      indexerUrl: HIDEKI_INDEXER,
      addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
      walletClient,
    });
  } else {
    browserSdk.setSigner({ walletClient });
  }
  return browserSdk;
}

export type SendOutcome = {
  hash: string | null;
  status: "confirmed" | "failed" | "unknown" | "rejected";
  title: string;
  action: string;
  technical: string;
};

export async function setAccountLeverage(input: {
  address: Address;
  pool: Address;
  marginBank: Address;
  leverageX: number;
}): Promise<SendOutcome> {
  const eth = getProvider();
  if (!eth) {
    return {
      hash: null,
      status: "rejected",
      title: "No injected wallet",
      action: "The leverage cap was not sent.",
      technical: "window.ethereum missing",
    };
  }
  const chainId = await readChainId(eth);
  if (chainId !== HIDEKI_CHAIN_ID) {
    return {
      hash: null,
      status: "rejected",
      title: "Wallet is on the wrong network",
      action: "Switch to chain 50383 before setting a leverage cap.",
      technical: `eth_chainId returned ${chainId}`,
    };
  }
  const walletClient = createWalletClient({
    account: input.address,
    chain: hidekiTestnet,
    transport: custom(eth),
  });
  try {
    const result = await sdkFor(walletClient).trader.setPerpLeverage({
      pool: input.pool,
      marginBank: input.marginBank,
      leverageX: input.leverageX,
    });
    const ok = result.receipt?.status === "success";
    return {
      hash: result.hash,
      status: ok ? "confirmed" : "failed",
      title: ok ? "Leverage cap confirmed" : "Leverage cap transaction reverted",
      action: ok
        ? "The receipt status is success. The cap is an order gate. It does not change the liquidation formula. REXBOT will read the stored cap back before the next review."
        : "The cap was not changed. The previous on-chain value still applies.",
      technical: `receipt.status=${result.receipt?.status ?? "missing"}`,
    };
  } catch (error) {
    const mapped = explainSendError(error);
    return { hash: mapped.hash, status: mapped.status, title: mapped.title, action: mapped.action, technical: mapped.technical };
  }
}

export type SendPhase = "signature" | "submitted" | "pending";

export async function sendPerpOrder(
  input: {
    address: Address;
    pool: Address;
    isBid: boolean;
    price: bigint;
    quantity: bigint;
    orderType: 0 | 2;
  },
  onPhase?: (phase: SendPhase, hash: string | null) => void,
): Promise<SendOutcome> {
  const eth = getProvider();
  if (!eth) {
    return {
      hash: null,
      status: "rejected",
      title: "No injected wallet",
      action: "Use Bot Execution Mode. REXBOT will not invent a fill.",
      technical: "window.ethereum missing",
    };
  }
  const chainId = await readChainId(eth);
  if (chainId !== HIDEKI_CHAIN_ID) {
    return {
      hash: null,
      status: "rejected",
      title: "Wallet is on the wrong network",
      action: "Switch the wallet to chain 50383 before signing.",
      technical: `eth_chainId returned ${chainId}`,
    };
  }
  const walletClient = createWalletClient({
    account: input.address,
    chain: hidekiTestnet,
    transport: custom(eth),
  });
  const sdk = sdkFor(walletClient);
  let built;
  try {
    built = await sdk.trader.buildPlacePerpOrder({
      pool: input.pool,
      isBid: input.isBid,
      price: input.price,
      quantity: input.quantity,
      orderType: input.orderType,
    });
  } catch (error) {
    const mapped = explainSendError(error);
    return { hash: mapped.hash, status: mapped.status, title: mapped.title, action: mapped.action, technical: mapped.technical };
  }
  if (built.order.chainId !== HIDEKI_CHAIN_ID) {
    return {
      hash: null,
      status: "failed",
      title: "SDK built a transaction for the wrong chain",
      action: "Nothing was signed. The order is not a Hideki transaction.",
      technical: `unsigned chainId ${built.order.chainId}`,
    };
  }
  onPhase?.("signature", null);
  const publicClient = createPublicClient({ chain: hidekiTestnet, transport: http(HIDEKI_RPC) });
  try {
    if (built.approval) {
      if (built.approval.chainId !== HIDEKI_CHAIN_ID) {
        return {
          hash: null,
          status: "failed",
          title: "Approval was built for the wrong chain",
          action: "The order was not sent.",
          technical: `approval chainId ${built.approval.chainId}`,
        };
      }
      const approvalHash = await walletClient.sendTransaction({
        account: input.address,
        chain: hidekiTestnet,
        to: built.approval.to,
        data: built.approval.data,
        value: built.approval.value,
      });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash, timeout: 60_000 });
      if (approvalReceipt.status !== "success") {
        return {
          hash: approvalHash,
          status: "failed",
          title: "Approval transaction reverted",
          action: "The order was not sent. The approval hash is not an order confirmation.",
          technical: `approval receipt.status=${approvalReceipt.status}`,
        };
      }
    }
    const hash = await walletClient.sendTransaction({
      account: input.address,
      chain: hidekiTestnet,
      to: built.order.to,
      data: built.order.data,
      value: built.order.value,
    });
    onPhase?.("submitted", hash);
    onPhase?.("pending", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    const ok = receipt.status === "success";
    return {
      hash,
      status: ok ? "confirmed" : "failed",
      title: ok ? "Transaction confirmed" : "Transaction reverted",
      action: ok
        ? "The receipt status is success. Only this state is saved as confirmed."
        : "A hash exists, but the receipt is not success. It is saved as failed, not confirmed.",
      technical: `receipt.status=${receipt.status}`,
    };
  } catch (error) {
    const mapped = explainSendError(error);
    const hash = mapped.hash ?? hashFromMessage(error);
    if (hash && mapped.status !== "rejected") {
      onPhase?.("pending", hash);
      return {
        hash,
        status: "unknown",
        title: "Transaction outcome unknown",
        action: "A hash exists but the receipt was not a success. It is saved as pending, not confirmed. Check it before sending again.",
        technical: mapped.technical,
      };
    }
    return { hash: null, status: mapped.status === "unknown" ? "failed" : mapped.status, title: mapped.title, action: mapped.action, technical: mapped.technical };
  }
}

export async function sendPerpOrderFor(
  input: {
    owner: Address;
    pool: Address;
    isBid: boolean;
    price: bigint;
    quantity: bigint;
    orderType: 0 | 2;
  },
  onPhase?: (phase: SendPhase, hash: string | null) => void,
): Promise<SendOutcome> {
  let account;
  try {
    account = privateKeyToAccount(requireBotKey());
  } catch (error) {
    const mapped = explainSendError(error);
    return { hash: null, status: "failed", title: mapped.title, action: mapped.action, technical: scrubSecret(mapped.technical) };
  }
  let data;
  try {
    data = encodePlaceOrderFor({
      owner: input.owner,
      isBid: input.isBid,
      price: input.price,
      quantity: input.quantity,
      orderType: input.orderType,
    });
  } catch (error) {
    const mapped = explainSendError(error);
    return { hash: null, status: "failed", title: "placeOrderFor was not built", action: mapped.title, technical: scrubSecret(mapped.technical) };
  }
  const walletClient = createWalletClient({ account, chain: hidekiTestnet, transport: http(HIDEKI_RPC) });
  const publicClient = createPublicClient({ chain: hidekiTestnet, transport: http(HIDEKI_RPC) });
  onPhase?.("signature", null);
  try {
    const hash = await walletClient.sendTransaction({
      account,
      chain: hidekiTestnet,
      to: input.pool,
      data,
      value: 0n,
    });
    const safe = publicHash(hash);
    if (!safe) {
      return {
        hash: null,
        status: "failed",
        title: "The broadcast did not return a public hash",
        action: "Nothing was saved as confirmed. The bot key was not written to the evidence locker.",
        technical: "sendTransaction returned a value that is not a public transaction hash.",
      };
    }
    onPhase?.("submitted", safe);
    onPhase?.("pending", safe);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: safe, timeout: 90_000 });
    const ok = receipt.status === "success";
    return {
      hash: safe,
      status: ok ? "confirmed" : "failed",
      title: ok ? "Bot order confirmed" : "Bot order reverted",
      action: ok
        ? "The receipt status is success. The position stays on the DreamDEX owner. The bot cannot withdraw."
        : "A hash exists, but the receipt is not success. It is saved as failed, not confirmed.",
      technical: `placeOrderFor receipt.status=${receipt.status}`,
    };
  } catch (error) {
    const mapped = forBotSigner(explainSendError(error));
    const hash = publicHash(mapped.hash ?? hashFromMessage(mapped.technical));
    if (hash && mapped.status !== "rejected") {
      onPhase?.("pending", hash);
      return {
        hash,
        status: "unknown",
        title: "Transaction outcome unknown",
        action: "A hash exists but the receipt was not a success. It is saved as pending, not confirmed.",
        technical: mapped.technical,
      };
    }
    return {
      hash: null,
      status: mapped.status === "unknown" ? "failed" : mapped.status,
      title: mapped.title,
      action: mapped.action,
      technical: mapped.technical,
    };
  }
}

function publicHash(value: string | null): Hash | null {
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) return null;
  if (scrubSecret(value) !== value) return null;
  return value as Hash;
}

function forBotSigner(mapped: ReturnType<typeof explainSendError>): ReturnType<typeof explainSendError> {
  const scrubbed = {
    ...mapped,
    title: scrubSecret(mapped.title),
    action: scrubSecret(mapped.action),
    technical: scrubSecret(mapped.technical),
  };
  if (scrubbed.title === "Insufficient STT for gas") {
    return {
      ...scrubbed,
      title: "Insufficient bot STT for gas",
      action: "Fund the REXBOT bot address with testnet STT. The DreamDEX owner's STT does not pay this transaction. USDso does not pay gas.",
    };
  }
  if (scrubbed.title === "Insufficient margin") {
    return {
      ...scrubbed,
      action: "The DreamDEX owner does not have enough perps margin. Deposit USDso on that wallet or shrink the order. The bot cannot deposit, withdraw, or transfer.",
    };
  }
  return scrubbed;
}

function hashFromMessage(error: unknown): Hash | null {
  const technical = error instanceof Error ? error.message : String(error);
  const match = technical.match(/0x[a-fA-F0-9]{64}/);
  return match ? (match[0] as Hash) : null;
}

export function explainSendError(error: unknown): {
  hash: string | null;
  status: "rejected" | "failed" | "unknown";
  title: string;
  action: string;
  technical: string;
} {
  const technical = error instanceof Error ? error.message : String(error);
  const code = codeOf(error);
  if (code === 4001 || /user rejected|user denied/i.test(technical)) {
    return {
      hash: null,
      status: "rejected",
      title: "Wallet rejected the signature",
      action: "Nothing was broadcast. Approve the prompt if you still want the order.",
      technical,
    };
  }
  if (error instanceof TransactionOutcomeUnknownError) {
    return {
      hash: error.hash ?? null,
      status: "unknown",
      title: "Transaction outcome unknown",
      action: error.hash
        ? "A hash exists but the receipt was not confirmed. Check it before sending again. REXBOT did not mark it confirmed."
        : "The node did not return a receipt. Refresh open orders before sending again.",
      technical,
    };
  }
  if (error instanceof ContractRevertError) {
    const name = error.errorName || error.reason || "revert";
    return {
      hash: null,
      status: "failed",
      title: `Order reverted (${name})`,
      action: actionForRevert(name),
      technical,
    };
  }
  if (/insufficient funds|intrinsic gas|gas required exceeds/i.test(technical)) {
    return {
      hash: null,
      status: "failed",
      title: "Insufficient STT for gas",
      action: "The perps margin is USDso. Gas is STT. Fund the wallet with testnet STT and retry.",
      technical,
    };
  }
  if (/wrong network|chain id|chain mismatch/i.test(technical)) {
    return {
      hash: null,
      status: "rejected",
      title: "Wrong network",
      action: "Switch to Hideki, chain 50383, then sign again.",
      technical,
    };
  }
  if (/minQuantity|minimum quantity|below min/i.test(technical)) {
    return {
      hash: null,
      status: "failed",
      title: "Quantity is below the pool minimum",
      action: "Raise notional until the snapped quantity clears minQuantity.",
      technical,
    };
  }
  if (/tick/i.test(technical)) {
    return {
      hash: null,
      status: "failed",
      title: "Price is not on the tick grid",
      action: "Use the snapped limit from the ticket. Do not edit the raw price.",
      technical,
    };
  }
  if (/lot/i.test(technical)) {
    return {
      hash: null,
      status: "failed",
      title: "Quantity is not on the lot grid",
      action: "Use the snapped quantity. REXBOT floors to lotSize.",
      technical,
    };
  }
  if (/not authorized|unauthorized|OperatorNot|permission denied|OnlyOperator|AccessControl|isOperatorAuthorized/i.test(technical)) {
    return {
      hash: null,
      status: "failed",
      title: "Bot permission is missing",
      action: "The pool rejected the operator. Link the bot in DreamDEX, enable Perps, and wait until place, cancel, and reduce are authorized. Nothing was marked confirmed.",
      technical,
    };
  }
  if (/rate limit|429|too many/i.test(technical)) {
    return {
      hash: null,
      status: "failed",
      title: "Rate limited",
      action: "Wait and retry. The last ticket is unchanged.",
      technical,
    };
  }
  if (/margin|collateral|insufficient/i.test(technical)) {
    return {
      hash: null,
      status: "failed",
      title: "Insufficient margin",
      action: "Deposit USDso into the perps account, or shrink the order. Paper USDso only works on voucher markets.",
      technical,
    };
  }
  return {
    hash: null,
    status: "failed",
    title: "Order was not sent",
    action: "Read the technical detail. If it is a protocol or SDK failure, file it under Notes. Do not treat this as a fill.",
    technical,
  };
}

function actionForRevert(name: string): string {
  if (/margin|collateral|balance/i.test(name)) return "Add USDso margin or reduce size. The order was not filled.";
  if (/tick/i.test(name)) return "The price missed tickSize. Use the snapped limit.";
  if (/lot|quantity/i.test(name)) return "The size missed lotSize or minQuantity. Raise notional.";
  if (/stale|price/i.test(name)) return "The pool rejected the price. Refresh the mark and rebuild the ticket.";
  return "The pool reverted the call. Nothing was marked confirmed.";
}

function codeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}
