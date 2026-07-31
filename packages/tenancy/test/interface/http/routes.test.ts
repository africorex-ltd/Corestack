import { describe, expect, it } from "vitest";

import { tenancyRoutes } from "../../../src/interface/http/routes.js";

/**
 * Verifies `tenancyRoutes` (Section 2's "route definitions" deliverable)
 * matches the founder directive's Section 3 route list exactly — method,
 * path, and that a handler function is present. This package does not
 * implement a matcher itself (Section 14), so there is nothing else to
 * test about the route table beyond its own declared shape.
 */
describe("tenancyRoutes", () => {
  it("declares exactly the six routes from Section 3, in order", () => {
    expect(tenancyRoutes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "POST /organizations",
      "POST /organizations/:id/invitations",
      "POST /invitations/:id/accept",
      "GET /organizations/:id",
      "GET /organizations/:id/members",
      "GET /organizations/:id/invitations",
    ]);
  });

  it("every route has a handler function", () => {
    for (const route of tenancyRoutes) {
      expect(typeof route.handler).toBe("function");
    }
  });
});
