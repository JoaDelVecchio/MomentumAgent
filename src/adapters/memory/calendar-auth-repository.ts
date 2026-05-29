import type {
  CalendarCredentialInput,
  CalendarCredentialLookup,
  CalendarCredentialRepository,
  CalendarCredentials
} from "../../ports/calendar-auth.js";

export class InMemoryCalendarCredentialRepository implements CalendarCredentialRepository {
  private credentials = new Map<string, CalendarCredentials>();
  private nextId = 1;

  async save(input: CalendarCredentialInput): Promise<CalendarCredentials> {
    const key = credentialKey(input);
    const existing = this.credentials.get(key);
    const now = new Date();
    const credentials: CalendarCredentials = {
      ...cloneInput(input),
      id: existing?.id ?? `calendar_connection_${this.nextId++}`,
      createdAt: existing ? new Date(existing.createdAt) : now,
      updatedAt: now
    };

    this.credentials.set(key, cloneCredentials(credentials));
    return cloneCredentials(credentials);
  }

  async get(lookup: CalendarCredentialLookup): Promise<CalendarCredentials | undefined> {
    const credentials = this.credentials.get(credentialKey(lookup));
    return credentials ? cloneCredentials(credentials) : undefined;
  }
}

function credentialKey(lookup: CalendarCredentialLookup) {
  return `${lookup.provider}:${lookup.clinicId}`;
}

function cloneInput(input: CalendarCredentialInput): CalendarCredentialInput {
  return {
    ...input,
    scopes: [...input.scopes],
    expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined
  };
}

function cloneCredentials(credentials: CalendarCredentials): CalendarCredentials {
  return {
    ...credentials,
    scopes: [...credentials.scopes],
    expiryDate: credentials.expiryDate ? new Date(credentials.expiryDate) : undefined,
    createdAt: new Date(credentials.createdAt),
    updatedAt: new Date(credentials.updatedAt)
  };
}
