import { describe, expect, it } from "vitest";
import { isPassingTestModeResult } from "../apps/web/src/lib/test-mode-readiness.js";

describe("test mode readiness display", () => {
  it("passes for booking-ready and simulated confirmation replies used by the backend", () => {
    expect(
      isPassingTestModeResult({
        result: {
          kind: "reply",
          text: "Tengo este horario: 2026-06-01T13:00:00.000Z"
        }
      })
    ).toBe(true);

    expect(
      isPassingTestModeResult({
        result: {
          kind: "reply",
          text: "Turno confirmado para lunes 1 de junio a las 10:00."
        }
      })
    ).toBe(true);
  });

  it("does not pass for generic non-empty replies", () => {
    expect(
      isPassingTestModeResult({
        result: {
          kind: "reply",
          text: "Ese horario ya no esta disponible. Te puedo ayudar con otra opcion."
        }
      })
    ).toBe(false);
  });
});
