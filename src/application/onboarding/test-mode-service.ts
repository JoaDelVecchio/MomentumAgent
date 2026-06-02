import type { AuditLogPort } from "../../ports/audit-log.js";
import {
  CalendarAvailabilityError,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarPort,
  type CalendarSlot,
  type FindFreeSlotsInput
} from "../../ports/calendar.js";
import type { OnboardingRepository } from "../../ports/onboarding.js";
import type { OperationalRepository } from "../../ports/repositories.js";
import { ConversationWorkflow, type WorkflowResult } from "../conversations/conversation-workflow.js";
import type { ConversationInterpreter } from "../conversations/interpreter.js";
import { RulesConversationInterpreter } from "../conversations/rules-interpreter.js";
import { SchedulingService } from "../scheduling/scheduling-service.js";

export type OnboardingTestModeServiceOptions = {
  onboarding: OnboardingRepository;
  operational: OperationalRepository;
  audit: AuditLogPort;
  calendar: CalendarPort;
  now?: () => Date;
  interpreter?: ConversationInterpreter;
};

export type OnboardingTestModeMessageInput = {
  clinicId: string;
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
  text: string;
};

export type OnboardingTestModeErrorCode =
  | "clinic_setup_missing"
  | "clinic_profile_missing"
  | "unsafe_test_identity";

export class OnboardingTestModeError extends Error {
  constructor(
    readonly code: OnboardingTestModeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OnboardingTestModeError";
  }
}

export class OnboardingTestModeService {
  private readonly workflow: ConversationWorkflow;
  private readonly now: () => Date;

  constructor(private readonly options: OnboardingTestModeServiceOptions) {
    this.now = options.now ?? (() => new Date());
    const scheduling = new SchedulingService(
      options.operational,
      new DryRunCalendar(options.calendar),
      options.audit,
      this.now
    );
    this.workflow = new ConversationWorkflow(
      options.operational,
      scheduling,
      options.audit,
      this.now,
      options.interpreter ?? new RulesConversationInterpreter(),
      { bookingMode: "dry-run" }
    );
  }

  async runMessage(input: OnboardingTestModeMessageInput): Promise<WorkflowResult> {
    this.assertSafeTestIdentity(input);
    await this.requireConfiguredClinic(input.clinicId);

    const result = await this.workflow.handleInboundMessage(input);
    if (isPositiveBookingTestReply(result)) {
      await this.options.onboarding.updateReadinessFlags({
        clinicId: input.clinicId,
        testConversationPassed: true,
        updatedAt: this.now()
      });
    }
    return result;
  }

  private assertSafeTestIdentity(input: OnboardingTestModeMessageInput): void {
    if (
      !input.conversationId.startsWith(`test:${input.clinicId}:`) ||
      !input.patientId.startsWith(`test_patient:${input.clinicId}:`) ||
      !input.whatsappNumber.startsWith("+549000")
    ) {
      throw new OnboardingTestModeError(
        "unsafe_test_identity",
        "Onboarding test mode only accepts scoped test identities"
      );
    }
  }

  private async requireConfiguredClinic(clinicId: string): Promise<void> {
    const setup = await this.options.onboarding.getClinicSetup(clinicId);
    if (!setup) {
      throw new OnboardingTestModeError("clinic_setup_missing", `Clinic setup ${clinicId} not found`);
    }

    const profile = await this.options.operational.getClinicProfile(clinicId);
    if (!profile) {
      throw new OnboardingTestModeError("clinic_profile_missing", `Clinic profile ${clinicId} not found`);
    }
  }
}

function isPositiveBookingTestReply(result: WorkflowResult): boolean {
  return (
    result.kind === "reply" &&
    (result.text.includes("Tengo este horario") || result.text.includes("Dry-run: el turno se podria confirmar"))
  );
}

class DryRunCalendar implements CalendarPort {
  constructor(private readonly delegate: CalendarPort) {}

  async findFreeSlots(input: FindFreeSlotsInput): Promise<CalendarSlot[]> {
    return this.delegate.findFreeSlots(input);
  }

  async createEvent(_input: CalendarEventInput): Promise<CalendarEvent> {
    throw new CalendarAvailabilityError("Onboarding test mode does not create calendar events");
  }

  async updateEvent(_eventId: string, _input: CalendarEventInput): Promise<CalendarEvent> {
    throw new CalendarAvailabilityError("Onboarding test mode does not update calendar events");
  }

  async cancelEvent(_eventId: string, _calendarId?: string): Promise<CalendarEvent> {
    throw new CalendarAvailabilityError("Onboarding test mode does not cancel calendar events");
  }

  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent | undefined> {
    return this.delegate.getEvent(eventId, calendarId);
  }
}
