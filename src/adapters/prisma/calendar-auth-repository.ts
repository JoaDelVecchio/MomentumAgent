import type { PrismaClient } from "@prisma/client";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes as cryptoRandomBytes
} from "node:crypto";
import type {
  CalendarCredentialInput,
  CalendarCredentialLookup,
  CalendarCredentialRepository,
  CalendarCredentials,
  CalendarProvider,
  TokenCipher
} from "../../ports/calendar-auth.js";

type RandomBytes = (size: number) => Buffer;

type CalendarConnectionRecord = {
  id: string;
  clinicId: string;
  provider: string;
  providerAccountEmail: string;
  scopesJson: string;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string;
  expiryDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class PrismaCalendarCredentialRepository implements CalendarCredentialRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: TokenCipher
  ) {}

  async save(input: CalendarCredentialInput): Promise<CalendarCredentials> {
    const connection = await this.prisma.calendarConnection.upsert({
      where: {
        clinicId_provider: {
          clinicId: input.clinicId,
          provider: input.provider
        }
      },
      create: {
        clinicId: input.clinicId,
        provider: input.provider,
        providerAccountEmail: input.providerAccountEmail,
        scopesJson: JSON.stringify(input.scopes),
        encryptedAccessToken:
          input.accessToken === undefined ? null : this.cipher.encrypt(input.accessToken),
        encryptedRefreshToken: this.cipher.encrypt(input.refreshToken),
        expiryDate: input.expiryDate ?? null
      },
      update: {
        providerAccountEmail: input.providerAccountEmail,
        scopesJson: JSON.stringify(input.scopes),
        encryptedAccessToken:
          input.accessToken === undefined ? null : this.cipher.encrypt(input.accessToken),
        encryptedRefreshToken: this.cipher.encrypt(input.refreshToken),
        expiryDate: input.expiryDate ?? null
      }
    });

    return this.toCredentials(connection);
  }

  async get(lookup: CalendarCredentialLookup): Promise<CalendarCredentials | undefined> {
    const connection = await this.prisma.calendarConnection.findUnique({
      where: {
        clinicId_provider: {
          clinicId: lookup.clinicId,
          provider: lookup.provider
        }
      }
    });

    return connection ? this.toCredentials(connection) : undefined;
  }

  private toCredentials(connection: CalendarConnectionRecord): CalendarCredentials {
    return {
      id: connection.id,
      clinicId: connection.clinicId,
      provider: parseCalendarProvider(connection.provider),
      providerAccountEmail: connection.providerAccountEmail,
      scopes: parseScopes(connection.scopesJson),
      accessToken: connection.encryptedAccessToken
        ? this.cipher.decrypt(connection.encryptedAccessToken)
        : undefined,
      refreshToken: this.cipher.decrypt(connection.encryptedRefreshToken),
      expiryDate: connection.expiryDate ?? undefined,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt
    };
  }
}

export class Aes256GcmTokenCipher implements TokenCipher {
  private readonly key: Buffer;

  constructor(
    key: string | Buffer,
    private readonly randomBytes: RandomBytes = cryptoRandomBytes
  ) {
    this.key = parseKey(key);
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): Aes256GcmTokenCipher {
    const key = env.TOKEN_ENCRYPTION_KEY;
    if (!key) {
      throw new Error("TOKEN_ENCRYPTION_KEY is required for calendar token encryption");
    }
    return new Aes256GcmTokenCipher(key);
  }

  encrypt(plainText: string): string {
    const iv = this.randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      "v1",
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64")
    ].join(":");
  }

  decrypt(cipherText: string): string {
    const [version, ivBase64, authTagBase64, encryptedBase64] = cipherText.split(":");
    if (version !== "v1" || !ivBase64 || !authTagBase64 || !encryptedBase64) {
      throw new Error("Invalid encrypted token payload");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivBase64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  }
}

function parseCalendarProvider(provider: string): CalendarProvider {
  if (provider === "google") {
    return provider;
  }
  throw new Error(`Unsupported calendar provider: ${provider}`);
}

function parseScopes(scopesJson: string): string[] {
  const scopes = JSON.parse(scopesJson) as unknown;
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) {
    throw new Error("Invalid calendar credential scopes");
  }
  return scopes;
}

function parseKey(key: string | Buffer): Buffer {
  const parsed = Buffer.isBuffer(key) ? key : parseStringKey(key);
  if (parsed.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return parsed;
}

function parseStringKey(key: string): Buffer {
  const trimmed = key.trim();
  if (/^[0-9a-f]{64}$/iu.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}
