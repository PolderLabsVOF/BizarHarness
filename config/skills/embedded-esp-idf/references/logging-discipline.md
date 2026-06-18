# Logging discipline

ESP-IDF logging uses `ESP_LOG*` macros. They are cheap when disabled (compile out), acceptable at moderate rates, and dangerous at acquisition-frame rates.

## The macros

```cpp
ESP_LOGE(TAG, "fmt", ...);   // error — always shown at default verbosity
ESP_LOGW(TAG, "fmt", ...);   // warning — recoverable issue
ESP_LOGI(TAG, "fmt", ...);   // info — state transitions
ESP_LOGD(TAG, "fmt", ...);   // debug — verbose, off by default
ESP_LOGV(TAG, "fmt", ...);   // verbose — trace, off by default
```

Each is gated by a per-level compile-time switch (`CONFIG_LOG_DEFAULT_LEVEL`) and a per-tag runtime level (`esp_log_level_set("tag", ESP_LOG_WARN)`).

## Tags

Use a stable per-module tag — a file-scope `static const char *TAG`:

```cpp
static const char *TAG = "ams7driver";
ESP_LOGI(TAG, "Start acquisition stack_hw=%lu", (unsigned long)stack_hw);
```

Tags show up as `[tag]` prefixes in the serial monitor and let you filter:

```bash
idf.py monitor --print-filter="ams7driver:I espnow_summary:W"
```

Pick short, stable tags. AMS7 module tags: `ams7driver`, `espnow_summary`, `ble_prph`, `acqsystem`, `dps310`, `ads129x`, `icm42688p`, `sdcard`.

## Format strings

Format strings are validated against arguments at compile time when GCC sees the format attribute:

```cpp
ESP_LOGI(TAG, "Hold=%lu ms", (unsigned long)ms);   // %lu for unsigned long
ESP_LOGI(TAG, "Cap=%" PRIu32, cap);               // PRIu32 macro for uint32_t
ESP_LOGI(TAG, "Ratio=%f", ratio);                 // %f for double, %f for float (promoted)
```

Common gotchas:

- `%lu` for `uint32_t` is **wrong on platforms where `long` is 64-bit**. Use `%" PRIu32 "` instead.
- `%d` for `size_t` is wrong on 64-bit hosts; use `%zu`.
- `%p` for arbitrary pointer; cast to `void *` first.

## Gating with Kconfig

Wrap debug logs in a `CONFIG_*` guard so a release build can drop them entirely:

```cpp
#if CONFIG_AMS7_RESP_TRIAL_DEBUG_LOG_ENABLE
    ESP_LOGI(TAG, "resp sample processed src=%d q=%u", src, q);
#endif
```

`(AMS7)` AMS7 names these options `*_TRIAL_DEBUG_LOG_ENABLE` and defaults them to `n` (or `y` only during early integration). They are the right toggle for "I want to see this while tuning the algorithm but not in production."

## Universal anti-patterns

- **Per-frame logs in acquisition.** At 125–500 Hz this is unprintable and floods the UART. The host monitor loses the frames you actually need.
- **Logs in ISRs.** `ESP_LOG*` is not `IRAM_ATTR`; calling it from an ISR pulls the whole logging chain into IRAM. Use `xQueueSendFromISR` to a logging task instead.
- **Logging from `app_main`'s setup before serial is up.** First few lines can be lost. Wait for `ESP_LOGI(TAG, "boot")` to appear before assuming the console is alive.
- **Sensitive data in logs.** Avoid logging peer MACs, subject IDs, or anything that crosses a wire to a host that doesn't need it. Add a `LOG_REDACT` flag if the project warrants it.

## AMS7 acquisition-logging rules

`(AMS7)` Acquisition builds must not log per-sample or per-frame. Acceptable log rates:

- **Per event**: BLE connect/disconnect, ESP-NOW peer add/remove, acquisition start/stop, file open/close, error conditions. These are inherently low-rate.
- **Periodic aggregate**: low-rate counters via a `pl:` (payload) console line every N ms. Example:

```cpp
// Throttled to 1 Hz regardless of underlying sample rate
if ((now_ms - last_pl_ms) >= 1000) {
    last_pl_ms = now_ms;
    ESP_LOGI(TAG, "pl: beats=%lu rr_ms=%lu q=%u en=%u src=%d",
             beats, rr_ms, quality, envelope, source);
}
```

The `pl:` prefix is grep-friendly — host-side tooling can pluck aggregate lines from the serial stream without parsing every byte.

- **Trial-debug toggles**: `CONFIG_AMS7_RESP_TRIAL_DEBUG_LOG_ENABLE`, `CONFIG_AMS7_HR_FUSED_DEBUG_LOG_ENABLE`, etc. Default `n` for release builds. When enabled, log per-decision but still throttled.

## Tagging aggregate lines

Use a tag prefix that distinguishes aggregate from per-event so the host can filter:

```cpp
// Aggregate (high-volume, low-rate)
ESP_LOGI("ams7_pl", "pl: hr=%lu rr_ms=%lu q=%u", hr_bpm, rr_ms, q);

// Per-event (low-volume, descriptive)
ESP_LOGI(TAG, "Acquisition start mode=%d stack_hw=%lu", mode, stack_hw);
```

## Runtime level control

`esp_log_level_set` lets you bump a tag's verbosity at runtime:

```cpp
esp_log_level_set("espnow_summary", ESP_LOG_DEBUG);   // noisy on demand
esp_log_level_set("ams7driver", ESP_LOG_WARN);         // quiet a noisy module
```

This is the right tool for "I want to debug one module without rebuilding."

## Common pitfalls

- **Logs in a tight loop.** Symptom: dropouts in other tasks, overflowing the UART ringbuffer. Fix: throttle or remove.
- **Float in `ESP_LOG*`.** ESP-IDF supports `%f` but pulling in `<stdio.h>` float formatting adds code; consider integer milliunits instead.
- **Missing format attribute.** ESP-IDF declares `__attribute__((format(printf, ...)))` on `ESP_LOG*` so format mismatches are warnings. Don't bypass with a `static_cast`.
- **Stale `TAG`.** Renaming a file but leaving the old `TAG`. Tag should match the module name in `idf.py monitor` filters.
- **Compile-time vs runtime gate confusion.** `CONFIG_LOG_DEFAULT_LEVEL` is compile-time; `esp_log_level_set` is runtime. A tag's level is `min(compile_max, runtime_set, default)`.
