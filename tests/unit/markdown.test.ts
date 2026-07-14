import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "../../src/lib/markdown";

describe("safe Markdown rendering", () => {
  it("removes active and remote content while retaining safe prose", async () => {
    const maliciousFixture = await readFile(
      resolve("tests/fixtures/markdown/malicious.md"),
      "utf8"
    );
    const result = await renderSafeMarkdown(maliciousFixture);
    expect(result.html).toContain("安全段落");
    expect(result.html).not.toMatch(/script|iframe|onerror|javascript:|data:|<svg|<form/i);
    expect(result.html).not.toContain("https://remote.example/image.png");
    expect(result.html).toContain('rel="noopener noreferrer"');
  });

  it("creates stable unique heading IDs and a matching toc", async () => {
    const result = await renderSafeMarkdown("# 标题\n## 重复\n## 重复");
    expect(result.toc.map((item) => item.id)).toEqual(["标题", "重复", "重复-1"]);
    expect(result.html).toContain('<h2 id="重复-1">重复</h2>');
  });
});
