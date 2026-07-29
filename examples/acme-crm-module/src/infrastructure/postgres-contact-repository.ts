import type { OrgScopedContext } from "@corestack/platform";
import { runOrgScopedQuery } from "@corestack/platform/postgres";
import type { Sql, TransactionSql } from "postgres";

import type { Contact, CreateContactInput } from "../domain/contact.js";
import type { ContactRepository } from "../application/contact-repository.js";

interface ContactRow {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  created_at: Date;
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

export class PostgresContactRepository implements ContactRepository {
  async create(
    tx: TransactionSql,
    context: OrgScopedContext,
    input: CreateContactInput,
    id: string,
  ): Promise<Contact> {
    const [row] = await tx<ContactRow[]>`
      INSERT INTO acme_crm.contacts (id, organization_id, name, email)
      VALUES (${id}::uuid, ${context.organizationId}::uuid, ${input.name}, ${input.email})
      RETURNING id, organization_id, name, email, created_at
    `;
    if (row === undefined) throw new Error("insert returned no row");
    return toContact(row);
  }

  async list(sql: Sql, context: OrgScopedContext): Promise<readonly Contact[]> {
    return runOrgScopedQuery(sql, context, async (tx) => {
      const rows = await tx<
        ContactRow[]
      >`SELECT id, organization_id, name, email, created_at FROM acme_crm.contacts ORDER BY created_at`;
      return rows.map(toContact);
    });
  }
}
