type ReminderInput = {
  now: Date;
  appointmentTime: Date;
  sameDayRisk?: boolean;
  alreadySent?: ReminderKind[];
};

export type ReminderKind = "72h" | "24h" | "same-day" | "none";

export function shouldSendReminder(input: ReminderInput): ReminderKind {
  const diffHours = Math.round((input.appointmentTime.getTime() - input.now.getTime()) / 3600000);
  const alreadySent = input.alreadySent ?? [];

  if (diffHours === 72 && !alreadySent.includes("72h")) {
    return "72h";
  }

  if (diffHours === 24 && !alreadySent.includes("24h")) {
    return "24h";
  }

  if (input.sameDayRisk && diffHours >= 2 && diffHours <= 3 && !alreadySent.includes("same-day")) {
    return "same-day";
  }

  return "none";
}
