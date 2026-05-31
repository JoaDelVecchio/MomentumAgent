import { createProductionAppRuntime } from "../src/runtime/production-app.js";
import { createVercelFastifyHandler } from "../src/runtime/vercel-fastify-handler.js";

export const config = {
  maxDuration: 300
};

export default createVercelFastifyHandler(() => createProductionAppRuntime(process.env));
