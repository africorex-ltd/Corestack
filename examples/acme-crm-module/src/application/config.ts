import { z } from "zod";
import type { ModuleConfigSpec } from "@corestack/platform";

export interface AcmeCrmConfig {
  readonly welcomeMessage: string;
}

export const acmeCrmConfigSpec: ModuleConfigSpec<AcmeCrmConfig> = {
  moduleName: "acme-crm",
  schema: z.object({
    welcomeMessage: z.string().min(1),
  }),
  envMapping: {
    welcomeMessage: "ACME_CRM_WELCOME_MESSAGE",
  },
};
