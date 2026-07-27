import { describe, expect, it } from "vitest";

import {
  all,
  andThenAsync,
  err,
  fromPromise,
  mapAsync,
  ok,
  RateLimitedError,
  PayloadTooLargeError,
  PreconditionFailedError,
  CryptoFailureError,
  type Result,
} from "../src/index.js";

describe("Result utilities (E02-T12)", () => {
  it("all combines Oks in order and short-circuits on the first Err", () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));

    const failure: Result<number, string>[] = [ok(1), err("first"), err("second")];
    expect(all(failure)).toEqual(err("first"));
    expect(all([])).toEqual(ok([]));
  });

  it("fromPromise maps resolution to Ok and rejection through mapError", async () => {
    expect(await fromPromise(Promise.resolve(7), () => "unreachable")).toEqual(ok(7));

    const mapped = await fromPromise(
      Promise.reject(new Error("io down")),
      (cause) => `wrapped: ${(cause as Error).message}`,
    );
    expect(mapped).toEqual(err("wrapped: io down"));
  });

  it("mapAsync and andThenAsync mirror their sync counterparts", async () => {
    expect(await mapAsync(ok(2), async (n) => n * 10)).toEqual(ok(20));
    expect(await mapAsync(err("e") as Result<number, string>, async (n) => n * 10)).toEqual(
      err("e"),
    );

    const parse = async (raw: string): Promise<Result<number, string>> =>
      Number.isFinite(Number(raw)) ? ok(Number(raw)) : err("nan");
    expect(await andThenAsync(ok("5"), parse)).toEqual(ok(5));
    expect(await andThenAsync(ok("x"), parse)).toEqual(err("nan"));
    expect(await andThenAsync(err("early") as Result<string, string>, parse)).toEqual(err("early"));
  });
});

describe("error taxonomy completion (E02-T11)", () => {
  it("new error classes carry their stable codes", () => {
    expect(new RateLimitedError("slow down").code).toBe("core/rate_limited");
    expect(new PayloadTooLargeError("too big").code).toBe("core/payload_too_large");
    expect(new PreconditionFailedError("step up").code).toBe("core/precondition_failed");
    expect(new CryptoFailureError("no detail").code).toBe("core/crypto_failure");
  });
});
