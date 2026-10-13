// scripts/compile-test-token.mjs
//
// Compiles contracts/WSRTestToken.sol with the installed solc and writes a
// build artifact the app imports at BUILD time (never compiled at runtime):
//   src/app/wizard/config/test-token-artifact.json
//     { contractName, solcVersion, abi, bytecode, compiledAt }
//
// Run:
//   node scripts/compile-test-token.mjs
//   npm run compile:token
//
// Requires the already-installed `solc` dependency.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const solc = require("solc");

const CONTRACT_NAME = "WSRTestToken";
const SRC_PATH = "contracts/WSRTestToken.sol";
const OUT_PATH = "src/app/wizard/config/test-token-artifact.json";
const CHECK_ONLY = process.argv.includes("--check");

const source = await readFile(SRC_PATH, "utf8");

const input = {
  language: "Solidity",
  sources: { [SRC_PATH]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const fatal = (output.errors ?? []).filter((e) => e.severity === "error");
if (fatal.length > 0) {
  console.error("Solidity compilation failed:");
  for (const e of fatal) console.error(e.formattedMessage || e.message);
  process.exit(1);
}

const contract = output.contracts?.[SRC_PATH]?.[CONTRACT_NAME];
if (!contract) {
  throw new Error(`Contract ${CONTRACT_NAME} not found in compiler output.`);
}

const bytecodeObject = contract.evm.bytecode.object;
const bytecode = bytecodeObject.startsWith("0x") ? bytecodeObject : `0x${bytecodeObject}`;

const artifact = {
  contractName: CONTRACT_NAME,
  solcVersion: solc.version(),
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  compilerSettings: input.settings,
  abi: contract.abi,
  bytecode,
  compiledAt: new Date().toISOString(),
};

if (CHECK_ONLY) {
  const committed = JSON.parse(await readFile(OUT_PATH, "utf8"));
  for (const key of ["contractName", "solcVersion", "sourceSha256", "compilerSettings", "abi", "bytecode"]) {
    if (JSON.stringify(committed[key]) !== JSON.stringify(artifact[key])) {
      throw new Error(`Committed token artifact does not match source/compiler field: ${key}`);
    }
  }
  console.log(`Verified ${OUT_PATH} against ${SRC_PATH} with solc ${artifact.solcVersion}`);
  process.exit(0);
}

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(artifact, null, 2) + "\n", "utf8");

console.log(
  `Wrote ${OUT_PATH} — solc ${artifact.solcVersion}, bytecode ${bytecode.length} chars (${(bytecode.length - 2) / 2} bytes), ${artifact.abi.length} ABI entries`,
);
