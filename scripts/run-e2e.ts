import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "127.0.0.1";

export function parseE2EPort(value: string | undefined): number {
  if (value === undefined) return 4321;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("REPORT_SITE_E2E_PORT_INVALID");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("REPORT_SITE_E2E_PORT_INVALID");
  }
  return port;
}

export async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("E2E_PORT_ALLOCATION_FAILED");
  }
  const port = address.port;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

export async function runPlaywright(
  args = process.argv.slice(2),
): Promise<number> {
  const port = await allocateLoopbackPort();
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(executable, ["playwright", "test", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, REPORT_SITE_E2E_PORT: String(port) },
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => child.kill(signal));
  }
  return await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entry) {
  runPlaywright()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "E2E_RUNNER_FAILED");
      process.exitCode = 1;
    });
}
