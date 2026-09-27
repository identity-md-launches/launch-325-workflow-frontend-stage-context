import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { keccak256, stringToHex } from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const handoff = read("web/deployment/handoff.json");
const network = read("web/deployment/network.json");
const canonical = (value) => JSON.stringify(sort(value));
function sort(x) {
  return Array.isArray(x)
    ? x.map(sort)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sort(x[k])]),
        )
      : x;
}
if (
  handoff.chainId !== network.network.chainId ||
  Number(BigInt(network.walletAddChain.chainId)) !== handoff.chainId
)
  throw Error("Chain configuration mismatch");
mkdirSync(join(root, "dist/abi"), { recursive: true });
const contracts = handoff.contracts.map(({ name, address, abiHash }) => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw Error("Invalid contract name");
  const source = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${name}.json`],
    { cwd: root, encoding: "utf8" },
  );
  const abi = JSON.parse(source);
  if (
    !Array.isArray(abi) ||
    keccak256(stringToHex(canonical(abi))).slice(2) !== abiHash
  )
    throw Error(`ABI hash mismatch: ${name}`);
  if (canonical(read(`docs/abi/${name}.json`)) !== canonical(abi))
    throw Error("Working ABI differs from pinned source");
  const abiPath = `abi/${name}.json`;
  writeFileSync(join(root, "dist", abiPath), source);
  return { name, address, abiHash, abiPath };
});
function walk(dir, prefix = "") {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = prefix + name;
      return statSync(join(dir, name)).isDirectory()
        ? walk(join(dir, name), path + "/")
        : path === "imd-deployment.json"
          ? []
          : [path];
    });
}
const assets = walk(join(root, "dist")).map((path) => {
  const bytes = readFileSync(resolve(root, "dist", path));
  if (bytes.length > 8388608) throw Error("Asset exceeds 8 MiB");
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
});
if (assets.length > 128) throw Error("Too many assets");
const { launchId, chainId, sourceCommit, attestationHash } = handoff;
writeFileSync(
  join(root, "dist/imd-deployment.json"),
  JSON.stringify(
    {
      version: 1,
      launchId,
      chainId,
      sourceCommit,
      attestationHash,
      contracts,
      assets,
      ...network,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified ${contracts.length} pinned ABIs; inventoried ${assets.length} assets.`,
);
