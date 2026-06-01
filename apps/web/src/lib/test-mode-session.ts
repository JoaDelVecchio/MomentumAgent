export type TestModeSession = {
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
};

type TestModeSessionOverrides = {
  runId?: string;
  phoneSuffix?: string;
};

export function createTestModeSession(
  clinicId: string,
  overrides: TestModeSessionOverrides = {}
): TestModeSession {
  const runId = overrides.runId ?? globalThis.crypto.randomUUID();
  const phoneSuffix = overrides.phoneSuffix ?? `${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`;

  return {
    conversationId: `test:${clinicId}:${runId}`,
    patientId: `test_patient:${clinicId}:${runId}`,
    whatsappNumber: `+549000${phoneSuffix.replace(/\D/g, "")}`
  };
}
