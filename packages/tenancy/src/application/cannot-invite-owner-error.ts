import { ValidationError } from "@corestack/kernel";

/**
 * `inviteMember` (E05-T06)'s dedicated rejection for `role: "OWNER"` —
 * checked and returned by the use case itself, *before* `Invitation.create`
 * is ever called (Section 5: "fail before aggregate creation"). The
 * aggregate's own `assertValidInvitationRole` (E05-T05) still rejects
 * `"OWNER"` too, with its own `ValidationError` — that stays as
 * defense-in-depth, not removed, but a caller going through this use case
 * should never actually reach it: this check runs first.
 *
 * Extends the kernel's `ValidationError` (same `core/validation` taxonomy
 * code — "malformed/disallowed input to this operation") rather than
 * introducing a new top-level error class, but named and exported
 * distinctly per this task's explicit instruction.
 */
export class CannotInviteOwnerError extends ValidationError {
  constructor() {
    super(
      "cannot invite a member as OWNER — ownership is granted at organization creation or a future ownership-transfer workflow, never by invitation",
      { metadata: { role: "OWNER" } },
    );
  }
}
