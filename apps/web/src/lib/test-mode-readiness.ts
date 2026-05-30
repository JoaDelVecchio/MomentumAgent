import type { TestMessageResponse } from "./types.js";

export function isPassingTestModeResult(response: TestMessageResponse | null): boolean {
  return response?.result.kind === "reply" && response.result.text?.includes("Tengo este horario") === true;
}
