import { describe, expect, it } from "vitest";
import { ValidationError } from "@corestack/kernel";

import {
  assertValidModuleName,
  computeChecksum,
  parseMigrationFile,
  parseMigrationHeader,
  parseMigrationVersion,
} from "../../src/domain/migration-file.js";

const VALID_SOURCE = [
  "-- @description: Create organizations table",
  "-- @lock-impact: none",
  "",
  "CREATE TABLE tenancy.organizations (id uuid PRIMARY KEY);",
  "",
].join("\n");

describe("assertValidModuleName", () => {
  it("accepts lowercase identifiers", () => {
    expect(() => assertValidModuleName("tenancy")).not.toThrow();
  });

  it("accepts hyphenated third-party module names (Architecture §24 /x/{moduleKey})", () => {
    expect(() => assertValidModuleName("acme-crm")).not.toThrow();
    expect(() => assertValidModuleName("brand-new")).not.toThrow();
  });

  it.each(["Tenancy", "../etc", "te nancy", "", "123", "-tenancy", "tenancy-", "tenancy--crm"])(
    "rejects %s",
    (name) => {
      expect(() => assertValidModuleName(name)).toThrow(ValidationError);
    },
  );
});

describe("parseMigrationVersion", () => {
  it("extracts the numeric prefix", () => {
    expect(parseMigrationVersion("0001_create-organizations.sql")).toBe(1);
    expect(parseMigrationVersion("0042_add-index.sql")).toBe(42);
  });

  it.each(["create.sql", "1_create.sql", "0001-create.sql", "0001_Create.sql", "0001_create.txt"])(
    "rejects malformed filename %s",
    (filename) => {
      expect(() => parseMigrationVersion(filename)).toThrow(ValidationError);
    },
  );
});

describe("parseMigrationHeader", () => {
  it("parses required keys and separates the SQL body", () => {
    const { header, sql } = parseMigrationHeader("0001_x.sql", VALID_SOURCE);
    expect(header).toEqual({
      description: "Create organizations table",
      lockImpact: "none",
      concurrent: false,
    });
    expect(sql).toBe("CREATE TABLE tenancy.organizations (id uuid PRIMARY KEY);");
  });

  it("parses the optional @concurrent flag", () => {
    const source =
      "-- @description: d\n-- @lock-impact: brief\n-- @concurrent: true\nCREATE INDEX CONCURRENTLY x;";
    const { header } = parseMigrationHeader("0001_x.sql", source);
    expect(header.concurrent).toBe(true);
  });

  it("rejects a missing required key", () => {
    expect(() => parseMigrationHeader("0001_x.sql", "-- @description: d\nSELECT 1;")).toThrow(
      ValidationError,
    );
  });

  it("rejects an invalid @lock-impact value", () => {
    const source = "-- @description: d\n-- @lock-impact: catastrophic\nSELECT 1;";
    expect(() => parseMigrationHeader("0001_x.sql", source)).toThrow(ValidationError);
  });

  it("rejects an invalid @concurrent value", () => {
    const source = "-- @description: d\n-- @lock-impact: none\n-- @concurrent: yes\nSELECT 1;";
    expect(() => parseMigrationHeader("0001_x.sql", source)).toThrow(ValidationError);
  });

  it("rejects a duplicate header key", () => {
    const source = "-- @description: d\n-- @description: d2\n-- @lock-impact: none\nSELECT 1;";
    expect(() => parseMigrationHeader("0001_x.sql", source)).toThrow(ValidationError);
  });

  it("rejects an empty SQL body after the header", () => {
    expect(() =>
      parseMigrationHeader("0001_x.sql", "-- @description: d\n-- @lock-impact: none\n\n  \n"),
    ).toThrow(ValidationError);
  });

  it("the first non-header line ends the header even if it is blank", () => {
    // A blank line right after the header becomes part of (leading) body
    // whitespace, which is trimmed — documented, predictable behavior.
    const source = "-- @description: d\n-- @lock-impact: none\n\nSELECT 1;";
    const { sql } = parseMigrationHeader("0001_x.sql", source);
    expect(sql).toBe("SELECT 1;");
  });
});

describe("computeChecksum", () => {
  it("is deterministic for identical content", async () => {
    const a = await computeChecksum(VALID_SOURCE);
    const b = await computeChecksum(VALID_SOURCE);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the content changes by even one character", async () => {
    const a = await computeChecksum(VALID_SOURCE);
    const b = await computeChecksum(VALID_SOURCE + " ");
    expect(a).not.toBe(b);
  });

  it("changes when only the header changes (whole-file hash, not body-only)", async () => {
    const a = await computeChecksum(VALID_SOURCE);
    const edited = VALID_SOURCE.replace("none", "brief");
    const b = await computeChecksum(edited);
    expect(a).not.toBe(b);
  });
});

describe("parseMigrationFile", () => {
  it("assembles module, version, header, sql, and checksum", async () => {
    const file = await parseMigrationFile("tenancy", "0001_create-organizations.sql", VALID_SOURCE);
    expect(file.module).toBe("tenancy");
    expect(file.version).toBe(1);
    expect(file.filename).toBe("0001_create-organizations.sql");
    expect(file.header.lockImpact).toBe("none");
    expect(file.sql).toBe("CREATE TABLE tenancy.organizations (id uuid PRIMARY KEY);");
    expect(file.checksum).toBe(await computeChecksum(VALID_SOURCE));
  });

  it("rejects an invalid module name before parsing the file", async () => {
    await expect(parseMigrationFile("Bad-Name", "0001_x.sql", VALID_SOURCE)).rejects.toThrow(
      ValidationError,
    );
  });
});
