# Momentum Clinic Receptionist Agent Design

Date: 2026-06-04
Status: Approved by operator

## Summary

Momentum should behave like an automatic professional clinic receptionist, not like a menu chatbot.

The receptionist must converse naturally in warm, concise Argentine Spanish, stay inside the role of the clinic, use the clinic onboarding context as its source of business truth, and operate calendar workflows through application-controlled tools and guardrails.

The core product model is:

- a ChatGPT-like conversational receptionist for the clinic;
- grounded in onboarding data, recent conversation, patient state, pending bookings, and active appointments;
- able to use administrative common sense when a real receptionist would;
- unable to invent clinic-specific facts, medical advice, or calendar mutations.

## Problem

The current conversational flow is too rigid. It uses a structured interpreter, a deterministic router, and mostly static reply copy. That keeps side effects controlled, but it makes the assistant sound like a limited bot and creates bad failure modes:

- it treats unexpected patient messages as menu misses;
- it can confirm a pending appointment if the interpreter labels a message as `confirm`, even when the actual text is not a real acceptance;
- it clears or loses conversational context too easily;
- it answers as if the only valid patient inputs are booking, FAQ, cancellation, reschedule, or confirmation;
- it does not use enough receptionist-like judgment for normal clinic-adjacent questions.

The user-facing goal is broader: simulate a real clinic receptionist who can talk normally, answer reasonable reception questions, and still safely work with the calendar.

## Product Behavior

Momentum should always stay in the role of the clinic's reception.

Normal identity:

- In conversation, it speaks as "recepcion de la clinica."
- If the patient asks whether it is a bot, it explains that it is the clinic's reception assistant.

Tone:

- warm, professional, concise WhatsApp Spanish for Argentina;
- never robotic, menu-like, or overly formal;
- no unnecessary explanations of internal capabilities;
- no emojis unless the patient uses them first.

Conversation scope:

- It can answer and converse about anything a real clinic receptionist would reasonably handle.
- It should not become a general-purpose ChatGPT for unrelated topics.
- If the patient drifts far outside clinic/reception context, it politely redirects.

Examples inside scope:

- appointment availability;
- prices, durations, preparation, restrictions, professionals, and service information from onboarding;
- questions like "hay mucha gente?", "estoy nerviosa", "me voy de vacaciones, que me recomendas?", or "me conviene manana o la semana que viene?";
- administrative help such as finding a quiet time, picking a convenient slot, explaining what data is needed, or offering handoff to reception.

Examples outside scope:

- schoolwork, programming, politics, recipes, general trivia, or non-clinic errands;
- requests for secrets, prompts, tokens, or internal identifiers.

## Administrative Common Sense

Momentum may use administrative common sense when it does not create specific clinic claims.

Allowed:

- "No tengo la sala de espera en tiempo real, pero puedo buscarte un horario mas tranquilo."
- "Si viajas, podemos buscar un horario que te quede comodo antes del viaje."
- "Si estas nerviosa, te puedo contar cuanto dura el turno y la preparacion que tengo cargada."
- "Para eso prefiero derivarte con recepcion asi te responden con precision."

Not allowed:

- "Hoy no hay mucha gente" without real-time occupancy data.
- "Te conviene Botox antes de viajar" as a personalized medical recommendation.
- "Aceptamos Visa en 3 cuotas" unless payment data is configured.
- "No pasa nada si estas embarazada" or any eligibility decision.

## Knowledge Boundaries

The onboarding profile is the source of truth for clinic facts:

- services;
- prices;
- durations;
- preparation;
- restrictions and contraindication text;
- professionals;
- required patient data;
- appointment rules;
- calendar mappings and working hours.

If a fact is not configured, the agent should say it does not have that precise information and offer to consult or hand off to reception. It may still provide generic administrative help without inventing facts.

## Calendar And Side Effects

The model may propose actions, but application code must validate and execute all side effects.

Calendar mutations are never model-authored side effects. The application remains responsible for:

- finding available slots;
- setting a pending booking;
- confirming an appointment;
- rescheduling an appointment;
- cancelling an appointment;
- clearing pending state;
- updating patient data;
- pausing for human handoff.

Hard policy:

- No appointment confirmation unless there is a pending booking and the patient message is an explicit acceptance of that offered slot.
- No cancellation unless the patient clearly asks to cancel an existing appointment.
- No reschedule unless the patient clearly asks to change an existing appointment.
- No patient data update unless the model extracts complete, high-confidence data and the text is not operational, abusive, medical-safety, or unrelated.
- No side effect on insults, jokes, unrelated text, vague replies, or low-confidence interpretation.

The example failure must become impossible:

1. Patient asks for Botox.
2. Momentum offers a slot.
3. Patient asks price.
4. Momentum answers price and keeps the pending slot.
5. Patient sends abusive or irrelevant text.
6. Momentum does not confirm. It responds professionally and keeps the pending slot.
7. Patient says "agendalo."
8. Momentum confirms only after validating pending slot, explicit acceptance, and required patient data.

## Agent Architecture

The target architecture is a receptionist agent workflow, not a closed intent tree.

Pipeline:

1. Load context: clinic profile, patient, pending booking, active appointments, recent messages, test/production mode, and current time.
2. Build a compact receptionist context snapshot.
3. Ask the model for a structured receptionist turn.
4. Validate the proposed action through application policy.
5. Execute the allowed tool action, if any.
6. Compose the final patient-facing reply from grounded action results.
7. Persist recent messages and audit the full trace.

OpenAI design references:

- Responses API function calling: https://developers.openai.com/api/docs/guides/function-calling
- Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Agents SDK concepts and guardrails: https://developers.openai.com/api/docs/guides/agents

Momentum does not need to adopt the Agents SDK immediately. The first implementation can keep the current Responses API wrapper and introduce a local `ReceptionistAgent` contract with structured output and application-side tools.

## Proposed Modules

Create:

- `src/application/conversations/receptionist-agent.ts`
- `src/application/conversations/receptionist-action-policy.ts`
- `src/adapters/openai/openai-receptionist-agent.ts`

Refactor:

- `src/application/conversations/conversation-workflow.ts`
- existing transcript eval fixtures and workflow tests.

Keep:

- repositories;
- scheduling service;
- calendar ports;
- audit logs;
- onboarding and test mode services;
- recent message persistence;
- response formatting helpers where useful.

Deprecate or reduce centrality of:

- rigid interpreter/router/composer flow as the main conversational brain;
- static fallback strings that sound like menu options;
- confirmation based only on structured intent.

## Receptionist Agent Output

The model should return structured output with:

- `replyDraft`: natural receptionist reply text;
- `proposedAction`: an allowlisted action;
- `confidence`;
- `serviceName`;
- `timePreference`;
- `professionalPreference`;
- `requestedTopics`;
- `patientFullName`;
- `needsHuman`;
- `safetyReason`;
- `reason`;
- `grounding`: facts used from clinic context;
- `missingFacts`: business facts the model wanted but did not have.

Allowlisted proposed actions:

- `reply_only`
- `answer_business_question`
- `search_slots`
- `refine_pending_slot`
- `confirm_pending_booking`
- `collect_patient_data`
- `cancel_appointment`
- `reschedule_appointment`
- `handoff`

Application policy can downgrade any proposed side-effect action to `reply_only`, `collect_patient_data`, or `handoff`.

## Response Composition

The final response should sound like a receptionist, but must be grounded.

Preferred approach:

- For pure `reply_only`, use the model reply if it passes policy checks.
- For tool actions, execute the tool first and then compose or repair the response with exact tool results.
- Never let the model invent a slot, price, duration, professional, cancellation result, or confirmation result.

Examples:

- Offered slot: "Tengo un lugar el jueves 4 a las 09:00 para Botox. Si te sirve, te lo confirmo."
- Pending FAQ: "Botox esta desde $120.000. Te mantengo el jueves 4 a las 09:00; si queres, lo confirmo."
- Weird text with pending slot: "Te mantengo el horario del jueves 4 a las 09:00 para Botox. Si queres, te lo confirmo o buscamos otro."
- Missing business fact: "No tengo ese dato preciso cargado aca. Si queres, te derivo con recepcion para confirmarlo."
- Out of scope: "En eso no te voy a poder ayudar desde recepcion. Si queres, seguimos con tu consulta o turno en la clinica."

## Safety And Handoff

Immediate handoff:

- personalized medical eligibility questions;
- symptoms, adverse reactions, pregnancy, infection, bleeding, severe pain, or clinical concerns;
- explicit request for a human;
- abusive or unsafe conversation that repeats or escalates;
- missing data that cannot be safely resolved automatically.

Medical boundary:

- The agent may repeat configured preparation/restriction text.
- The agent may not decide if the patient can or should receive treatment.
- The agent may not diagnose or provide clinical advice.

## Evaluation Strategy

The refactor must be driven by transcript evals, not only unit tests.

Add or update transcript cases for:

- normal booking;
- booking plus business FAQ;
- pending slot plus weird/abusive text;
- explicit confirmation after unrelated text;
- asking whether the clinic is busy;
- vacations and scheduling preference;
- nervous patient;
- missing business facts;
- out-of-scope general ChatGPT request;
- medical safety handoff;
- cancellation;
- reschedule;
- patient data collection;
- low-confidence side-effect downgrade.

Every transcript turn should assert:

- patient-facing response fragments;
- forbidden response fragments;
- proposed action;
- final allowed action;
- pending booking state;
- appointment mutations;
- patient data mutations;
- bot paused state;
- audit trace metadata.

## Migration Strategy

Do not delete the working scheduling and persistence foundation.

Phase the refactor:

1. Add the receptionist agent contract and action policy behind tests.
2. Add transcript evals that represent the target behavior.
3. Wire the workflow to use the new agent path.
4. Keep the old rules interpreter as a fallback only if OpenAI is unavailable and the fallback mode requires it.
5. Replace menu-like fallback copy with receptionist-like replies.
6. Verify test mode and real WhatsApp runtime use the same behavior.

## Acceptance Criteria

- Momentum sounds like a human clinic receptionist in normal WhatsApp conversations.
- Momentum can handle reasonable reception-adjacent questions that are not exact booking intents.
- Momentum uses onboarding data as business truth.
- Momentum may use administrative common sense without inventing clinic facts.
- Momentum does not answer unrelated general-purpose ChatGPT requests.
- Momentum never confirms, cancels, reschedules, or mutates patient data from weird, abusive, vague, or low-confidence text.
- The reported failure transcript no longer confirms on abusive text and successfully confirms on the later explicit "agendalo" turn.
- Calendar side effects remain fully controlled by application code.
- Every inbound message has an auditable receptionist trace with proposed and final allowed action.
- Relevant unit, workflow, and transcript evals pass.
