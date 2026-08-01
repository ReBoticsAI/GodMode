import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signGithubAppJwt,
  verifyGithubWebhookSignatureWithSecret,
} from "../github-app.js";

describe("github-app crypto", () => {
  it("signs a JWT with an RSA private key", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const jwt = signGithubAppJwt("4457625", pem);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8")
    ) as { iss: string };
    expect(payload.iss).toBe("4457625");
  });

  it("verifies webhook HMAC signatures", () => {
    const body = Buffer.from('{"action":"edited"}', "utf8");
    const secret = "whsec_test";
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    expect(
      verifyGithubWebhookSignatureWithSecret(body, `sha256=${digest}`, secret)
    ).toBe(true);
    expect(
      verifyGithubWebhookSignatureWithSecret(body, "sha256=deadbeef", secret)
    ).toBe(false);
  });
});
