import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  allocateLoopbackPort,
  parseE2EPort,
} from "../../scripts/run-e2e";

describe("E2E port allocation", () => {
  it("parses the configured port and preserves the developer default", () => {
    expect(parseE2EPort(undefined)).toBe(4321);
    expect(parseE2EPort("49152")).toBe(49152);

    for (const value of ["0", "65536", "12.5", "abc", " 4321"]) {
      expect(() => parseE2EPort(value)).toThrow(
        "REPORT_SITE_E2E_PORT_INVALID",
      );
    }
  });

  it("allocates a different usable loopback port while another port is held", async () => {
    const held = createServer();
    await new Promise<void>((resolve, reject) => {
      held.once("error", reject);
      held.listen(0, "127.0.0.1", resolve);
    });
    const address = held.address();
    if (!address || typeof address === "string") {
      throw new Error("TEST_LISTENER_INVALID");
    }

    try {
      const allocated = await allocateLoopbackPort();
      expect(allocated).not.toBe(address.port);
      expect(allocated).toBeGreaterThan(0);
      expect(allocated).toBeLessThanOrEqual(65535);
    } finally {
      await new Promise<void>((resolve, reject) =>
        held.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
