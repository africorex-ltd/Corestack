import { ConflictError } from "@corestack/kernel";

/**
 * The one specific conflict `createOrganization` (E05-T03) can produce:
 * an organization already exists with the requested slug.
 *
 * Extends the kernel's `ConflictError` (same `core/conflict` taxonomy
 * code — "the operation conflicts with current state") rather than
 * introducing a new top-level error class, but is named and exported
 * distinctly per this task's explicit instruction, so a caller can
 * `instanceof DuplicateSlugError` without inspecting `metadata`.
 */
export class DuplicateSlugError extends ConflictError {
  constructor(slug: string) {
    super(`an organization with slug "${slug}" already exists`, { metadata: { slug } });
  }
}
