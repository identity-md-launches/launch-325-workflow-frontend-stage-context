import {
  formatUnits,
  isAddress,
  parseUnits,
  maxUint256,
  zeroAddress,
  type Address,
} from "viem";
export type Lot = {
  id: bigint;
  seller: Address;
  lotToken: Address;
  lotAmount: bigint;
  reserve: bigint;
  end: bigint;
  highestBidder: Address;
  highestBid: bigint;
  claimant: Address;
  status: number;
  claimed: boolean;
  minimum: bigint;
  metadata: Metadata;
};
export type Metadata = { symbol: string; decimals: number | null };
export const same = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const display = (value: bigint, decimals = 18) =>
  formatUnits(value, decimals);
export function amount(value: string, decimals: number): bigint {
  if (
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n || parsed > maxUint256)
    throw Error(
      "Enter an amount greater than zero and within the token limit.",
    );
  return parsed;
}
export const validToken = (v: string) => isAddress(v) && !same(v, zeroAddress);
export function countdown(end: bigint, now: number) {
  const left = Math.max(0, Number(end) - now);
  if (!left) return "Ready to settle";
  const days = Math.floor(left / 86400),
    hours = Math.floor((left % 86400) / 3600),
    minutes = Math.floor((left % 3600) / 60),
    seconds = left % 60;
  return days
    ? `${days}d ${hours}h ${minutes}m`
    : `${hours}h ${minutes}m ${seconds}s`;
}
export function eligibility(
  lot: Lot,
  account: Address | undefined,
  now: number,
) {
  const open = lot.status === 0 && Number(lot.end) > now;
  return {
    bid:
      open &&
      !!account &&
      !same(lot.seller, account) &&
      !same(lot.highestBidder, account),
    cancel: open && same(lot.seller, account) && lot.highestBid === 0n,
    settle: lot.status === 0 && Number(lot.end) <= now,
    claim: !lot.claimed && same(lot.claimant, account),
  };
}
export function errorText(error: unknown) {
  const e = error as { shortMessage?: string; message?: string; code?: number };
  if (
    e.code === 4001 ||
    /rejected|denied/i.test(e.shortMessage || e.message || "")
  )
    return "Request declined in your wallet. No new transaction was submitted; try again when ready.";
  return `${e.shortMessage || e.message || "Request failed."} Refresh the state and try again.`;
}
