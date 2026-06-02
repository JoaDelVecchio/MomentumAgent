import { describe, expect, it } from "vitest";
import { buildNonTransactionalReply } from "../src/application/conversations/agent-decisions.js";
import { parseClinicProfile } from "../src/domain/clinic-profile.js";

const profile = parseClinicProfile({
  clinicId: "clinic_1",
  name: "Clinica Demo",
  timezone: "America/Argentina/Buenos_Aires",
  services: [
    {
      id: "svc_botox",
      name: "Botox",
      durationMinutes: 30,
      priceText: "Desde $120.000",
      preparation: "Evitar alcohol 24 horas antes.",
      restrictions: [],
      professionalIds: ["pro_perez"]
    }
  ],
  professionals: [{ id: "pro_perez", name: "Dra. Perez", calendarId: "cal_perez" }],
  appointmentRules: { minimumNoticeMinutes: 0, cancellationNoticeMinutes: 0, bufferMinutes: 0 },
  requiredPatientFields: ["fullName"]
});

describe("agent decision helpers", () => {
  it("answers role smalltalk without a transactional action", () => {
    expect(buildNonTransactionalReply({ messageText: "como te llamas", clinicProfile: profile })).toEqual({
      kind: "reply",
      text: "Soy Momentum, el asistente de la clinica para ayudarte con informacion y turnos."
    });
  });

  it("answers service catalog questions from the configured clinic profile", () => {
    expect(buildNonTransactionalReply({ messageText: "que servicios ofrecen", clinicProfile: profile })).toEqual({
      kind: "reply",
      text: "Por ahora puedo ayudarte con: Botox."
    });
  });

  it("does not intercept transactional booking text", () => {
    expect(buildNonTransactionalReply({ messageText: "quiero reservar botox", clinicProfile: profile })).toBeUndefined();
  });

  it("does not intercept mixed transactional and catalog text", () => {
    expect(
      buildNonTransactionalReply({
        messageText: "quiero reservar botox y saber que servicios ofrecen",
        clinicProfile: profile
      })
    ).toBeUndefined();
  });

  it("does not intercept mixed transactional and smalltalk text", () => {
    expect(
      buildNonTransactionalReply({ messageText: "quiero sacar turno y saber si sos un bot", clinicProfile: profile })
    ).toBeUndefined();
  });

  it("does not treat broad que hacen questions as a service catalog request", () => {
    expect(buildNonTransactionalReply({ messageText: "que hacen si llego tarde", clinicProfile: profile })).toBeUndefined();
  });
});
