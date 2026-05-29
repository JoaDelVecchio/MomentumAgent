export type CalendarProvider = "google";

export type CalendarCredentialLookup = {
  clinicId: string;
  provider: CalendarProvider;
};

export type CalendarCredentialInput = CalendarCredentialLookup & {
  providerAccountEmail: string;
  scopes: string[];
  accessToken?: string;
  refreshToken: string;
  expiryDate?: Date;
};

export type CalendarCredentials = CalendarCredentialInput & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface CalendarCredentialRepository {
  save(credentials: CalendarCredentialInput): Promise<CalendarCredentials>;
  get(lookup: CalendarCredentialLookup): Promise<CalendarCredentials | undefined>;
}

export interface TokenCipher {
  encrypt(plainText: string): string;
  decrypt(cipherText: string): string;
}
