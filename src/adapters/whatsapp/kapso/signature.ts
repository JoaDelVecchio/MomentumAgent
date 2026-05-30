import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifyKapsoWebhookSignatureInput = {
  rawBody: string | Buffer;
  signature: string | undefined;
  secret: string;
};

export function createKapsoWebhookSignature(rawBody: string | Buffer, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyKapsoWebhookSignature(input: VerifyKapsoWebhookSignatureInput) {
  if (!input.signature) {
    return false;
  }

  const expected = Buffer.from(createKapsoWebhookSignature(input.rawBody, input.secret), "hex");
  const providedSignature = normalizeSignature(input.signature);
  const provided = Buffer.from(providedSignature, "hex");

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function normalizeSignature(signature: string) {
  return signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
}
