import assert from "node:assert/strict";
import { test } from "node:test";
import { teamReviewDecision } from "../worker.js";

test("the three-agent team requires both independent reviewers to approve", () => {
  assert.deepEqual(teamReviewDecision([
    { decision: "approve", confidence: 0.91, findings: [] },
    { decision: "approve", confidence: 0.88, findings: [] },
  ]), { approved: true, reason: "unanimous" });

  assert.equal(teamReviewDecision([
    { decision: "approve", confidence: 0.95, findings: [] },
    { decision: "block", confidence: 0.92, findings: [{ detail: "Potential regression." }] },
  ]).approved, false);

  assert.equal(teamReviewDecision([{ decision: "approve", confidence: 0.99, findings: [] }]).approved, false);
  assert.equal(teamReviewDecision([
    { decision: "approve", confidence: 0.99, findings: [] },
    { decision: "approve", confidence: 0.4, findings: [] },
  ]).approved, false);
});
