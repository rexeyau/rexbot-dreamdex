import { encodeFunctionData, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";

/** Hideki OperatorPermissionsRegistry published in the dreamDEX perps testnet docs. Pools also expose it via getOperatorPermissionsRegistry. */
export const HIDEKI_OPERATOR_REGISTRY = "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a" as const;

export const PLACE_ORDER_FOR_SELECTOR = "0x80054449" as const;
export const CANCEL_ORDER_FOR_SELECTOR = "0xe37b444b" as const;
export const REDUCE_ORDER_FOR_SELECTOR = "0x364c2587" as const;

const placeAbi = parseAbi([
  "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) returns (bool success, uint128 orderId)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";

export function placeOrderForSelector(): Hex {
  return toFunctionSelector(
    "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
  );
}

export function assertOperatorSelectors(): void {
  const place = placeOrderForSelector();
  const cancel = toFunctionSelector("function cancelOrderFor(address owner, uint128 orderId)");
  const reduce = toFunctionSelector("function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)");
  if (place !== PLACE_ORDER_FOR_SELECTOR || cancel !== CANCEL_ORDER_FOR_SELECTOR || reduce !== REDUCE_ORDER_FOR_SELECTOR) {
    throw new Error("Operator selectors do not match the dreamDEX registry. Nothing will be signed.");
  }
}

/** About 50 years, matching the SDK's omitted-expiry default. */
const FAR_FUTURE_NS = (1_000_000_000n + 50n * 365n * 24n * 60n * 60n) * 1_000_000_000n;

export function encodePlaceOrderFor(input: {
  owner: Address;
  isBid: boolean;
  price: bigint;
  quantity: bigint;
  orderType: 0 | 2;
}): Hex {
  assertOperatorSelectors();
  if (input.price <= 0n || input.quantity <= 0n) {
    throw new Error("Price and quantity must be positive. Nothing was signed.");
  }
  const data = encodeFunctionData({
    abi: placeAbi,
    functionName: "placeOrderFor",
    args: [input.owner, input.isBid, 0n, input.price, input.quantity, FAR_FUTURE_NS, input.orderType, 0, ZERO, 0n],
  });
  if (!data.startsWith(PLACE_ORDER_FOR_SELECTOR)) {
    throw new Error("placeOrderFor calldata selector mismatch. Nothing was signed.");
  }
  return data;
}

export function grantConnected(row: {
  place: boolean | null;
  cancel: boolean | null;
  reduce: boolean | null;
  error: string | null;
} | null | undefined): boolean {
  if (!row || row.error) return false;
  return row.place === true && row.cancel === true && row.reduce === true;
}
