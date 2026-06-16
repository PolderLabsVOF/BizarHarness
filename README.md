# BizarHarness — Norse Pantheon Agent Stack

A 6-agent opencode hierarchy named after Norse gods, with automatic cost-aware routing from free (DeepSeek) through mid-tier (MiniMax M2.7) and high-tier (MiniMax M3) up to GPT-5.5 as the ultimate fallback.

## Agents

| Agent | God | Model | Cost | Role |
|-------|-----|-------|------|------|
| **Odin** 🛡️ | All-Father | DeepSeek V4 Flash Free | Free | Router + simple tasks |
| **Heimdall** 👁️ | Watchman | DeepSeek V4 Flash Free | Free | Mechanical/routine work |
| **Hermod** ✉️ | Messenger | DeepSeek V4 Flash Free | Free | Git/gh operations |
| **Thor** ⚡ | Thunder | MiniMax M2.7 | $0.30/$1.20 | Moderate complexity |
| **Tyr** ⚖️ | Law | MiniMax M3 | Highest | Complex impl/debug |
| **Vidarr** 🔥 | Vengeance | GPT-5.5 | Highest | Last resort |
| **Forseti** 🔍 | Justice | MiniMax M3 *(edit:deny)* | Highest | Plan auditor |

## Architecture

```
User Request
  └─ Odin (router)
       ├─ Tier 1     → Self-handle (free)
       ├─ Tier 2     → @heimdall  (free, mechanical)
       ├─ Git Ops    → @hermod    (free, git/gh)
       ├─ Tier 3     → @thor      ($, medium)
       ├─ Tier 4     → @tyr       ($$, complex) ──┐
       └─ Tier 5     → @vidarr    ($$$, last resort) │
                                                     │
                          ┌──────────────────────────┘
                          ▼
                    @forseti (audit gate, edit:deny)
                          │
                          ▼
                    Execute
```

- Odin routes every request by complexity
- Forseti audits all Tier 4 and Tier 5 plans before any code is written
- Vidarr is invoked only when Tyr fails or debugging stalls
- All agents use Hindsight memory (default bank) for cross-session context

## Installation

```bash
# Clone and install
git clone git@github.com:DrB0rk/BizarHarness.git
cd BizarHarness
chmod +x install.sh
./install.sh
```

## Prerequisites

- [opencode CLI](https://opencode.ai)
- API keys for your chosen providers (set up via `/connect` in opencode TUI)
- A [Hindsight](https://memory-api.polderlabs.io) API key for persistent memory

## Provider Setup

After installation, run `/connect` in opencode to add:

| Provider | Models | Cost |
|----------|--------|------|
| OpenCode Zen | DeepSeek V4 Flash Free | Free |
| minimax.io | MiniMax M2.7, MiniMax M3 | Pay-per-token |
| OpenAI (ChatGPT sub) | GPT-5.5 | Subscription |
