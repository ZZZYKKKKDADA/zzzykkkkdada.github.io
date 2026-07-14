import { expect, test } from "@playwright/test";
import { validReportRoute } from "../helpers/fixtures";

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
