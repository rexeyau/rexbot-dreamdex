# Nested Order filter by Market returns a database error

Severity: normal
Area: API

## Steps to reproduce

1. POST `https://hideki-dev.smk.somnia.host/v1/graphql` with:

```graphql
query {
  Order(
    where: {
      market: { baseSymbol: { _eq: "ETH" }, marketType: { _eq: PERP } }
      isBid: { _eq: true }
      quantityRemaining: { _gt: "0" }
    }
    limit: 6
    order_by: { price: desc }
  ) {
    price
    quantityRemaining
    isBid
    status
  }
}
```

2. Compare with the working shape, using the pool address as `market_id`:

```graphql
query {
  Order(
    where: { market_id: { _eq: "0xd6cb1dd58580b84d76068ac21594219ce03aeddf" }, status: { _eq: Open } }
    limit: 3
    order_by: { price: desc }
  ) {
    price
    quantityRemaining
    isBid
    status
  }
}
```

## Expected

The nested `market` filter returns the same open ETH-PERP orders as the `market_id` filter. Hasura-style relationship filters are valid against this schema (`Order.market` exists).

## Actual

The nested query fails with:

```json
{ "errors": [{ "message": "database query error", "extensions": { "code": "unexpected" } }] }
```

The `market_id` query succeeds and returns rows. `Order(limit: 1)` with no filter also succeeds, so the table itself is readable.

## Evidence

Observed 2026-10-21 against the public Hideki indexer while building a read-only perps desk. No transaction. Request and response as above.

## Environment

Network: Somnia Hideki testnet (chain 50383), indexer `https://hideki-dev.smk.somnia.host/v1/graphql`. No SDK call — this is the indexer the perps developer docs point at (`@somnia-chain/markets-sdk` 0.32.1 docs). Wallet: none (read-only).
