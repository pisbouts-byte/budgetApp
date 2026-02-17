import assert from "node:assert/strict";
import test from "node:test";
import { metricsSnapshot, recordRequest } from "./metrics.js";

test("metrics snapshot increments counters and duration stats", () => {
  const before = metricsSnapshot();

  recordRequest(201, 15.25);
  recordRequest(404, 7.5);

  const after = metricsSnapshot();
  assert.equal(after.requestsTotal, before.requestsTotal + 2);
  assert.equal(
    after.requestsByStatusClass["2xx"],
    before.requestsByStatusClass["2xx"] + 1
  );
  assert.equal(
    after.requestsByStatusClass["4xx"],
    before.requestsByStatusClass["4xx"] + 1
  );
  assert.ok(after.requestDurationMsAvg >= before.requestDurationMsAvg);
  assert.ok(after.requestDurationMsMax >= before.requestDurationMsMax);
});
