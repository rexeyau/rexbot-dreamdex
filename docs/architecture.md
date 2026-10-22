# Architecture

REXBOT is a funding-aware perps terminal. The browser paints a desk. The server reads Hideki. The wallet, when one is injected, signs from the browser. No private key is ever accepted by the page.

## Data

| Value | Source | When it is fresh |
|---|---|---|
| Market list, book, prints, funding history | Hideki indexer GraphQL | The query itself is under 15s old |
| Mark, index, funding rate, open interest | `client.getPerpState` | The chain read is under 15s, `markPriceOk` is true, and `indexUpdatedAt` is under 15s |
| Spread used for the score | Top of the indexer book during the chain pass | Missing book is `null`, never zero |
| Margin, voucher floor, liquidation, leverage | `getMarginAccount`, `getPerpVoucher`, `getLiquidationPrice`, `getPerpLeverage` | The account snapshot time |
| STT | `eth_getBalance` on the Hideki HTTP RPC | The account snapshot time |
| Positions, orders, fills, funding payments | Indexer | The account snapshot time |

The indexed `markPrice` only advances when funding settles, about once an hour. That is why the desk overlays `getPerpState` and refuses to call an indexer mark "live".

A failed refresh keeps the last successful payload and shows the error. The next attempt backs off from 12–15s to at most 60s. There is no mock book.

## Execution

Paper mode writes a simulated row in `localStorage` (`markside-desk-v2`). It does not sign.

Testnet Live builds a tick-snapped, lot-snapped order from the book, calls `getMaxPerpOrderSize`, runs the trade check, then opens a confirmation dialog. An injected wallet signs `placeOrder`. A linked DreamDEX bot signs `placeOrderFor` for the owner's public address. Only the confirm button sends, and only a receipt with status success is confirmed.

Order type `0` rests one tick off the book. Order type `2` is IOC, one tick through the book.

If the page has no injected provider and no unlocked bot, Bot Execution Mode shows the env block. The key stays in the operator's shell.

## What is not stored

The DreamDEX owner private key, seeds, and recovery phrases are not requested. A REXBOT bot key, when the user creates one, is generated in the browser and stored only as AES-GCM ciphertext plus the public address. The decrypted key lives in memory after unlock and is not written to logs, URLs, or the desk store. Pasted transaction hashes are public evidence, stored only in the browser, with status `pasted` until a receipt says otherwise.

## Addresses

Pool addresses come from `listPerpMarkets` and the indexer. The MarginBank used for account reads is `SOMNIA_HIDEKI_TESTNET_ADDRESSES.marginBank` from SDK 0.32.1, not a hand-copied constant in the call site.
