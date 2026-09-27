import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWalletClient,
  custom,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import type { Runtime } from "./config";
import {
  amount,
  countdown,
  display,
  eligibility,
  errorText,
  same,
  short,
  validToken,
  type Lot,
  type Metadata,
} from "./domain";
type Provider = EIP1193Provider & {
  on?: (event: string, fn: (value: any) => void) => void;
  removeListener?: (event: string, fn: (value: any) => void) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
type Funds = { balance: bigint; allowance: bigint; withdrawable: bigint };
type Deposit = Metadata & {
  address: Address;
  balance: bigint;
  allowance: bigint;
};
type Action = {
  label: string;
  description: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};
const PAGE_SIZE = 6n;
export function App({ runtime: r }: { runtime: Runtime }) {
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [lots, setLots] = useState<Lot[]>([]),
    [total, setTotal] = useState(0n),
    [page, setPage] = useState(0n);
  const [filter, setFilter] = useState("all"),
    [funds, setFunds] = useState<Funds>();
  const [verified, setVerified] = useState(false),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState("");
  const [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [txHash, setTxHash] = useState<Hash>();
  const [busy, setBusy] = useState(false),
    [review, setReview] = useState<Action>();
  const [clock, setClock] = useState({ chain: 0, local: Date.now() }),
    [now, setNow] = useState(0),
    [updated, setUpdated] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0),
    lock = useRef(false),
    dialog = useRef<HTMLDialogElement>(null),
    restoreFocus = useRef<HTMLElement | null>(null);
  const { client, auction, token, deployment } = r;
  const read = useCallback(
    (
      address: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[] = [],
      blockNumber?: bigint,
    ) => client.readContract({ address, abi, functionName, args, blockNumber }),
    [client],
  );
  const metadata = useCallback(
    async (address: Address, blockNumber?: bigint): Promise<Metadata> => {
      const [symbol, decimals] = await Promise.allSettled([
        read(address, token.abi, "symbol", [], blockNumber),
        read(address, token.abi, "decimals", [], blockNumber),
      ]);
      return {
        symbol:
          symbol.status === "fulfilled" && typeof symbol.value === "string"
            ? symbol.value
                .replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, "")
                .slice(0, 24) || "ERC-20"
            : "ERC-20",
        decimals:
          decimals.status === "fulfilled" &&
          Number.isInteger(Number(decimals.value)) &&
          Number(decimals.value) >= 0 &&
          Number(decimals.value) <= 255
            ? Number(decimals.value)
            : null,
      };
    },
    [read, token.abi],
  );
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const [chainId, block, codes, binding, decimals] = await Promise.all([
        client.getChainId(),
        client.getBlock(),
        Promise.all(
          r.contracts.map((c) => client.getCode({ address: c.address })),
        ),
        read(auction.address, auction.abi, "token"),
        read(token.address, token.abi, "decimals"),
      ]);
      if (
        chainId !== deployment.chainId ||
        codes.some((code) => !code || code === "0x") ||
        !same(String(binding), token.address) ||
        Number(decimals) !== 18
      )
        throw Error(
          "Live deployment verification failed. Check the configured RPC and contracts.",
        );
      const count = (await read(
        auction.address,
        auction.abi,
        "lotCount",
        [],
        block.number,
      )) as bigint;
      const first = count - page * PAGE_SIZE;
      const ids = Array.from(
        {
          length: Number(
            first > 0n ? (first < PAGE_SIZE ? first : PAGE_SIZE) : 0n,
          ),
        },
        (_, i) => first - BigInt(i),
      );
      const entries = await Promise.all(
        ids.map(async (id) => {
          const [item, minimum] = await Promise.all([
            read(auction.address, auction.abi, "lot", [id], block.number),
            read(
              auction.address,
              auction.abi,
              "minNextBid",
              [id],
              block.number,
            ),
          ]);
          const lot = item as Omit<Lot, "id" | "minimum" | "metadata">;
          return {
            ...lot,
            id,
            minimum: minimum as bigint,
            metadata: await metadata(lot.lotToken, block.number),
          };
        }),
      );
      const balances = account
        ? await Promise.all([
            read(
              token.address,
              token.abi,
              "balanceOf",
              [account],
              block.number,
            ),
            read(
              token.address,
              token.abi,
              "allowance",
              [account, auction.address],
              block.number,
            ),
            read(
              auction.address,
              auction.abi,
              "withdrawable",
              [account],
              block.number,
            ),
          ])
        : undefined;
      if (current !== generation.current) return;
      setTotal(count);
      setLots(entries);
      setFunds(
        balances
          ? {
              balance: balances[0] as bigint,
              allowance: balances[1] as bigint,
              withdrawable: balances[2] as bigint,
            }
          : undefined,
      );
      setClock({ chain: Number(block.timestamp), local: Date.now() });
      setNow(Number(block.timestamp));
      setUpdated(Date.now());
      setReadError("");
      setVerified(true);
    } catch (e) {
      if (current === generation.current) {
        setReadError(errorText(e));
        setVerified(false);
        setFunds(undefined);
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [
    account,
    page,
    client,
    r.contracts,
    read,
    auction,
    token,
    deployment.chainId,
    metadata,
  ]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [refresh, epoch]);
  useEffect(() => {
    const timer = setInterval(
      () => setNow(clock.chain + Math.floor((Date.now() - clock.local) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [clock]);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    let active = true;
    const accounts = (value: Address[]) => {
      if (active) {
        setAccount(value[0]);
        setFunds(undefined);
        setReview(undefined);
        setVerified(false);
        setError("");
      }
    };
    const chain = (value: string) => {
      if (active) {
        setWalletChain(Number(BigInt(value)));
        setReview(undefined);
        setVerified(false);
        setEpoch((n) => n + 1);
      }
    };
    const disconnected = () => accounts([]);
    void provider
      .request({ method: "eth_accounts" })
      .then(accounts)
      .catch(() => {});
    void provider
      .request({ method: "eth_chainId" })
      .then(chain)
      .catch(() => {});
    provider.on?.("accountsChanged", accounts);
    provider.on?.("chainChanged", chain);
    provider.on?.("disconnect", disconnected);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", accounts);
      provider.removeListener?.("chainChanged", chain);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, []);
  useEffect(() => {
    if (review) {
      restoreFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      restoreFocus.current?.focus();
    }
  }, [review]);
  async function connect() {
    setError("");
    setWalletBusy(true);
    try {
      if (!window.ethereum)
        throw Error(
          "No browser wallet found. Install or open this page in an Ethereum wallet, then reload.",
        );
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      setAccount(accounts[0]);
      setWalletChain(
        Number(
          BigInt(await window.ethereum.request({ method: "eth_chainId" })),
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWalletBusy(false);
    }
  }
  async function switchChain() {
    if (!window.ethereum) return;
    setWalletBusy(true);
    setError("");
    try {
      const params: [{ chainId: string }] = [
        { chainId: deployment.walletAddChain.chainId },
      ];
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params,
        });
      } catch (e) {
        const x = e as {
          code?: number;
          message?: string;
          data?: { originalError?: { code?: number } };
        };
        if (
          x.code !== 4902 &&
          x.data?.originalError?.code !== 4902 &&
          !/unknown chain|unrecognized chain|not added/i.test(x.message ?? "")
        )
          throw e;
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [deployment.walletAddChain],
        });
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params,
        });
      }
      setWalletChain(
        Number(
          BigInt(await window.ethereum.request({ method: "eth_chainId" })),
        ),
      );
      setEpoch((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWalletBusy(false);
    }
  }
  const wrong = !!account && walletChain !== deployment.chainId;
  const ready =
    !!account &&
    !wrong &&
    verified &&
    !busy &&
    !loading &&
    Date.now() - updated < 45000;
  function ask(action: Action) {
    if (!ready) return;
    setError("");
    setReview(action);
  }
  async function execute() {
    if (!review || !account || !window.ethereum || lock.current) return;
    const action = review,
      signer = account,
      provider = window.ethereum;
    lock.current = true;
    setBusy(true);
    setReview(undefined);
    setError("");
    setTxHash(undefined);
    setStatus(`Checking ${action.label.toLowerCase()}…`);
    let submitted = false;
    let replacementReason: string | undefined;
    try {
      const assertWallet = async () => {
        const [accounts, chain] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (
          !same(accounts[0], signer) ||
          Number(BigInt(chain)) !== deployment.chainId
        )
          throw Error(
            "Wallet account or network changed. Reconnect before continuing.",
          );
      };
      await assertWallet();
      if (!verified || Date.now() - updated >= 45000)
        throw Error("Live state expired. Refresh before continuing.");
      const { request } = await client.simulateContract({
        address: action.address,
        abi: action.abi,
        functionName: action.functionName,
        args: action.args,
        account: signer,
      });
      await assertWallet();
      setStatus(`Confirm ${action.label.toLowerCase()} in your wallet.`);
      const wallet = createWalletClient({
        chain: r.chain,
        transport: custom(provider),
      });
      const hash = await wallet.writeContract(request);
      submitted = true;
      setTxHash(hash);
      setStatus(`${action.label} submitted. Waiting for confirmation…`);
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 120000,
        confirmations: 1,
        onReplaced: (replacement) => {
          replacementReason = replacement.reason;
          setTxHash(replacement.transaction.hash);
        },
      });
      if (replacementReason && replacementReason !== "repriced")
        throw Error(
          "The wallet replaced or cancelled this action. Check the replacement transaction.",
        );
      if (receipt.status !== "success")
        throw Error("Transaction reverted on chain.");
      setStatus(
        `${action.label} confirmed. Live balances and lots are refreshing.`,
      );
      setEpoch((n) => n + 1);
    } catch (e) {
      setError(
        submitted
          ? `Transaction was submitted. Check its explorer status before retrying. ${errorText(e)}`
          : errorText(e),
      );
      setStatus("");
      setEpoch((n) => n + 1);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  const appAction = (
    label: string,
    description: string,
    functionName: string,
    args: readonly unknown[] = [],
  ) =>
    ask({
      label,
      description,
      address: auction.address,
      abi: auction.abi,
      functionName,
      args,
    });
  const approval = (address: Address, value: bigint, symbol: string) =>
    ask({
      label: value === 0n ? `Reset ${symbol} approval` : `Approve ${symbol}`,
      description:
        value === 0n
          ? `Set this token’s auction allowance to zero. Approve your desired amount after confirmation.`
          : `Allow LotAuction to spend exactly ${display(value, address === token.address ? 18 : (createMeta?.decimals ?? 18))} ${symbol}. This approval does not place a bid or deposit a lot.`,
      address,
      abi: token.abi,
      functionName: "approve",
      args: [auction.address, value],
    });
  const [createAddress, setCreateAddress] = useState(""),
    [createAmount, setCreateAmount] = useState(""),
    [reserve, setReserve] = useState("1"),
    [duration, setDuration] = useState("24");
  const [createMeta, setCreateMeta] = useState<Deposit>(),
    [inspectBusy, setInspectBusy] = useState(false),
    [createError, setCreateError] = useState(""),
    [createInvalid, setCreateInvalid] = useState("");
  const inspectGeneration = useRef(0);
  const inspect = useCallback(async () => {
    const ticket = ++inspectGeneration.current;
    setCreateMeta(undefined);
    setCreateError("");
    if (!account || !validToken(createAddress)) {
      setCreateError(
        "Connect your wallet and enter a valid ERC-20 contract address.",
      );
      return;
    }
    setInspectBusy(true);
    try {
      const address = createAddress as Address;
      const [meta, balance, allowance, code] = await Promise.all([
        metadata(address),
        read(address, token.abi, "balanceOf", [account]),
        read(address, token.abi, "allowance", [account, auction.address]),
        client.getCode({ address }),
      ]);
      if (meta.decimals === null || !code || code === "0x")
        throw Error("Token metadata is unavailable. Check the token address.");
      if (ticket === inspectGeneration.current)
        setCreateMeta({
          ...meta,
          address,
          balance: balance as bigint,
          allowance: allowance as bigint,
        });
    } catch (e) {
      if (ticket === inspectGeneration.current) setCreateError(errorText(e));
    } finally {
      if (ticket === inspectGeneration.current) setInspectBusy(false);
    }
  }, [
    account,
    createAddress,
    metadata,
    read,
    token.abi,
    auction.address,
    client,
  ]);
  useEffect(() => {
    setCreateMeta(undefined);
    inspectGeneration.current++;
    setInspectBusy(false);
  }, [account, createAddress]);
  useEffect(() => {
    if (validToken(createAddress) && account) void inspect();
  }, [epoch, account, inspect, createAddress]);
  function invalid(field: string, message: string): never {
    setCreateInvalid(field);
    document.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus();
    throw Error(message);
  }
  function fieldAmount(value: string, decimals: number, field: string) {
    try {
      return amount(value, decimals);
    } catch (e) {
      return invalid(field, (e as Error).message);
    }
  }
  function createValues() {
    if (
      !createMeta ||
      createMeta.decimals === null ||
      !same(createAddress, createMeta.address)
    )
      invalid("lotToken", "Read the token details before continuing.");
    const deposit = fieldAmount(createAmount, createMeta.decimals, "lotAmount"),
      floor = fieldAmount(reserve, 18, "reserve"),
      hours = Number(duration);
    if (floor < 10n ** 18n)
      invalid("reserve", "Set a reserve of at least 1 GAVL.");
    if (!Number.isInteger(hours) || hours < 1 || hours > 168)
      invalid("duration", "Choose a duration from 1 to 168 whole hours.");
    if (deposit > createMeta.balance)
      invalid(
        "lotAmount",
        `Your ${createMeta.symbol} balance is too low for this lot.`,
      );
    return { deposit, floor, seconds: BigInt(hours * 3600) };
  }
  function createStep(approve: boolean) {
    setCreateError("");
    setCreateInvalid("");
    try {
      const { deposit, floor, seconds } = createValues();
      if (approve) {
        approval(createMeta!.address, deposit, createMeta!.symbol);
        return;
      }
      if (createMeta!.allowance < deposit)
        throw Error("Approve the lot amount before creating this lot.");
      appAction(
        "Create lot",
        `Deposit ${display(deposit, createMeta!.decimals!)} ${createMeta!.symbol}. Reserve: ${display(floor)} GAVL. Duration: ${duration} hours. Tokens enter escrow; cancellation is only possible before a bid and before expiry.`,
        "createLot",
        [createMeta!.address, deposit, floor, seconds],
      );
    } catch (e) {
      setCreateError(errorText(e));
    }
  }

  let depositValue = 0n;
  try {
    if (createMeta?.decimals !== null && createMeta?.decimals !== undefined)
      depositValue = amount(createAmount, createMeta.decimals);
  } catch {
    /* Inline validation occurs on action. */
  }
  const depositApproved =
    !!createMeta && depositValue > 0n && createMeta.allowance >= depositValue;
  const visible = lots.filter(
    (l) =>
      filter === "all" ||
      (filter === "open"
        ? l.status === 0 && Number(l.end) > now
        : same(l.seller, account) ||
          same(l.highestBidder, account) ||
          same(l.claimant, account)),
  );
  const explorer = deployment.network.explorer;
  return (
    <>
      <a className="skip" href="#main">
        Skip to auction room
      </a>
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Gavel home">
          <span className="brand-mark" aria-hidden="true">
            g.
          </span>{" "}
          gavel<span className="brand-sub">The auction room</span>
        </a>
        <div className="wallet">
          <span className="network-tag">{deployment.network.name} testnet</span>
          {account ? (
            <>
              <span className="account" title={account}>
                {short(account)}
              </span>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => {
                  setAccount(undefined);
                  setFunds(undefined);
                  setReview(undefined);
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={walletBusy}
              onClick={() => void connect()}
            >
              {walletBusy ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </header>
      <main id="main">
        <section className="intro">
          <div>
            <p className="eyebrow">An open market for ERC-20 lots</p>
            <h1>
              Going, going.
              <br />
              <em>Yours.</em>
            </h1>
            <p className="intro-copy">
              Put tokens on the block. Bid in GAVL.
              <br />A simple auction, settled on chain.
            </p>
          </div>
          <div className="room-note">
            <span className="note-number">01 — The rules of the room</span>
            <p>
              Highest bid wins.
              <br />
              Everyone can settle.
              <br />
              You collect what you’re owed.
            </p>
            <a href="#how-it-works">
              Read the auction rules <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
        {wrong && (
          <div className="notice warning">
            <div>
              <strong>Wallet is on another network</strong>
              <p>
                Switch to {deployment.network.name} to approve tokens or use the
                auction.
              </p>
            </div>
            <button
              disabled={walletBusy || busy}
              onClick={() => void switchChain()}
            >
              {walletBusy
                ? "Switching…"
                : `Switch to ${deployment.network.name}`}
            </button>
          </div>
        )}
        <div className="status-line">
          <span
            className={verified ? "live-dot" : "offline-dot"}
            aria-hidden="true"
          />
          <span>
            {readError
              ? "Live reads unavailable — actions paused"
              : loading
                ? "Reading contract state…"
                : verified
                  ? `Deployment checked · Updated ${new Date(updated).toLocaleTimeString()}`
                  : "Checking deployment…"}
          </span>
          <button
            className="text-button"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
        {readError && (
          <p role="alert" className="error">
            {readError}
          </p>
        )}
        <section className="balances" aria-label="Wallet balances">
          <div>
            <span>Wallet balance</span>
            <strong>
              {funds ? display(funds.balance) : "—"} <small>GAVL</small>
            </strong>
          </div>
          <div>
            <span>Auction allowance</span>
            <strong>
              {funds ? display(funds.allowance) : "—"} <small>GAVL</small>
            </strong>
          </div>
          <div className="withdraw-cell">
            <div>
              <span>Ready to withdraw</span>
              <strong>
                {funds ? display(funds.withdrawable) : "—"} <small>GAVL</small>
              </strong>
            </div>
            <button
              disabled={!ready || !funds?.withdrawable}
              onClick={() =>
                appAction(
                  "Withdraw GAVL",
                  `Collect your full ${display(funds!.withdrawable)} GAVL credit to ${account}.`,
                  "withdraw",
                )
              }
            >
              Withdraw <span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>
        {!account && (
          <p className="wallet-hint">
            Connect a browser wallet to see your balance, allowance and
            withdrawal credit.
          </p>
        )}
        <div className="transaction-status" role="status">
          {status}
          {txHash && (
            <a
              href={`${explorer}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          )}
        </div>
        <div role="alert">{error && <p className="error">{error}</p>}</div>
        <div className="workspace">
          <section className="lot-section" aria-labelledby="lots-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Discover & bid</p>
                <h2 id="lots-title">
                  On the block <span className="count">{total.toString()}</span>
                </h2>
              </div>
              <label className="filter-label">
                Show on this page
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All lots</option>
                  <option value="open">Open lots</option>
                  <option value="mine">My activity</option>
                </select>
              </label>
            </div>
            {visible.map((lot) => (
              <LotCard
                key={lot.id.toString()}
                lot={lot}
                account={account}
                ready={ready}
                now={now}
                funds={funds}
                explorer={explorer}
                appAction={appAction}
                approval={(value) => approval(token.address, value, "GAVL")}
              />
            ))}
            {!visible.length && (
              <div className="empty">
                <span className="empty-mark" aria-hidden="true">
                  ↗
                </span>
                <h3>
                  {loading
                    ? "Reading the room…"
                    : readError
                      ? "The room is temporarily unavailable"
                      : total === 0n
                        ? "The first lot could be yours."
                        : "No matching lots on this page."}
                </h3>
                <p>
                  {readError
                    ? "Retry with Refresh above."
                    : total === 0n
                      ? "Offer an ERC-20 lot and set your opening reserve."
                      : "Change the filter or browse another page."}
                </p>
                <a href="#create-lot">
                  Create a lot <span aria-hidden="true">→</span>
                </a>
              </div>
            )}
            <div className="pagination">
              <button
                disabled={page === 0n || loading || busy}
                onClick={() => setPage((p) => p - 1n)}
              >
                Newer lots
              </button>
              <span>Page {(page + 1n).toString()} · newest first</span>
              <button
                disabled={(page + 1n) * PAGE_SIZE >= total || loading || busy}
                onClick={() => setPage((p) => p + 1n)}
              >
                Older lots
              </button>
            </div>
            <p className="fine-print">
              Six lots per page, read directly from the contract. Updates every
              15 seconds. Countdowns follow the last chain timestamp.
            </p>
          </section>
          <section
            className="create-panel"
            id="create-lot"
            aria-labelledby="create-title"
          >
            <p className="eyebrow">Start an auction</p>
            <h2 id="create-title">Put it on the block.</h2>
            <p className="muted">Choose your tokens. Set your terms.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createStep(false);
              }}
            >
              <fieldset disabled={!ready || inspectBusy}>
                <label>
                  Lot token address
                  <input
                    name="lotToken"
                    aria-invalid={createInvalid === "lotToken"}
                    autoComplete="off"
                    placeholder="0x…"
                    value={createAddress}
                    onChange={(e) => setCreateAddress(e.target.value)}
                    aria-describedby="token-hint create-error"
                  />
                </label>
                <p id="token-hint" className="field-hint">
                  Use an ERC-20 contract on {deployment.network.name}.
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void inspect()}
                >
                  Read token details
                </button>
                {createMeta && (
                  <p className="token-info">
                    <bdi>{createMeta.symbol}</bdi> · {createMeta.decimals}{" "}
                    decimals
                    <br />
                    Balance: {display(createMeta.balance, createMeta.decimals!)}
                    <br />
                    Allowance:{" "}
                    {display(createMeta.allowance, createMeta.decimals!)}
                  </p>
                )}
                <label>
                  Lot amount
                  <input
                    name="lotAmount"
                    aria-invalid={createInvalid === "lotAmount"}
                    aria-describedby="create-error"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="100"
                    value={createAmount}
                    onChange={(e) => setCreateAmount(e.target.value)}
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    Reserve (GAVL)
                    <input
                      name="reserve"
                      aria-invalid={createInvalid === "reserve"}
                      aria-describedby="create-error"
                      inputMode="decimal"
                      value={reserve}
                      onChange={(e) => setReserve(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Duration
                    <select
                      name="duration"
                      aria-invalid={createInvalid === "duration"}
                      aria-describedby="create-error"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    >
                      <option value="1">1 hour</option>
                      <option value="6">6 hours</option>
                      <option value="24">1 day</option>
                      <option value="72">3 days</option>
                      <option value="168">7 days</option>
                    </select>
                  </label>
                </div>
                <p className="field-hint">
                  Minimum reserve: 1 GAVL. Duration: 1 hour–7 days.
                </p>
                <div className="steps">
                  <span className="step-label">1. Approve the lot token</span>
                  <button
                    type="button"
                    disabled={!createMeta || depositApproved}
                    onClick={() => createStep(true)}
                  >
                    {depositApproved
                      ? "Lot amount approved"
                      : `Approve ${createMeta?.symbol || "lot token"}`}
                  </button>
                  <span className="step-label">2. Deposit & open bidding</span>
                  <button
                    className="primary"
                    type="submit"
                    disabled={!depositApproved}
                  >
                    Create lot
                  </button>
                </div>
                {!!createMeta?.allowance && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      approval(createMeta.address, 0n, createMeta.symbol)
                    }
                  >
                    Reset lot token approval
                  </button>
                )}
              </fieldset>
              <p id="create-error" className="error" role="alert">
                {createError}
              </p>
            </form>
            <p className="fine-print">
              The actual amount received becomes the lot. Transfer fees may
              reduce it. Rebasing and sender-extra-fee tokens are unsupported.
            </p>
            {!ready && (
              <p className="field-hint">
                {!account
                  ? "Connect your wallet to create a lot."
                  : wrong
                    ? "Switch networks to create a lot."
                    : busy
                      ? "Wait for the current transaction."
                      : "Waiting for verified, fresh contract state."}
              </p>
            )}
          </section>
        </div>
        <section id="how-it-works" className="rules">
          <div>
            <p className="eyebrow">Before the hammer falls</p>
            <h2>A few ground rules.</h2>
          </div>
          <div>
            <h3>Get GAVL</h3>
            <p>
              Swap Sepolia ETH for GAVL in the factory-seeded launch pool using
              a compatible Uniswap v4 interface. Use the GAVL address below.
              This page has no in-page swap.
            </p>
          </div>
          <div>
            <h3>Make your bid count</h3>
            <p>
              The first bid meets the reserve. Each next bid is at least 5%
              higher, rounded up. Bids in the final 10 minutes extend the clock
              to 10 minutes.
            </p>
          </div>
          <div>
            <h3>Collect separately</h3>
            <p>
              Outbid? Withdraw your GAVL credit. At the end, anyone can settle.
              The winner claims the tokens; the seller withdraws GAVL. Unbid
              lots return to the seller by claim.
            </p>
          </div>
        </section>
        <details className="deployment">
          <summary>Contract details & network</summary>
          <p>
            {deployment.network.name} · Chain {deployment.chainId} · GAVL is
            verified against LotAuction.token().
          </p>
          {r.contracts.map((c) => (
            <p key={c.name}>
              {c.name}:{" "}
              <a
                href={`${explorer}/address/${c.address}`}
                target="_blank"
                rel="noreferrer"
              >
                <bdi>{c.address}</bdi> ↗
              </a>
            </p>
          ))}
          <p>
            Connected wallet: <bdi>{account || "Not connected"}</bdi>
          </p>
          <p>
            Allowance spender: LotAuction. Approval and payment are separate
            transactions. Reset approval to zero first if your token requires
            it.
          </p>
          <p>
            Lot tokens are untrusted. Verify the token address before bidding;
            metadata is not an endorsement. A token that blocks transfers may
            prevent collection.
          </p>
          <p>Public RPCs: {deployment.network.rpcUrls.join(" · ")}</p>
          <p>
            Source: <code>{deployment.sourceCommit}</code>
          </p>
          <a href="./imd-deployment.json">View deployment manifest</a>
        </details>
      </main>
      <footer>
        <a className="brand" href="#main">
          gavel
        </a>
        <span>Open auctions. On-chain settlement.</span>
        <span>{deployment.network.name} · Test tokens only</span>
      </footer>
      <dialog
        ref={dialog}
        onCancel={() => setReview(undefined)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        aria-labelledby="review-title"
      >
        <h2 id="review-title">Review {review?.label.toLowerCase()}</h2>
        <p>{review?.description}</p>
        <p className="fine-print">
          Contract: <bdi>{review?.address}</bdi>
          <br />
          Network: {deployment.network.name}. Your wallet will ask you to
          confirm. Gas is paid in {deployment.network.nativeCurrency.symbol}.
        </p>
        <div className="dialog-actions">
          <button onClick={() => setReview(undefined)}>Go back</button>
          <button
            className="primary"
            disabled={!ready}
            onClick={() => void execute()}
          >
            Continue to wallet
          </button>
        </div>
      </dialog>
    </>
  );
}
function LotCard({
  lot: l,
  account,
  ready,
  now,
  funds,
  explorer,
  appAction,
  approval,
}: {
  lot: Lot;
  account?: Address;
  ready: boolean;
  now: number;
  funds?: Funds;
  explorer: string;
  appAction: (
    label: string,
    description: string,
    fn: string,
    args?: readonly unknown[],
  ) => void;
  approval: (value: bigint) => void;
}) {
  const [bid, setBid] = useState(""),
    [error, setError] = useState("");
  const can = eligibility(l, account, now);
  const status =
    l.status === 1
      ? "Cancelled"
      : l.status === 2
        ? l.claimed
          ? "Collected"
          : "Settled"
        : Number(l.end) <= now
          ? "Awaiting settlement"
          : "Open for bids";
  let value = 0n;
  try {
    value = amount(bid || display(l.minimum), 18);
  } catch {
    /* Validated on action. */
  }
  const approved = !!funds && value > 0n && funds.allowance >= value;
  function paying(approve: boolean) {
    setError("");
    try {
      const parsed = amount(bid || display(l.minimum), 18);
      if (parsed < l.minimum)
        throw Error(`Bid at least ${display(l.minimum)} GAVL.`);
      if (!funds || parsed > funds.balance)
        throw Error("Your GAVL balance is too low for this bid.");
      if (approve) {
        approval(parsed);
        return;
      }
      if (funds.allowance < parsed) throw Error("Approve GAVL before bidding.");
      appAction(
        `Bid on lot #${l.id}`,
        `Pay ${display(parsed)} GAVL for your bid on lot #${l.id}. The full amount enters escrow. You can withdraw it only after being outbid.`,
        "bid",
        [l.id, parsed],
      );
    } catch (e) {
      setError(errorText(e));
      document.getElementById(`bid-${l.id}`)?.focus();
    }
  }
  return (
    <article className="lot-card" aria-label={`Lot ${l.id}`}>
      <div className="lot-top">
        <span className="eyebrow">
          Lot / {l.id.toString().padStart(3, "0")}
        </span>
        <span className="lot-status">{status}</span>
      </div>
      <h3>
        <span className="lot-amount">
          {l.metadata.decimals === null
            ? l.lotAmount.toString()
            : display(l.lotAmount, l.metadata.decimals)}
        </span>{" "}
        <bdi>
          {l.metadata.decimals === null ? "raw units" : l.metadata.symbol}
        </bdi>
      </h3>
      <p className="token-address">
        Token{" "}
        <a
          title={l.lotToken}
          href={`${explorer}/address/${l.lotToken}`}
          target="_blank"
          rel="noreferrer"
        >
          {short(l.lotToken)} ↗
        </a>{" "}
        · Seller{" "}
        <a
          title={l.seller}
          href={`${explorer}/address/${l.seller}`}
          target="_blank"
          rel="noreferrer"
        >
          {same(l.seller, account) ? "You" : short(l.seller)} ↗
        </a>
      </p>
      <div className="lot-numbers">
        <div>
          <span>{l.highestBid ? "Highest bid" : "Opening reserve"}</span>
          <strong>
            {display(l.highestBid || l.reserve)} <small>GAVL</small>
          </strong>
        </div>
        <div>
          <span>{l.status === 0 ? "Time remaining" : "Auction status"}</span>
          <strong className="timer">
            {l.status === 0 ? countdown(l.end, now) : status}
          </strong>
        </div>
      </div>
      {l.status === 0 && Number(l.end) > now && (
        <>
          <label>
            Bid amount (GAVL)
            <input
              id={`bid-${l.id}`}
              aria-invalid={!!error}
              aria-label={`Bid amount for lot ${l.id} (GAVL)`}
              inputMode="decimal"
              autoComplete="off"
              value={bid}
              placeholder={display(l.minimum)}
              disabled={!ready || !can.bid}
              onChange={(e) => {
                setBid(e.target.value);
                setError("");
              }}
              aria-describedby={`minimum-${l.id} bid-error-${l.id}`}
            />
          </label>
          <p className="field-hint" id={`minimum-${l.id}`}>
            Minimum next bid: {display(l.minimum)} GAVL
          </p>
          <div className="bid-actions">
            <button
              disabled={!ready || !can.bid || approved}
              onClick={() => paying(true)}
            >
              {approved ? "1. GAVL approved" : "1. Approve GAVL"}
            </button>
            <button
              disabled={!ready || !can.bid || !approved}
              onClick={() => paying(false)}
            >
              2. Place bid
            </button>
          </div>
          {!can.bid && (
            <p className="field-hint">
              {!account
                ? "Connect your wallet to bid."
                : same(account, l.seller)
                  ? "You own this lot. Sellers cannot bid."
                  : "You hold the highest bid."}
            </p>
          )}
        </>
      )}
      <div className="lot-actions">
        {can.cancel && (
          <button
            disabled={!ready}
            onClick={() =>
              appAction(
                `Cancel lot #${l.id}`,
                "Close this unbid auction. Cancellation cannot be undone. Claim the lot separately after confirmation.",
                "cancel",
                [l.id],
              )
            }
          >
            Cancel lot
          </button>
        )}
        {can.settle && (
          <button
            disabled={!ready}
            onClick={() =>
              appAction(
                `Settle lot #${l.id}`,
                "Close the auction and assign the token claim and any GAVL credit. Collection is a separate step.",
                "settle",
                [l.id],
              )
            }
          >
            Settle auction
          </button>
        )}
        {can.claim && (
          <button
            disabled={!ready}
            onClick={() =>
              appAction(
                `Claim lot #${l.id}`,
                `Transfer the escrowed lot tokens to ${account}. Token transfer fees may reduce what you receive.`,
                "claimLot",
                [l.id],
              )
            }
          >
            Claim lot
          </button>
        )}
      </div>
      <p id={`bid-error-${l.id}`} className="error" role="alert">
        {error}
      </p>
      <details>
        <summary>Lot details</summary>
        <p>
          Token: <bdi>{l.lotToken}</bdi>
        </p>
        <p>
          Seller: <bdi>{l.seller}</bdi>
        </p>
        <p>
          Highest bidder:{" "}
          <bdi>{l.highestBid ? l.highestBidder : "No bids"}</bdi>
        </p>
        <p>
          Claimant:{" "}
          <bdi>{l.status === 0 ? "Assigned after settlement" : l.claimant}</bdi>
        </p>
        <p>
          Ends: {new Date(Number(l.end) * 1000).toLocaleString()} · Reserve:{" "}
          {display(l.reserve)} GAVL
        </p>
      </details>
    </article>
  );
}
