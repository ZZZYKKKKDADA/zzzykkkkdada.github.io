import { readFile } from "node:fs/promises";
import {
  buildPackage,
  type PackageBuildInput
} from "../src/lib/package-builder";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("usage: build-package <private-input.json>");
const input = JSON.parse(await readFile(inputPath, "utf8")) as PackageBuildInput;
const result = await buildPackage(input);
process.stdout.write(`${JSON.stringify(result)}\n`);
