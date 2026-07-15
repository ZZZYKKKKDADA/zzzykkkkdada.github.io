import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  emergencyDownloadRoute,
  validDownloadRoute,
  validManifest,
  validReportRoute
} from "../helpers/fixtures";

test("directory searches by ticker and company and opens the timeline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "搜索股票" }).fill("002050");
  await expect(page.getByRole("link", { name: /三花智控/ })).toBeVisible();
  await page.getByRole("link", { name: /三花智控/ }).click();
  await expect(page).toHaveURL(/\/stocks\/002050-sz\/$/);
  await expect(page.getByText("版本时间线")).toBeVisible();
});

test("report page leads with history boundary and decision matrix", async ({ page }) => {
  await page.goto(validReportRoute);
  await expect(page.getByText("分析时点")).toBeVisible();
  await expect(page.getByRole("table", { name: "仓位与交易风格建议" })).toBeVisible();
  await expect(page.getByText("指标分析")).toBeVisible();
  await expect(page.getByText("仅供研究交流，不构成个性化投资建议")).toBeVisible();
});

test("renders explicit metric evidence gaps without placeholders", async ({ page }) => {
  await page.goto(validReportRoute);
  const valuation = page.getByRole("region", { name: "估值指标" });
  await expect(valuation.getByText("报告未提供足够的此类指标证据")).toBeVisible();
  await expect(valuation.locator("dt")).toHaveCount(0);
  await expect(page.getByText("示例值")).toHaveCount(0);
  await expect(page.getByText("报告证据不足，暂不形成建议")).toBeVisible();
  await expect(page.getByText("本页公开且可下载，noindex 不是访问控制。")).toBeVisible();
  await expect(page.getByText("合成测试数据，不代表真实市场信息。")).toHaveCount(0);
});

test("complete report expands, anchors, and restores focus", async ({ page }) => {
  await page.goto(validReportRoute);
  const button = page.locator('button[aria-controls^="complete-report-"]');
  await expect(button).toHaveText("展开完整报告");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("link", { name: "市场分析" }).click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveText("折叠完整报告");
  await expect(page.locator("#市场分析")).toBeFocused();
});

test("report directory shows three levels and reveals one deeper level at a time", async ({
  page
}) => {
  await page.goto(validReportRoute);
  const directory = page.getByRole("navigation", { name: "完整报告目录" });
  const levelFour = directory.getByRole("link", { name: "短期结构", includeHidden: true });
  const levelFive = directory.getByRole("link", { name: "风险条件", includeHidden: true });
  const levelSix = directory.getByRole("link", { name: "触发阈值", includeHidden: true });

  await expect(directory.getByRole("link", { name: "三花智控合成测试报告" })).toBeVisible();
  await expect(directory.getByRole("link", { name: "市场分析" })).toBeVisible();
  await expect(directory.getByRole("link", { name: "趋势判断" })).toBeVisible();
  await expect(levelFour).toHaveCount(1);
  await expect(levelFour).toBeHidden();
  await expect(levelFive).toBeHidden();
  await expect(levelSix).toBeHidden();

  const levelThreeToggle = directory.getByRole("button", {
    name: "展开“趋势判断”的下一级"
  });
  await expect(levelThreeToggle).toHaveAttribute("aria-expanded", "false");
  await levelThreeToggle.click();
  await expect(levelFour).toBeVisible();
  await expect(levelFive).toBeHidden();

  const levelFourToggle = directory.getByRole("button", {
    name: "展开“短期结构”的下一级"
  });
  await levelFourToggle.click();
  await expect(levelFive).toBeVisible();
  await expect(levelSix).toBeHidden();

  await directory.getByRole("button", { name: "展开“风险条件”的下一级" }).click();
  await expect(levelSix).toBeVisible();
  await levelSix.click();
  await expect(page.locator("#触发阈值")).toBeFocused();

  await directory.getByRole("button", { name: "收起“趋势判断”的下一级" }).click();
  await expect(levelFour).toBeHidden();
});

test("download is byte-identical Markdown with a safe media type", async ({ request }) => {
  const response = await request.get(validDownloadRoute);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/markdown");
  expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(
    validManifest.complete_report_sha256
  );
});

test("emergency withdrawal has no download", async ({ request }) => {
  expect((await request.get(emergencyDownloadRoute)).status()).toBe(404);
});

test("desktop and mobile report pages have no serious accessibility violations", async ({
  page
}) => {
  await page.goto(validReportRoute);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? "")
    )
  ).toEqual([]);
});

test("matrix scrolls without page overflow on mobile", async ({ page }) => {
  await page.goto(validReportRoute);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
  await expect(page.locator('[data-testid="matrix-scroll"]')).toHaveCSS("overflow-x", "auto");
});
