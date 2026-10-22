import assert from "node:assert/strict";
import test from "node:test";
import { annualizedProjection, bugReport, deskLink, fundingVerified, scrubReport } from "./data-status.ts";
import { opportunityScore } from "./score.ts";

const now = 1_700_000_000_000;

test("cold start is connecting, not a failure, until chain marks arrive", () => {
  assert.equal(deskLink({ marketCount: 0, indexerError: false, chainError: false, chainFetching: true, chainRows: 0, freshMarks: 0 }), "Connecting to DreamDEX");
  assert.equal(deskLink({ marketCount: 4, indexerError: false, chainError: false, chainFetching: true, chainRows: 0, freshMarks: 0 }), "Connecting to DreamDEX");
  assert.equal(deskLink({ marketCount: 4, indexerError: false, chainError: true, chainFetching: false, chainRows: 0, freshMarks: 0 }), "Partial data available");
  assert.equal(deskLink({ marketCount: 0, indexerError: true, chainError: true, chainFetching: false, chainRows: 0, freshMarks: 0 }), "Live data unavailable");
  assert.equal(deskLink({ marketCount: 4, indexerError: false, chainError: false, chainFetching: false, chainRows: 4, freshMarks: 4 }), "Live data ready");
  assert.equal(deskLink({ marketCount: 4, indexerError: false, chainError: false, chainFetching: false, chainRows: 4, freshMarks: 2 }), "Partial data available");
});

test("indexer funding and a stale settlement are not ranked", () => {
  assert.equal(fundingVerified({ fundingSource: "indexer", chainFetchedAt: now, fundingUpdatedAt: now / 1000, intervalSec: 3600 }, now), false);
  assert.equal(fundingVerified({ fundingSource: "chain", chainFetchedAt: now, fundingUpdatedAt: now / 1000 - 100, intervalSec: 3600 }, now), true);
  assert.equal(fundingVerified({ fundingSource: "chain", chainFetchedAt: now - 120_000, fundingUpdatedAt: now / 1000, intervalSec: 3600 }, now), false);
  assert.equal(fundingVerified({ fundingSource: "chain", chainFetchedAt: now, fundingUpdatedAt: now / 1000 - 8_000, intervalSec: 3600 }, now), false);
  const skipped = opportunityScore({ fundingHourly: 0.000013, fundingVerified: false, oiNotional: 0, volumeQuote: 0, freshness: "unknown", spreadBps: null });
  assert.equal(skipped.parts[0]?.points, 0);
  assert.match(skipped.parts[0]?.note ?? "", /N\/A/);
});

test("annualized funding is labeled as a projection", () => {
  assert.equal(annualizedProjection(-1.982), "Annualized funding projection: −198.2%");
});

test("a bug report drops a private key and keeps a public address", () => {
  const key = "0x" + "ab".repeat(32);
  const text = bugReport({
    owner: "0x1111111111111111111111111111111111111111",
    note: `leak ${key}`,
    phrase: "recovery phrase never include this",
  });
  assert.equal(text.includes(key), false);
  assert.match(text, /0x1111111111111111111111111111111111111111/);
  assert.equal(scrubReport(text).includes("never include"), false);
});
