---
name: embedded-esp-idf
description: Write, review, or debug ESP-IDF v5.x C++ firmware. Triggers on idf.py build/flash/monitor/menuconfig/size, FreeRTOS tasks and ISRs, IRAM/DRAM/PSRAM budgeting, packed binary protocols with static_assert on sizeof, NVS, BLE/NimBLE, ESP-NOW, deep-sleep/light-sleep, Kconfig option design, or host-side C++ unit tests that compile firmware headers without idf.py. AMS7 ambulatory-monitoring firmware conventions (SD-first storage, low-rate aggregate logs, CONFIG_AMS7_* options, ESP-NOW framing discipline) are flagged as project-specific extensions.
---

# Embedded ESP-IDF

ESP-IDF v5.x C++ firmware patterns: build/flash/monitor workflow, FreeRTOS, IRAM/DRAM memory model, packed binary protocols, drivers, and host-side testing without idf.py. Universal ESP-IDF rules are the default. Anything tagged **(AMS7)** is a project-specific extension for the `/projects/ams7_esp32` ambulatory-monitoring firmware — do not silently generalize it.

## Quick start

```bash
# 1. Source the ESP-IDF environment (required once per shell)
source esp/esp-idf/export.sh

# 2. Build / flash / monitor
idf.py build                     # compile firmware
idf.py -p /dev/ttyUSB0 flash     # flash (Linux; COMx on Windows)
idf.py -p /dev/ttyUSB0 monitor   # serial monitor (Ctrl-] to exit)

# 3. Configure / inspect
idf.py menuconfig                # TUI Kconfig editor
idf.py size                      # IRAM/DRAM/flash breakdown (text)
idf.py size --format json        # machine-readable for tooling
```

`idf.py` is the single entry point: build, flash, monitor, menuconfig, size, clean, full-clean, set-target, partition-table, and OTA-related commands are all subcommands. See `references/idf-py-commands.md` for the full list and exit codes.

A helper that validates your environment is at `scripts/idf_env.sh`:

```bash
bash scripts/idf_env.sh           # prints the source line and verifies idf.py is reachable
```

## Project layout (typical ESP-IDF + AMS7)

```
project-root/
├── CMakeLists.txt                # top-level: project(<name>), C++ standard, EXTRA_COMPONENT_DIRS
├── sdkconfig                     # PRIMARY build configuration (Kconfig output)
├── sdkconfig.<profile>           # SECONDARY overlays (per-flow variants) — AMS7 uses these
├── partitions.csv                # flash partition table
├── main/                         # app component (idf_component_register lives here)
│   ├── CMakeLists.txt            # main component sources and INCLUDE_DIRS
│   ├── Kconfig                   # app-level CONFIG_* options
│   ├── ams7_esp32.cpp            # app_main(), task creation, system bring-up
│   └── ...
├── components/                   # first-party shared components
├── module/                       # submodules vendored into the build (set EXTRA_COMPONENT_DIRS)
├── managed_components/           # populated by `idf.py add-dependency` (idf-component-manager)
├── docs/                         # design notes, memory budget, runbooks
└── tools/                        # project-specific helpers (size budget, etc.)
```

`(AMS7)` In the AMS7 project the top-level `CMakeLists.txt` sets:

```cmake
set(EXTRA_COMPONENT_DIRS "./module")   # pull ./module/* into the component search path
set(CMAKE_CXX_STANDARD 20)             # C++20 across all components
set(PROJECT_VER "beta.studio.core.v1")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(ams7_esp32)
```

## Build profiles

`sdkconfig` is the primary, always-applied configuration. Project overlays under `sdkconfig.<name>` are layered on top for variant builds:

```bash
# (AMS7) Build a flow-specific firmware variant in a separate build directory
idf.py -B build_espnow_flow -C . \
       --sdkconfig sdkconfig.espnow_flow \
       build flash
```

`(AMS7)` AMS7 ships `sdkconfig.espnow_flow`, `sdkconfig.espnow_flow_minadv`, `sdkconfig.espnow_flow_studylock`. These toggle `CONFIG_AMS7_*` options (e.g., `CONFIG_AMS7_SUMMARY_ENABLE=y`, `CONFIG_AMS7_ESPNOW_WIFI_CHANNEL=6`) without touching the primary `sdkconfig`. Never hand-edit `sdkconfig` for flow-specific tweaks — add a profile file and merge with `--sdkconfig`.

## Kconfig

Add options under `main/Kconfig` (or a component's `Kconfig` file). ESP-IDF auto-sources any `Kconfig` file inside a registered component.

```kconfig
config AMS7_SUMMARY_ENABLE
    bool "Enable ESP-NOW summary workflow"
    default n
    help
        Master switch for the recording workflow that starts with BLE control
        and then switches to ESP-NOW summary mode after acquisition begins.

config AMS7_BLE_VITALS_ENABLE
    bool "Enable custom BLE vitals characteristic"
    depends on AMS7_VITALS_ENABLE
    default y

config AMS7_HR_HOLD_MS
    int "Hold time for fused HR before fallback"
    depends on AMS7_VITALS_ENABLE
    range 0 60000
    default 10000
```

Key operators:

- `bool` / `int` / `string` / `hex` — value type
- `default y|n|"value"` — default when not explicitly set
- `depends on FOO` — option only visible when `FOO` is set
- `select BAR` — when this option is enabled, force `BAR = y`
- `imply BAR` — soft suggestion; user can still disable
- `range MIN MAX` — integer range constraint
- `choice ... endchoice` — radio group with mutually-exclusive values

`(AMS7)` AMS7 namespacing uses the `AMS7_*` prefix on every project-defined symbol. Treat `CONFIG_AMS7_*` as AMS7-specific — do not propose `CONFIG_AMS7_*` symbols for a different ESP-IDF project.

See `references/kconfig.md` for menus, sourcing custom Kconfig files, and component-level isolation.

## Component CMakeLists.txt

Each component has a `CMakeLists.txt` with one call to `idf_component_register`:

```cmake
idf_component_register(
    SRCS
        "ams7fileheader.cpp"
        "ams7fileheader.h"
    INCLUDE_DIRS
        "."
    REQUIRES             # public link deps (visible in component.h)
        nvs_flash
        esp_wifi
    PRIV_REQUIRES        # private link deps (only used in component .cpp)
        mbedtls
        app_update
)
```

- `SRCS` — sources for this component.
- `INCLUDE_DIRS` — headers exported to dependents.
- `REQUIRES` — other components whose public headers are used here (public dependency).
- `PRIV_REQUIRES` — used only in `.cpp` (private dependency; smaller rebuild blast radius).

`(AMS7)` The main component in AMS7 (`main/CMakeLists.txt`) registers ~50 sources and lists ~25 components under `REQUIRES` (drivers, BLE, NVS, OTA, etc.). Keep this list explicit — do not switch to glob patterns.

## FreeRTOS patterns

ESP-IDF uses FreeRTOS. The universal rules:

- **Tasks**: `xTaskCreatePinnedToCore` to pin to core 0 or 1. App/main runs on the PRO CPU (core 1) by default; pin acquisition ISRs and time-critical tasks deliberately.
- **Priorities**: 0 is idle. 1–4 normal tasks. Real-time acquisition can use 5–24. `(AMS7)` AMS7 acquisition tasks run at priority 20+.
- **Blocking calls**: `vTaskDelay(pdMS_TO_TICKS(N))`, `xQueueReceive(..., portMAX_DELAY)`.
- **Queues**: prefer a queue over a shared buffer. Producer/consumer with `xQueueSend` / `xQueueReceive`.
- **Semaphores / mutexes**: binary/counting semaphores for ISR-to-task signaling; mutexes for shared resources. Prefer `xSemaphoreCreateBinary` and give it from `xQueueSendFromISR`/`xTaskNotifyFromISR`.
- **Timers**: `xTimerCreate` for periodic callbacks. One-shot timers for deferred work.
- **Event groups**: `xEventGroupWaitBits` for "wait until several subsystems ready" patterns.
- **Stream/ring buffers**: `xStreamBufferCreate` for variable-length byte streams; `xRingbufferCreate` for the IDF lockless variant.
- **ISR rules**: never block in an ISR. Use `xQueueSendFromISR`, `xTaskNotifyFromISR`, or `xTimerPendFunctionCallFromISR` and check the returned `BaseType_t xHigherPriorityTaskWoken` to force a context switch with `portYIELD_FROM_ISR`.

`portTICK_PERIOD_MS` is `10` by default (10 ms tick). Always convert via `pdMS_TO_TICKS(ms)` rather than multiplying by hand.

See `references/freertos-patterns.md` for task lifecycle, pinning to cores, watchdog setup, and ISR-to-task handoff patterns.

## Memory model

ESP32 (Xtensa LX6/LX7, or RISC-V on S3/C3) has distinct address spaces:

- **IRAM** (instruction RAM, ~128 KB on classic ESP32): code marked with `IRAM_ATTR` lives here. Used for ISR handlers, flash-cache-disabled paths, and time-critical code. **Tight budget.**
- **DRAM** (data RAM, ~120 KB on classic ESP32): `.data`, `.bss`, heap, stack. Default for all variables and most code.
- **Flash** (4–16 MB): program text, read-only data (`.rodata`), filesystem. Code lives here by default; XIP cache fetches it.
- **PSRAM** (when chip has it): slow external RAM via SPI. Use `MALLOC_CAP_SPIRAM` for large buffers you cannot fit in DRAM.

Universal guidance:

- **Prefer `static` over heap.** DRAM fragmentation on ESP32 is severe; long-running firmware that `malloc`s in a loop will eventually fail.
- **Mark only what must run from IRAM**: ISR handlers, flash-cache-disabled paths (e.g., SPI drivers during DMA), and a few hot loops. Most code is fine in flash.
- **`MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT`** for buffers that must not touch PSRAM (DMA-capable memory).
- **`MALLOC_CAP_SPIRAM`** for big buffers that need not be DMA-capable (logs, JSON caches).
- **`heap_caps_print_heap_info(MALLOC_CAP_8BIT)`** in a debug build to confirm.

`(AMS7)` **IRAM is the tightest budget on AMS7.** Reference baseline (see `docs/firmware/memory_budget.md`):

```
IRAM: 108,726 used, 22,346 free, 131,072 total
DRAM: 43,152 used, 81,428 free, 124,580 total
```

Keep IRAM remaining ≥ 20 KiB; below 24 KiB prints a warning because new `IRAM_ATTR` code can hurt quickly. Do not add `IRAM_ATTR` unless the function is required in ISR/cache-disabled paths. Always re-run the size check after acquisition-path changes.

See `references/memory-and-iram.md` for IRAM_ATTR placement rules, PSRAM trade-offs, and the things that blow the IRAM budget (logging, format strings in IRAM, ISR deep paths).

## Packed binary protocols

Wire-format frames over ESP-NOW, BLE, or any byte-oriented transport must be deterministic in size. AMS7 uses the same shape across all frames — see `main/connectivity/espnow_imu_frame.hpp` for a clean example:

```cpp
#define CORE_ESPNOW_IMU_MAGIC 0x494dU       // 'IM'
#define CORE_ESPNOW_IMU_VERSION 1U
#define CORE_ESPNOW_FRAME_IMU_RAW 1U

typedef struct __attribute__((packed)) {
    uint16_t magic;         // first 2 bytes identify the frame family
    uint8_t  version;       // protocol version of this struct
    uint8_t  frame_type;    // sub-type within family
    uint16_t id;            // sender / subject
    uint16_t seq;           // monotonic sequence
    uint16_t age_ms;        // capture age in ms (sender-stamped)
    int16_t  accel_x, accel_y, accel_z;
    int16_t  gyro_x,  gyro_y,  gyro_z;
} core_espnow_imu_frame_v1_t;

// Compile-time size lock — breaks the build if the struct grows or shrinks.
static_assert(sizeof(core_espnow_imu_frame_v1_t) == 22,
              "core_espnow_imu_frame_v1_t must be 22 bytes");
```

Universal rules:

- Always `__attribute__((packed))` and always back it with `static_assert(sizeof(T) == N)` (or `_Static_assert` in C linkage). Catch drift at compile time, not over the air.
- Fixed-width types only (`uint16_t`, `int16_t`, not `int`).
- First fields are `magic` (16-bit ASCII-ish) + `version` + `frame_type`. Magic is how receivers reject foreign frames; version is how they migrate.
- All multi-byte fields are **little-endian on the wire** — ESP32 is LE natively, but make byte order explicit when porting.
- Wire framing is **length-prefixed**: receiver gets a 2-byte length, then exactly that many bytes. No delimiter-scanning, no escape bytes.
- For variable payloads, define `frame_header_t` once and reuse — don't reinvent per frame family.

`(AMS7)` The naming convention `core_<transport>_<family>_frame_vN_t` and the `static_assert` on `sizeof` are non-negotiable in AMS7. Every frame header under `main/connectivity/` follows this pattern (imu, resp, resp_icg, beat_event, capability, name, protocol_status, gateway_command, marker).

See `references/packed-structs.md` for the full pattern, capability bits, and migration across versions.

## Logging

```cpp
static const char *TAG = "ams7driver";
ESP_LOGI(TAG, "Start acquisition stack_hw=%lu", (unsigned long)stack_hw);
ESP_LOGW(TAG, "Skipping channel-info drain wait for device without ringbuffer");
ESP_LOGE(TAG, "Failed to start stop finalization task");
```

Universal guidance:

- Use `ESP_LOGE` for failures, `ESP_LOGW` for recoverable issues, `ESP_LOGI` for state transitions, `ESP_LOGD` for verbose debug (off by default), `ESP_LOGV` for trace.
- Pick a stable per-module tag — file-scoped `static const char *TAG = "modname";`.
- Format strings are validated against the args at compile time — `%lu` for `unsigned long`, `%" PRIu32 "` for `uint32_t`, etc.
- Gating with `CONFIG_*_LOG_ENABLE` switches lets you build a release binary with no debug logs at all (`idf.py menuconfig → Component config → Log output → Default log verbosity`).

`(AMS7)` **Logging discipline.** Acquisition builds must not log per-sample or per-frame — at 125–500 Hz that is unprintable and useless. Acceptable log rates:

- Per-event: BLE connect, ESP-NOW peer add, acquisition start/stop, file open/close.
- Periodic aggregate: low-rate counters via a `pl:` console line every N ms (e.g., `ESP_LOGI(TAG, "pl: beats=%lu rr_ms=%lu q=%u", ...)`).
- Trial-debug toggles (e.g., `CONFIG_AMS7_RESP_TRIAL_DEBUG_LOG_ENABLE=y`) gate extra lines.

For full AMS7 logging rules see `references/logging-discipline.md`.

## Drivers

ESP-IDF v5 unified drivers (used by AMS7 modules):

- **I2C**: `i2c_master_bus_config_t` + `i2c_master_bus_handle_t`, then per-device `i2c_device_config_t`. `i2c_master_transmit`, `i2c_master_receive`, `i2c_master_transmit_receive`.
- **SPI**: `spi_bus_initialize` + `spi_device_interface_config_t` + `spi_device_queue_transfer`. Use `IRAM_ATTR` on `queueTransfer`/`getTransferResult` for DMA-completion paths.
- **GPIO**: `gpio_config`, `gpio_set_level`, `gpio_install_isr_service` (zero-arg ISR service install once at boot, then `gpio_isr_handler_add`).
- **ADC**: `esp_adc/adc_oneshot.h` for one-shot reads; `esp_adc/adc_continuous.h` for DMA-driven streams.
- **RTC**: `esp_sleep_enable_timer_wakeup`, `esp_sleep_enable_ext0_wakeup` (single GPIO), `esp_sleep_enable_ext1_wakeup` (multiple GPIOs), `esp_deep_sleep_start`.
- **NVS**: see next section.
- **BLE**: NimBLE (`nimble/`), or the Bluedroid stack. AMS7 uses NimBLE via `components/bt`.
- **Wi-Fi / ESP-NOW**: `esp_wifi_set_mode(WIFI_MODE_STA)`, `esp_wifi_set_promiscuous`, `esp_wifi_set_channel`, then `esp_now_init`, `esp_now_register_send_cb`, `esp_now_send`.

## NVS (preferences)

`nvs_flash_init()` once at boot. Per-namespace open/get/set/commit:

```cpp
nvs_handle_t h;
esp_err_t err = nvs_open("storage", NVS_READWRITE, &h);
if (err != ESP_OK) { /* handle */ }

uint8_t mac[6] = {};
size_t len = sizeof(mac);
err = nvs_get_blob(h, "peer_mac", mac, &len);

uint32_t counter = 0;
nvs_set_u32(h, "boot_count", counter + 1);
nvs_commit(h);
nvs_close(h);
```

- Namespaces (`"storage"`, `"wifi"`, `"ams7cfg"`) isolate unrelated settings.
- Blobs for binary data; `nvs_set_str` / `nvs_get_str` for short strings; `nvs_set_u8/u16/u32/u64/i32` for integers.
- `nvs_commit` is required after writes; reads do not need commit.
- Flash wear is real — prefer batched writes. Use a memory cache and flush on shutdown or every N minutes.

`(AMS7)` AMS7 stores device-name, hardware-rev, last-acquisition metadata in NVS under the `"ams7cfg"` namespace, and persists peer / study-locks state.

For NVS review tasks (most common: catching `nvs_flash_init()` anti-patterns, swallowed errors, missing commits, wrong namespaces), see `references/nvs.md`. NVS issues are the highest-yield review finding for non-driver firmware code, so this reference is worth loading early.

## Power management

- `esp_sleep_enable_timer_wakeup(seconds)` for timed wakes.
- `esp_sleep_enable_ext0_wakeup(gpio_num, level)` for one external wake pin.
- `esp_sleep_enable_ext1_wakeup(bitmask, mode)` for multiple pins (EXT1 only on classic ESP32; on S3 use `gpio_wakeup`).
- `esp_deep_sleep_start()` — full power-off; only RTC fast memory survives (`RTC_DATA_ATTR` / `RTC_IRAM_ATTR`).
- `esp_light_sleep_start()` — pause CPU, peripherals resume on wake; lower latency than deep sleep.
- `esp_sleep_pd_domain_config` to power down unused domains.
- `RTC_DATA_ATTR static uint32_t boot_count;` survives deep sleep.
- `esp_wifi_set_ps(WIFI_PS_MIN_MODEM)` for Wi-Fi connected/idle power save.

`(AMS7)` AMS7 enters deep sleep after acquisition stop with a wake-on-tap (`esp_sleep_enable_ext0_wakeup` on ICM-42688-P INT1) plus a wake-after-N-seconds safety timer.

## Size budget

`idf.py size` shows IRAM / DRAM / flash app image. Read it after every change to acquisition-path code.

```bash
idf.py size                       # text summary
idf.py size --format json         # for tooling
idf.py size --output-file size.json
```

What to watch:

- **IRAM used**: this is the dangerous one. Adding `IRAM_ATTR` to a large function or pulling logging into ISR paths inflates it.
- **DRAM used**: static `.bss` and `.data`. Large `static` buffers add here.
- **Flash app binary**: usually comfortable; check `0xfb650 bytes, 0xf49b0 bytes free in the smallest app partition`.

`(AMS7)` AMS7 ships `tools/check_idf_size_budget.py` — a hard gate that runs `idf.py size --format json` and fails if IRAM remaining drops below 20 KiB or DRAM remaining below 40 KiB. Always run it after changes:

```bash
source esp/esp-idf/export.sh
tools/check_idf_size_budget.py --min-iram-remain 20480 --min-dram-remain 40960
```

A non-project wrapper that delegates to it when present (and falls back to `idf.py size`) is at `scripts/size_check.sh`:

```bash
bash scripts/size_check.sh                          # uses current dir as project
bash scripts/size_check.sh --project-dir build_espnow_flow
```

## Host-side tests

Policy modules, payload encoders/decoders, and pure-C++ algorithms can be unit-tested on the host **without `idf.py`**. ESP-IDF firmware that depends on FreeRTOS / drivers stays out of these tests.

`(AMS7)` AMS7's host tests are deliberately minimal: a `tests/<area>/<name>_test.cpp` source file plus a `run_<name>_test.sh` shell wrapper that compiles with `g++ -std=c++17`, links the firmware `.cpp` source files directly, and runs. Example:

```bash
#!/usr/bin/env bash
set -euo pipefail
g++ -std=c++17 \
  tests/connectivity/espnow_imu_frame_test.cpp \
  main/connectivity/espnow_imu_frame.cpp \
  -I main/connectivity \
  -o /tmp/espnow_imu_frame_test
/tmp/espnow_imu_frame_test
```

Two key distinctions vs the firmware build:

- **No `idf.py`**: pure `g++` (or `cmake --build` for larger suites). Fast, runs anywhere.
- **No FreeRTOS or driver code**: the host testable surface should not include `<freertos/FreeRTOS.h>`, `esp_log.h`, or anything that pulls in `driver/`. If a header you want to test transitively includes those, factor the pure logic out.

For larger host-test projects with fakes and a CMake build, see the **`cpp-testing`** skill — it covers GoogleTest, Catch2, host fakes for FreeRTOS, and fixture patterns. See `references/host-tests.md` for the AMS7 host-test layout and pitfalls.

## Do / Don't

**Do**

```cpp
// Mark an ISR handler and let it defer work to a task
void IRAM_ATTR gpio_isr(void *arg) {
    BaseType_t hpw = pdFALSE;
    xQueueSendFromISR(gpio_evt_queue, &pin, &hpw);
    portYIELD_FROM_ISR(hpw);
}
```

```cpp
// Lock the wire size at compile time
typedef struct __attribute__((packed)) { /* ... */ } my_frame_v1_t;
static_assert(sizeof(my_frame_v1_t) == N, "wire size must match");
```

```cpp
// Aggregate, low-rate log instead of per-frame spam
ESP_LOGI(TAG, "pl: beats=%lu rr_ms=%lu q=%u", beats, rr_ms, quality);
```

**Don't**

```cpp
// Don't malloc in a hot path
while (running) {
    auto *p = new uint8_t[256];     // DRAM fragmentation, leaks on errors
    // ...
}

// Don't block inside an ISR
void IRAM_ATTR bad_isr(void *a) {
    vTaskDelay(pdMS_TO_TICKS(10));  // illegal — use xTaskNotifyFromISR + task
}

// Don't add IRAM_ATTR unless required
void IRAM_ATTR slow_json_formatter(...);  // pulls a big function into IRAM

// Don't hand-roll endianness
uint32_t be = (raw[0] << 24) | (raw[1] << 16) | ...;  // use explicit <bit> byte-swap helpers
```

## Resources

### Task-to-reference index

For most C++ review tasks on non-driver firmware code (NVS, logging, Kconfig, BLE/ESP-NOW data paths), the highest-yield references are:

| Task | Load first | Also useful |
|---|---|---|
| Reviewing NVS / persistence code | `references/nvs.md` | `logging-discipline.md` |
| Reviewing logging or `ESP_LOG*` calls | `references/logging-discipline.md` | `kconfig.md` |
| Reviewing Kconfig options | `kconfig.md` | (inline guidance in SKILL.md) |
| Reviewing packed binary frames / structs | `packed-structs.md` | (inline guidance in SKILL.md) |
| Reviewing task/queue/ISR code | `freertos-patterns.md` | `memory-and-iram.md` |
| Reviewing IRAM/disk usage after a build | `memory-and-iram.md` | `scripts/size_check.sh` |
| Building, flashing, monitoring | `idf-py-commands.md` | `scripts/idf_env.sh` |
| Writing a host-side C++ test | `host-tests.md` | `$cpp-testing` skill |

### references/

Load on demand for deeper detail:

- `idf-py-commands.md` — full `idf.py` subcommand list, exit codes, monitor filters, partition-table flow.
- `freertos-patterns.md` — task lifecycle, pinning, priorities, queue + ISR-to-task handoff, ringbuffer for streams, watchdog, ISR rules.
- `memory-and-iram.md` — IRAM vs DRAM vs flash vs PSRAM, `iram_attr` placement, what blows the IRAM budget.
- `kconfig.md` — adding options, menus, `depends on` / `select` / `imply` / `range` / `choice`, component-level Kconfig isolation.
- `nvs.md` — NVS init/handle/error pattern, namespace hygiene, `nvs_commit`, `nvs_flash_init()` anti-patterns, AMS7 `"ams7cfg"` namespace. **High-yield for review tasks.**
- `packed-structs.md` — `__attribute__((packed))`, byte order, `static_assert`, versioning, capability bits, magic byte, length-prefixed framing. Mirrors AMS7's `main/connectivity/espnow_*_frame.hpp`.
- `logging-discipline.md` — `ESP_LOG*`, log levels, tagging, no-per-frame logs, `pl:` aggregate lines, gating with `CONFIG_*_LOG_ENABLE`. **High-yield for review tasks.**
- `host-tests.md` — pure-CMake host tests that include firmware `.cpp` from `main/`, fakes for FreeRTOS, common pitfalls.

### scripts/

Small, runnable helpers:

- `scripts/idf_env.sh` — prints the `source esp/esp-idf/export.sh` line and validates that `idf.py` is reachable. Exits 0 if the env is good, 1 otherwise.
- `scripts/size_check.sh` — runs AMS7's `tools/check_idf_size_budget.py` if available, else falls back to `idf.py size`. Exits 0 on pass, 1 on size violation.
