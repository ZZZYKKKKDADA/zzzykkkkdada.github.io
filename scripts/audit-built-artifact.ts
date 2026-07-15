import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { scanPublicBytes } from "../src/lib/public-content-scan";

async function files(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, path)));
    else if (entry.isFile()) result.push(relative(root, path));
  }
  return result.sort();
}

const findings = [];
for (const path of await files("dist")) {
  findings.push(...scanPublicBytes(path, await readFile(join("dist", path))));
}
if (findings.length > 0) throw new Error("UNSAFE_BUILT_ARTIFACT");
