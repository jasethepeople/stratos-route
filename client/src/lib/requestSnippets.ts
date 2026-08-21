export type SnippetLanguage = "javascript" | "python";

type SignedRequestSnippetOptions = {
  language: SnippetLanguage;
  triggerUrl: string;
  triggerId: string;
  signingSecret: string;
};

export function buildSignedRequestSnippet({ language, triggerUrl, triggerId, signingSecret }: SignedRequestSnippetOptions) {
  if (language === "javascript") {
    return `import crypto from "node:crypto";

const triggerUrl = "${triggerUrl}";
const secret = "${signingSecret}";
const body = JSON.stringify({ mission: "telemetry" });
const timestamp = Date.now().toString();
const path = new URL(triggerUrl).pathname;
const signature = crypto.createHmac("sha256", secret)
  .update([timestamp, "POST", path, body].join("\\n"))
  .digest("hex");

const response = await fetch(triggerUrl, {
  method: "POST",
  headers: { "content-type": "application/json", "x-stratos-timestamp": timestamp, "x-stratos-signature": signature },
  body,
});
console.log(await response.json());`;
  }

  return `import hashlib
import hmac
import json
import time
import requests

trigger_url = "${triggerUrl}"
secret = "${signingSecret}"
body = json.dumps({"mission": "telemetry"}, separators=(",", ":"))
timestamp = str(int(time.time() * 1000))
path = "/trigger/${triggerId}"
payload = "\\n".join([timestamp, "POST", path, body])
signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

response = requests.post(trigger_url, data=body, headers={
  "content-type": "application/json",
  "x-stratos-timestamp": timestamp,
  "x-stratos-signature": signature,
})
print(response.json())`;
}
