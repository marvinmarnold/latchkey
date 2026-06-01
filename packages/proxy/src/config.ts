// Central source of truth for pull-payment / billing thresholds.
// Override via env (PULL_THRESHOLD_USD, USDC_DECIMALS); everything else derives from these.
// Do not hardcode the threshold anywhere else — import from here.

/**
 * Default accrued-debt level (USD) that triggers an on-chain pull.
 * Currently $0.01 for testing on Base Sepolia (frequent settlement, low batching).
 * Raise for production to batch payments and reduce on-chain transaction volume.
 */
export const DEFAULT_PULL_THRESHOLD_USD = 0.01

/**
 * Minimum Caller Deposit (USD). Enforced on-chain by the billing contract once built;
 * surfaced here as the canonical value for onboarding UX and proxy-side error messages.
 * The proxy fronts at most min(remainingDeposit, PULL_THRESHOLD_USD) of unsettled usage.
 */
export const MIN_CALLER_DEPOSIT_USD = 1

export const USDC_DECIMALS = Number(process.env.USDC_DECIMALS ?? 6)
export const PULL_SCALE = 10 ** USDC_DECIMALS
export const PULL_THRESHOLD_USD = Number(process.env.PULL_THRESHOLD_USD ?? DEFAULT_PULL_THRESHOLD_USD)
export const PULL_THRESHOLD_ATOMIC = BigInt(Math.round(PULL_THRESHOLD_USD * PULL_SCALE))
