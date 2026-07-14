import { readFile } from "node:fs/promises";
import {
  prepareRepair,
  prepareWithdrawal,
  type RepairInput,
  type WithdrawalInput
} from "../src/lib/maintenance";

const [operation, inputPath] = process.argv.slice(2);
if (!inputPath || !["repair", "withdrawal"].includes(operation)) {
  throw new Error("usage: prepare-maintenance <repair|withdrawal> <private-input.json>");
}
const input = JSON.parse(await readFile(inputPath, "utf8"));
const result =
  operation === "repair"
    ? await prepareRepair(input as RepairInput)
    : await prepareWithdrawal(input as WithdrawalInput);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
