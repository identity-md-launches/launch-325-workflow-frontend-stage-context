import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";
import { keccak256, stringToHex } from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const m = read("dist/imd-deployment.json"),
  h = read("web/deployment/handoff.json"),
  n = read("web/deployment/network.json");
const sorted = (x) =>
  Array.isArray(x)
    ? x.map(sorted)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sorted(x[k])]),
        )
      : x;
const walk = (dir, prefix = "") =>
  readdirSync(dir)
    .flatMap((name) =>
      statSync(join(dir, name)).isDirectory()
        ? walk(join(dir, name), `${prefix}${name}/`)
        : [prefix + name],
    )
    .sort();
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.equal(m[key], h[key]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.deepEqual(
  m.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })),
  h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })),
);
assert.deepEqual(
  m.assets.map((a) => a.path).sort(),
  walk(join(root, "dist")).filter((p) => p !== "imd-deployment.json"),
);
assert(m.assets.length <= 128);
let exportBytes = statSync(join(root, "dist/imd-deployment.json")).size;
for (const a of m.assets) {
  assert(
    !a.path.includes("..") && !a.path.startsWith("/") && !a.path.includes(":"),
  );
  const bytes = readFileSync(join(root, "dist", a.path));
  assert(bytes.length <= 8388608);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256);
  exportBytes += bytes.length;
}
for (const c of m.contracts) {
  const abi = read(`dist/${c.abiPath}`);
  assert(Array.isArray(abi));
  assert.equal(
    keccak256(stringToHex(JSON.stringify(sorted(abi)))).slice(2),
    c.abiHash,
  );
}
assert(exportBytes < 32 * 1024 * 1024);
const result = {
  result: "pass",
  assetCount: m.assets.length,
  exportBytes,
  sourceCommit: m.sourceCommit,
  abiBindings: m.contracts.map(({ name, abiHash }) => ({ name, abiHash })),
  checks: [
    "exact handoff contract set and identifiers",
    "unchanged network and walletAddChain",
    "all and only exported files inventoried, excluding manifest",
    "every SHA-256 and canonical ABI Keccak verified",
    "relative safe paths",
    "asset-count and size limits",
  ],
};
writeFileSync(
  join(root, "docs/validation/export.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
