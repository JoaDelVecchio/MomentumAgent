import { describe, expect, it } from "vitest";
import { matchFreedSlot } from "../src/application/outbound/freed-slot-service.js";
import { canReactivate, isOptOutText } from "../src/application/outbound/reactivation-policy.js";
import { shouldSendReminder } from "../src/application/outbound/reminder-policy.js";

describe("outbound policies", () => {
  it("sends 72h and 24h reminders, plus same-day only for high-risk appointments", () => {
    const appointmentTime = new Date("2026-06-10T15:00:00.000Z");

    expect(shouldSendReminder({ now: new Date("2026-06-07T15:00:00.000Z"), appointmentTime })).toBe("72h");
    expect(
      shouldSendReminder({
        now: new Date("2026-06-07T15:00:00.000Z"),
        appointmentTime,
        alreadySent: ["72h"]
      })
    ).toBe("none");
    expect(shouldSendReminder({ now: new Date("2026-06-09T15:00:00.000Z"), appointmentTime })).toBe("24h");
    expect(
      shouldSendReminder({
        now: new Date("2026-06-10T12:00:00.000Z"),
        appointmentTime,
        sameDayRisk: true
      })
    ).toBe("same-day");
    expect(shouldSendReminder({ now: new Date("2026-06-10T12:00:00.000Z"), appointmentTime })).toBe("none");
  });

  it("uses reminder due windows without sending before the nominal due time", () => {
    const appointmentTime = new Date("2026-06-10T15:00:00.000Z");

    expect(shouldSendReminder({ now: new Date("2026-06-07T14:45:00.000Z"), appointmentTime })).toBe("none");
    expect(shouldSendReminder({ now: new Date("2026-06-07T14:30:00.000Z"), appointmentTime })).toBe("none");
    expect(shouldSendReminder({ now: new Date("2026-06-09T14:45:00.000Z"), appointmentTime })).toBe("none");
    expect(shouldSendReminder({ now: new Date("2026-06-09T14:30:00.000Z"), appointmentTime })).toBe("none");
    expect(shouldSendReminder({ now: new Date("2026-06-09T16:00:00.000Z"), appointmentTime })).toBe("24h");
    expect(shouldSendReminder({ now: new Date("2026-06-10T04:01:00.000Z"), appointmentTime })).toBe("none");
  });

  it("includes the 24h reminder late-window lower bound after quiet hours", () => {
    const appointmentTime = new Date("2026-06-03T23:00:00.000Z");

    expect(shouldSendReminder({ now: new Date("2026-06-03T12:00:00.000Z"), appointmentTime })).toBe("24h");
  });

  it("includes the 72h reminder late-window lower bound after quiet hours", () => {
    const appointmentTime = new Date("2026-06-05T23:00:00.000Z");

    expect(shouldSendReminder({ now: new Date("2026-06-03T12:00:00.000Z"), appointmentTime })).toBe("72h");
  });

  it("reactivates only prior contacts who did not opt out", () => {
    expect(canReactivate({ hadPriorConversation: true, optedOut: false, previousAttempts: 0 })).toBe(true);
    expect(canReactivate({ hadPriorConversation: false, optedOut: false, previousAttempts: 0 })).toBe(false);
    expect(canReactivate({ hadPriorConversation: true, optedOut: true, previousAttempts: 0 })).toBe(false);
    expect(canReactivate({ hadPriorConversation: true, optedOut: false, previousAttempts: 2 })).toBe(false);
    expect(
      canReactivate({
        hadPriorConversation: true,
        optedOut: false,
        previousAttempts: 1,
        lastAttemptAt: new Date("2026-06-01T12:00:00.000Z"),
        now: new Date("2026-06-03T12:00:00.000Z")
      })
    ).toBe(false);
    expect(
      canReactivate({
        hadPriorConversation: true,
        optedOut: false,
        previousAttempts: 1,
        lastAttemptAt: new Date("2026-06-01T12:00:00.000Z"),
        now: new Date("2026-06-08T12:00:00.000Z")
      })
    ).toBe(true);
  });

  it("detects common opt-out messages", () => {
    expect(isOptOutText("No me escriban mas por favor")).toBe(true);
    expect(isOptOutText("STOP")).toBe(true);
    expect(isOptOutText("Quiero reservar botox")).toBe(false);
    expect(isOptOutText("No quiero cancelar el turno")).toBe(false);
    expect(isOptOutText("Mi doctora trabaja los viernes?")).toBe(false);
  });

  it("matches freed slots to compatible active interests", () => {
    const match = matchFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      slot: {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-05T13:00:00.000Z"),
        endsAt: new Date("2026-06-05T13:30:00.000Z")
      },
      interests: [
        {
          id: "interest_1",
          clinicId: "clinic_1",
          patientId: "pat_1",
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
          preferredTo: new Date("2026-06-05T16:00:00.000Z"),
          status: "active"
        }
      ]
    });

    expect(match?.id).toBe("interest_1");
  });

  it("does not match inactive, wrong-service, wrong-professional, or out-of-window interests", () => {
    const match = matchFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      slot: {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-05T13:00:00.000Z"),
        endsAt: new Date("2026-06-05T13:30:00.000Z")
      },
      interests: [
        {
          id: "inactive",
          clinicId: "clinic_1",
          patientId: "pat_1",
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
          preferredTo: new Date("2026-06-05T16:00:00.000Z"),
          status: "fulfilled"
        },
        {
          id: "wrong_service",
          clinicId: "clinic_1",
          patientId: "pat_2",
          serviceId: "svc_facial",
          professionalId: "pro_perez",
          preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
          preferredTo: new Date("2026-06-05T16:00:00.000Z"),
          status: "active"
        },
        {
          id: "wrong_professional",
          clinicId: "clinic_1",
          patientId: "pat_3",
          serviceId: "svc_botox",
          professionalId: "pro_lopez",
          preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
          preferredTo: new Date("2026-06-05T16:00:00.000Z"),
          status: "active"
        },
        {
          id: "wrong_clinic",
          clinicId: "clinic_2",
          patientId: "pat_5",
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          preferredFrom: new Date("2026-06-05T12:00:00.000Z"),
          preferredTo: new Date("2026-06-05T16:00:00.000Z"),
          status: "active"
        },
        {
          id: "outside_window",
          clinicId: "clinic_1",
          patientId: "pat_4",
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          preferredFrom: new Date("2026-06-05T15:00:00.000Z"),
          preferredTo: new Date("2026-06-05T16:00:00.000Z"),
          status: "active"
        }
      ]
    });

    expect(match).toBeUndefined();
  });

  it("ranks exact professional preferences before broad interests", () => {
    const match = matchFreedSlot({
      clinicId: "clinic_1",
      serviceId: "svc_botox",
      slot: {
        professionalId: "pro_perez",
        calendarId: "cal_perez",
        startsAt: new Date("2026-06-05T13:00:00.000Z"),
        endsAt: new Date("2026-06-05T13:30:00.000Z")
      },
      interests: [
        {
          id: "broad",
          clinicId: "clinic_1",
          patientId: "pat_1",
          serviceId: "svc_botox",
          preferredFrom: new Date("2026-06-05T08:00:00.000Z"),
          preferredTo: new Date("2026-06-05T18:00:00.000Z"),
          status: "active"
        },
        {
          id: "exact",
          clinicId: "clinic_1",
          patientId: "pat_2",
          serviceId: "svc_botox",
          professionalId: "pro_perez",
          preferredFrom: new Date("2026-06-05T08:00:00.000Z"),
          preferredTo: new Date("2026-06-05T18:00:00.000Z"),
          status: "active"
        }
      ]
    });

    expect(match?.id).toBe("exact");
  });
});
