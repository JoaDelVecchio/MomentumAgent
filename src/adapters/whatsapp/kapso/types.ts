import { z } from "zod";

export const KapsoSendMessageResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1)
});

export type KapsoSendMessageResponse = z.infer<typeof KapsoSendMessageResponseSchema>;
