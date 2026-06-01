// Central source of truth for pull-payment / billing thresholds.
// Override via env (PULL_THRESHOLD_USD, USDC_DECIMALS); everything else derives from these.
// Do not hardcode the threshold anywhere else — import from here.

/**
 * Default accrued-debt level (USD) that triggers an on-chain pull.
 * Currently $0.01 for testing on Base Sepolia (frequent settlement, low batching).
 * Raise for production to batch payments and reduce on-chain transaction volume.
 */
export const DEFAULT_PULL_THRESHOLD_USD = 0.01

function envNum(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw || raw.trim() === '') return fallback
  const v = Number(raw)
  if (!Number.isFinite(v)) throw new Error(`config: ${key}=${raw} is not a valid number`)
  return v
}

export const USDC_DECIMALS = envNum('USDC_DECIMALS', 6)
export const PULL_SCALE = 10 ** USDC_DECIMALS
export const PULL_THRESHOLD_USD = envNum('PULL_THRESHOLD_USD', DEFAULT_PULL_THRESHOLD_USD)
export const PULL_THRESHOLD_ATOMIC = BigInt(Math.round(PULL_THRESHOLD_USD * PULL_SCALE))

/**
 * Minimum Caller Deposit (USD). Enforced on-chain by the billing contract once built;
 * surfaced here as the canonical value for onboarding UX and proxy-side error messages.
 * The proxy fronts at most min(remainingDeposit, PULL_THRESHOLD_USD) of unsettled usage.
 */
export const MIN_CALLER_DEPOSIT_USD = envNum('MIN_CALLER_DEPOSIT_USD', 1)
