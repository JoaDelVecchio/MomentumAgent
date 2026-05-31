import type { IncomingMessage, ServerResponse } from "node:http";
import { createProductionAppRuntime } from "../../src/runtime/production-app.js";
import { runOutboundCron } from "../../src/runtime/outbound-cron.js";

export const config = {
  maxDuration: 300
};

let runtimePromise: ReturnType<typeof createProductionAppRuntime> | undefined;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const result = await runOutboundCron({
    authorization: readHeader(request.headers.authorization),
    env: process.env,
    runtimeFactory: async () => {
      runtimePromise ??= createProductionAppRuntime(process.env).catch((error: unknown) => {
        runtimePromise = undefined;
        throw error;
      });
      return runtimePromise;
    }
  });

  response.statusCode = result.statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(result.body));
}

function readHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
