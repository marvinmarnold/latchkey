# Devbox is a separate bounded context and a Marketplace funnel

Devbox — crypto-funded dev-environment provisioning — is modelled as its own bounded context in the monorepo (see `CONTEXT-MAP.md`), not folded into the Marketplace glossary, because its language (provisioning, VPS lifecycle, remote environments) is disjoint from inference routing.

It exists solely to funnel developers onto the Marketplace proxy and deliberately carries **no compute margin**: we do not resell VPS compute for profit, do not custody VPS funds, and run no recurring billing for them. The bait is compute; the business is inference flowing through the proxy's protocol fee. This is why the design optimises time-from-payment-to-first-prompt and conversion to ongoing Caller spend, not VPS economics.

## Considered Options

- **Fold Devbox into the Marketplace context** — rejected: pollutes a clean inference-routing glossary with provisioning/VNC/SSH terms.
- **Standalone product / separate repo** — rejected: loses the shared wallet identity and the funnel intent that justify building it at all.
- **Treat compute as a real revenue line** — rejected: reselling VPS is a brutal, undifferentiated, low-margin business; it would require a full VPS-lifecycle billing model (start/stop/resize/meter) that is as much work as everything else combined.
