import { describe, expect, it } from "vitest";
import { consumeTriggerQuota, signTriggerRequest, verifyTriggerSignature } from "./gatewaySecurity";

describe("gateway trigger security", () => {
  it("accepts an unexpired HMAC signature and rejects a tampered request", () => {
    const secret = "tenant-secret";
    const timestamp = "1725000000000";
    const signature = signTriggerRequest(secret, timestamp, "POST", "/trigger/fn_demo", '{"signal":"go"}');

    expect(verifyTriggerSignature({ secret, timestamp, signature, method: "POST", path: "/trigger/fn_demo", rawBody: '{"signal":"go"}', now: 1_725_000_000_100 })).toBe(true);
    expect(verifyTriggerSignature({ secret, timestamp, signature, method: "POST", path: "/trigger/fn_demo", rawBody: '{"signal":"altered"}', now: 1_725_000_000_100 })).toBe(false);
    expect(verifyTriggerSignature({ secret, timestamp, signature, method: "POST", path: "/trigger/fn_demo", rawBody: '{"signal":"go"}', now: 1_725_000_301_000 })).toBe(false);
  });

  it("allows sixty requests per trigger per minute and returns a limit response thereafter", () => {
    const now = 1_725_000_000_000;
    const triggerId = "test-rate-limit-isolated";
    for (let request = 0; request < 60; request += 1) {
      expect(consumeTriggerQuota(triggerId, now).allowed).toBe(true);
    }
    expect(consumeTriggerQuota(triggerId, now).allowed).toBe(false);
    expect(consumeTriggerQuota(triggerId, now + 60_001).allowed).toBe(true);
  });
});
