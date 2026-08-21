import { describe, expect, it } from "vitest";
import { buildSignedRequestSnippet } from "./requestSnippets";

describe("signed request snippet generator", () => {
  const base = { triggerUrl: "https://route.example/trigger/fn_alpha", triggerId: "fn_alpha", signingSecret: "secret-alpha" };

  it("generates a JavaScript client that creates the required HMAC headers", () => {
    const snippet = buildSignedRequestSnippet({ ...base, language: "javascript" });
    expect(snippet).toContain('crypto.createHmac("sha256", secret)');
    expect(snippet).toContain('"x-stratos-signature": signature');
  });

  it("generates a Python client that signs the exact trigger path", () => {
    const snippet = buildSignedRequestSnippet({ ...base, language: "python" });
    expect(snippet).toContain('hmac.new(secret.encode(), payload.encode(), hashlib.sha256)');
    expect(snippet).toContain('path = "/trigger/fn_alpha"');
  });
});
