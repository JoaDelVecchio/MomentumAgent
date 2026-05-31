import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProductionAppRuntime } from "./production-app.js";

export type VercelRuntimeFactory = () => Promise<ProductionAppRuntime>;

export function createVercelFastifyHandler(runtimeFactory: VercelRuntimeFactory) {
  let runtimePromise: Promise<ProductionAppRuntime> | undefined;

  return async function handler(request: IncomingMessage, response: ServerResponse) {
    runtimePromise ??= runtimeFactory().catch((error: unknown) => {
      runtimePromise = undefined;
      throw error;
    });
    const runtime = await runtimePromise;
    request.url = stripVercelApiPrefix(request.url);
    await runtime.app.ready();
    runtime.app.server.emit("request", request, response);
  };
}

export function stripVercelApiPrefix(url: string | undefined): string | undefined {
  if (url === "/api") {
    return "/";
  }
  if (url?.startsWith("/api?")) {
    return `/${url.slice("/api".length)}`;
  }
  if (!url?.startsWith("/api/")) {
    return url;
  }
  return url.slice("/api".length);
}
