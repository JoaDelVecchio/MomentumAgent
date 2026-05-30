type ReminderInput = {
  now: Date;
  appointmentTime: Date;
  sameDayRisk?: boolean;
  alreadySent?: ReminderKind[];
};

export type ReminderKind = "72h" | "24h" | "same-day" | "none";

const HOUR_MS = 60 * 60 * 1000;
const REMINDER_LATE_WINDOW_HOURS = 13;
const REMINDER_72H_MIN_HOURS = 72 - REMINDER_LATE_WINDOW_HOURS;
const REMINDER_24H_MIN_HOURS = 24 - REMINDER_LATE_WINDOW_HOURS;

export function shouldSendReminder(input: ReminderInput): ReminderKind {
  const diffHours = (input.appointmentTime.getTime() - input.now.getTime()) / HOUR_MS;
  const alreadySent = input.alreadySent ?? [];

  if (diffHours >= REMINDER_72H_MIN_HOURS && diffHours <= 72 && !alreadySent.includes("72h")) {
    return "72h";
  }

  if (diffHours >= REMINDER_24H_MIN_HOURS && diffHours <= 24 && !alreadySent.includes("24h")) {
    return "24h";
  }

  if (input.sameDayRisk && diffHours >= 2 && diffHours <= 3 && !alreadySent.includes("same-day")) {
    return "same-day";
  }

  return "none";
}
