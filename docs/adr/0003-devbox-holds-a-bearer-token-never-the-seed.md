# A Devbox holds a Bearer Token, never the wallet seed

The marketplace wallet is generated and persisted on the **user's own machine** by the local Provisioner. Only a signed `Bearer Token` (the existing `sk-ant-api03-…` credential, time-boxed) is installed on the rented box and wired into Claude Code. The seed never touches the box.

The obvious path — generate the wallet on the box — is deliberately rejected. A Devbox is a remote, disposable VPS rented from an untrusted host, so a compromised box must leak at most a **time-boxed, allowance-capped token**, not a money-holding seed. This reuses the Marketplace's existing rationale for `Bearer Token` (limit the blast radius of a leak) and `Session Key` (keep the root wallet cold).

"Bring your own" has two tiers: import a seed (the laptop signs locally) or supply just a token (the Provisioner never sees a seed at all).

## Consequences

- A long-lived box needs **re-tokening from the laptop** when the token expires (EVM tokens currently default to 30-day expiry; expiry may be lengthened for this use).
- Generating or importing the seed is a **Sensitive Action**, so it appears in the approved Plan.
