export type QuietHoursInput = {
  now: Date;
  timezone: string;
  quietStartHour?: number;
  quietEndHour?: number;
};

export function isInsideQuietHours(input: QuietHoursInput): boolean {
  const quietStartHour = input.quietStartHour ?? 20;
  const quietEndHour = input.quietEndHour ?? 9;

  if (quietStartHour === quietEndHour) {
    return false;
  }

  const hour = localHour(input.now, input.timezone);

  if (quietStartHour > quietEndHour) {
    return hour >= quietStartHour || hour < quietEndHour;
  }

  return hour >= quietStartHour && hour < quietEndHour;
}

function localHour(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: timezone
  });
  const hour = formatter.formatToParts(date).find((part) => part.type === "hour")?.value;

  if (!hour) {
    throw new Error(`Could not determine local hour for timezone ${timezone}`);
  }

  return Number.parseInt(hour, 10);
}
