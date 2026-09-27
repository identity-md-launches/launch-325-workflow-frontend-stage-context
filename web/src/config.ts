import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
} from "viem";
export type Deployment = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
export function sorted(x: unknown): unknown {
  return Array.isArray(x)
    ? x.map(sorted)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.entries(x)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, sorted(v)]),
        )
      : x;
}
async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI), {
    cache: "no-store",
  });
  if (!response.ok) throw Error(`Cannot load ${path}. Reload to retry.`);
  return response.json();
}
export async function loadDeployment() {
  const deployment: Deployment = await json("imd-deployment.json");
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId ||
    Number(BigInt(deployment.walletAddChain.chainId)) !== deployment.chainId
  )
    throw Error("Deployment configuration does not match the network.");
  const contracts = await Promise.all(
    deployment.contracts.map(async (c) => {
      if (!/^abi\/[A-Za-z0-9_]+\.json$/.test(c.abiPath))
        throw Error("Invalid ABI path");
      const abi: Abi = await json(c.abiPath);
      if (
        !Array.isArray(abi) ||
        keccak256(stringToHex(JSON.stringify(sorted(abi)))).slice(2) !==
          c.abiHash
      )
        throw Error(`ABI verification failed for ${c.name}.`);
      return { ...c, abi };
    }),
  );
  const auction = contracts.find((c) => c.name === "LotAuction");
  const token = contracts.find((c) => c.name === "LaunchToken");
  if (!auction || !token) throw Error("Required contracts are missing.");
  const n = deployment.network;
  const chain = defineChain({
    id: deployment.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    testnet: n.testnet,
  });
  const client = createPublicClient({
    chain,
    transport: fallback(
      n.rpcUrls.map((url) => http(url, { timeout: 8000, retryCount: 0 })),
      { retryCount: 0 },
    ),
  });
  return { deployment, contracts, auction, token, chain, client };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;
