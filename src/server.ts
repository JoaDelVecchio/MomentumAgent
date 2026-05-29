import "dotenv/config";
import { buildApp } from "./api/app.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const app = buildApp();

await app.listen({ port, host });
console.log(`Momentum API listening on http://${host}:${port}`);
