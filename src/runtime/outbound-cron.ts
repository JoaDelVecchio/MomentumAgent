export type OutboundCronResult = {
  statusCode: number;
  body: unknown;
};

export type OutboundCronRuntime = {
  app: {
    inject: (input: OutboundCronRequest) => Promise<OutboundCronResponse>;
  };
};

export type OutboundCronRequest = {
  method: "POST";
  url: "/internal/outbound/run";
  headers: { authorization: string };
  payload: { clinicId: string };
};

export type OutboundCronResponse = {
  statusCode: number;
  json: () => unknown;
};

export type OutboundCronInput = {
  authorization: string | undefined;
  env: NodeJS.ProcessEnv;
  runtimeFactory: () => Promise<OutboundCronRuntime>;
};

export async function runOutboundCron(input: OutboundCronInput): Promise<OutboundCronResult> {
  if (!input.env.CRON_SECRET || input.authorization !== `Bearer ${input.env.CRON_SECRET}`) {
    return { statusCode: 401, body: { error: "unauthorized" } };
  }

  const outboundToken = input.env.OUTBOUND_AUTOMATION_TOKEN?.trim();
  const clinicId = input.env.MOMENTUM_CRON_CLINIC_ID?.trim();
  if (!outboundToken || !clinicId) {
    return { statusCode: 500, body: { error: "outbound_cron_not_configured" } };
  }

  const runtime = await input.runtimeFactory();
  const response = await runtime.app.inject({
    method: "POST",
    url: "/internal/outbound/run",
    headers: { authorization: `Bearer ${outboundToken}` },
    payload: { clinicId }
  });

  return { statusCode: response.statusCode, body: response.json() as unknown };
}
