import { describe, expect, it } from "vitest";

import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrapOr,
  unwrapOrThrow,
  type Result,
} from "../src/index.js";

describe("Result", () => {
  it("ok wraps a value and narrows via isOk", () => {
    const result: Result<number, string> = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("err wraps an error and narrows via isErr", () => {
    const result: Result<number, string> = err("boom");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe("boom");
    }
  });

  it("map transforms success and passes errors through", () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
    const failure: Result<number, string> = err("boom");
    expect(map(failure, (n: number) => n * 10)).toEqual(err("boom"));
  });

  it("mapErr transforms errors and passes success through", () => {
    expect(mapErr(err("boom"), (e) => `wrapped:${e}`)).toEqual(err("wrapped:boom"));
    const success: Result<number, string> = ok(1);
    expect(mapErr(success, (e) => `wrapped:${e}`)).toEqual(ok(1));
  });

  it("andThen chains fallible operations and short-circuits on error", () => {
    const parse = (raw: string): Result<number, string> => {
      const n = Number(raw);
      return Number.isFinite(n) ? ok(n) : err("not a number");
    };
    const positive = (n: number): Result<number, string> => (n > 0 ? ok(n) : err("not positive"));

    expect(andThen(parse("5"), positive)).toEqual(ok(5));
    expect(andThen(parse("-5"), positive)).toEqual(err("not positive"));
    expect(andThen(parse("abc"), positive)).toEqual(err("not a number"));
  });

  it("unwrapOr returns the value or the fallback", () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
    expect(unwrapOr(err("boom") as Result<number, string>, 0)).toBe(0);
  });

  it("unwrapOrThrow returns the value, throws Error errors as-is, wraps others", () => {
    expect(unwrapOrThrow(ok("fine"))).toBe("fine");

    const cause = new Error("original");
    expect(() => unwrapOrThrow(err(cause))).toThrow(cause);
    expect(() => unwrapOrThrow(err("plain string"))).toThrow(TypeError);
  });
});
