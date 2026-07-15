import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";


describe("empty public archive", () => {
  it("explains that no public reports have been published", async () => {
    const source = await readFile("src/pages/index.astro", "utf8");
    expect(source).toContain("目前还没有公开报告");
  });
});
