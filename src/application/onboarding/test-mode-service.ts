import type { AuditLogPort } from "../../ports/audit-log.js";
import type { CalendarPort } from "../../ports/calendar.js";
import type { OnboardingRepository } from "../../ports/onboarding.js";
import type { OperationalRepository } from "../../ports/repositories.js";
import { ConversationWorkflow, type WorkflowResult } from "../conversations/conversation-workflow.js";
import { RulesConversationInterpreter } from "../conversations/rules-interpreter.js";
import { SchedulingService } from "../scheduling/scheduling-service.js";

export type OnboardingTestModeServiceOptions = {
  onboarding: OnboardingRepository;
  operational: OperationalRepository;
  audit: AuditLogPort;
  calendar: CalendarPort;
  now?: () => Date;
};

export type OnboardingTestModeMessageInput = {
  clinicId: string;
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
  text: string;
};

export type OnboardingTestModeErrorCode = "clinic_setup_missing" | "clinic_profile_missing";

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
    const scheduling = new SchedulingService(options.operational, options.calendar, options.audit, this.now);
    this.workflow = new ConversationWorkflow(
      options.operational,
      scheduling,
      options.audit,
      this.now,
      new RulesConversationInterpreter()
    );
  }

  async runMessage(input: OnboardingTestModeMessageInput): Promise<WorkflowResult> {
    await this.requireConfiguredClinic(input.clinicId);

    const result = await this.workflow.handleInboundMessage(input);
    await this.options.onboarding.updateReadinessFlags({
      clinicId: input.clinicId,
      testConversationPassed: true,
      updatedAt: this.now()
    });
    return result;
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
