export type { Contact, CreateContactInput, ContactValidationIssue } from "./domain/contact.js";
export { validateCreateContactInput } from "./domain/contact.js";

export type { ContactRepository } from "./application/contact-repository.js";
export type { AcmeCrmConfig } from "./application/config.js";
export { acmeCrmConfigSpec } from "./application/config.js";
export type { CreateContactDeps } from "./application/create-contact.js";
export { CONTACT_CREATED_EVENT, createContact } from "./application/create-contact.js";
export type { AcmeCrmModuleDeps, AcmeCrmUseCases } from "./application/module.js";
export { createAcmeCrmModule } from "./application/module.js";

export { PostgresContactRepository } from "./infrastructure/postgres-contact-repository.js";
export {
  ACME_CRM_APP_ROLE,
  ACME_CRM_PLATFORM_ROLE,
  ensureAcmeCrmRoles,
} from "./infrastructure/ensure-acme-crm-roles.js";
