import { ValidationError } from "@corestack/kernel";

/**
 * Invitation role — E05-T05 Section 4. Deliberately excludes `OWNER`
 * (unlike `MembershipRole`, which has three members): an invitation can
 * only ever result in an `ADMIN` or `MEMBER` membership. Ownership is
 * conferred at organization creation (`CreateOrganization`, E05-T03) or
 * by a separate, future ownership-transfer workflow — never by accepting
 * an invitation.
 */
export const InvitationRole = {
  Admin: "ADMIN",
  Member: "MEMBER",
} as const;

export type InvitationRole = (typeof InvitationRole)[keyof typeof InvitationRole];

/**
 * Validates a raw, caller-supplied role string against the two legal
 * invitation roles. Takes a plain `string`, not an already-typed
 * `InvitationRole`, because the value this guards typically originates
 * from external input (a future `InviteMember` command's request body) —
 * unlike `Membership.create`, which takes an already-typed
 * `MembershipRole` because its only caller today is trusted, in-process
 * code (`CreateOrganization`, using the `Owner` constant directly).
 * Rejects `"OWNER"` explicitly (Section 4: "do not allow inviting an
 * OWNER through this aggregate") as well as any other unrecognized value.
 */
export function assertValidInvitationRole(value: string): InvitationRole {
  if (value === InvitationRole.Admin || value === InvitationRole.Member) {
    return value;
  }
  if (value === "OWNER") {
    throw new ValidationError(
      "cannot invite a member as OWNER — ownership is granted at organization creation or a future ownership-transfer workflow, never by invitation",
      { metadata: { value } },
    );
  }
  throw new ValidationError(`invalid invitation role "${value}" (expected ADMIN or MEMBER)`, {
    metadata: { value },
  });
}
