import { sha256Bytes } from "./crypto";

export const PUBLIC_CONTENT_SCANNER_VERSION = "2.0.0";

export interface PublicContentFinding {
  ruleId: string;
  file: string;
  line: number;
  start: number;
  end: number;
  matchHash: string;
}

const RULES = [
  { id: "private_path", pattern: /(?:\/Volumes\/|\/Users\/|file:\/\/)[^\s"']+/giu },
  { id: "env_reference", pattern: /(?:^|[^\w])\.env(?:[^\w]|$)/giu },
  { id: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu },
  {
    id: "authorization_header",
    pattern: /authorization["']?\s*:\s*["']?(?:bearer|basic)\s+[^\s,}\]"']+/giu
  },
  {
    id: "credential_assignment",
    pattern:
      /(?:api[_ -]?key|token|secret|password)["']?\s*[:=]\s*["']?[^\s,}\]"']+/giu
  },
  { id: "email", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu },
  { id: "phone", pattern: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu },
  {
    id: "private_artifact",
    pattern: /(?:private_source_map|reasoning trace|system prompt|model messages?|approval receipt)/giu
  }
] as const;

export function scanPublicBytes(file: string, bytes: Uint8Array): PublicContentFinding[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const findings: PublicContentFinding[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
      const start = match.index ?? 0;
      findings.push({
        ruleId: rule.id,
        file,
        line: text.slice(0, start).split("\n").length,
        start,
        end: start + match[0].length,
        matchHash: sha256Bytes(Buffer.from(match[0], "utf8"))
      });
    }
  }
  return findings.sort((left, right) =>
    `${left.file}\0${left.start}\0${left.ruleId}`.localeCompare(
      `${right.file}\0${right.start}\0${right.ruleId}`,
      "en"
    )
  );
}
