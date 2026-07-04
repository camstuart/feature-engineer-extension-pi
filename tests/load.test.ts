/**
 * Smoke test: verify the extension entry point can be imported and that
 * registering a default export factory produces a callable function.
 *
 * We can't import the full ExtensionAPI runtime in a unit test (it requires
 * pi's bootstrap), but we can verify the module's syntax and export shape.
 */

import { describe, expect, it } from "vitest";

describe("extension load smoke", () => {
  it("index.ts can be dynamically imported without throwing", async () => {
    // jiti is what pi uses to load extensions. We use a plain dynamic import
    // here which goes through node's ESM loader — the module is plain TS via
    // vitest's transform, so the import resolves.
    const mod = (await import("../.pi/extensions/feature-engineer/index")) as {
      default: (...args: unknown[]) => unknown;
    };
    expect(typeof mod.default).toBe("function");
  });

  it("exports a default function with arity 1 (the pi factory)", async () => {
    const mod = (await import("../.pi/extensions/feature-engineer/index")) as {
      default: (...args: unknown[]) => unknown;
    };
    expect(mod.default.length).toBe(1);
  });
});
