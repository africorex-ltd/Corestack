import { pgSchema } from "drizzle-orm/pg-core";

/**
 * The `tenancy` Postgres schema (DATABASE.md §1 rule 1: "one Postgres
 * schema per module"). Reserved by `migrations/tenancy/0001_create-
 * schema.sql` (E05-T01); every table this module defines lives inside it.
 */
export const tenancySchema = pgSchema("tenancy");
