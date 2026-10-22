import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { HIDEKI_INDEXER } from "@/lib/freshness";

const globalSdk = globalThis as unknown as { __marksideSdk?: SomniaMarkets };

export function getSdk(): SomniaMarkets {
  if (!globalSdk.__marksideSdk) {
    globalSdk.__marksideSdk = new SomniaMarkets({
      chain: hidekiTestnet,
      indexerUrl: HIDEKI_INDEXER,
      addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
    });
  }
  return globalSdk.__marksideSdk;
}
