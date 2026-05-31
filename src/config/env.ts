export function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '""' || trimmed === "''") {
    return undefined;
  }
  return trimmed;
}

export function requiredEnv(env: NodeJS.ProcessEnv, key: string, message?: string): string {
  const value = optionalEnv(env[key]);
  if (!value) {
    throw new Error(message ?? `${key} is required`);
  }
  return value;
}
