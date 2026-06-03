const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

export function formatPatientDateTime(date: Date, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  }).formatToParts(date);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = byType.get("weekday") ?? "";
  const day = byType.get("day") ?? "";
  const month = byType.get("month") ?? "";
  const hour = byType.get("hour") ?? "";
  const minute = byType.get("minute") ?? "";

  return `${weekday} ${day} de ${month} a las ${hour}:${minute}`.trim();
}
