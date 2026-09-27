import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  parseEther,
  zeroAddress,
  type Address,
  type Abi,
} from "viem";
const manifest = JSON.parse(
  readFileSync("../dist/imd-deployment.json", "utf8"),
);
const auction = manifest.contracts.find((x: any) => x.name === "LotAuction");
const token = manifest.contracts.find((x: any) => x.name === "LaunchToken");
const auctionAbi = JSON.parse(
  readFileSync(`../dist/${auction.abiPath}`, "utf8"),
) as Abi;
const tokenAbi = JSON.parse(
  readFileSync(`../dist/${token.abiPath}`, "utf8"),
) as Abi;
const ALICE = "0x1111111111111111111111111111111111111111",
  BOB = "0x2222222222222222222222222222222222222222",
  CAROL = "0x3333333333333333333333333333333333333333",
  LOT = "0x4444444444444444444444444444444444444444";
const timestamp = Math.floor(Date.now() / 1000);
const blockHash = `0x${"ab".repeat(32)}`;
function lot(overrides: any = {}) {
  return {
    seller: BOB,
    lotToken: LOT,
    lotAmount: 250000000n,
    reserve: parseEther("1"),
    end: BigInt(timestamp + 3600),
    highestBidder: zeroAddress,
    highestBid: 0n,
    claimant: zeroAddress,
    status: 0,
    claimed: false,
    ...overrides,
  };
}
function fixtureLots() {
  return [
    lot({ highestBid: parseEther("10"), highestBidder: CAROL }),
    lot({ seller: ALICE }),
    lot({
      end: BigInt(timestamp - 10),
      highestBidder: ALICE,
      highestBid: parseEther("12"),
    }),
    lot({ seller: ALICE, status: 1, claimant: ALICE }),
  ];
}
async function setup(page: Page, options: any = {}) {
  const state = {
    lots: options.lots ?? fixtureLots(),
    gavlAllowance: 0n,
    lotAllowance: 0n,
    gavlBalance: parseEther("100"),
    lotBalance: 1000000000n,
    withdrawable: parseEther("3"),
    sends: [] as any[],
    simulations: [] as any[],
    receipts: new Map<string, any>(),
    rejectSimulation: false,
    noCode: options.noCode ?? false,
    rpcChain: options.rpcChain ?? manifest.chainId,
    rpcFail: false,
  };
  await page.route("https://**/*", async (route) => {
    const body = route.request().postDataJSON();
    if (
      !manifest.network.rpcUrls.some((url: string) =>
        route.request().url().startsWith(url),
      )
    )
      return route.abort();
    if (state.rpcFail) return route.fulfill({ status: 503, body: "offline" });
    async function respond(req: any) {
      const { method, params = [] } = req;
      let result: any = "0x0";
      try {
        if (method === "eth_chainId")
          result = `0x${state.rpcChain.toString(16)}`;
        else if (method === "eth_getCode")
          result = state.noCode ? "0x" : "0x60006000";
        else if (method === "eth_blockNumber") result = "0x100";
        else if (method === "eth_getBlockByNumber")
          result = {
            number: "0x100",
            timestamp: `0x${timestamp.toString(16)}`,
            hash: blockHash,
            parentHash: blockHash,
            transactions: [],
            gasLimit: "0x1c9c380",
            gasUsed: "0x100",
            baseFeePerGas: "0x1",
            difficulty: "0x0",
            extraData: "0x",
            logsBloom: `0x${"00".repeat(256)}`,
            miner: zeroAddress,
            mixHash: blockHash,
            nonce: "0x0000000000000000",
            receiptsRoot: blockHash,
            sha3Uncles: blockHash,
            size: "0x100",
            stateRoot: blockHash,
            totalDifficulty: "0x0",
            transactionsRoot: blockHash,
            uncles: [],
          };
        else if (method === "eth_getTransactionReceipt")
          result = state.receipts.get(params[0]) ?? null;
        else if (method === "eth_call") {
          const request = params[0],
            isAuction =
              request.to.toLowerCase() === auction.address.toLowerCase(),
            isGavl = request.to.toLowerCase() === token.address.toLowerCase(),
            abi = isAuction ? auctionAbi : tokenAbi;
          const decoded = decodeFunctionData({ abi, data: request.data });
          const fn = decoded.functionName;
          const args = decoded.args ?? [];
          let value: any;
          if (
            [
              "approve",
              "createLot",
              "bid",
              "cancel",
              "settle",
              "claimLot",
              "withdraw",
            ].includes(fn)
          ) {
            state.simulations.push({ fn, args });
            if (state.rejectSimulation)
              return {
                jsonrpc: "2.0",
                id: req.id,
                error: {
                  code: 3,
                  message: "execution reverted",
                  data: encodeErrorResult({
                    abi: auctionAbi,
                    errorName: "BidTooLow",
                    args: [parseEther("50")],
                  }),
                },
              };
            value =
              fn === "approve"
                ? true
                : fn === "createLot"
                  ? BigInt(state.lots.length + 1)
                  : undefined;
          } else if (fn === "token") value = token.address;
          else if (fn === "lotCount") value = BigInt(state.lots.length);
          else if (fn === "lot") value = state.lots[Number(args[0]) - 1];
          else if (fn === "minNextBid") {
            const item = state.lots[Number(args[0]) - 1];
            value = item.highestBid
              ? item.highestBid +
                item.highestBid / 20n +
                (item.highestBid % 20n ? 1n : 0n)
              : item.reserve;
          } else if (fn === "decimals") {
            if (options.metadataFail && !isGavl)
              throw Error("metadata unavailable");
            value = isGavl ? 18 : 6;
          } else if (fn === "symbol") value = isGavl ? "GAVL" : "USDC";
          else if (fn === "balanceOf")
            value = isGavl ? state.gavlBalance : state.lotBalance;
          else if (fn === "allowance")
            value = isGavl ? state.gavlAllowance : state.lotAllowance;
          else if (fn === "withdrawable") value = state.withdrawable;
          else throw Error(`Unhandled contract call ${fn}`);
          result = encodeFunctionResult({
            abi,
            functionName: fn,
            result: value,
          });
        } else throw Error(`Unhandled RPC ${method}`);
        return { jsonrpc: "2.0", id: req.id, result };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32000, message: String(e) },
        };
      }
    }
    const reply = Array.isArray(body)
      ? await Promise.all(body.map(respond))
      : await respond(body);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(reply),
    });
  });
  await page.exposeFunction("__send", async (tx: any) => {
    const isAuction = tx.to.toLowerCase() === auction.address.toLowerCase(),
      isGavl = tx.to.toLowerCase() === token.address.toLowerCase();
    const decoded = decodeFunctionData({
      abi: isAuction ? auctionAbi : tokenAbi,
      data: tx.data,
    });
    const fn = decoded.functionName,
      args: any = decoded.args ?? [];
    state.sends.push({ fn, args, tx });
    if (fn === "approve") {
      if (isGavl) state.gavlAllowance = args[1];
      else state.lotAllowance = args[1];
    }
    if (fn === "bid") {
      const item = state.lots[Number(args[0]) - 1];
      item.highestBid = args[1];
      item.highestBidder = ALICE;
      state.gavlBalance -= args[1];
      state.gavlAllowance -= args[1];
    }
    if (fn === "createLot") {
      state.lots.push(
        lot({
          seller: ALICE,
          lotToken: args[0],
          lotAmount: args[1],
          reserve: args[2],
          end: BigInt(timestamp) + args[3],
        }),
      );
      state.lotBalance -= args[1];
      state.lotAllowance -= args[1];
    }
    if (fn === "cancel") {
      const item = state.lots[Number(args[0]) - 1];
      item.status = 1;
      item.claimant = item.seller;
    }
    if (fn === "settle") {
      const item = state.lots[Number(args[0]) - 1];
      item.status = 2;
      item.claimant = item.highestBid ? item.highestBidder : item.seller;
      if (item.seller === ALICE) state.withdrawable += item.highestBid;
    }
    if (fn === "claimLot") state.lots[Number(args[0]) - 1].claimed = true;
    if (fn === "withdraw") {
      state.gavlBalance += state.withdrawable;
      state.withdrawable = 0n;
    }
    const hash = `0x${state.sends.length.toString(16).padStart(64, "0")}`;
    state.receipts.set(hash, {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash,
      blockNumber: "0x100",
      from: ALICE,
      to: tx.to,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      contractAddress: null,
      logs: [],
      logsBloom: `0x${"00".repeat(256)}`,
      status: "0x1",
      effectiveGasPrice: "0x1",
      type: "0x2",
    });
    return hash;
  });
  if (options.wallet !== false)
    await page.addInitScript(
      ({ account, chain, unknown, add }: any) => {
        const listeners: Record<string, Function[]> = {};
        const wallet: any = {
          account,
          chain,
          unknown,
          reject: false,
          calls: [],
          on: (event: string, fn: Function) =>
            (listeners[event] ??= []).push(fn),
          removeListener: (event: string, fn: Function) => {
            listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
          },
          emit: (event: string, value: any) => {
            for (const fn of listeners[event] ?? []) fn(value);
          },
          request: async ({ method, params }: any) => {
            wallet.calls.push({ method, params });
            if (method === "eth_accounts")
              return wallet.account ? [wallet.account] : [];
            if (method === "eth_requestAccounts") {
              if (wallet.reject) throw { code: 4001, message: "User rejected" };
              wallet.account =
                wallet.account || "0x1111111111111111111111111111111111111111";
              return [wallet.account];
            }
            if (method === "eth_chainId") return wallet.chain;
            if (method === "wallet_switchEthereumChain") {
              if (wallet.unknown)
                throw { code: 4902, message: "Unknown chain" };
              wallet.chain = params[0].chainId;
              wallet.emit("chainChanged", wallet.chain);
              return null;
            }
            if (method === "wallet_addEthereumChain") {
              if (JSON.stringify(params[0]) !== JSON.stringify(add))
                throw Error("Wrong add chain configuration");
              wallet.unknown = false;
              return null;
            }
            if (method === "eth_sendTransaction") {
              if (wallet.reject) throw { code: 4001, message: "User rejected" };
              return (window as any).__send(params[0]);
            }
            throw Error(`Unexpected wallet method ${method}`);
          },
        };
        (window as any).ethereum = wallet;
      },
      {
        account: options.connected === false ? null : ALICE,
        chain: options.wrong ? "0x1" : manifest.walletAddChain.chainId,
        unknown: options.wrong ?? false,
        add: manifest.walletAddChain,
      },
    );
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Going, going. Yours." }),
  ).toBeVisible();
  return state;
}
async function ready(page: Page) {
  await expect(page.getByText(/Deployment checked · Updated/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
}
async function confirm(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByText(/confirmed\. Live balances/)).toBeVisible();
  await ready(page);
}
const card = (page: Page, id: number) =>
  page.getByRole("article", { name: `Lot ${id}`, exact: true });

test("static subpath, disconnected empty state, no wallet guidance, keyboard and responsive accessibility", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith("http://127.0.0.1") && r.status() >= 400)
      errors.push(r.url());
  });
  await setup(page, { wallet: false, lots: [] });
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "The first lot could be yours." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create lot", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText(/No browser wallet found/)).toBeVisible();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Tab");
  const results = [];
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);
    results.push({ width, violations: a11y.violations.length });
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `../docs/validation/empty-${width}.png`,
        fullPage: true,
      });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator("button")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  writeFileSync(
    "../docs/validation/accessibility.json",
    JSON.stringify(
      {
        viewports: results,
        errors,
        textEnlargement: "200% root font at 320px; not native browser zoom",
        screenReader: "not performed",
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
test("wrong network offers exact add-chain fallback and blocks paying actions", async ({
  page,
}) => {
  await setup(page, { wrong: true });
  await ready(page);
  await expect(
    card(page, 1).getByRole("button", { name: "1. Approve GAVL" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(page.getByText("Wallet is on another network")).toBeHidden();
  await ready(page);
  const calls = await page.evaluate(() =>
    (window as any).ethereum.calls.map((c: any) => c.method),
  );
  expect(
    calls.filter((s: string) => s === "wallet_switchEthereumChain"),
  ).toHaveLength(2);
  expect(calls).toContain("wallet_addEthereumChain");
});
test("GAVL approval then full bid, exact amounts, previews, state refresh and eligibility", async ({
  page,
}) => {
  const state = await setup(page);
  await ready(page);
  await expect(
    card(page, 2).getByRole("button", { name: "1. Approve GAVL" }),
  ).toBeDisabled();
  await card(page, 1)
    .getByLabel("Bid amount for lot 1 (GAVL)")
    .fill("10.499999999999999999");
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await expect(card(page, 1).getByText(/Bid at least 10.5 GAVL/)).toBeVisible();
  expect(state.sends).toHaveLength(0);
  await card(page, 1).getByLabel("Bid amount for lot 1 (GAVL)").fill("10.5");
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await expect(page.getByRole("dialog")).toContainText("exactly 10.5 GAVL");
  await confirm(page);
  await card(page, 1).getByRole("button", { name: "2. Place bid" }).click();
  await confirm(page);
  expect(state.sends.map((x) => x.fn)).toEqual(["approve", "bid"]);
  expect(state.sends[0].args[0].toLowerCase()).toBe(
    auction.address.toLowerCase(),
  );
  expect(state.sends[0].args[1]).toBe(parseEther("10.5"));
  expect(state.sends[1].args).toEqual([1n, parseEther("10.5")]);
  expect(
    state.sends.every((x) => !x.tx.value || x.tx.value === "0x0"),
  ).toBeTruthy();
  await expect(
    card(page, 1).getByText("You hold the highest bid."),
  ).toBeVisible();
  expect(state.simulations.map((x) => x.fn)).toEqual(["approve", "bid"]);
});
test("create a six-decimal lot, cancel with review, then claim exactly once", async ({
  page,
}) => {
  const state = await setup(page, { lots: [] });
  await ready(page);
  await page.getByLabel("Lot token address").fill(LOT);
  await expect(page.getByText("USDC · 6 decimals")).toBeVisible();
  await page.getByLabel("Lot amount", { exact: true }).fill("2.000001");
  await page.getByLabel("Reserve (GAVL)").fill("0.5");
  await page.getByRole("button", { name: "Approve USDC" }).click();
  await expect(
    page.getByText(/Set a reserve of at least 1 GAVL/),
  ).toBeVisible();
  await page.getByLabel("Reserve (GAVL)").fill("1");
  await page.getByRole("button", { name: "Approve USDC" }).click();
  await confirm(page);
  await page.getByRole("button", { name: "Create lot", exact: true }).click();
  await confirm(page);
  expect(state.sends[0].args[1]).toBe(2000001n);
  expect(state.sends[1].args).toEqual([LOT, 2000001n, parseEther("1"), 86400n]);
  await card(page, 1)
    .getByRole("button", { name: "Cancel lot", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("cannot be undone");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    card(page, 1).getByRole("button", { name: "Cancel lot" }),
  ).toBeFocused();
  await card(page, 1).getByRole("button", { name: "Cancel lot" }).click();
  await confirm(page);
  await card(page, 1)
    .getByRole("button", { name: "Claim lot", exact: true })
    .click();
  await confirm(page);
  await expect(
    card(page, 1).getByRole("button", { name: "Claim lot", exact: true }),
  ).toHaveCount(0);
  expect(state.sends.map((x) => x.fn)).toEqual([
    "approve",
    "createLot",
    "cancel",
    "claimLot",
  ]);
});
test("settle an expired winning lot, claim, settle an unbid lot, withdraw credits", async ({
  page,
}) => {
  const state = await setup(page, {
    lots: [
      lot({
        end: BigInt(timestamp - 5),
        highestBidder: ALICE,
        highestBid: parseEther("12"),
      }),
      lot({ seller: ALICE, end: BigInt(timestamp - 1) }),
    ],
  });
  await ready(page);
  await card(page, 1).getByRole("button", { name: "Settle auction" }).click();
  await confirm(page);
  await card(page, 1)
    .getByRole("button", { name: "Claim lot", exact: true })
    .click();
  await confirm(page);
  await card(page, 2).getByRole("button", { name: "Settle auction" }).click();
  await confirm(page);
  await expect(
    card(page, 2).getByRole("button", { name: "Claim lot", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Withdraw", exact: false }).click();
  await confirm(page);
  expect(state.withdrawable).toBe(0n);
  await expect(
    page.getByRole("button", { name: "Withdraw", exact: false }),
  ).toBeDisabled();
  expect(state.sends.map((x) => x.fn)).toEqual([
    "settle",
    "claimLot",
    "settle",
    "withdraw",
  ]);
});
test("wallet rejection and simulation revert never send a transaction", async ({
  page,
}) => {
  const state = await setup(page);
  await ready(page);
  await page.evaluate(() => ((window as any).ethereum.reject = true));
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByText(/Request declined in your wallet/)).toBeVisible();
  expect(state.sends).toHaveLength(0);
  await ready(page);
  await page.evaluate(() => ((window as any).ethereum.reject = false));
  state.rejectSimulation = true;
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByText(/reverted/)).toBeVisible();
  expect(state.sends).toHaveLength(0);
});
test("wallet account change dismisses the review and refreshes permissions", async ({
  page,
}) => {
  const state = await setup(page);
  await ready(page);
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await page.evaluate(() => {
    const wallet = (window as any).ethereum;
    wallet.account = "0x2222222222222222222222222222222222222222";
    wallet.emit("accountsChanged", [wallet.account]);
  });
  await expect(page.getByRole("dialog")).toBeHidden();
  await ready(page);
  await expect(
    card(page, 1).getByText("You own this lot. Sellers cannot bid."),
  ).toBeVisible();
  expect(state.sends).toHaveLength(0);
});
test("missing code, wrong RPC chain and unavailable reads disable transactions", async ({
  page,
}) => {
  const state = await setup(page, { noCode: true });
  await expect(
    page.getByText(/Live deployment verification failed/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create lot", exact: true }),
  ).toBeDisabled();
  state.noCode = false;
  state.rpcChain = 1;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(/Live deployment verification failed/),
  ).toBeVisible();
  state.rpcChain = manifest.chainId;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await ready(page);
  state.rpcFail = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/Live reads unavailable/)).toBeVisible();
  await expect(
    card(page, 1).getByRole("button", { name: "1. Approve GAVL" }),
  ).toBeDisabled();
});
test("ABI tampering fails closed before wallet controls render", async ({
  page,
}) => {
  await page.route("**/abi/LaunchToken.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Unable to open Gavel" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "ABI verification failed",
  );
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toHaveCount(0);
});
test("bounded pagination and filters keep older lots reachable", async ({
  page,
}) => {
  await setup(page, {
    lots: Array.from({ length: 8 }, (_, i) =>
      lot({ seller: i === 0 ? ALICE : BOB }),
    ),
  });
  await ready(page);
  expect(await page.getByRole("article").count()).toBe(6);
  await page.getByRole("button", { name: "Older lots" }).click();
  await ready(page);
  expect(await page.getByRole("article").count()).toBe(2);
  await page.getByLabel("Show on this page").selectOption("mine");
  await expect(card(page, 1)).toBeVisible();
  expect(await page.getByRole("article").count()).toBe(1);
});
test("metadata failures show raw units, while arbitrary-token deposits fail closed", async ({
  page,
}) => {
  await setup(page, { metadataFail: true });
  await ready(page);
  await expect(card(page, 1).getByRole("heading")).toContainText(
    "250000000 raw units",
  );
  await page.getByLabel("Lot token address").fill(LOT);
  await expect(page.getByText(/Token metadata is unavailable/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create lot", exact: true }),
  ).toBeDisabled();
});
test("populated page screenshots, contrast, dialog keyboard focus and accessible names", async ({
  page,
}) => {
  await setup(page);
  await ready(page);
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `../docs/validation/auctions-${width}.png`,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await expect(
    page.getByRole("button", { name: "Go back", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Continue to wallet" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Go back", exact: true }),
  ).toBeFocused();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({ path: "../docs/validation/transaction-review.png" });
  await page.keyboard.press("Escape");
  const pairs = await page.evaluate(() => {
    const luminance = (rgb: string) => {
      const values = rgb
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    return [
      "body",
      ".room-note",
      ".primary",
      ".create-panel",
      ".lot-card",
      ".muted",
    ].map((selector) => {
      const el = document.querySelector(selector)!;
      const style = getComputedStyle(el);
      let bg = style.backgroundColor;
      let parent = el.parentElement;
      while (bg === "rgba(0, 0, 0, 0)" && parent) {
        bg = getComputedStyle(parent).backgroundColor;
        parent = parent.parentElement;
      }
      const a = luminance(style.color),
        b = luminance(bg);
      return {
        selector,
        foreground: style.color,
        background: bg,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
  writeFileSync(
    "../docs/validation/contrast.json",
    JSON.stringify(pairs, null, 2),
  );
  expect(pairs.every((p) => p.ratio >= 4.5)).toBeTruthy();
});

test("explicit wallet connection, rejection recovery, disconnect and exact-input validation", async ({
  page,
}) => {
  const state = await setup(page, { connected: false });
  await ready(page);
  await page.evaluate(() => ((window as any).ethereum.reject = true));
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText(/Request declined in your wallet/)).toBeVisible();
  await page.evaluate(() => ((window as any).ethereum.reject = false));
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await ready(page);
  const input = card(page, 1).getByLabel("Bid amount for lot 1 (GAVL)");
  await input.fill("10.5000000000000000001");
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(
    card(page, 1).getByText(/at most 18 decimal places/),
  ).toBeVisible();
  await input.fill("101");
  await card(page, 1).getByRole("button", { name: "1. Approve GAVL" }).click();
  await expect(card(page, 1).getByText(/balance is too low/)).toBeVisible();
  expect(state.sends).toHaveLength(0);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Connect a browser wallet to see your balance, allowance and withdrawal credit.",
    ),
  ).toBeVisible();
});
