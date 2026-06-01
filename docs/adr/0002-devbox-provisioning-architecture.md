# Devbox provisioning: local agentic CLI, pluggable provider, plan-and-approve trust

The Provisioner is a **local, agent-driven CLI** the user runs on their own machine. There is no Latchkey-operated backend for MVP provisioning: no credential ever lands on a Latchkey-operated system, and the user's own device may persist its own credentials to survive a restart (which also fixes the Funding-Gate crash-recovery problem). The user **always holds** both the provider credential and the wallet; we orchestrate transiently and store nothing.

The VPS provider sits behind a pluggable **Provider Adapter**. The MVP adapter is **SporeStack** (anonymous bearer token, BTC/XMR); a **BitLaunch** (ETH) adapter is a fast-follow.

There are **two independent funding relationships**, never conflated and possibly on different chains: **VPS Billing** (user ↔ provider, on the provider's rail) and **Wallet Funding** (the user's EVM/Base-Sepolia wallet for inference). The provider exposes a pay-to address at order creation; the user funds it directly; the Provisioner watches for confirmation (the **Funding Gate**) and only then runs the Recipe.

The **Recipe** is a natural-language brief (intent), not a reproducible artifact; the agent interprets it per-host. Before touching the box the agent presents a per-run **Plan** for approval; once approved it follows the Plan faithfully. Benign deviations proceed and are logged; **Sensitive Actions** (wallet seed, API keys, spending money) not in the approved Plan force re-approval. Each run ends with a **deviation report**.

## Considered Options

- **Server-side provisioning service** — rejected: would hold the provider token in memory across a minutes-long Funding Gate, forcing a choice between losing the token on a crash (stranding the user's deposit) or persisting it (becoming custodial).
- **ETH-first via BitLaunch for the MVP** — rejected for now: ETH was the stated preference and would let one EVM keypair fund both rails, but every ETH-capable API provider is account-based (email signup, prepaid balance, custody/identity surface), which fights the accountless, disposable funnel ethos. The adapter preserves the option to add it.
- **Declarative, reproducible Recipe (image/cloud-init)** — rejected: a brittle distro-specific artifact fails on heterogeneous self-host infra; agent adaptivity is the better portability story.
- **Pure improvisation with a post-hoc manifest** — rejected: a money-holding box needs consent *before* the seed is generated, not an after-the-fact receipt. The approved Plan provides pre-execution consent.

## Consequences

- No two Devboxes are guaranteed identical. Reproducibility and auditability come from the **approved Plan + deviation report**, not from a deterministic image.
- Trust rests on **pre-execution consent at the risk boundary** (Sensitive Actions), so the agent's interruption budget is spent only on secrets and money.
- The VPS payment chain is a property of the chosen adapter, independent of the marketplace wallet's chain.
