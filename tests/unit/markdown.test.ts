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

  it("collects all six Markdown heading levels for the report directory", async () => {
    const result = await renderSafeMarkdown(
      "# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级\n###### 六级"
    );

    expect(result.toc.map((item) => item.depth)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.toc.map((item) => item.text)).toEqual([
      "一级",
      "二级",
      "三级",
      "四级",
      "五级",
      "六级"
    ]);
  });
});
