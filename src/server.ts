import "dotenv/config";
import { createProductionAppRuntime } from "./runtime/production-app.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const runtime = await createProductionAppRuntime(process.env);

await runtime.app.listen({ port, host });
console.log(JSON.stringify({ event: "momentum.startup", ...runtime.summary }));
console.log(`Momentum API listening on http://${host}:${port}`);

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

async function shutdown() {
  await runtime.close();
  process.exit(0);
}
