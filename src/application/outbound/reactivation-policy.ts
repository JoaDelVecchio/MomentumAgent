type ReactivationInput = {
  hadPriorConversation: boolean;
  optedOut: boolean;
  previousAttempts: number;
  now?: Date;
  lastAttemptAt?: Date;
};

export function canReactivate(input: ReactivationInput) {
  if (!input.hadPriorConversation) {
    return false;
  }

  if (input.optedOut) {
    return false;
  }

  if (input.previousAttempts >= 2) {
    return false;
  }

  if (input.now && input.lastAttemptAt) {
    const minimumDelayDays = input.previousAttempts === 0 ? 1 : 7;
    const elapsedMs = input.now.getTime() - input.lastAttemptAt.getTime();
    return elapsedMs >= minimumDelayDays * 24 * 60 * 60 * 1000;
  }

  return true;
}

export function isOptOutText(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    /\bstop\b/.test(normalized) ||
    /\bbaja\b/.test(normalized) ||
    /no me escriban mas/.test(normalized) ||
    /no quiero recibir mensajes/.test(normalized) ||
    /no quiero que me escriban/.test(normalized)
  );
}
