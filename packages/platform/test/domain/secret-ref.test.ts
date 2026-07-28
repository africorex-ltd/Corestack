import { describe, expect, it } from "vitest";

import { isSecretRefValue, stripSecretRefPrefix } from "../../src/domain/secret-ref.js";

describe("secret-ref syntax", () => {
  it("recognizes ref: prefixed values", () => {
    expect(isSecretRefValue("ref:vault:secret/data/auth#key")).toBe(true);
    expect(isSecretRefValue("plain-value")).toBe(false);
    expect(isSecretRefValue("")).toBe(false);
  });

  it("strips the prefix to expose the opaque locator", () => {
    expect(stripSecretRefPrefix("ref:vault:secret/data/auth#key")).toBe(
      "vault:secret/data/auth#key",
    );
  });
});
