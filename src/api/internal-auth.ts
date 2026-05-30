import { timingSafeEqual } from "node:crypto";

export function isAuthorized(authorization: string | string[] | undefined, expected: string) {
  const actual = readBearerToken(authorization);
  if (!actual) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function readBearerToken(authorization: string | string[] | undefined) {
  if (!authorization || Array.isArray(authorization)) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  return match?.[1];
}
