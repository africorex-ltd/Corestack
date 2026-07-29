import {
  createEvent,
  err,
  ok,
  ValidationError,
  type Clock,
  type IdGenerator,
  type Result,
} from "@corestack/kernel";
import type { OrgScopedContext } from "@corestack/platform";
import type { PostgresUnitOfWork } from "@corestack/platform/postgres";

import {
  validateCreateContactInput,
  type Contact,
  type CreateContactInput,
} from "../domain/contact.js";
import type { ContactRepository } from "./contact-repository.js";

export const CONTACT_CREATED_EVENT = "acmecrm.contact.created";

export interface CreateContactDeps {
  /**
   * A `PostgresUnitOfWork`, not the generic kernel `UnitOfWork` — this use
   * case's repository call needs `ctx.sql` (step 2 of the contributor
   * guide), which only `PostgresTransactionContext` exposes.
   */
  readonly uow: PostgresUnitOfWork;
  readonly repository: ContactRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Steps 1 (context already resolved by the caller), 2 (UnitOfWork), 4
 * (org-scoped repository), and 5 (event publishing) of
 * docs/security/how-to-build-a-tenant-safe-feature.md, in one place.
 */
export async function createContact(
  context: OrgScopedContext,
  input: CreateContactInput,
  deps: CreateContactDeps,
): Promise<Result<Contact, ValidationError>> {
  const issues = validateCreateContactInput(input);
  if (issues.length > 0) {
    return err(new ValidationError("invalid contact input", { metadata: { issues } }));
  }

  const contact = await deps.uow.run(async (ctx) => {
    const id = deps.ids.generate();
    const created = await deps.repository.create(ctx.sql, context, input, id);

    ctx.publish(
      createEvent(
        { name: CONTACT_CREATED_EVENT, version: 1, payload: { contactId: created.id } },
        context,
        { clock: deps.clock, ids: deps.ids },
      ),
    );

    return created;
  });

  return ok(contact);
}
