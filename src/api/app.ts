import Fastify from "fastify";
import { registerRoutes } from "./routes.js";

type BuildAppOptions = {
  enableSimulationRoutes?: boolean;
  simulationNow?: Date;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  if (options.enableSimulationRoutes) {
    registerRoutes(app, { now: options.simulationNow });
  }

  return app;
}
