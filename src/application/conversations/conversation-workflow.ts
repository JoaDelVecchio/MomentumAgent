import type { Appointment, ClinicProfile } from "../../domain/types.js";
import type { AuditLogPort } from "../../ports/audit-log.js";
import { CalendarInfrastructureError, type CalendarSlot } from "../../ports/calendar.js";
import type { Conversation, ConversationMessage, OperationalRepository, PendingBooking } from "../../ports/repositories.js";
import type { SchedulingService } from "../scheduling/scheduling-service.js";
import { decideAgentAction, hasMedicalSafetyLanguage, type AgentDecision } from "./agent-router.js";
import { buildConversationState, type ConversationState } from "./agent-state.js";
import { buildFaqResponse, hasRequestedFaqTopic, missingConfiguredFaqResponse } from "./faq-response.js";
import type { ConversationInterpreter, ConversationUnderstanding, RequestedTopic } from "./interpreter.js";
import { normalizeText } from "./intent.js";
import { extractLikelyPatientFullName, normalizeFullNameIfComplete } from "./patient-data.js";
import { decideReceptionistAction, type ReceptionistActionDecision } from "./receptionist-action-policy.js";
import type { ReceptionistAgent, ReceptionistTurn } from "./receptionist-agent.js";
import type { ConversationResponseComposer } from "./response-composer.js";
import { formatPatientDateTime } from "./response-formatting.js";
import { RulesConversationInterpreter } from "./rules-interpreter.js";
import { findProfessional, findService, formatServiceList } from "./service-matching.js";
import { detectNormalizedTimePreference, filterSlotsByDaypart, resolveSlotSearchRange } from "./time-preferences.js";

const SIDE_EFFECT_CONFIDENCE_THRESHOLD = 0.7;
const MAX_RECENT_MESSAGES = 12;
const PENDING_SLOT_LOCK_MINUTES = 10;

type InboundMessage = {
  clinicId: string;
  conversationId: string;
  patientId: string;
  whatsappNumber: string;
  text: string;
};

type LockedSlotClaim = {
  slot: CalendarSlot;
  professional: ClinicProfile["professionals"][number];
  lockId: string;
  lockExpiresAt: Date;
};

export type WorkflowResult =
  | { kind: "reply"; text: string }
  | { kind: "handoff"; text: string };

export type ConversationWorkflowOptions = {
  bookingMode?: "execute" | "simulate";
  receptionistAgent?: ReceptionistAgent;
  responseComposer?: ConversationResponseComposer;
};

export class ConversationWorkflow {
  constructor(
    private readonly repos: OperationalRepository,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditLogPort,
    private readonly now: () => Date = () => new Date(),
    private readonly interpreter: ConversationInterpreter = new RulesConversationInterpreter(),
    private readonly options: ConversationWorkflowOptions = {}
  ) {}

  async handleInboundMessage(input: InboundMessage): Promise<WorkflowResult> {
    return this.repos.withConversationLock(`${input.clinicId}:${input.conversationId}`, () =>
      this.handleInboundMessageLocked(input)
    );
  }

  private async handleInboundMessageLocked(input: InboundMessage): Promise<WorkflowResult> {
    await this.upsertPatient(input);
    const conversation = await this.upsertConversation(input);
    if (conversation.botPaused) {
      return { kind: "handoff", text: "Recepcion continua la conversacion por este mismo chat." };
    }

    const clinicProfile = await this.repos.getClinicProfile(input.clinicId);
    const patient = await this.repos.getPatient(input.patientId);
    const activeAppointments = (await this.repos.listAppointmentsByPatient(input.patientId)).filter(
      (appointment) => appointment.clinicId === input.clinicId && appointment.status === "scheduled"
    );
    const conversationState = buildConversationState({
      conversation,
      clinicProfile,
      patient,
      activeAppointments,
      messageText: input.text
    });

    if (this.options.receptionistAgent) {
      const result = await this.handleReceptionistAgentMessage({
        input,
        conversation,
        conversationState,
        clinicProfile,
        activeAppointments
      });
      await this.rememberExchange(input, result.text);
      return result;
    }

    const intent = await this.interpreter.interpret({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      patientId: input.patientId,
      messageText: input.text,
      now: this.now(),
      clinicProfile,
      pendingBooking: conversation.pendingBooking,
      conversationState,
      recentMessages: conversation.recentMessages ?? []
    });
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "intent.detected",
      message: `Detected ${intent.intent}`,
      metadata: {
        intent: intent.intent,
        provider: intent.provider,
        confidence: String(intent.confidence),
        serviceName: intent.serviceName ?? "",
        requestedTopics: intent.requestedTopics.join(","),
        requiresHuman: String(intent.requiresHuman),
        safetyReason: intent.safetyReason ?? "",
        reason: intent.reason
      }
    });

    const decision = decideAgentAction({
      messageText: input.text,
      state: conversationState,
      understanding: intent,
      clinicProfile
    });
    await this.audit.record({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      type: "agent.decision",
      message: `Selected ${decision.action}`,
      metadata: {
        action: decision.action,
        stage: decision.stage,
        reason: decision.reason,
        intent: intent.intent,
        provider: intent.provider
      }
    });

    const result = await this.executeDecision(input, conversation, intent, decision, conversationState, clinicProfile);
    const finalResult = await this.composeResult({
      input,
      result,
      conversation,
      intent,
      decision,
      conversationState,
      clinicProfile
    });
    await this.rememberExchange(input, finalResult.text);
    return finalResult;
  }

  private async handleReceptionistAgentMessage(input: {
    input: InboundMessage;
    conversation: Conversation;
    conversationState: ConversationState;
    clinicProfile?: ClinicProfile;
    activeAppointments: Appointment[];
  }): Promise<WorkflowResult> {
    const turn = await this.options.receptionistAgent!.respond({
      clinicId: input.input.clinicId,
      conversationId: input.input.conversationId,
      patientId: input.input.patientId,
      messageText: input.input.text,
      now: this.now(),
      clinicProfile: input.clinicProfile,
      pendingBooking: input.conversation.pendingBooking,
      conversationState: input.conversationState,
      activeAppointments: input.activeAppointments,
      recentMessages: input.conversation.recentMessages ?? []
    });

    await this.audit.record({
      clinicId: input.input.clinicId,
      conversationId: input.input.conversationId,
      type: "receptionist.turn",
      message: `Proposed ${turn.proposedAction}`,
      metadata: {
        proposedAction: turn.proposedAction,
        confidence: String(turn.confidence),
        serviceName: turn.serviceName ?? "",
        requestedTopics: turn.requestedTopics.join(","),
        needsHuman: String(turn.needsHuman),
        safetyReason: turn.safetyReason ?? "",
        reason: turn.reason
      }
    });

    const decision = decideReceptionistAction({
      messageText: input.input.text,
      state: input.conversationState,
      turn
    });

    await this.audit.record({
      clinicId: input.input.clinicId,
      conversationId: input.input.conversationId,
      type: "receptionist.decision",
      message: `Allowed ${decision.action}`,
      metadata: {
        proposedAction: decision.proposedAction,
        action: decision.action,
        stage: decision.stage,
        reason: decision.reason
      }
    });

    return await this.executeReceptionistDecision({
      input: input.input,
      conversation: input.conversation,
      conversationState: input.conversationState,
      clinicProfile: input.clinicProfile,
      turn,
      decision
    });
  }

  private async executeDecision(
    input: InboundMessage,
    conversation: Conversation,
    intent: ConversationUnderstanding,
    decision: AgentDecision,
    conversationState: ConversationState,
    clinicProfile: ClinicProfile | undefined
  ): Promise<WorkflowResult> {
    switch (decision.action) {
      case "handoff":
        return await this.pauseForHandoff(input);
      case "reply_non_transactional":
        return decision.reply ?? {
          kind: "reply",
          text: "Te ayudo con informacion y turnos. Decime que necesitas y lo vemos."
        };
      case "answer_pending_faq": {
        const pendingBookingFaqResult = await this.tryAnswerPendingBookingQuestion(input, conversation, intent);
        return pendingBookingFaqResult ?? { kind: "reply", text: missingConfiguredFaqResponse };
      }
      case "complete_pending_patient_data": {
        const pendingDataResult = await this.tryCompletePendingPatientData(input, conversation, intent);
        return pendingDataResult ?? { kind: "reply", text: buildContextualFallback(conversationState) };
      }
      case "clarify_low_confidence":
        return {
          kind: "reply",
          text: "No llegue a entenderlo con seguridad. Decime si queres reservar, confirmar, cancelar o cambiar un turno."
        };
      case "refine_pending_slot":
        return await this.handlePendingSlotRefinement(input, conversation, intent, clinicProfile);
      case "search_slots":
        return await this.handleBookingIntent(input, intent);
      case "confirm_pending_booking":
        return await this.handleConfirmation(input, conversation);
      case "cancel_appointment":
        await this.clearPendingBooking(input.clinicId, input.conversationId);
        return await this.handleCancelIntent(input);
      case "reschedule_appointment":
        await this.clearPendingBooking(input.clinicId, input.conversationId);
        return await this.handleRescheduleIntent(input);
      case "answer_faq": {
        const faq = buildFaqResponse(clinicProfile, intent);
        if (faq) {
          return { kind: "reply", text: faq };
        }
        if (hasRequestedFaqTopic(intent) && !isMissingServiceForServiceFact(intent)) {
          return { kind: "reply", text: missingConfiguredFaqResponse };
        }
        return { kind: "reply", text: buildContextualFallback(conversationState) };
      }
      case "reply_contextual_fallback":
        return { kind: "reply", text: buildContextualFallback(conversationState) };
    }
  }

  private async executeReceptionistDecision(input: {
    input: InboundMessage;
    conversation: Conversation;
    conversationState: ConversationState;
    clinicProfile?: ClinicProfile;
    turn: ReceptionistTurn;
    decision: ReceptionistActionDecision;
  }): Promise<WorkflowResult> {
    switch (input.decision.action) {
      case "handoff":
        return await this.pauseForHandoff(input.input);
      case "reply_only":
        return {
          kind: "reply",
          text:
            input.decision.proposedAction === "reply_only" || input.decision.proposedAction === "answer_business_question"
              ? safeReceptionistReplyText(input.turn, input.conversationState)
              : buildReceptionistPolicyFallback(input.conversationState)
        };
      case "answer_business_question":
        return await this.answerReceptionistBusinessQuestion(input);
      case "search_slots":
        return await this.handleBookingIntent(
          input.input,
          receptionistUnderstanding(input.turn, "book", input.input.text, this.now(), input.clinicProfile?.timezone)
        );
      case "refine_pending_slot":
        return await this.handlePendingSlotRefinement(
          input.input,
          input.conversation,
          receptionistUnderstanding(
            input.turn,
            "slot_refinement",
            input.input.text,
            this.now(),
            input.clinicProfile?.timezone
          ),
          input.clinicProfile
        );
      case "confirm_pending_booking":
        return await this.handleConfirmation(input.input, input.conversation);
      case "collect_patient_data": {
        const dataResult = await this.tryCompletePendingPatientData(
          input.input,
          input.conversation,
          receptionistUnderstanding(input.turn, "unknown", input.input.text, this.now(), input.clinicProfile?.timezone)
        );
        return dataResult ?? { kind: "reply", text: buildReceptionistPolicyFallback(input.conversationState) };
      }
      case "cancel_appointment":
        await this.clearPendingBooking(input.input.clinicId, input.input.conversationId);
        return await this.handleCancelIntent(input.input);
      case "reschedule_appointment":
        await this.clearPendingBooking(input.input.clinicId, input.input.conversationId);
        return await this.handleRescheduleIntent(input.input);
    }
  }

  private async composeResult(input: {
    input: InboundMessage;
    result: WorkflowResult;
    conversation: Conversation;
    intent: ConversationUnderstanding;
    decision: AgentDecision;
    conversationState: ConversationState;
    clinicProfile?: ClinicProfile;
  }): Promise<WorkflowResult> {
    if (input.result.kind !== "reply" || !this.options.responseComposer) {
      return input.result;
    }

    const composedText = await this.options.responseComposer.compose({
      clinicProfile: input.clinicProfile,
      conversationState: input.conversationState,
      understanding: input.intent,
      action: input.decision.action,
      patientMessage: input.input.text,
      recentMessages: input.conversation.recentMessages ?? [],
      draftText: input.result.text
    });

    return composedText ? { ...input.result, text: composedText } : input.result;
  }

  private async answerReceptionistBusinessQuestion(input: {
    input: InboundMessage;
    conversation: Conversation;
    conversationState: ConversationState;
    clinicProfile?: ClinicProfile;
    turn: ReceptionistTurn;
  }): Promise<WorkflowResult> {
    const understanding = receptionistUnderstanding(
      input.turn,
      "question",
      input.input.text,
      this.now(),
      input.clinicProfile?.timezone
    );
    const pendingFaqResult = await this.tryAnswerPendingBookingQuestion(input.input, input.conversation, understanding);
    if (pendingFaqResult) {
      return pendingFaqResult;
    }

    const faq = buildFaqResponse(input.clinicProfile, understanding);
    if (faq) {
      return { kind: "reply", text: faq };
    }
    if (hasRequestedFaqTopic(understanding) || input.turn.missingFacts.length > 0) {
      return { kind: "reply", text: missingConfiguredFaqResponse };
    }

    return { kind: "reply", text: safeReceptionistReplyText(input.turn, input.conversationState) };
  }

  private async rememberExchange(input: InboundMessage, responseText: string) {
    const conversation = await this.repos.getConversation({
      clinicId: input.clinicId,
      conversationId: input.conversationId
    });
    if (!conversation) {
      return;
    }

    const at = this.now();
    await this.repos.saveConversation({
      ...conversation,
      recentMessages: trimRecentMessages([
        ...(conversation.recentMessages ?? []),
        { role: "patient", text: trimConversationText(input.text), at },
        { role: "assistant", text: trimConversationText(responseText), at }
      ]),
      updatedAt: at
    });
  }

  private async pauseForHandoff(input: InboundMessage): Promise<WorkflowResult> {
    const conversation = await this.repos.getConversation({
      clinicId: input.clinicId,
      conversationId: input.conversationId
    });
    if (conversation) {
      await this.repos.saveConversation({ ...conversation, botPaused: true, updatedAt: this.now() });
    }
    return { kind: "handoff", text: "Te derivo con recepcion para que puedan ayudarte por este mismo chat." };
  }

  private async upsertPatient(input: InboundMessage) {
    const existing = await this.repos.getPatient(input.patientId);
    await this.repos.upsertPatient({
      ...existing,
      id: input.patientId,
      whatsappNumber: input.whatsappNumber
    });
  }

  private async upsertConversation(input: InboundMessage): Promise<Conversation> {
    const now = new Date();
    const existing = await this.repos.getConversation({
      clinicId: input.clinicId,
      conversationId: input.conversationId
    });
    const conversation = {
      id: input.conversationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      botPaused: existing?.botPaused ?? false,
      pendingBooking: existing?.pendingBooking,
      recentMessages: existing?.recentMessages ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.repos.saveConversation(conversation);
    return conversation;
  }

  private async handlePendingSlotRefinement(
    input: InboundMessage,
    conversation: Conversation,
    intent: ConversationUnderstanding,
    profile: ClinicProfile | undefined
  ): Promise<WorkflowResult> {
    const pending = conversation.pendingBooking;
    if (!profile || !pending) {
      return { kind: "reply", text: "Decime que tratamiento queres reservar y te paso horarios disponibles." };
    }

    const service = profile.services.find((candidate) => candidate.id === pending.serviceId);
    if (!service) {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return { kind: "reply", text: "No pude encontrar el tratamiento pendiente. Decime cual queres reservar." };
    }

    const preferredProfessional = findProfessional(profile, intent.professionalPreference);
    const searchFrom = startOfDay(this.now());
    const defaultTo = addDays(searchFrom, 14);
    const range = resolveSlotSearchRange({
      defaultFrom: searchFrom,
      defaultTo,
      understanding: intent
    });
    const slots = filterSlotsByDaypart(
      await this.scheduling.findSlots({
        clinicId: input.clinicId,
        serviceId: service.id,
        professionalId: preferredProfessional?.id ?? pending.professionalId,
        from: range.from,
        to: range.to,
        conversationId: input.conversationId
      }),
      intent,
      profile.timezone
    ).filter((slot) => slot.startsAt.getTime() !== pending.startsAt.getTime());

    if (slots.length === 0) {
      return {
        kind: "reply",
        text: `No encontre otro horario disponible para ${service.name} con esa preferencia. Te puedo mantener el horario ofrecido.`
      };
    }

    const lockedSlot = await this.claimFirstAvailableSlot({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      profile,
      service,
      slots
    });
    if (!lockedSlot) {
      return {
        kind: "reply",
        text: `No encontre otro horario disponible para ${service.name} con esa preferencia. Te puedo mantener el horario ofrecido.`
      };
    }

    await this.setPendingBooking(input.clinicId, input.conversationId, {
      ...(pending.appointmentId ? { appointmentId: pending.appointmentId } : {}),
      slotLockId: lockedSlot.lockId,
      slotLockExpiresAt: lockedSlot.lockExpiresAt,
      serviceId: service.id,
      professionalId: lockedSlot.professional.id,
      startsAt: lockedSlot.slot.startsAt,
      endsAt: lockedSlot.slot.endsAt
    });

    return {
      kind: "reply",
      text: `Tengo este horario: ${this.formatDateForPatient(lockedSlot.slot.startsAt, profile)} para ${service.name}. Si te sirve, lo confirmamos.`
    };
  }

  private async handleBookingIntent(input: InboundMessage, intent: ConversationUnderstanding): Promise<WorkflowResult> {
    const profile = await this.repos.getClinicProfile(input.clinicId);
    if (!profile) {
      return { kind: "reply", text: "No tengo la agenda configurada para esta clinica todavia." };
    }

    const service = findService(profile, intent.serviceName);
    if (!service) {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: intent.serviceName
          ? `No encontre ese tratamiento. Por ahora puedo ayudarte con: ${formatServiceList(profile)}.`
          : `Decime que tratamiento queres reservar. Por ahora puedo ayudarte con: ${formatServiceList(profile)}.`
      };
    }

    const preferredProfessional = findProfessional(profile, intent.professionalPreference);
    const searchFrom = startOfDay(this.now());
    const defaultTo = addDays(searchFrom, 14);
    const range = resolveSlotSearchRange({
      defaultFrom: searchFrom,
      defaultTo,
      understanding: intent
    });
    const slots = filterSlotsByDaypart(
      await this.scheduling.findSlots({
        clinicId: input.clinicId,
        serviceId: service.id,
        professionalId: preferredProfessional?.id,
        from: range.from,
        to: range.to,
        conversationId: input.conversationId
      }),
      intent,
      profile.timezone
    );

    if (slots.length === 0) {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      const faqPrefix = buildBookingFaqPrefix(profile, intent);
      return {
        kind: "reply",
        text: `${faqPrefix}No encontre horarios disponibles para ${service.name} con esa preferencia. Podes decirme otro dia u horario.`
      };
    }

    const lockedSlot = await this.claimFirstAvailableSlot({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      profile,
      service,
      slots
    });
    if (!lockedSlot) {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: `No encontre horarios disponibles para ${service.name} con esa preferencia. Podes decirme otro dia u horario.`
      };
    }

    await this.setPendingBooking(input.clinicId, input.conversationId, {
      slotLockId: lockedSlot.lockId,
      slotLockExpiresAt: lockedSlot.lockExpiresAt,
      serviceId: service.id,
      professionalId: lockedSlot.professional.id,
      startsAt: lockedSlot.slot.startsAt,
      endsAt: lockedSlot.slot.endsAt
    });

    const faqPrefix = buildBookingFaqPrefix(profile, intent);
    return {
      kind: "reply",
      text: `${faqPrefix}Tengo este horario: ${this.formatDateForPatient(lockedSlot.slot.startsAt, profile)} para ${service.name}. Si te sirve, lo confirmamos.`
    };
  }

  private async handleConfirmation(input: InboundMessage, conversation: Conversation): Promise<WorkflowResult> {
    const pending = conversation.pendingBooking;
    if (!pending) {
      return { kind: "reply", text: "Decime que tratamiento queres reservar y te paso horarios disponibles." };
    }

    if (
      !pending.appointmentId &&
      (await this.missingRequiredPatientFields(input.clinicId, input.patientId)).includes("fullName")
    ) {
      return { kind: "reply", text: "Perfecto. Para confirmar el turno, pasame nombre y apellido." };
    }

    if (this.options.bookingMode === "simulate") {
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: `Turno confirmado para ${await this.formatDateForClinic(input.clinicId, pending.startsAt)}. Te vamos a enviar el recordatorio antes del turno.`
      };
    }

    try {
      const appointment = pending.appointmentId
        ? await this.scheduling.rescheduleAppointment({
            clinicId: input.clinicId,
            appointmentId: pending.appointmentId,
            startsAt: pending.startsAt,
            conversationId: input.conversationId,
            slotLockId: pending.slotLockId
          })
        : await this.scheduling.bookAppointment({
            clinicId: input.clinicId,
            patientId: input.patientId,
            serviceId: pending.serviceId,
            startsAt: pending.startsAt,
            professionalId: pending.professionalId,
            conversationId: input.conversationId,
            slotLockId: pending.slotLockId
          });
      await this.clearPendingBooking(input.clinicId, input.conversationId);

      return {
        kind: "reply",
        text: pending.appointmentId
          ? `Turno reprogramado para ${await this.formatDateForClinic(input.clinicId, appointment.startsAt)}. Te vamos a enviar el recordatorio antes del turno.`
          : `Turno confirmado para ${await this.formatDateForClinic(input.clinicId, appointment.startsAt)}. Te vamos a enviar el recordatorio antes del turno.`
      };
    } catch (error) {
      if (error instanceof CalendarInfrastructureError) {
        throw error;
      }
      await this.clearPendingBooking(input.clinicId, input.conversationId);
      return {
        kind: "reply",
        text: "Ese horario ya no esta disponible. Te busco otro horario si queres."
      };
    }
  }

  private async setPendingBooking(clinicId: string, conversationId: string, pendingBooking: PendingBooking) {
    const conversation = await this.repos.getConversation({ clinicId, conversationId });
    if (conversation) {
      await this.releaseReplacedSlotLock(conversation.pendingBooking, pendingBooking);
      await this.repos.saveConversation({ ...conversation, pendingBooking, updatedAt: this.now() });
    }
  }

  private async clearPendingBooking(clinicId: string, conversationId: string) {
    const conversation = await this.repos.getConversation({ clinicId, conversationId });
    if (conversation) {
      await this.releasePendingSlotLock(conversation.pendingBooking);
      const { pendingBooking: _pendingBooking, ...nextConversation } = conversation;
      await this.repos.saveConversation({ ...nextConversation, updatedAt: this.now() });
    }
  }

  private async tryAnswerPendingBookingQuestion(
    input: InboundMessage,
    conversation: Conversation,
    intent: ConversationUnderstanding
  ): Promise<WorkflowResult | undefined> {
    if (!conversation.pendingBooking || intent.intent !== "question") {
      return undefined;
    }

    const enrichedIntent = inferPendingQuestionTopics(input.text, intent);
    if (!hasRequestedFaqTopic(enrichedIntent)) {
      return undefined;
    }
    const profile = await this.repos.getClinicProfile(input.clinicId);
    const service = profile?.services.find((candidate) => candidate.id === conversation.pendingBooking?.serviceId);
    const professional = profile?.professionals.find(
      (candidate) => candidate.id === conversation.pendingBooking?.professionalId
    );
    if (enrichedIntent.requestedTopics.includes("professional")) {
      return {
        kind: "reply",
        text: professional
          ? `Seria con ${professional.name}.`
          : "No pude identificar el profesional del horario ofrecido. Te derivo con recepcion si queres confirmarlo."
      };
    }
    const response = buildFaqResponse(profile, {
      ...enrichedIntent,
      serviceName: enrichedIntent.serviceName ?? service?.name
    });

    return {
      kind: "reply",
      text: response ?? missingConfiguredFaqResponse
    };
  }

  private async tryCompletePendingPatientData(
    input: InboundMessage,
    conversation: Conversation,
    intent: ConversationUnderstanding
  ) {
    if (!conversation.pendingBooking || conversation.pendingBooking.appointmentId) {
      return undefined;
    }

    if (!(await this.missingRequiredPatientFields(input.clinicId, input.patientId)).includes("fullName")) {
      return undefined;
    }

    const fullName = extractPendingPatientFullName(input.text, intent);
    if (!fullName) {
      return undefined;
    }

    const patient = await this.repos.getPatient(input.patientId);
    await this.repos.upsertPatient({
      id: input.patientId,
      whatsappNumber: input.whatsappNumber,
      fullName: fullName ?? patient?.fullName
    });

    return await this.handleConfirmation(input, conversation);
  }

  private async missingRequiredPatientFields(clinicId: string, patientId: string) {
    const profile = await this.repos.getClinicProfile(clinicId);
    const patient = await this.repos.getPatient(patientId);
    if (!profile) {
      return [];
    }

    return profile.requiredPatientFields.filter((field) => field === "fullName" && !patient?.fullName);
  }

  private async handleCancelIntent(input: InboundMessage): Promise<WorkflowResult> {
    const appointment = await this.findSingleScheduledAppointment(input);
    if (!appointment) {
      return {
        kind: "reply",
        text: "No encontre un unico turno activo para cancelar. Pasame dia y horario y lo reviso."
      };
    }

    try {
      const cancelled = await this.scheduling.cancelAppointment({
        clinicId: input.clinicId,
        appointmentId: appointment.id,
        conversationId: input.conversationId
      });

      return { kind: "reply", text: `Turno cancelado: ${await this.formatDateForClinic(input.clinicId, cancelled.startsAt)}.` };
    } catch (error) {
      if (error instanceof CalendarInfrastructureError) {
        throw error;
      }
      return { kind: "reply", text: "No pude cancelar ese turno automaticamente. Te derivo con recepcion." };
    }
  }

  private async handleRescheduleIntent(input: InboundMessage): Promise<WorkflowResult> {
    const appointment = await this.findSingleScheduledAppointment(input);
    if (!appointment) {
      return {
        kind: "reply",
        text: "No encontre un unico turno activo para reprogramar. Pasame dia y horario y lo reviso."
      };
    }

    const profile = await this.repos.getClinicProfile(input.clinicId);
    const service = profile?.services.find((candidate) => candidate.id === appointment.serviceId);
    if (!profile || !service) {
      return { kind: "reply", text: "No pude encontrar el servicio del turno. Te derivo con recepcion." };
    }

    const searchFrom = startOfDay(this.now());
    const slots = await this.scheduling.findSlots({
      clinicId: input.clinicId,
      serviceId: service.id,
      professionalId: appointment.professionalId,
      from: searchFrom,
      to: addDays(searchFrom, 14),
      conversationId: input.conversationId
    });
    const nextSlot = slots.find((slot) => slot.startsAt.getTime() !== appointment.startsAt.getTime());
    if (!nextSlot) {
      return { kind: "reply", text: "No encontre otro horario disponible para reprogramar. Te aviso si se libera uno." };
    }

    const lockedSlot = await this.claimFirstAvailableSlot({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      profile,
      service,
      slots: slots.filter((slot) => slot.startsAt.getTime() !== appointment.startsAt.getTime())
    });
    if (!lockedSlot) {
      return { kind: "reply", text: "No encontre otro horario disponible para reprogramar. Te aviso si se libera uno." };
    }

    await this.setPendingBooking(input.clinicId, input.conversationId, {
      appointmentId: appointment.id,
      slotLockId: lockedSlot.lockId,
      slotLockExpiresAt: lockedSlot.lockExpiresAt,
      serviceId: appointment.serviceId,
      professionalId: appointment.professionalId,
      startsAt: lockedSlot.slot.startsAt,
      endsAt: lockedSlot.slot.endsAt
    });

    return {
      kind: "reply",
      text: `Tengo este nuevo horario: ${this.formatDateForPatient(lockedSlot.slot.startsAt, profile)}. Si te sirve, lo confirmamos.`
    };
  }

  private async claimFirstAvailableSlot(input: {
    clinicId: string;
    conversationId: string;
    profile: ClinicProfile;
    service: ClinicProfile["services"][number];
    slots: CalendarSlot[];
  }): Promise<LockedSlotClaim | undefined> {
    for (const slot of input.slots) {
      const professional = input.profile.professionals.find((candidate) => candidate.calendarId === slot.calendarId);
      if (!professional) {
        continue;
      }

      const now = this.now();
      const expiresAt = addMinutes(now, PENDING_SLOT_LOCK_MINUTES);
      const lock = await this.repos.claimSlotLock({
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        serviceId: input.service.id,
        professionalId: professional.id,
        calendarId: professional.calendarId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        expiresAt,
        now
      });
      if (lock) {
        return { slot, professional, lockId: lock.id, lockExpiresAt: lock.expiresAt };
      }
    }

    return undefined;
  }

  private async releaseReplacedSlotLock(previous: PendingBooking | undefined, next: PendingBooking) {
    if (previous?.slotLockId && previous.slotLockId !== next.slotLockId) {
      await this.releasePendingSlotLock(previous);
    }
  }

  private async releasePendingSlotLock(pendingBooking: PendingBooking | undefined) {
    if (pendingBooking?.slotLockId) {
      await this.repos.releaseSlotLock({ lockId: pendingBooking.slotLockId, now: this.now() });
    }
  }

  private async findSingleScheduledAppointment(input: InboundMessage): Promise<Appointment | undefined> {
    const scheduled = (await this.repos.listAppointmentsByPatient(input.patientId)).filter(
      (appointment) => appointment.clinicId === input.clinicId && appointment.status === "scheduled"
    );
    return scheduled.length === 1 ? scheduled[0] : undefined;
  }

  private formatDateForPatient(date: Date, profile: ClinicProfile | undefined) {
    return formatPatientDateTime(date, profile?.timezone);
  }

  private async formatDateForClinic(clinicId: string, date: Date) {
    const profile = await this.repos.getClinicProfile(clinicId);
    return this.formatDateForPatient(date, profile);
  }
}

function looksLikeFullName(text: string) {
  return Boolean(normalizeFullNameIfComplete(text));
}

function extractPendingPatientFullName(text: string, intent: ConversationUnderstanding) {
  if (intent.requiresHuman || hasMedicalSafetyLanguage(text) || hasOperationalActionLanguage(text)) {
    return undefined;
  }

  if (intent.provider === "fallback") {
    return undefined;
  }

  if (intent.provider === "openai") {
    if (intent.confidence < SIDE_EFFECT_CONFIDENCE_THRESHOLD) {
      return undefined;
    }
    return normalizeFullNameIfComplete(intent.patientFullName ?? "");
  }

  if (intent.intent === "question") {
    return extractLikelyPatientFullName(text);
  }

  return undefined;
}

function buildBookingFaqPrefix(profile: Parameters<typeof buildFaqResponse>[0], intent: ConversationUnderstanding) {
  if (!hasRequestedFaqTopic(intent)) {
    return "";
  }

  return `${buildFaqResponse(profile, intent) ?? missingConfiguredFaqResponse} `;
}

function isMissingServiceForServiceFact(intent: ConversationUnderstanding) {
  if (intent.serviceName) {
    return false;
  }

  return intent.requestedTopics.some(
    (topic) => topic === "price" || topic === "duration" || topic === "preparation" || topic === "restrictions"
  );
}

function hasOperationalActionLanguage(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("turno") ||
    normalized.includes("reserv") ||
    normalized.includes("agend") ||
    normalized.includes("cancel") ||
    normalized.includes("anular") ||
    normalized.includes("reprogram") ||
    normalized.includes("cambiar") ||
    normalized.includes("confirm")
  );
}

function inferPendingQuestionTopics(text: string, intent: ConversationUnderstanding): ConversationUnderstanding {
  const normalized = normalizeText(text);
  const inferredTopics = new Set<RequestedTopic>(intent.requestedTopics);

  if (
    normalized.includes("doctor") ||
    normalized.includes("doctora") ||
    normalized.includes("medico") ||
    normalized.includes("profesional") ||
    normalized.includes("quien")
  ) {
    inferredTopics.add("professional");
  }
  if (containsAny(normalized, ["precio", "sale", "vale", "cuesta", "costo", "valor", "cuanto"])) {
    inferredTopics.add("price");
  }
  if (containsAny(normalized, ["prepar", "antes", "cuidados previos"])) {
    inferredTopics.add("preparation");
  }
  if (containsAny(normalized, ["dura", "duracion", "tiempo tarda", "cuanto tarda"])) {
    inferredTopics.add("duration");
  }
  if (containsAny(normalized, ["restric", "contraindic"])) {
    inferredTopics.add("restrictions");
  }

  return { ...intent, requestedTopics: [...inferredTopics] };
}

function containsAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function trimRecentMessages(messages: ConversationMessage[]) {
  return messages.slice(-MAX_RECENT_MESSAGES);
}

function trimConversationText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 2000);
}

function receptionistUnderstanding(
  turn: ReceptionistTurn,
  intent: ConversationUnderstanding["intent"],
  messageText: string,
  now: Date,
  timezone?: string
): ConversationUnderstanding {
  const normalizedTimePreference =
    detectNormalizedTimePreference(turn.timePreference ?? messageText, now, timezone) ?? turn.normalizedTimePreference;

  return {
    provider: "openai",
    intent,
    confidence: turn.confidence,
    serviceName: turn.serviceName ?? undefined,
    professionalPreference: turn.professionalPreference ?? undefined,
    timePreference: turn.timePreference ?? undefined,
    normalizedTimePreference,
    requestedTopics: turn.requestedTopics,
    patientFullName: turn.patientFullName ?? undefined,
    requiresHuman: turn.needsHuman,
    safetyReason: turn.safetyReason ?? undefined,
    reason: turn.reason
  };
}

function buildReceptionistPolicyFallback(state: ConversationState) {
  if (state.stage === "offering_slot") {
    return "Te mantengo el horario ofrecido. Si queres, te lo confirmo o buscamos otro.";
  }
  if (state.stage === "rescheduling") {
    return "Te mantengo el nuevo horario ofrecido. Si queres, te lo confirmo o buscamos otra opcion.";
  }
  if (state.stage === "booked") {
    return "Te ayudo desde recepcion. Puedo ayudarte a cambiar o cancelar tu turno, o resolver dudas de la clinica.";
  }
  return "Te ayudo desde recepcion. Decime que necesitas de la clinica y lo vemos.";
}

function safeReceptionistReplyText(turn: ReceptionistTurn, state: ConversationState) {
  if (hasCalendarMutationClaim(turn.replyDraft)) {
    return buildReceptionistPolicyFallback(state);
  }
  return turn.replyDraft;
}

function hasCalendarMutationClaim(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("turno confirmado") ||
    normalized.includes("turno cancelado") ||
    normalized.includes("turno reprogramado") ||
    normalized.includes("cita confirmada") ||
    normalized.includes("cita cancelada") ||
    normalized.includes("cita reprogramada")
  );
}

function buildContextualFallback(state: ConversationState) {
  if (state.stage === "offering_slot" && state.missingPatientFields.includes("fullName")) {
    return "Para confirmar el turno necesito nombre y apellido. Tambien puedo responderte dudas antes de confirmarlo.";
  }
  if (state.stage === "offering_slot") {
    return "Te mantengo el horario ofrecido. Podes confirmarlo, pedirme otro horario o preguntarme algo del tratamiento.";
  }
  if (state.stage === "rescheduling") {
    return "Te mantengo el nuevo horario ofrecido. Podes confirmarlo o pedirme otra opcion.";
  }
  if (state.stage === "booked") {
    return "Tenes un turno activo. Puedo ayudarte a cambiarlo, cancelarlo o responder dudas del tratamiento.";
  }
  return "Te ayudo con informacion y turnos. Decime que tratamiento te interesa o si queres reservar, cancelar o cambiar un turno.";
}
