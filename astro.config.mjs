import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  outDir: process.env.REPORT_SITE_DIST ?? "dist",
  site: "https://zzzykkkkdada.github.io",
  trailingSlash: "always",
  build: { format: "directory" }
});
