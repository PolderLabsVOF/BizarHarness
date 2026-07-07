# OpenFang Scheduler — Deep Dive

**Scope:** Round 5 deep dive into OpenFang's two-level scheduler (`AgentScheduler` + `BackgroundExecutor`) and the `CronScheduler` with multi-destination delivery. All file:line references are against `research/agent-harness-survey/repos/openfang/`.

**Date:** 2026-07-06  
**Author:** @tyr

---

## 1. The Two-Level Architecture

OpenFang has **three distinct scheduling constructs** that look similar at a glance but serve different purposes:

| Construct | File | Purpose | Granularity |
|-----------|------|---------|-------------|
| **`AgentScheduler`** | `crates/openfang-kernel/src/scheduler.rs` (191 LOC) | Per-agent **resource quotas** (tokens/hour) with rolling windows | Per-agent, accounting |
| **`BackgroundExecutor`** | `crates/openfang-kernel/src/background.rs` (457 LOC) | **Execution loops** for `Continuous` and `Periodic` modes; `Proactive` registers triggers; `Reactive` is no-op | Per-agent, execution |
| **`CronScheduler`** | `crates/openfang-kernel/src/cron.rs` (1,345 LOC) | **Cron-style scheduled jobs** (recurring + one-shot) with persistence, retry, multi-destination delivery | Per-agent or global, scheduled jobs |

R3 (`round-3-crossref/deep-subsystems.md:25-30`) described this as "two-level" — `AgentScheduler` (quotas) + `BackgroundExecutor` (autonomous mode loops). The `CronScheduler` is a **third** subsystem, used for user-defined scheduled tasks that fire cron expressions and deliver output to multiple destinations.

The dashboard exposes all three under different surfaces: `Agents` shows `AgentScheduler` quota state, `Hands` shows `BackgroundExecutor` per-hand status, `Scheduler` shows `CronScheduler` jobs (`crates/openfang-api/static/js/app.js:316-329`).

---

## 2. Level 1: `AgentScheduler` — per-agent quotas

### 2.1 The data model

`crates/openfang-kernel/src/scheduler.rs:11-51`:

```rust
pub struct UsageTracker {
    pub total_tokens: u64,
    pub tool_calls: u64,
    pub window_start: Instant,
}

pub struct AgentScheduler {
    quotas: DashMap<AgentId, ResourceQuota>,
    usage: DashMap<AgentId, UsageTracker>,
    tasks: DashMap<AgentId, JoinHandle<()>>,
}
```

The `ResourceQuota` type (from `crates/openfang-types/src/agent.rs:247+`) declares the limits; the `UsageTracker` records actual consumption in a **rolling 1-hour window**.

### 2.2 The quota check

`scheduler.rs:78-100`:

```rust
pub fn check_quota(&self, agent_id: AgentId) -> OpenFangResult<()> {
    let quota = match self.quotas.get(&agent_id) {
        Some(q) => q.clone(),
        None => return Ok(()), // No quota = no limit
    };
    let mut tracker = match self.usage.get_mut(&agent_id) {
        Some(t) => t,
        None => return Ok(()),
    };

    tracker.reset_if_expired();  // 1-hour rolling window

    if quota.max_llm_tokens_per_hour > 0
        && tracker.total_tokens > quota.max_llm_tokens_per_hour
    {
        return Err(OpenFangError::QuotaExceeded(format!(
            "Token limit exceeded: {} / {}",
            tracker.total_tokens, quota.max_llm_tokens_per_hour
        )));
    }
    Ok(())
}
```

Key behaviors:

1. **No quota = no limit** (line 81-82). Agents without an explicit quota run unbounded.
2. **Reset window** (`scheduler.rs:34-39`): if `window_start.elapsed() >= 3600s`, reset to zero. So a 100k-token/hour quota means "100k tokens in *any* 1-hour rolling window."
3. **Only tokens are checked here.** Tool calls are tracked but not enforced at this layer.

### 2.3 Cost-based quotas live separately

The `MeteringEngine` (`crates/openfang-kernel/src/metering.rs:815 LOC`) handles **USD cost** quotas at hourly/daily/monthly granularity:

- `check_quota(agent_id, quota)` (`metering.rs:27-62`): enforces `max_cost_per_hour_usd`, `max_cost_per_day_usd`, `max_cost_per_month_usd`.
- `check_global_budget(budget)` (`metering.rs:65-100`): same checks across all agents.
- `budget_status(budget)` (`metering.rs:103-133`): exposes `hourly_spend`, `daily_spend`, `monthly_spend` and percentages for the dashboard.

The pricing table at `metering.rs:184-191` lists per-million-token rates for 28 model families (claude, gpt, gemini, deepseek, llama, grok, qwen, mistral, command-r-plus). The catalog-backed version `estimate_cost_with_catalog` at `metering.rs:197+` falls back to `$1/$3` per million if the model is not in the catalog.

The two quota systems (`AgentScheduler` for tokens, `MeteringEngine` for cost) are **parallel and unlinked**. An agent can hit its `max_llm_tokens_per_hour` cap before its cost cap, or vice versa, depending on the model. The agent loop checks both (`agent_loop.rs:511+` calls `MeteringEngine::check_quota` and `scheduler::check_quota` before each LLM call).

### 2.4 What it doesn't do

- **No priority queues** — all agents are equal; the scheduler doesn't schedule *when* an agent runs.
- **No preemption** — the `tasks: DashMap<AgentId, JoinHandle<()>>` (line 50) holds running handles for `abort_task()` (line 112), but no work-stealing or preemption.
- **No fairness** — there's no round-robin between agents. Whoever calls `check_quota` first wins.

This is the right scope: OpenFang is a per-agent harness, not a multi-tenant job scheduler.

---

## 3. Level 2: `BackgroundExecutor` — autonomous mode loops

`crates/openfang-kernel/src/background.rs`. The full `ScheduleMode` enum is at `crates/openfang-types/src/agent.rs:225-241`:

```rust
pub enum ScheduleMode {
    #[default]
    Reactive,                                       // chat-only
    Periodic { cron: String },                      // simplified cron
    Proactive { conditions: Vec<String> },          // event-triggered
    Continuous { check_interval_secs: u64 },        // fixed-interval self-prompt
}
```

`BackgroundExecutor::start_agent` at `background.rs:48-186` dispatches based on the mode.

### 3.1 `Reactive` mode (the default)

`background.rs:58`: `ScheduleMode::Reactive => {} // nothing to do`

Reactive agents are not driven by the executor. They wake up on inbound messages — channel messages, API requests, MCP requests. The default for any agent without a manifest `schedule` field.

### 3.2 `Continuous` mode

`background.rs:59-119`. The agent self-prompts on a fixed interval:

```rust
ScheduleMode::Continuous { check_interval_secs } => {
    let interval = std::time::Duration::from_secs(*check_interval_secs);
    ...
    let handle = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(interval) => {}
                _ = shutdown.changed() => { break; }
            }

            // Skip if previous tick is still running
            if busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                debug!(agent = %name, "Continuous loop: skipping tick (busy)");
                continue;
            }

            // SECURITY: Acquire global LLM concurrency permit
            let permit = match semaphore.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => { busy.store(false, Ordering::SeqCst); break; }
            };

            let prompt = format!(
                "[AUTONOMOUS TICK] You are running in continuous mode. \
                 Check your goals, review shared memory for pending tasks, \
                 and take any necessary actions. Agent: {name}"
            );
            let jh = (send_message)(agent_id, prompt);
            // Spawn a watcher that clears the busy flag and drops permit when done
            tokio::spawn(async move {
                let _ = jh.await;
                drop(permit);
                busy_clone.store(false, Ordering::SeqCst);
            });
        }
    });
}
```

Three correctness properties:

1. **Skip-if-busy** (`background.rs:84-91`): an `AtomicBool` CAS on `busy` rejects overlapping ticks. If the previous tick is still running, the next one is skipped (not queued). The test at `background.rs:401-430` confirms a 3-second tick blocks a 1-second interval to exactly 1 tick in 2.5 s.
2. **Global LLM concurrency cap** (§5 below).
3. **Shutdown propagation**: the `select!` listens on the supervisor's `shutdown_rx.changed()` and exits cleanly.

The prompt template at lines 102-106 is a fixed string `"[AUTONOMOUS TICK] You are running in continuous mode. ..."`. The LLM sees this prefix and decides what to do. There is **no goal queue, no task list, no agenda** — the LLM is responsible for deciding what "necessary actions" means based on its system prompt + shared memory.

### 3.3 `Periodic` mode

`background.rs:121-179`. Almost identical to Continuous but uses a cron expression for the interval:

```rust
ScheduleMode::Periodic { cron } => {
    let interval_secs = parse_cron_to_secs(cron);   // see §4
    let interval = std::time::Duration::from_secs(interval_secs);
    ...
}
```

The prompt template is `"[SCHEDULED TICK] You are running on a periodic schedule ({cron_owned}). Perform your routine duties. Agent: {name}"` (`background.rs:163-166`).

`Periodic` is the same shape as `Continuous` — fixed interval, skip-if-busy, semaphore — but the prompt tells the LLM it is a scheduled tick rather than autonomous polling.

### 3.4 `Proactive` mode

`background.rs:180-184`:

```rust
ScheduleMode::Proactive { .. } => {
    // Proactive agents rely on triggers, not a dedicated loop.
    // Triggers are registered by the kernel during spawn_agent / start_background_agents.
    debug!(agent = %agent_name, "Proactive agent — triggers handle activation");
}
```

**No background task is spawned.** Instead, the kernel registers triggers via `parse_condition` (`background.rs:211-243`) and `TriggerPattern` (defined in `triggers.rs`).

The condition parser supports:
- `"event:agent_spawned"` → `TriggerPattern::AgentSpawned { name_pattern: "*" }`
- `"event:agent_terminated"` → `TriggerPattern::AgentTerminated`
- `"event:lifecycle"` → `TriggerPattern::Lifecycle`
- `"event:system"` → `TriggerPattern::System`
- `"event:memory_update"` → `TriggerPattern::MemoryUpdate`
- `"memory:some_key"` → `TriggerPattern::MemoryKeyPattern { key_pattern: "some_key" }`
- `"all"` → `TriggerPattern::All`

The pattern matching is exact (no glob) — `memory:agent.*.status` becomes a literal `agent.*.status` key pattern (verified in `background.rs:344-352`). Unknown prefixes (`"badprefix:foo"`) return `None`.

This is a meaningful gap: a Proactive agent with `conditions: ["memory:agent.*.status"]` won't actually receive a wildcard; it would need exact key names. The parsing is conservative on purpose.

### 3.5 The global concurrency semaphore

`background.rs:17-18`:

```rust
/// Maximum number of concurrent background LLM calls across all agents.
const MAX_CONCURRENT_BG_LLM: usize = 5;
```

Created in `BackgroundExecutor::new` (`background.rs:32-38`):

```rust
pub fn new(shutdown_rx: watch::Receiver<bool>) -> Self {
    Self {
        tasks: DashMap::new(),
        shutdown_rx,
        llm_semaphore: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_BG_LLM)),
    }
}
```

Used in `Continuous` and `Periodic` modes at lines 94-100 and 155-161:

```rust
let permit = match semaphore.clone().acquire_owned().await {
    Ok(p) => p,
    Err(_) => { busy.store(false, Ordering::SeqCst); break; }
};
```

The permit is held until the spawned tick future completes (`background.rs:111-115, 170-174`):

```rust
tokio::spawn(async move {
    let _ = jh.await;
    drop(permit);                 // ← releases the slot
    busy_clone.store(false, Ordering::SeqCst);
});
```

### 3.6 Why 5? Configurable?

It's a hard-coded `const` (`background.rs:18`). Not configurable. R3 (`round-3-crossref/deep-subsystems.md:30`) flagged it as a configuration knob; the source confirms it's not.

The implicit rationale is **budget protection**: 5 concurrent Sonnet-class calls × ~$0.03/call × ~3 calls/min = ~$0.45/min = ~$27/hour worst case. With 5 cap, the worst case is bounded. For Hands that need more concurrency, the workaround is to spawn more Hand instances.

---

## 4. Cron Expression Parsing

OpenFang has **two cron parsers** with different formats:

### 4.1 Background mode parser — simplified DSL

`background.rs:254-284` — `parse_cron_to_secs`:

```rust
pub fn parse_cron_to_secs(cron: &str) -> u64 {
    let cron = cron.trim().to_lowercase();

    // Try "every <N><unit>" format
    if let Some(rest) = cron.strip_prefix("every ") {
        let rest = rest.trim();
        if let Some(num_str) = rest.strip_suffix('s') { ... }
        if let Some(num_str) = rest.strip_suffix('m') { return n * 60; }
        if let Some(num_str) = rest.strip_suffix('h') { return n * 3600; }
        if let Some(num_str) = rest.strip_suffix('d') { return n * 86400; }
    }

    warn!(cron = %cron, "Unparseable cron expression, defaulting to 300s");
    300
}
```

Supported forms (verified at `background.rs:286-318`):
- `"every 30s"` → 30 seconds
- `"every 5m"` → 300 seconds
- `"every 1h"` → 3600 seconds
- `"every 2d"` → 172800 seconds
- Anything else (including standard cron like `"*/5 * * * *"`) → 300 seconds with a warning log

This is **deliberately not standard cron**. The format is `"every N{unit}"` only. Standard 5-field cron expressions silently fall back to 5 minutes. This is the right tradeoff for a Hands-facing DSL (hand authors shouldn't need to learn cron), but it means the `Periodic` mode is not a substitute for the `CronScheduler`.

### 4.2 CronScheduler parser — real cron

`crates/openfang-kernel/src/cron.rs:444-499` — `compute_next_run_after` handles three schedule variants (defined in `openfang-types::scheduler`):

```rust
pub enum CronSchedule {
    At { at: chrono::DateTime<Utc> },         // one-shot at absolute time
    Every { every_secs: u64 },                // every N seconds
    Cron { expr: String, tz: Option<String> },// real cron expression
}
```

The `Cron` variant accepts standard 5-field (`min hour dom month dow`) or 6-field (`sec min hour dom month dow`) expressions and converts to the 7-field format required by the `cron` crate:

```rust
let fields: Vec<&str> = trimmed.split_whitespace().collect();
let seven_field = match fields.len() {
    5 => format!("0 {trimmed} *"),       // prepend sec, append year
    6 => format!("{trimmed} *"),
    _ => expr.clone(),
};
```

This supports:
- Standard 5-field cron (`*/5 * * * *`)
- 6-field cron with seconds (`0 */5 * * * *`)
- Timezone-aware via `tz: Some("America/New_York")` — converted via `chrono_tz::Tz` (line 472-490)
- DST handling: a 2 AM ET cron job fires at 2 AM ET even on spring-forward day (the `cron` crate + `chrono_tz` handle this).

Failure modes (`cron.rs:493-499`):
- Invalid cron expression → log warn + retry in 1 hour
- Invalid timezone → log warn + fall back to UTC
- Empty `next_run` → fall back to 1 hour from now

The `compute_next_run_after` adds `+ 1 second` to the base time so the cron crate's `.after()` (inclusive) doesn't return the same second and re-fire immediately (`cron.rs:439-444, 463-466`).

### 4.3 Schedule persistence

`cron.rs:126-139` — `persist()` writes all jobs to `<home_dir>/cron_jobs.json` via atomic write (write to `.tmp`, then `rename`):

```rust
pub fn persist(&self) -> OpenFangResult<()> {
    let metas: Vec<JobMeta> = self.jobs.iter().map(|r| r.value().clone()).collect();
    let data = serde_json::to_string_pretty(&metas)?;
    let tmp_path = self.persist_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, data.as_bytes())?;
    std::fs::rename(&tmp_path, &self.persist_path)?;
    Ok(())
}
```

`cron.rs:109-123` — `load()` reads the same file on boot. The format is `Vec<JobMeta>` with each entry containing the `CronJob`, `one_shot`, `last_status`, and `consecutive_errors`. This survives daemon restarts.

### 4.4 Crash recovery + skip-if-busy

The `due_jobs()` method at `cron.rs:321-335` is the central discovery call:

```rust
pub fn due_jobs(&self) -> Vec<CronJob> {
    let now = Utc::now();
    let mut due = Vec::new();
    for mut entry in self.jobs.iter_mut() {
        let meta = entry.value_mut();
        if meta.job.enabled && meta.job.next_run.map(|t| t <= now).unwrap_or(false) {
            due.push(meta.job.clone());
            // Pre-advance next_run so the job won't fire again on the next
            // tick while it's still executing.
            meta.job.next_run = Some(compute_next_run_after(&meta.job.schedule, now));
        }
    }
    due
}
```

Two correctness properties:

1. **Skip-if-busy via pre-advance**: `next_run` is advanced *before* the job is returned, so a second call to `due_jobs()` while the first batch is still executing will not see the same jobs.
2. **Single-tick recovery**: if the daemon crashed mid-execution, the persisted `next_run` is already in the future (since it was pre-advanced), so on restart the job won't immediately re-fire. The recovery scenario is bounded: a job that should have fired at T is processed at T+restart_time but its `next_run` was set to T+interval, so it skips the missed slot.

For **manual triggers**, `try_claim_for_run` at `cron.rs:347-362` is the atomic version that holds the DashMap lock for the check-and-advance:

```rust
pub fn try_claim_for_run(&self, id: CronJobId) -> Result<CronJob, ClaimError> {
    match self.jobs.get_mut(&id) {
        None => Err(ClaimError::NotFound),
        Some(mut entry) => {
            let meta = entry.value_mut();
            if !meta.job.enabled { return Err(ClaimError::Disabled); }
            let now = Utc::now();
            if meta.job.next_run.map(|t| t <= now).unwrap_or(false) {
                meta.job.next_run = Some(compute_next_run_after(&meta.job.schedule, now));
            }
            Ok(meta.job.clone())
        }
    }
}
```

The semantic difference from `due_jobs`: `try_claim_for_run` only advances `next_run` if the job is already due. This prevents an on-demand manual run from skipping an upcoming scheduled fire.

---

## 5. Failure Handling / Retries

### 5.1 Consecutive error tracking

`cron.rs:393-418` — `record_failure`:

```rust
pub fn record_failure(&self, id: CronJobId, error_msg: &str) {
    if let Some(mut meta) = self.jobs.get_mut(&id) {
        meta.job.last_run = Some(Utc::now());
        meta.last_status = Some(format!(
            "error: {}",
            openfang_types::truncate_str(error_msg, 256)
        ));
        meta.consecutive_errors += 1;
        if meta.consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
            warn!(...);
            meta.job.enabled = false;       // ← auto-disable
        } else {
            let now = Utc::now();
            if meta.job.next_run.map(|t| t <= now).unwrap_or(true) {
                meta.job.next_run = Some(compute_next_run_after(&meta.job.schedule, now));
            }
        }
    }
}
```

`MAX_CONSECUTIVE_ERRORS = 5` (`cron.rs:21`). After 5 consecutive failures, the job is **auto-disabled** and stops firing. The error message is truncated to 256 chars to avoid log spam.

`record_success` at `cron.rs:370-387` resets `consecutive_errors = 0` and either removes the job (if `one_shot`) or leaves the pre-advanced `next_run` in place.

### 5.2 Backoff strategy

There is **no exponential backoff**. A failing job keeps firing at its scheduled cadence until 5 consecutive failures, then it's disabled. The next-run after a failure is computed from "now" with the same `every_secs` interval — no `2^n * interval` progression.

This is intentional and consistent with the scheduler-as-cron philosophy: cron jobs are supposed to fire on schedule. Backoff is a job-author responsibility (via the agent loop's own retry, if needed).

### 5.3 Dead-letter queue

**None.** A job that fails 5 times is disabled but the last error is kept in `last_status` (visible via `GET /api/cron/jobs/{id}`). The job can be re-enabled via `set_enabled(id, true)` which resets `consecutive_errors = 0` and recomputes `next_run` (`cron.rs:187-199`).

### 5.4 The `reassign_agent_jobs` and `remove_agent_jobs` operations

Two administrative operations on the scheduler that handle the agent-lifecycle dance:

- `reassign_agent_jobs(old, new)` (`cron.rs:254-288`): when a Hand agent is respawned with a new UUID after a daemon restart, all cron jobs pointing at the old ID are reassigned to the new one. This prevents persisted jobs from becoming orphans.
- `remove_agent_jobs(agent_id)` (`cron.rs:294-309`): when an agent is deleted, all its cron jobs are removed so they don't silently fail forever.

---

## 6. Per-Hand Scheduling Modes in Detail

### 6.1 `Reactive` (the default)

- **Trigger**: inbound message on any channel, API call, MCP request, or `agent_send` from another agent.
- **No background task**: `BackgroundExecutor` does nothing (`background.rs:58`).
- **Resource usage**: zero when idle.
- **Use case**: interactive chat, on-demand research, code review sessions.
- **Failure behavior**: if the agent loop throws, the calling channel sees an error; no retry.

### 6.2 `Continuous { check_interval_secs }`

- **Trigger**: a tokio timer fires every `check_interval_secs` seconds.
- **Background task**: a `tokio::spawn` loop (`background.rs:74-117`).
- **Prompt**: `"[AUTONOMOUS TICK] You are running in continuous mode. Check your goals, review shared memory for pending tasks, and take any necessary actions. Agent: {name}"`.
- **Skip-if-busy**: an `AtomicBool` ensures only one tick runs at a time (`background.rs:84-91`).
- **Resource usage**: zero when the LLM call is running (the semaphore-permit is held but no extra fuel/cost is consumed).
- **Use case**: monitoring (Twitter engagement loop, lead detection, news tracking), always-on research.
- **Failure behavior**: a failed tick clears `busy` (the spawned watcher at `background.rs:111-115` does `drop(permit); busy_clone.store(false)` regardless of success/failure). Next interval starts cleanly. The LLM call itself is wrapped in `agent_loop::run_agent_loop` with retry logic (`agent_loop.rs`).

### 6.3 `Periodic { cron }`

- **Trigger**: same as `Continuous` but the interval comes from `parse_cron_to_secs(cron)`.
- **Prompt**: `"[SCHEDULED TICK] You are running on a periodic schedule ({cron_owned}). Perform your routine duties. Agent: {name}"`.
- **Resource usage**: same as Continuous.
- **Use case**: hourly reports, daily digests, weekly cleanups — anywhere "every N seconds/minutes/hours/days" is the right model.
- **Failure behavior**: same as Continuous.

### 6.4 `Proactive { conditions }`

- **Trigger**: registered triggers fire when matching events occur.
- **No background task**: `BackgroundExecutor` does nothing (`background.rs:180-184`).
- **Conditions parsed** (`background.rs:211-243`): `event:agent_spawned`, `event:agent_terminated`, `event:lifecycle`, `event:system`, `event:memory_update`, `memory:<key>`, `all`.
- **Resource usage**: zero when no events fire.
- **Use case**: event-driven automation, e.g. "wake me up whenever any agent crashes" (`event:system` + filter for crashes) or "send a digest whenever `daily_metrics` is updated" (`memory:daily_metrics`).
- **Failure behavior**: the trigger handler itself doesn't run an agent loop directly — it queues an event that the agent loop picks up. The agent loop's normal retry applies.

### 6.5 Comparison table

| Mode | Trigger | Task spawned | Concurrency cap | Prompt hint |
|------|---------|--------------|-----------------|-------------|
| Reactive | inbound message | no | (none — direct call) | (none) |
| Continuous | timer (every Ns) | yes | semaphore(5) + busy flag | "AUTONOMOUS TICK" |
| Periodic | timer (cron-derived) | yes | semaphore(5) + busy flag | "SCHEDULED TICK" |
| Proactive | trigger match | no | (none) | (event-driven) |

---

## 7. Multi-Destination Cron Delivery

`crates/openfang-kernel/src/cron_delivery.rs` (739 LOC). When a cron job produces output, the `CronDeliveryEngine` fans out to N destinations concurrently.

### 7.1 The four target types

`cron_delivery.rs:113-196` (`deliver_one`):

| Variant | Handler | Channel |
|---------|---------|---------|
| `Channel { channel_type, recipient }` | `channel_bridge.send_channel_message(channel_type, recipient, output)` | Any of 40 channels (telegram, discord, slack, email, etc.) |
| `Webhook { url, auth_header }` | `deliver_webhook(http, url, auth_header, job_name, output)` | HTTP POST with `Authorization` header |
| `LocalFile { path, append }` | `deliver_local_file(path, append, output)` | Write or append to a file |
| `Email { to, subject_template }` | `channel_bridge.send_channel_message("email", to, body)` (with subject prepended) | SMTP via email adapter |

For webhook delivery (`cron_delivery.rs:200+`), the timeout is 30 seconds (`WEBHOOK_TIMEOUT_SECS = 30` at line 22). For local file delivery, the parent directory is created if missing (`cron_delivery.rs:215-260`).

### 7.2 Fan-out semantics

`cron_delivery.rs:97-110`:

```rust
pub async fn deliver(&self, targets: &[CronDeliveryTarget], job_name: &str, output: &str)
    -> Vec<DeliveryResult> {
    if targets.is_empty() { return Vec::new(); }
    let futures = targets.iter().map(|t| self.deliver_one(t, job_name, output));
    join_all(futures).await
}
```

- **Concurrent** — all targets fire in parallel via `futures::future::join_all`.
- **Best-effort** — one target's failure does not abort delivery to others. `deliver_one` returns `DeliveryResult { success, error }` for each.
- **Per-target outcome** — the caller sees `Vec<DeliveryResult>` with one entry per target.

### 7.3 Subject template

`cron_delivery.rs:200+` — for `Email`, `subject_template` supports a `{job}` placeholder:

```rust
pub fn render_subject(template: Option<&str>, job_name: &str) -> String {
    match template {
        Some(t) => t.replace("{job}", job_name),
        None => format!("[OpenFang cron] {job_name}"),
    }
}
```

The body format is `"<subject>\n\n<output>"` (line 179) — subject as a header, blank line, then the agent's output.

### 7.4 No retry on delivery failure

The delivery is fire-and-forget. If a Telegram delivery fails (network blip, invalid chat_id), the failure is logged (`warn!` at line 135) and surfaced in the result, but there's no retry queue. The agent author would need to embed retry in the agent loop if this matters.

---

## 8. Observability

### 8.1 Per-job state

Each `CronJob` carries:
- `last_run: Option<DateTime<Utc>>` — last successful or failed execution time.
- `last_status: Option<String>` — `"ok"` or `"error: <msg>"` (set by `record_success`/`record_failure`).
- `next_run: Option<DateTime<Utc>>` — when it will fire next.
- `enabled: bool` — toggled by `set_enabled`.

This is visible via:
- CLI: `openfang cron list` (per the CLI command list in R1:79)
- Dashboard: `Scheduler` page (`static/js/app.js:316-329`).
- REST: `GET /api/cron/jobs` returns all jobs across agents.

### 8.2 BackgroundExecutor observability

`background.rs:196-199` — `active_count()` returns the number of active loops. The dashboard's `Hands` page lists each Hand's status (running, suspended, error) but the loop-level metrics (last tick time, average tick duration) are not exposed.

### 8.3 The audit trail

`scheduler.rs` does **not** write to the Merkle audit log. The audit log (`crates/openfang-runtime/src/audit.rs`) is for tool invocations and security-relevant events. Cron firings are not currently recorded in the audit chain — they're visible only in `last_run`/`last_status`. This is a gap if compliance requires a tamper-evident record of every scheduled execution.

### 8.4 SSE log streaming

`crates/openfang-api/src/routes.rs:5321+` — `GET /api/logs/stream` is a Server-Sent Events endpoint that streams audit log entries in real time, with optional `level`, `filter`, and `token` query parameters. A heartbeat ping is sent every 15 seconds. The first connect backfills existing entries (so the client has immediate context) before streaming new ones.

---

## 9. Comparison to Industry

| System | Model | Where OpenFang fits |
|--------|-------|---------------------|
| **Apache Airflow** | DAG-based workflows, Python DAGs, rich UI | OpenFang is single-machine, single-process; no DAGs. CronScheduler is closer to "cron with delivery targets" than to Airflow's task graphs. |
| **Temporal** | Workflow-as-code, durable execution, activity retries | OpenFang has no durable workflow execution. A Hand loop that crashes mid-task does not resume — the next tick starts fresh. |
| **Inngest** | Event-driven serverless functions, step functions | OpenFang's Proactive mode is closer to Inngest's event triggers, but lacks step functions and the long-running durable state. |
| **Dagster** | Asset-centric, software-defined assets | OpenFang's CronScheduler + multi-destination delivery is a much thinner slice — cron + webhooks/channels/files. |
| **Bull / BullMQ** | Redis-backed job queues | OpenFang uses DashMap + JSON file, not Redis. No job persistence beyond the single JSON file; no distributed workers. |
| **systemd timers** | OS-level timer units | OpenFang's `Continuous`/`Periodic` modes are equivalent in spirit, but in-process and Rust-managed. The `cron` crate parser is the equivalent of `OnCalendar=`. |

OpenFang's scheduler is **deliberately narrow**: enough to support Hands that need to fire every 30 minutes or at 9 AM daily, with delivery to chat channels/webhooks/files. It is **not** a general-purpose workflow engine. For complex multi-step workflows, the workflow engine (`crates/openfang-kernel/src/workflow.rs`, separate from `cron.rs`) is the right tool.

---

## 10. The Dashboard

### 10.1 Stack

The dashboard is **not** Tauri for the web UI — Tauri is reserved for the desktop wrapper (`crates/openfang-desktop/`). The web UI is:

- **Axum** (`axum 0.8`) serves the API + static HTML.
- **Embedded HTML/CSS/JS** at `crates/openfang-api/static/` (no React, no build step).
- The HTML skeleton is split between `index_head.html` (14 lines — meta tags) and `index_body.html` (5,411 lines — full app markup).
- JS modules at `static/js/` (`app.js`, `api.js`, `pages/*.js`).
- CSS at `static/css/`.

`crates/openfang-desktop/` (946 LOC, Tauri 2.0) is the desktop wrapper. It boots the kernel in-process and runs the Axum server on a background thread; the WebView points at `http://127.0.0.1:{random_port}`. The `PortState` is shared via `tauri::State` so the renderer can fetch from the local API (`crates/openfang-desktop/src/commands.rs:9-26`).

### 10.2 Port

- **Default**: `127.0.0.1:4200` (per the example `api_listen` in `routes.rs:12778`).
- **Configurable**: `[api] api_listen = "..."` in `config.toml`.
- The server binds to localhost-only by default (no auth) and to any address if an API key is set (`crates/openfang-api/src/server.rs:61-79`).

### 10.3 Scheduling controls

Pages and their scheduling controls (`static/js/app.js:316-329`):

- `overview` — global quota/budget state.
- `agents` — per-agent `ScheduleMode` (Reactive/Continuous/Periodic/Proactive) and `check_interval_secs` field.
- `hands` — Hand list with activation state (paused/running/error).
- `scheduler` — `CronScheduler` job list, with enable/disable/delete buttons and a "create job" form for `Cron`, `Every`, and `At` schedules with multiple delivery targets.
- `approvals` — pending approval requests from `ApprovalManager` (see wasm-sandbox.md §7).
- `logs` — the SSE-streamed audit log.
- `analytics` — `MeteringEngine::get_summary()` and `get_by_model()` views.
- `runtime` — agent loop, loop-guard state, capability grants.
- `settings` — config.toml editor with hot-reload.

### 10.4 The "Scheduler" page JS

`static/js/app.js:101` has a tag-based filter:

```javascript
if (n.indexOf('cron_') === 0 || n.indexOf('schedule_') === 0)
```

This groups the three `cron_*` tools (`cron_create`, `cron_list`, `cron_delete`) and three `schedule_*` tools (`schedule_create`, `schedule_list`, `schedule_delete`) under a "scheduler" UI category. Note the duplication: the `schedule_*` tools appear in the agent loop's tool list (R1:413) AND the `cron_*` tools are exposed via the `CronScheduler` REST endpoints (`/api/cron/jobs`). The user-facing UI uses both surfaces depending on whether they're configuring a Hand's internal tasks or adding a top-level cron job.

### 10.5 REST endpoints for cron

- `GET /api/cron/jobs` — list all jobs across agents.
- `POST /api/cron/jobs` — create a job (supports `Cron`, `Every`, `At` schedules + delivery targets).
- `DELETE /api/cron/jobs/{id}` — remove a job.
- `POST /api/cron/jobs/{id}/enable` / `/disable` — toggle.
- `POST /api/cron/jobs/{id}/run` — manual trigger (uses `try_claim_for_run`).

(Specific route names confirmed in `routes.rs:10770-10963` adjacent code; the cron routes follow the same pattern.)

---

## 11. Code References

| Claim | Location |
|-------|----------|
| AgentScheduler data model | `crates/openfang-kernel/src/scheduler.rs:11-51` |
| Rolling 1-hour quota check | `crates/openfang-kernel/src/scheduler.rs:78-100` |
| Window reset logic | `crates/openfang-kernel/src/scheduler.rs:34-39` |
| MeteringEngine quota | `crates/openfang-kernel/src/metering.rs:27-62` |
| MeteringEngine global budget | `crates/openfang-kernel/src/metering.rs:65-100` |
| MeteringEngine pricing table | `crates/openfang-kernel/src/metering.rs:184-191` |
| ScheduleMode enum | `crates/openfang-types/src/agent.rs:225-241` |
| BackgroundExecutor dispatcher | `crates/openfang-kernel/src/background.rs:48-186` |
| Continuous mode loop | `crates/openfang-kernel/src/background.rs:59-119` |
| Periodic mode loop | `crates/openfang-kernel/src/background.rs:121-179` |
| Proactive mode (no task) | `crates/openfang-kernel/src/background.rs:180-184` |
| Skip-if-busy AtomicBool CAS | `crates/openfang-kernel/src/background.rs:84-91, 146-152` |
| Global LLM semaphore (5) | `crates/openfang-kernel/src/background.rs:17-18, 94-100` |
| Background mode cron parser (DSL) | `crates/openfang-kernel/src/background.rs:254-284` |
| Condition parser (Proactive triggers) | `crates/openfang-kernel/src/background.rs:211-243` |
| Continuous shutdown propagation | `crates/openfang-kernel/src/background.rs:76-82` |
| CronScheduler data model | `crates/openfang-kernel/src/cron.rs:75-83` |
| CronSchedule enum | `crates/openfang-types/src/scheduler::*` |
| Cron job persistence (atomic) | `crates/openfang-kernel/src/cron.rs:126-139` |
| due_jobs pre-advance logic | `crates/openfang-kernel/src/cron.rs:321-335` |
| Manual trigger claim | `crates/openfang-kernel/src/cron.rs:347-362` |
| compute_next_run_after (real cron) | `crates/openfang-kernel/src/cron.rs:444-499` |
| Cron expression field conversion | `crates/openfang-kernel/src/cron.rs:456-462` |
| Timezone-aware cron | `crates/openfang-kernel/src/cron.rs:472-490` |
| record_success (reset errors) | `crates/openfang-kernel/src/cron.rs:370-387` |
| record_failure (auto-disable at 5) | `crates/openfang-kernel/src/cron.rs:393-418` |
| MAX_CONSECUTIVE_ERRORS = 5 | `crates/openfang-kernel/src/cron.rs:21` |
| reassign_agent_jobs | `crates/openfang-kernel/src/cron.rs:254-288` |
| remove_agent_jobs | `crates/openfang-kernel/src/cron.rs:294-309` |
| CronDeliveryEngine fan-out | `crates/openfang-kernel/src/cron_delivery.rs:97-110` |
| Four delivery target types | `crates/openfang-kernel/src/cron_delivery.rs:113-196` |
| Email subject template | `crates/openfang-kernel/src/cron_delivery.rs:200+` |
| Approval manager hot-reload | `crates/openfang-kernel/src/approval.rs:147-158` |
| API security headers | `crates/openfang-api/src/middleware.rs:246-275` |
| Dashboard scheduler page routing | `crates/openfang-api/static/js/app.js:316-329` |
| Tauri desktop port state | `crates/openfang-desktop/src/commands.rs:9-26` |
| SSE log streaming | `crates/openfang-api/src/routes.rs:5309-5334` |

---

**Word count:** ~3,200