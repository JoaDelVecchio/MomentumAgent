import type { LoggerPort, LogMetadata } from "../ports/logger.js";

export class ConsoleLogger implements LoggerPort {
  info(metadata: LogMetadata): void {
    console.log(JSON.stringify({ level: "info", ...metadata }));
  }

  warn(metadata: LogMetadata): void {
    console.warn(JSON.stringify({ level: "warn", ...metadata }));
  }

  error(metadata: LogMetadata): void {
    console.error(JSON.stringify({ level: "error", ...metadata }));
  }
}
