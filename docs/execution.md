# Placing a testnet order

Chain 50383. SDK `@somnia-chain/markets-sdk` 0.32.1. Collateral is USDso. Gas is STT.

## In the desk

1. Open REXBOT and wait until the mark and the index both say `live`. If either is `stale` or `unknown`, Testnet Live will not send.
2. Connect an injected wallet, or use a linked DreamDEX bot. If the injected wallet is not on 50383, use Switch to Hideki. A watched public address cannot sign.
3. Set the mode to Testnet Live. Paper is a different control and cannot produce a hash.
4. Pick a market, side, notional, and rest or cross. The limit is snapped to `tickSize`. The quantity is floored to `lotSize` and rejected under `minQuantity`.
5. Read Trade Check. Red blocks the review button. Amber does not.
6. Review the dialog. It shows the best bid, best ask, spread, tick-snapped limit, whether the order rests or crosses, average fill, slippage, visible size, book age, protocol initial margin, equity, available margin, maintenance margin, utilization, and the liquidation price from `previewPerpLiquidationPrice`.
7. Sign. The locker row moves from signature requested to confirmed only when the receipt status is success. A hash without that receipt stays pending or failed. Rejecting the prompt stores a failed row with no hash.
8. The confirmed hash is written with the explorer link, SDK version, and chain id. Positions, orders, and balances refresh.

Paper keeps a simulated leverage slider and an isolated liquidation formula that is labeled simulated. Testnet Live does not use that slider or that formula. `setPerpLeverage` writes an account cap in its own transaction. The cap adds `leverageSurcharge` on a new order. It is not an input to the liquidation price. A typed cap that does not match `getPerpMaxLeverage` blocks review. Live initial margin is `previewPerpOrderMargin.initialMarginPortion` at the effective IMF. `lockAmount` is the collateral the pool reserves and can be larger because of the adverse mark-to-entry gap. Margin utilization is `(existing imRequirement + lockAmount + leverageSurcharge) / (equity + topUpRequired)` from that same preview. It is not notional divided by a leverage slider. Live liquidation is `previewPerpLiquidationPrice` only. If that read does not return a price with positive projected equity, the ticket says unavailable and blocks review. Hourly funding is the window rate times `3600 / fundingWindowSec`. Positive means longs pay shorts.

## Linked DreamDEX bot

The Wallet tab can create a REXBOT bot address in the browser. The private key is generated with Web Crypto, encrypted with AES-GCM under a local password (PBKDF2-SHA-256, 210,000 iterations), and stored only as ciphertext in `localStorage` key `markside-bot-vault-v1`. It is not shown, logged, or sent to a server. If Web Crypto is missing, creation stays off and Bot Execution Mode is the signer.

Link that public address inside DreamDEX testnet: wallet menu, the wallet that holds Perps margin (prefer Wallet 2 or 3), Link a bot, enable Perps, leave the gas transfer on, Add bot, wait for Access granted. Then paste the owner's public address. REXBOT reads `isOperatorAuthorized` on each pool for `placeOrderFor` (`0x80054449`), `cancelOrderFor` (`0xe37b444b`), and `reduceOrderFor` (`0x364c2587`). **Ready to trade** is shown only when that read succeeds for the owner and the bot has STT for gas. A local wallet alone is **Bot created**. A missing grant is **Permission required**. A grant without STT is **Gas required**. There is no manual verified switch. A failed read stays unverified.

A verified ticket signs `placeOrderFor` from the unlocked bot key, with value 0. The owner keeps the margin, the position, and the fills. The bot pays STT gas and cannot withdraw. Quotes use `autoPull: false`. Confirmed still requires a receipt whose status is success. The evidence row stores the hash, owner, bot signer, market, side, type, quantity, price, time, SDK version, and chain id.

## Bot Execution Mode

Use this when the page cannot see a wallet. Do not paste the key into REXBOT.

```bash
export NETWORK=hideki
export STRATEGY=perp-funding
export PERP_SYMBOL=BTC-PERP
export PERP_NOTIONAL_USDSO=50
export DRY_RUN=true
export OWNER_ADDRESS=0xYOUR_OWNER_ADDRESS
export PRIVATE_KEY=0xYOUR_BOT_KEY
```

Run that in a checkout of the dreamDEX bot kit. Read the dry run. Then set `DRY_RUN=false`. Move USDso into the perps account first. Paper USDso only works on the markets the desk marks as eligible.

The same order, run outside the browser. `OWNER_ADDRESS` is the DreamDEX public wallet. `PRIVATE_KEY` is the bot key in that shell, never pasted into REXBOT. The call is `placeOrderFor`. `trader.placePerpOrder` signs as the key itself and does not name an owner, so it is not the linked-bot path.

```ts
// encode placeOrderFor(owner, isBid, 0, price, quantity, expiry, orderType, 0, address(0), 0)
// send it from the bot key to the pool with value 0
// confirmed only when the receipt status is success
```

## Explorer

The SDK's Hideki chain definition does not set a block explorer. Links point at `https://explorer.testnet.somnia.network/tokyo/tx/{hash}`, the Tokyo explorer named in the dreamDEX perps testnet docs. If a hash does not render there, the hash is still the record. Do not invent a replacement.
