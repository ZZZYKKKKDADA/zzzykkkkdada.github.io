import { resolve } from "node:path";
import { auditSite } from "../src/lib/site-audit";

const root = resolve(process.argv[2] ?? process.cwd());
const result = await auditSite(root);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
