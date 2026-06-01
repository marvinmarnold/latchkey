# Context Map

## Contexts

- [Marketplace](./CONTEXT.md) — routes LLM inference requests to provider listings and settles billing on-chain
- [Devbox](./packages/devbox/CONTEXT.md) — provisions portable, crypto-funded development environments pre-wired to the Marketplace proxy

## Relationships

- **Devbox → Marketplace**: The marketplace wallet is generated and kept on the user's own machine; a Devbox only ever holds a `Bearer Token` signed from it — never the seed. A Devbox is therefore a Caller's *host*, wired to reach the proxy, while custody of the wallet stays off the rented box. Devbox exists to funnel developers into the Marketplace and deliberately carries no compute margin of its own.
