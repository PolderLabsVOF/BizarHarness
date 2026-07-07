# Hermes Trajectory Pipeline — Batch Run to Training Data

## 1. batch_runner.py — Full Architecture

**File:** `batch_runner.py` (~1,500 lines)

### Multiprocessing Architecture

`BatchRunner` uses Python's `multiprocessing.Pool` to distribute prompt files across worker processes. The pool is created with `maxtasksperchild` to prevent memory leaks in long-running batch jobs.

```python
# Core dispatch loop (simplified from batch_runner.py)
with Pool(processes=num_workers) as pool:
    async_results = [
        pool.apply_async(_process_single_prompt, (prompt_item, run_config))
        for prompt_item in prompt_items
    ]
    results = [ar.get(timeout=task_timeout) for ar in async_results]
```

### Failure Handling

Each `_process_single_prompt()` call is wrapped in try/except. On failure:

1. The error is caught and stored in the trajectory output with `status: error`
2. The error message and traceback are stored in `trajectory.error`
3. Processing continues to the next prompt (no early termination)
4. A `failed_count` counter is incremented and reported at batch end

Failed trajectories are not discarded — they are stored alongside successful ones and included in the trajectory output directory. This ensures the training data reflects real agent behavior including failure modes.

### Checkpoint / Resume

`BatchRunner` supports resume via a checkpoint file at `data/<run_name>/.checkpoint`. On resume:

1. The checkpoint is loaded, containing the set of already-processed prompt IDs
2. The pool is re-created with the same `num_workers`
3. Only prompts not in the checkpoint are dispatched
4. After each successful completion, the checkpoint is updated (append mode)

The checkpoint format: `JSON Lines` — one JSON object per line, each with `prompt_id` and `trajectory_path`.

### Output Directory Structure

```
data/<run_name>/
  ├── trajectories/
  │   ├── prompt_0001.jsonl
  │   ├── prompt_0002.jsonl
  │   └── ...
  ├── metrics/
  │   ├── tool_stats.json
  │   ├── reasoning_stats.json
  │   └── aggregate_summary.json
  ├── .checkpoint
  └── run_manifest.jsonl  # metadata about the run itself
```

### Key Functions

| Function | Location | Purpose |
|---|---|---|
| `_process_single_prompt()` | `batch_runner.py` | Runs one prompt through the agent, returns trajectory |
| `_save_trajectory()` | `batch_runner.py` | Writes trajectory JSONL to `data/<run_name>/trajectories/` |
| `_extract_tool_stats()` | `batch_runner.py` | Aggregates tool call counts, latencies, success rates |
| `_extract_reasoning_stats()` | `batch_runner.py` | Aggregates model reasoning token usage per turn |
| `BatchRunner.run()` | `batch_runner.py` | Main entry — creates pool, dispatches, collects results |
| `BatchRunner.checkpoint()` | `batch_runner.py` | Persists checkpoint state |

---

## 2. Trajectory Format

### JSON Schema

A trajectory is a JSON object with the following top-level fields:

```json
{
  "run_id": "string",
  "prompt_id": "string",
  "model": "string",
  "created_at": "ISO8601 timestamp",
  "status": "success | error | timeout | cancelled",
  "error": "string | null",
  "total_turns": "integer",
  "total_tokens": "integer",
  "total_cost_usd": "float",
  "turns": [Turn],
  "tool_stats": {"tool_name": ToolStat},
  "reasoning_stats": {"turn_id": ReasoningStat}
}
```

### Turn Object

```json
{
  "turn_index": "integer",
  "role": "user | assistant | tool",
  "content": "string",
  "tool_calls": [{"name": "string", "parameters": {}, "result": "string", "duration_ms": "float"}],
  "model": "string",
  "tokens_in": "integer",
  "tokens_out": "integer",
  "latency_ms": "float",
  "thinking": "string | null"
}
```

### Multi-turn

A trajectory with `total_turns: 5` means the agent took 5 assistant turns to completion (or failure). Each turn has its own `tokens_in`, `tokens_out`, `latency_ms`, and optionally `tool_calls` and `thinking` fields. The `thinking` field captures the model's chain-of-thought reasoning when enabled in the model config.

### Example

```json
{
  "run_id": "run-2024-01-15-hermes-3b-web",
  "prompt_id": "prompt_0001",
  "model": "hermes-3-llama-3.1-405b",
  "status": "success",
  "total_turns": 3,
  "turns": [
    {
      "turn_index": 0,
      "role": "user",
      "content": "What is the capital of France?",
      "tool_calls": [],
      "tokens_in": 12,
      "tokens_out": 0
    },
    {
      "turn_index": 1,
      "role": "assistant",
      "content": "The capital of France is Paris.",
      "tool_calls": [],
      "tokens_in": 24,
      "tokens_out": 8,
      "latency_ms": 142.3
    }
  ]
}
```

---

## 3. Trajectory Compression

### The 6-Step Algorithm

**File:** `trajectory_compressor.py` (~1,500 lines)

`TrajectoryCompressor` implements a 6-step compression pipeline:

**Step 1 — Protect Head**
The first N turns (configurable, default `protected_turns: {head: 3, tail: 3}`) are preserved verbatim. These turns contain the task framing, tool definitions, and grounding context — information that should not be summarized away.

**Step 2 — Protect Tail**
The last N turns are also preserved verbatim. These contain the final answer, verification steps, and any error recovery that succeeded. The tail is the most valuable training signal for "how to finish a task correctly."

**Step 3 — Identify Middle Turns**
All turns between the protected head and protected tail are designated "middle turns" — the working middle of the conversation where the agent explored, failed, backtracked, or refined.

**Step 4 — Group Middle Turns by Topic**
Middle turns are grouped into semantic segments (e.g., "search phase", "verification phase", "tool-calling phase") to preserve contextual coherence during summarization.

**Step 5 — LLM Summarization of Each Segment**
Each segment is summarized via `google/gemini-3-flash-preview` (configured in `trajectory_compression.yaml`). The prompt instructs the model to produce a concise narrative that preserves:
- The goal of the segment
- Key tool calls and their outcomes
- Any failure/recovery patterns
- Decisions that changed direction

**Step 6 — Reconstruct Compressed Trajectory**
The final compressed trajectory is: `protected_head + [summarized_segment...] + protected_tail`. The total token count of the output is targeted to `target_max_tokens: 29000` (from `trajectory_compression.yaml`).

### Middle-turn LLM Compression

The use of an LLM (rather than naive truncation) to summarize middle turns is the key design choice. Naive truncation would either cut the most informative middle turns entirely or leave them as noisy raw transcripts. LLM summarization:

- Preserves semantic intent even when the token budget is severely reduced
- Can compress a 50-turn middle section to ~500 tokens while retaining the key decisions
- Produces training data that is denser in useful patterns per token than the raw transcript

The summarization model (`google/gemini-3-flash-preview`) is selected for cost efficiency — it is a fast, cheap Flash-tier model so the compression cost is a small fraction of the trajectory value.

### Why Compress

Without compression:
- A 100-turn trajectory at ~800 tokens/turn = 80,000 tokens
- This exceeds context windows and is prohibitively expensive for training data iteration

With compression targeting 29,000 tokens:
- The same trajectory fits in context, is cheap to re-run through training loops
- Multiple compressed trajectories can be batched in a single training step

---

## 4. Training Data Generation

### Output Format

The compressed trajectory pipeline outputs JSONL (JSON Lines) files, one trajectory per line. Each line is a complete compressed trajectory ready for training:

```json
{"prompt_id": "p001", "compressed": [...turns], "original_total_turns": 47, "compressed_total_turns": 11, "compression_ratio": 0.23}
```

The `compressed` field is the output of Step 6 (reconstructed compressed trajectory). Additional metadata fields record the compression ratio so training jobs can filter by compression level.

### Destination

Training data is written to `data/<run_name>/training_data/`. The directory structure mirrors the trajectory structure, and a `dataset_manifest.jsonl` is written listing all files and their compression metadata.

### Filtering

`trajectory_compressor.py` exposes a `CompressionConfig` with the following filters:

```python
class CompressionConfig:
    target_max_tokens: int = 29000
    protected_turns: dict = {"head": 3, "tail": 3}
    min_compression_ratio: float = 0.05  # discard if compressed below 5% of original
    max_compression_ratio: float = 1.0   # no expansion
    filter_errors: bool = True           # exclude error status trajectories
```

After compression, trajectories failing the filter criteria are moved to `data/<run_name>/filtered/` rather than discarded, preserving auditability.

---

## 5. datagen-config-examples

The `datagen-config-examples/` directory contains YAML configuration files that define the scenarios under which trajectories are collected for training data generation.

### Config Schema

```yaml
scenario_name: <string>
model: <model identifier>
temperature: <float>
max_tokens: <integer>
system_prompt: <string>
prompt_files:
  - glob: <glob pattern>
  - or: [list of prompt file paths]
tools:
  - <tool_name>
compression:
  enabled: <bool>
  target_max_tokens: <integer>
  protected_turns: {head: <int>, tail: <int>}
batch:
  num_workers: <integer>
  checkpoint_interval: <integer>
```

### Common Scenarios

**Scenario: Web Research Agent Fine-tuning**
```yaml
scenario_name: web-research-ft
model: nousresearch/hermes-3-llama-3.1-405b
temperature: 0.7
max_tokens: 4096
tools: [web_search, web_fetch, browser_navigate]
compression:
  enabled: true
  target_max_tokens: 29000
```

**Scenario: Code Completion from Trajectories**
```yaml
scenario_name: code-completion-ft
model: hermes-3-llama-3.1-405b
temperature: 0.2
max_tokens: 2048
tools: [read, edit, bash, glob]
compression:
  enabled: true
  target_max_tokens: 20000
  protected_turns: {head: 5, tail: 5}
```

**Scenario: Multi-step Reasoning**
```yaml
scenario_name: reasoning-ft
model: hermes-3-llama-3.1-405b
temperature: 0.9
max_tokens: 8192
system_prompt: "You are a reasoning agent. Think step by step."
tools: [web_search, calculator, knowledge_retrieval]
compression:
  enabled: true
  target_max_tokens: 32000
```

### How Configs Drive batch_runner

The `batch_runner.py` `run()` method accepts a `run_config` dict that is the loaded YAML. It extracts:
- `model` → agent model selection
- `batch.num_workers` → pool size
- `compression.*` → passed to `TrajectoryCompressor`
- `prompt_files` → globs resolved to the list of prompt files to process

---

## 6. Use Cases

### Who Uses This Pipeline

**ML practitioners fine-tuning open-source models** — the pipeline produces training data from trajectories generated by a teacher model (Hermes-3-405B), which is then used to fine-tune smaller student models. The student model learns the teacher's tool-use patterns, error recovery strategies, and multi-step reasoning approaches.

**Researchers studying agent behavior** — trajectory data is the ground truth for understanding how agents approach multi-step problems. The compression pipeline enables rapid iteration on analysis by producing tractable-sized data files.

**Agent developers optimizing prompts** — tool call statistics from `_extract_tool_stats()` reveal which tools are most frequently called, which succeed, which fail, and what the typical latency is. This feeds directly into prompt engineering.

### What It Trains

The output format supports multiple training modalities:

| Training Mode | Input | Description |
|---|---|---|
| Behavior cloning | (prompt, compressed_turns) | Train student to imitate teacher on same tasks |
| Preference learning | (turn_A, turn_B, preference) | Rank successful vs failed trajectories |
| Reasoning distillation | (prompt, thinking + answer) | Train on chain-of-thought reasoning traces |
| Tool use | (prompt, tool_sequence) | Train on tool call ordering and parameterization |

### The Agent ↔ Model Loop

```
Teacher Model (Hermes-3-405B)
    │ generates trajectories
    ▼
batch_runner.py → trajectories stored in data/<run_name>/
    │
    ▼
trajectory_compressor.py → compressed JSONL training data
    │
    ▼
Training job → fine-tuned student model (e.g., Hermes-3-8B)
    │
    ▼
Student model runs in agent → generates new trajectories
    │
    ▼
batch_runner.py (new run) → curator detects skill gaps
    │
    ▼
Skill auto-creation → new/revised SKILL.md authored
    │
    ▼
Teacher model (or new student) picks up skill → loop restarts
```

This is the outer loop of the learning system: the model being trained is the same model that participates in the learning loop described in `learning-loop.md`.

---

## 7. Comparison to OpenAI's Approach

### OpenAI's o1/r1 Reasoning Approach

OpenAI's o1 and r1 models use **reinforcement learning with verifiable rewards** — the model generates a reasoning chain, receives a binary reward signal (correct/incorrect on a test case), and the reasoning chain is reinforced via policy gradient methods. The key claim is "self-play" — the model improves by generating and evaluating its own reasoning traces.

### How Hermes Differs

| Dimension | OpenAI o1/r1 | Hermes Trajectory Pipeline |
|---|---|---|
| Learning signal | Verifiable reward (math, code execution) | Outcome reward (task success/failure from trajectory status) |
| Model improvement | Policy gradient on reasoning chain | Behavior cloning on compressed trajectories |
| Skill creation | None (monolithic model) | Autonomous SKILL.md authoring by Curator |
| Multi-turn memory | Context window only | FTS5 long-term session memory + Honcho peer cards |
| Human in loop | Required for reward shaping | Optional (via config toggles) |
| Tool use | Implicit in reasoning chain | Explicit tool_calls with typed parameters in trajectory |
| Failure data | Used if task failed | Explicitly captured with error field, used for training |

### Self-Improving Claims

Hermes does **not** claim that the model improves purely from its own output via self-play (the o1 claim). Instead, it claims:

1. The **Curator closes the loop** — skill auto-creation means the agent's behavior improves not just from better next-token prediction, but from the explicit authoring of skill documents that change which tools the agent reaches for.
2. The **trajectory pipeline closes the outer loop** — training data from successful trajectories fine-tunes a student model, which then generates new trajectories, which are reviewed by the Curator, which may author new skills.
3. The **FTS5 + Honcho layer provides grounding** — unlike o1's opaque reasoning chain, Hermes's trajectories are grounded in actual tool calls with actual outcomes, stored in an indexed, queryable memory. This means the learning signal is more directly tied to observable behavior.

The self-improvement in Hermes is more like **compiled procedure learning** than self-play RL: the agent learns to write better skills (which are procedures), not just to generate better tokens.

### Failure Modes Compared to o1

- **o1**: fails when the reward signal is sparse or only evaluable post-hoc (e.g., creative writing, open-ended research)
- **Hermes**: fails when the Curator's pattern detection threshold is misconfigured (too few sessions = noisy skills; too many = slow adaptation)

---

## 8. Code References

### batch_runner.py — File Locations

| Claim | Location |
|---|---|
| Pool-based multiprocessing | `_process_single_prompt()` and Pool dispatch in `BatchRunner.run()` |
| `maxtasksperchild` for memory management | Pool initialization in `BatchRunner.run()` |
| `_save_trajectory()` writes JSONL | `batch_runner.py` |
| `_extract_tool_stats()` | `batch_runner.py` |
| `_extract_reasoning_stats()` | `batch_runner.py` |
| Checkpoint format (JSON Lines) | `BatchRunner.checkpoint()` |
| Resume logic (load checkpoint, skip processed) | `BatchRunner.run()` resume branch |
| Output directory `data/<run_name>/` | `BatchRunner.run()` path construction |
| `run_manifest.jsonl` metadata | `BatchRunner.run()` |

### trajectory_compressor.py — File Locations

| Claim | Location |
|---|---|
| `TrajectoryCompressor` class | `trajectory_compressor.py` |
| 6-step compression algorithm | `compress()` method in `TrajectoryCompressor` |
| Step 1 — protect head | `CompressionConfig.protected_turns` + slice in `compress()` |
| Step 2 — protect tail | `CompressionConfig.protected_turns` + slice in `compress()` |
| Step 5 — LLM summarization via `google/gemini-3-flash-preview` | `trajectory_compression.yaml` + `Summarizer` call in `compress()` |
| `TrajectoryMetrics` | `trajectory_compressor.py` |
| `AggregateMetrics` | `trajectory_compressor.py` |
| `CompressionConfig` with `target_max_tokens: 29000` | `trajectory_compression.yaml` |
| Filter: `filter_errors: True` | `CompressionConfig` defaults |
| Output to `data/<run_name>/training_data/` | `TrajectoryCompressor.write()` |

### Configuration Files

| File | Purpose |
|---|---|
| `web_research.yaml` | Backend config for web research trajectories (openrouter/nousresearch/hermes-3-llama-3.1-405b, compression enabled) |
| `trajectory_compression.yaml` | Compression config (tokenizer: moonshotai/Kimi-K2-Thinking, summarization via google/gemini-3-flash-preview, target_max_tokens: 29000) |

### Integration Points

| Claim | Location |
|---|---|
| `maybe_run_curator()` called from `cli.py` | `cli.py:13171` |
| `maybe_run_curator()` called from `gateway/run.py` | `gateway/run.py:19779–19785` |
| Skill usage telemetry | `tools/skill_usage.py` |
| FTS5 virtual table schema | `hermes_state.py:813–856` |
| FTS5 triggers (insert/delete/update) | `hermes_state.py:813–856` |
| TRIGRAM index for CJK | `hermes_state.py:813–856` (FTS_TRIGRAM_SQL) |
| Honcho dialectic Q&A | `plugins/memory/honcho/__init__.py` |
| MemoryProviderABC | `agent/memory_provider.py` |
