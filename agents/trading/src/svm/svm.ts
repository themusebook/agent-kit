/**
 * SVM dev agent: routes questions to the Solana Foundation solana-dev skill
 * (MIT, github.com/solana-foundation/solana-dev-skill) and Helius core-ai's svm
 * skill. It reads docs and code only: scaffolding, IDL/codegen and autofixer
 * guidance. It never deploys, never holds a key and never signs.
 */
export const SOLANA_DEV_SKILL = { repo: "https://github.com/solana-foundation/solana-dev-skill", commit: "a265d11", license: "MIT", install: "npx skills add solana-foundation/solana-dev-skill" } as const;
export const CORE_AI_SVM = { repo: "https://github.com/helius-labs/core-ai", path: "helius-skills/svm", commit: "fbf6b13", license: "MIT" } as const;

const R = "skills/solana-dev/references/";
export const TOPICS: Record<string, { refs: string[]; keywords: RegExp; docsOnly?: true }> = {
  "common-errors": { refs: [`${R}common-errors.md`], keywords: /error|failed|panic|custom program error|0x[0-9a-f]+/i },
  "version-matrix": { refs: [`${R}compatibility-matrix.md`], keywords: /version|compatib|toolchain|rustc|anchor (cli|version)|agave/i },
  runtime: { refs: [`${R}concepts.md`], keywords: /runtime|account model|rent|pda|compute unit|cpi/i },
  "kit-frontend": { refs: [`${R}frontend.md`, `${R}kit/react.md`, `${R}kit/overview.md`, `${R}kit-web3-interop.md`], keywords: /kit|frontend|react|wallet standard|web3\.js/i },
  codama: { refs: [`${R}idl-codegen.md`, `${R}kit/codama.md`], keywords: /idl|codama|codegen|client gen/i },
  keychain: { refs: [`${R}keychain.md`], keywords: /keychain|server[- ]side sign|custody|kms|hsm/i, docsOnly: true },
  kora: { refs: [`${R}kora.md`], keywords: /kora|gasless|fee payer|relayer/i, docsOnly: true },
  mosaic: { refs: [`${R}mosaic.md`], keywords: /mosaic|stablecoin|token-2022 issuance/i },
  payments: { refs: [`${R}payments.md`], keywords: /payment|solana pay|checkout/i },
  testing: { refs: [`${R}testing.md`, `${R}surfpool/overview.md`, `${R}surfpool/cheatcodes.md`], keywords: /test|litesvm|mollusk|surfpool|bankrun/i },
  "tx-v1": { refs: [`${R}transactions-v1.md`], keywords: /transaction v1|tx v1|versioned|v1 transaction/i },
  security: { refs: [`${R}security.md`], keywords: /secur|audit|vulnerab|checklist|signer check|owner check/i },
  programs: { refs: [`${R}programs/anchor.md`, `${R}programs/pinocchio.md`, `${R}anchor/migrating-v0.32-to-v1.md`], keywords: /anchor|pinocchio|program|scaffold/i },
};

export function route(question: string): { topic: string; refs: string[]; docsOnly: boolean }[] {
  const hits = Object.entries(TOPICS).filter(([, t]) => t.keywords.test(question)).map(([topic, t]) => ({ topic, refs: t.refs, docsOnly: !!t.docsOnly }));
  return hits.length ? hits : [{ topic: "overview", refs: ["skills/solana-dev/SKILL.md"], docsOnly: false }];
}

/** Commands the agent may suggest. Anything that deploys or moves funds is out of scope. */
const FORBIDDEN = /\b(deploy|program deploy|upgrade|airdrop|transfer|solana-keygen\s+new|keypair)\b/i;
export function allowedCommand(cmd: string): boolean {
  return !FORBIDDEN.test(cmd);
}
