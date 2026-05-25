# Colosseum Copilot — LLM Proxy/Marketplace Research

## Project Overview

Building a crypto-native LLM proxy: **one endpoint, one wallet, every model. No API keys.**

- OpenAI-compatible `/v1/chat/completions` endpoint
- Wallet auth via EIP-712 session keys
- LiteLLM under the hood (100+ providers)
- On-chain billing via x402 protocol + USDC
- EVM-first, Solana as second rail

## API Configuration

```bash
export COLOSSEUM_COPILOT_API_BASE="https://copilot.colosseum.com/api/v1"
export COLOSSEUM_COPILOT_PAT="<set in environment>"  # expires 2026-08-20
```

Key endpoints:
- `GET /status` — auth check
- `GET /filters` — available hackathons, categories
- `GET /projects/search?q=...` — search the corpus
- `GET /archives/:id` — fetch full research documents
- `POST /research/deep-dive` — 8-step deep dive analysis

## Research Context (from prior session)

### Prior art already identified:

| Project | Hackathon | Relevance |
|---------|-----------|-----------|
| solrouter | Cypherpunk | Multi-model, USDC, wallet auth; Solana-only, UI studio not proxy |
| latinum-agentic-commerce | Breakout (1st place AI, $25k) | Agent payment middleware, API key sprawl pain; general purpose, no LLM routing |
| agent-cred | Cypherpunk | Hotkey/coldkey spending limits, agent payment infra; pure infra, no LLM layer |
| solaibot | Cypherpunk | Agent autonomous payments; general toolkit, not proxy |
| solana-a2a-payment | Cypherpunk | x402 + Solana Pay adaptation |

### Open threads:
- Galaxy Research x402 doc (archive ID: 21fe158b-da81-40d7-89c0-a726e79191e2) — not yet pulled
- "Frontier" hackathon entries — not yet indexed
- "autohodl" project — not found, needs more search context
- Full 8-step deep dive — not triggered yet

### Available hackathons in corpus:
Renaissance (Mar 2024), Radar (Sep 2024), Breakout (Apr 2025), Cypherpunk (Sep 2025)

## Project Conventions

- Use `colosseum-copilot` skill for all API interactions
- Before any creative/design work, invoke brainstorming skill
- Before committing to architecture decisions, invoke grill-me skill
- Save research findings to `research/` directory with dated filenames
- Use subagent scout for broad searches, evaluator for comparing ideas to prior art
