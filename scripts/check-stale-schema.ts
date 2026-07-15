import { access, readFile } from "node:fs/promises";

const forbiddenFile = "config/publication-sources.yaml";
try {
  await access(forbiddenFile);
  throw new Error("OBSOLETE_POLICY_FILE");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const productionFiles = [
  "src/lib/contracts.ts",
  "src/lib/repository.ts",
  "src/lib/site-audit.ts",
  "src/lib/package-builder.ts",
  "src/lib/maintenance.ts",
  "src/pages/stocks/[ticker]/[analysisDate]/[versionId]/index.astro"
];
const forbidden =
  /provenance_attestation_hash|source_classes|policy_entry_id|terms_url|attributions/;
for (const path of productionFiles) {
  if (forbidden.test(await readFile(path, "utf8"))) {
    throw new Error(`OBSOLETE_SCHEMA_TERM:${path}`);
  }
}
