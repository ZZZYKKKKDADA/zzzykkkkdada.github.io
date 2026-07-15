import { describe, expect, it } from "vitest";
import { scanPublicBytes } from "../../src/lib/public-content-scan";

describe("public content scanner", () => {
  it("reports only redacted identities for unsafe public bytes", () => {
    const result = scanPublicBytes(
      "reports/x/summary.json",
      Buffer.from('{"token":"sk-secret-value"}')
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ruleId: "credential_assignment",
      file: "reports/x/summary.json",
      line: 1
    });
    expect(result[0].matchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("sk-secret-value");
  });
});
