import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: "https://zzzykkkkdada.github.io",
  trailingSlash: "always",
  build: { format: "directory" }
});
