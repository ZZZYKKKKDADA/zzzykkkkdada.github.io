import { expect, test } from "@playwright/test";

test("directory searches by ticker and company and opens the timeline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "搜索股票" }).fill("002050");
  await expect(page.getByRole("link", { name: /三花智控/ })).toBeVisible();
  await page.getByRole("link", { name: /三花智控/ }).click();
  await expect(page).toHaveURL(/\/stocks\/002050-sz\/$/);
  await expect(page.getByText("版本时间线")).toBeVisible();
});
