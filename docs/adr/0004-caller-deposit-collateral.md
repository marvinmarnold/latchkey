# Caller Deposit: true on-chain collateral with cooldown withdrawal

A Caller posts a **Caller Deposit** — USDC custodied in the billing contract — before using the proxy. This replaces the v1 allowance-gate model (funds stay in the user's wallet; the proxy pulls via an ERC-20 allowance) with deposited collateral held by the contract. Chosen over reusing the already-deployed allowance gate because we want real collateral that enables the `min(deposit − used, PULL_THRESHOLD_USD)` fronting cap and a path to on-chain settlement guarantees.

A Caller Deposit is **distinct from a Provider's Stake**: it is credit collateral, never a fraud bond, and is **never slashed** (Callers consume inference; they have nothing to defraud). It only bounds the proxy's fronting exposure.

**Minimum deposit: $1** (canonical value in `packages/proxy/src/config.ts`, enforced on-chain by the contract). **Fronting cap:** at any moment a Caller may have at most `min(deposit − used, PULL_THRESHOLD_USD)` of unsettled (fronted) usage — the smaller of remaining deposit and the centralized pull threshold; beyond that the proxy settles on-chain or returns HTTP 402. Because the cap references `PULL_THRESHOLD_USD` directly, the cap and threshold are one knob, not two that can diverge.

**Withdrawal is two-step with a cooldown (≥ one pull cycle):** `requestWithdrawal()` starts a timelock during which the proxy settles any accrued debt from the deposit; `withdraw()` then releases the remainder. This closes the withdraw-before-settle race.

## Considered Options

- **Reuse the deployed allowance gate as the v1 "deposit"** — rejected: funds-in-wallet can be revoked or spent between accrual and pull; it is not real collateral and cannot support the fronting cap.
- **Instant withdrawal** — rejected: only safe if the proxy does a synchronous on-chain pull per request, which destroys the batch-to-threshold design and spikes gas.

## Consequences

- The deployed `LatchkeyBilling` (pull-from-allowance) must be reworked into deposit/withdraw collateral.
- The `Session` glossary term shifts from "presence of a sufficient allowance" to "presence of a sufficient deposit."
- Devbox onboarding sequencing: the Caller Deposit is the **last** step — the box is fully provisioned and wired before the deposit unlocks billed prompts.
