# REXBOT

Funding desk for dreamDEX perpetual futures on Somnia Hideki testnet (chain 50383). It ranks markets from live chain data, prices a ticket from the book, and can send a testnet order only after an explicit confirmation and a receipt whose status is success.

The running desk this source matches: [https://onyx-giant-zippy-mint.grok.me](https://onyx-giant-zippy-mint.grok.me)

Testnet only. Not financial advice. Paper fills are simulated and are not exchange fills.

## Features

- REXBOT branding on Hideki chain ID 50383
- Paper mode, isolated from Testnet Live. Paper liquidation stays labeled simulated
- Testnet Live mode with protocol margin, utilization, and liquidation reads
- DreamDEX bot authorization. The bot signs `placeOrderFor`, `cancelOrderFor`, and `reduceOrderFor` for one owner. It cannot withdraw
- Funding rankings. A rate is ranked only when `getPerpState` returned it and the read is still fresh. Unverified funding is N/A
- Trade checks before review. A failed margin preview blocks the order
- Position and account reading for a public address. A watched address cannot sign
- Shareable trade card drawn from an open position already on the owner account
- Data diagnostics and a bug report that redacts a 64-character hex key

## Architecture

The browser paints the desk. Server functions read Hideki. Signing stays in the browser.

| Piece | Role |
|---|---|
| React 19, TanStack Start, Tailwind | Desk UI |
| `@somnia-chain/markets-sdk` 0.32.1 + viem | Indexer, `getPerpState`, margin, and order encoding |
| Injected wallet | `placeOrder` from the connected wallet on chain 50383 |
| Local bot | AES-GCM ciphertext in `localStorage` key `markside-bot-vault-v1`. The unlocked key stays in memory |
| Paper blotter | `localStorage` key `markside-desk-v2`. No signature and no hash |

Auth and the database are off. Do not set `DATABASE_URL` while `VITE_AUTH_ENABLED` is `false`. The app does not need an account to browse or to trade on testnet.

Market list, book, prints, and funding history come from the Hideki indexer. Mark, index, funding, and open interest used for live trading come from `getPerpState`. The indexer mark only moves when funding settles, so it is never labeled live. A failed refresh keeps the last good payload and retries from about 12 seconds up to 60 seconds.

Order checks and the bot path are written out in [docs/execution.md](docs/execution.md). The module map is in [docs/architecture.md](docs/architecture.md).

## Installation

Node.js 22.

```bash
npm install
npm run dev
```

The dev server listens on port 8080. No `.env` file is required to browse markets.

```bash
npm run build
```

## Environment setup

[`.env.example`](.env.example) lists names only. Every value is empty. Do not commit a filled `.env`.

The web desk does not read `PRIVATE_KEY`. A linked bot key is created in the browser. If you sign from a shell instead, put `PRIVATE_KEY` in that shell only, and do not prefix it with `VITE_`.

`.grok/app-env.json` sets `VITE_AUTH_ENABLED` to `false` so a local run matches the deployed desk. Leave it false.

## Hideki testnet

| | |
|---|---|
| Chain ID | 50383 |
| HTTP RPC | `https://api.hideki2.infra.testnet.somnia.network` |
| WebSocket | `wss://api.hideki2.infra.testnet.somnia.network/ws` |
| Indexer | `https://hideki-dev.smk.somnia.host/v1/graphql` |
| Explorer | `https://explorer.testnet.somnia.network/tokyo/tx/{hash}` |
| Gas | STT |
| Collateral | USDso (18 decimals) |

Public protocol addresses from `@somnia-chain/markets-sdk` 0.32.1 (`SOMNIA_HIDEKI_TESTNET_ADDRESSES`):

| Contract | Address |
|---|---|
| Margin bank | `0x478769E1177C0773c43A593DCCc4Ad15F15F1394` |
| Collateral / test USDC | `0x9E9492cC533E8696A3b6afC7df730800DF75148f` |
| Perp pool factory | `0xE631fAEE547baeE07353E290f0562ea67d856560` |
| Markets core | `0x2802504314685D89bF6C992CA5a8e7cC78bc0294` |
| Oracle hub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| CLOB factory | `0x1a478019Ae4d24249a962934af0f129CE98B5e6f` |
| Market creator | `0xAd890D6Ac3c659E1Ed0fA72Cf557DB4cA26bdAff` |
| Operator permissions registry | `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a` |

The operator registry is the address `getOperatorPermissionsRegistry` returned on Hideki. It is not inside the SDK address object. Selectors and the `placeOrderFor` ABI string live in [`src/lib/operator.ts`](src/lib/operator.ts):

| Call | Selector |
|---|---|
| `placeOrderFor` | `0x80054449` |
| `cancelOrderFor` | `0xe37b444b` |
| `reduceOrderFor` | `0x364c2587` |

Pool addresses come from `listPerpMarkets`. They are not hardcoded.

## DreamDEX bot linking

1. In REXBOT, Wallet, create a bot. The private key is generated in the browser, encrypted with your password (AES-GCM, PBKDF2-SHA-256, 210,000 iterations), and stored only as ciphertext. It is not shown.
2. In [dreamDEX testnet](https://app.testnet.dreamdex.io), open the wallet that holds perps margin. Prefer Wallet 2 or Wallet 3. Link a bot. Enable Perps. Leave “Send it for gas” on. Add the bot’s public address. Wait until Access is granted.
3. Paste that owner’s public address into REXBOT. Do not paste a private key. A 64-hex key is rejected.
4. REXBOT reads `isOperatorAuthorized` for place, cancel, and reduce. **Ready to trade** requires those grants and bot STT greater than 0. Anything else stays **Bot created**, **Checking access**, **Permission required**, or **Gas required**.
5. Unlock the bot with the local password. The bot signs `placeOrderFor` for the owner. Margin, positions, and fills stay on the owner. The bot pays STT gas.

Linking notes: [Link a bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot). Perps developer notes: [perps testnet](https://app.testnet.dreamdex.io/docs/developers/perps-testnet). Shell-only signing, if the page has no wallet, is the dreamDEX bot kit and is not a key stored in this repo: [somnia-chain/dreamdex-bot-kit](https://github.com/somnia-chain/dreamdex-bot-kit).

## Security model

REXBOT uses an authorized bot signer for trading actions. Positions and margin remain on the DreamDEX owner account. REXBOT never requests the owner wallet’s private key or recovery phrase.

- A watched address is read-only. It is not Connect Wallet.
- Connect Wallet uses an injected provider. The page does not ask for a seed phrase.
- The bot vault key is `markside-bot-vault-v1`. Disconnect, regenerate, and delete warn that the local signer may be lost.
- Bug reports drop a 64-hex secret and lines that name a seed, mnemonic, recovery phrase, or private key. Addresses (40 hex) stay.
- This repository does not contain a bot private key, a seed, a filled `.env`, or a confirmed live-order hash.

Report a protocol issue to security@dreamdex.io. Do not include a private key.

## Live-order flow

1. Wait until the selected market’s chain mark and index are usable. Until then live submission stays off.
2. Choose Paper or Testnet Live. They do not mix.
3. Pick market, side, notional, and rest or cross. The limit comes from the book, snapped to the tick. Quantity is floored to the lot.
4. Read Trade Check. Red blocks review. Amber does not.
5. Confirm. Sign and send runs once for that reviewed order.
6. **Confirmed** only if `receipt.status` is success. The hash stays clickable. View transaction opens the Tokyo explorer. View position reads the owner again and does not claim the position exists until that read shows it. While the indexer lags, the desk says the transaction is confirmed and DreamDEX has not indexed the position yet.

No Hideki transaction has been signed from the environment that prepared this source tree.

## Known limitations

- You connect the wallet, link the bot, and fund STT and USDso yourself. This app cannot broadcast a transaction for you.
- The leverage slider is paper only. Live margin uses the protocol preview. `setPerpLeverage` is an account cap, and the bot does not call it.
- Positive funding means longs pay shorts. The annualized figure assumes the current hourly rate stays unchanged for a year. It is not a forecast.
- The indexer does not document the sign of `FundingPayment`. Realized PnL is not shown as zero.
- A nested Order filter through Market returns a database error. See [feedback/INDEXER_ORDER_NESTED_FILTER.md](feedback/INDEXER_ORDER_NESTED_FILTER.md).
- Local QA screenshots are not part of this repository.

## Bounty

dreamDEX Perps Builder Bounty on DoraHacks (Somnia, 19 Oct–1 Nov 2026, 23:59 UTC).

- Track: [DoraHacks](https://dorahacks.io/hackathon/dreamdex-perps-bounty)
- Demo: [https://onyx-giant-zippy-mint.grok.me](https://onyx-giant-zippy-mint.grok.me)
- App: [https://app.testnet.dreamdex.io](https://app.testnet.dreamdex.io)
- Discord: [https://discord.gg/dreamdex](https://discord.gg/dreamdex)
- Telegram: [https://t.me/+s_oRMnGpOyQ3ODQ0](https://t.me/+s_oRMnGpOyQ3ODQ0)
- X: [@DreamDEXSomnia](https://x.com/DreamDEXSomnia)

Posts are drafted in the Ship tab. This app does not publish them. Transaction evidence in this repository: none confirmed.
