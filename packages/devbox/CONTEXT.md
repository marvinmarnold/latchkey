# Devbox

Provisions portable, crypto-funded development environments that come pre-wired to the Latchkey Marketplace proxy. Its only job is to get a developer from zero to a working Claude Code session against the proxy as fast as possible — on infrastructure we provision or their own. It is a funnel for the Marketplace and deliberately carries no compute margin.

## Language

**Recipe**:
The natural-language brief that tells the Provisioner's agent what a finished Devbox should be — which tools to get working, how the wallet is generated, how the box is wired to the proxy. It states intent, not exact steps: the agent interprets it and adapts to whatever host it runs on, so no two Devboxes are guaranteed identical. This buys portability across arbitrary infra at the cost of a deterministic, auditable artifact.
_Avoid_: image, script, manifest, cloud-init (a Recipe is prose interpreted per-run, not a reproducible artifact)

**Provisioner**:
The local, agent-driven command the user runs on their own machine to stand up a Devbox. It calls the chosen Provider Adapter to create an order, surfaces the provider's crypto pay-to address, waits at the Funding Gate, then launches the box and applies the Recipe over SSH. It runs entirely on the user's device — no Latchkey-operated backend is involved, and no credential ever lands on a Latchkey-operated system (the user's own device may persist its own credentials to survive a restart).
_Avoid_: provisioning service, server, spinner (it is a local CLI, not a hosted service)

**Plan**:
The per-run, host-specific concretization of the Recipe that the Provisioner's agent presents for the user's approval before it touches the box. Once approved it is a commitment the agent follows faithfully, and it is the artifact the user consents to and audits against. Where the Recipe is standing intent, the Plan is this box, today.
_Avoid_: proposal, script

**Sensitive Action**:
Any step that touches the wallet seed, API keys, or the spending of money — generating or exporting the seed, funding the VPS, or installing anything off-Plan that could reach secrets. The agent absorbs benign deviations from the approved Plan silently (logging them), but a Sensitive Action not in the Plan forces it to stop and re-approve. Every run ends with a deviation report: the approved Plan plus every place reality differed.
_Avoid_: dangerous action, privileged action

**Provider Adapter**:
The pluggable boundary between the Provisioner and one VPS provider's API + payment rail. Each adapter maps that provider's create-order / pay / launch / renew operations onto the Provisioner's chain-agnostic flow, so the provider — and therefore the VPS payment chain — is swappable without touching the Recipe or the rest of the funnel.
_Avoid_: driver, plugin, connector

**Funding Gate**:
The pause in provisioning between "order created, pay-to address shown" and "payment confirmed by the provider," after which the Recipe runs. The point at which an unfunded order simply never becomes a Devbox.
_Avoid_: payment wall, paywall

**VPS Billing**:
The funding relationship between the user and the VPS provider, settled directly on the provider's own rail (which may be Lightning/BTC and need not match the marketplace's chain). Latchkey never custodies these funds and runs no recurring billing for them.
_Avoid_: hosting fee, compute billing

**Caller Deposit** (Marketplace term, used here):
The last step of Devbox onboarding — the user deposits USDC collateral into the billing contract to unlock billed prompts. Defined in the Marketplace context (`../../CONTEXT.md`); a Devbox only triggers and links to it. Independent of VPS Billing in rail, timing, and counterparty.
_Avoid_: wallet funding, top-up (the canonical term is Caller Deposit)
