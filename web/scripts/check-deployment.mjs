import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, decodeFunctionResult } from "viem";
const base = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("dist/imd-deployment.json", base)),
);
const evidence = {
  checkedAt: new Date().toISOString(),
  mode: "read-only; no wallet or broadcast",
  sourceCommit: manifest.sourceCommit,
  attempts: [],
};
for (const url of manifest.network.rpcUrls) {
  const attempt = { rpc: url };
  try {
    const rpc = (method, params = []) => {
      const response = JSON.parse(
        execFileSync(
          "curl",
          [
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            "18",
            "-H",
            "Content-Type: application/json",
            "--data",
            JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            url,
          ],
          { encoding: "utf8", maxBuffer: 2000000 },
        ),
      );
      if (response.error) throw Error(JSON.stringify(response.error));
      return response.result;
    };
    const chainId = Number(BigInt(rpc("eth_chainId")));
    if (chainId !== manifest.chainId) throw Error("Wrong RPC chain");
    const block = rpc("eth_blockNumber");
    attempt.chainId = chainId;
    attempt.blockNumber = Number(BigInt(block));
    attempt.contracts = manifest.contracts.map((c) => {
      const code = rpc("eth_getCode", [c.address, block]);
      if (code === "0x") throw Error("Missing code");
      return {
        name: c.name,
        address: c.address,
        runtimeBytes: (code.length - 2) / 2,
      };
    });
    const auction = manifest.contracts.find((c) => c.name === "LotAuction");
    const abi = JSON.parse(
      readFileSync(new URL(`dist/${auction.abiPath}`, base)),
    );
    const read = (fn) =>
      decodeFunctionResult({
        abi,
        functionName: fn,
        data: rpc("eth_call", [
          {
            to: auction.address,
            data: encodeFunctionData({ abi, functionName: fn }),
          },
          block,
        ]),
      });
    attempt.token = read("token");
    attempt.lotCount = read("lotCount").toString();
    if (
      attempt.token.toLowerCase() !==
      manifest.contracts
        .find((c) => c.name === "LaunchToken")
        .address.toLowerCase()
    )
      throw Error("Token binding mismatch");
    attempt.result = "pass";
    evidence.attempts.push(attempt);
    break;
  } catch (e) {
    attempt.result = "unavailable";
    attempt.error = e.message;
    evidence.attempts.push(attempt);
  }
}
evidence.result = evidence.attempts.some((a) => a.result === "pass")
  ? "pass"
  : "unverified";
writeFileSync(
  new URL("docs/validation/live-chain.json", base),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence, null, 2));
