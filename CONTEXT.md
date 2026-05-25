# Colosseum LLM Marketplace — Glossary

## Marketplace
A listing marketplace where independent Providers register their own inference endpoints and prices. The platform routes requests and handles billing but never holds upstream API keys. Providers compete on price (v1) and eventually on quality heuristics (v2).

Excludes: reselling proprietary model APIs (OpenAI, Anthropic, etc.) — only open-weight models where community inference does not violate terms of service.

## Provider
An entity that serves inference for one or more open-weight Models and registers an endpoint + price with the Marketplace. Two modes:

- **Self-hosted Provider** — runs inference directly (vLLM, Ollama, llama.cpp, etc.) and exposes an OpenAI-compatible endpoint. The Marketplace forwards requests directly.
- **API-delegating Provider** — holds API credentials to an open-weight model API service (DeepSeek, Groq, Together AI, Fireworks, Hyperbolic, etc.) and delegates those credentials to the protocol, which makes requests on their behalf.

The Marketplace does not control or custody Provider infrastructure. Providers may only list open-weight Models — proprietary model APIs (OpenAI, Anthropic, Google) are excluded regardless of provider type.

## Model
An open-weight model identified by its Hugging Face repo ID (e.g. `meta-llama/Llama-3.1-70B-Instruct`). This is the canonical routing key. Providers additionally expose metadata (quantization, context length, avg latency) that users can filter on, but the HF repo ID defines what model is being served.

## Caller
The primary Caller is an Agent — autonomous software that POSTs to the proxy endpoint without human in the loop. Developers (humans) are secondary callers who use the same endpoint with a manually controlled wallet. No developer dashboard in v1.

Callers authenticate via a signed Bearer Token. Auth header conventions differ by API Format — the proxy accepts both `Authorization: Bearer <token>` (OpenAI convention) and `x-api-key: <token>` (Anthropic convention).

## API Format
The request/response schema a Caller uses to interact with the proxy. The proxy exposes multiple API Format endpoints and normalises all inbound requests to OpenAI format internally before routing to Providers (who always expose OpenAI-compatible endpoints). Responses are translated back to the Caller's original format before returning.

Supported formats (v1): OpenAI (`/v1/chat/completions`), Anthropic (`/v1/messages`).

The internal normalisation layer translates between formats. LiteLLM is excluded as a dependency (supply chain risk); translation is implemented directly or via a vetted alternative.

## Router
The component that, given a user-specified Model, selects the cheapest available Provider serving that Model (v1). Future versions (v2) will route on heuristics beyond cost (latency, reliability score, benchmark quality).

Providers are deprioritised (not slashed) for downtime — the Router scores reliability over time and routes away from unreliable Providers without on-chain penalties.

## Model Verification
The process by which the Marketplace confirms a Provider is serving the declared Model (HF repo ID).

Two mechanisms run in combination:
- **Fingerprinting** — at onboarding, the Marketplace runs a lightweight behavioural fingerprint check (known token probability signatures for the declared model) to confirm model identity before the Provider is listed.
- **Challenge Sampling** — post-listing, the Marketplace periodically sends known prompts on a randomised schedule and statistically checks responses against expected model behaviour. Catches bait-and-switch after approval.

A Provider caught serving a different model than declared is slashed and delisted. Slashed stake funds dispute resolution.

## Protocol Fee
1% of each Session settlement, taken at the smart contract level before paying out to the Provider. Callers pay the Provider's listed token price; the contract routes 99% to the Provider and 1% to the protocol treasury. No spread or markup on top of Provider pricing.

## Stake
USDC deposited by a Provider before listing on the Marketplace. Slashed (partially or fully forfeited) only for provable fraud — serving a different model than declared, or overbilling. Downtime is not a slashable offence; it affects the Provider's Router score instead. No protocol token in v1.

## Session
The active billing period for a Caller — the window between depositing USDC into the Marketplace contract for their wallet address and that balance reaching zero (or being withdrawn). No discrete on-chain open/close event; the Session is a soft construct defined by the presence of a funded balance. Inference requests debit against the balance without per-request on-chain transactions. If balance hits zero mid-session, the next request returns HTTP 402.

## Proof of Inference
The mechanism by which the Marketplace verifies that a Provider made a real upstream LLM request and that billing reflects actual token usage.

- **Self-hosted Providers:** optimistic trust with on-chain staking/slashing for dispute resolution.
- **API-delegating Providers:** zkTLS — a cryptographic proof over the TLS session with the upstream API, proving the server identity and the `usage` response (token counts) without revealing the provider's API key. Settlement is async: the Caller receives a streamed response immediately; the zkTLS proof is generated in the background and settles billing on-chain within seconds.

## Chain
The blockchain network used for on-chain settlement, staking, and balance tracking.

- **v1:** Base (EVM). Native USDC, mature x402 tooling, EIP-712 signing supported across major wallets.
- **v2:** Solana added as a second funding rail. Callers fund whichever chain matches their wallet; the proxy checks the correct contract before routing. Agents are chain-unaware.

## Bearer Token
The credential Callers use to authenticate requests. Derived by signing a structured message `{address, expiry, nonce}` with the Caller's wallet private key — no gas, no on-chain transaction, no registration step. The signature itself is the token.

The proxy recovers the signer address from the signature on every request, checks the Caller's on-chain USDC balance for that address, and proceeds if funded. If balance is zero, returns HTTP 402.

Callers fund their balance on-chain independently. Token expiry limits the blast radius of a leaked token — the attacker can only drain whatever USDC is deposited for that address.

Passed in request headers using the convention of the Caller's API Format: `Authorization: Bearer <token>` (OpenAI) or `x-api-key: <token>` (Anthropic).

## Session Key
A keypair generated by the Caller and authorised via a wallet signature. Used when the Caller wants to keep their root wallet cold — the session keypair signs requests instead of the root wallet. The authorisation is submitted on-chain. Optional; Callers who are comfortable signing at runtime can use a Bearer Token derived from their root wallet directly.
