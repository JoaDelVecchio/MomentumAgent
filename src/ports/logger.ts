export type LogMetadata = Record<string, string | number | boolean | undefined>;

export interface LoggerPort {
  info(metadata: LogMetadata): void;
  warn(metadata: LogMetadata): void;
  error(metadata: LogMetadata): void;
}
