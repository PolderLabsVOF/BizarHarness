# Memory model and IRAM

ESP32 (Xtensa LX6/LX7, or RISC-V on S3/C3) has distinct address spaces. Code and data are placed into them by the linker based on attributes; getting this wrong is the difference between a working firmware and one that crashes on the first SPI-DMA transfer.

## Address spaces at a glance

| Space     | Size (classic ESP32)        | What lives here                                              |
|-----------|-----------------------------|--------------------------------------------------------------|
| IRAM      | ~128 KB (some chips 256 KB) | ISR handlers, `IRAM_ATTR` functions, flash-cache-disabled    |
| DRAM      | ~120 KB                     | `.data`, `.bss`, heap, stacks, default-code-section RAM     |
| Flash     | 4–16 MB                     | Program text (XIP), read-only data, filesystems              |
| PSRAM     | 0–8 MB optional             | Large buffers via `MALLOC_CAP_SPIRAM`                        |

## IRAM (instruction RAM)

IRAM is the tightest budget on most ESP32 firmware because it has to be physically present on-chip and is not expandable. Code in IRAM can run without flash cache, which is required during:

- **ISR handlers** — the cache may be disabled.
- **SPI / DMA completion paths** — flash-cache-disabled periods when the SPI peripheral is busy.
- **Time-critical inner loops** — a few hot loops that would be slowed by XIP cache misses.

Mark a function IRAM-resident with the attribute:

```cpp
#include "esp_attr.h"

void IRAM_ATTR spi_complete_isr(spi_transaction_t *trans) {
    // runs from IRAM, must be small and avoid non-IRAM APIs
}
```

`(AMS7)` Keep IRAM remaining ≥ 20 KiB on AMS7. Below 24 KiB is a warning. Do not add `IRAM_ATTR` unless the function is genuinely on a cache-disabled path. See `docs/firmware/memory_budget.md`.

### What blows the IRAM budget

- **Every `IRAM_ATTR` function** — even a 200-byte routine pulls in 200 bytes of IRAM that flash would otherwise have held.
- **Logging inside ISRs** — `ESP_LOG*` is not `IRAM_ATTR` by default; if you call it from an ISR, the linker pulls the entire logging chain into IRAM. Use direct `uart_tx` or a deferred task instead.
- **Format strings in IRAM** — `printf`-style code in IRAM is expensive. Move formatted output to a task.
- **Per-frame work in IRAM** — even non-IRAM helpers reached only from IRAM functions can end up in IRAM if the linker decides so (`-ffunction-sections` + linker `--gc-sections` reduces but does not eliminate this).
- **Inlining** — `static inline` in a header used by an IRAM file ends up in IRAM for every consumer.

### Diagnosing IRAM growth

```bash
idf.py size --format json --output-file size.json
python3 -c "import json; s=json.load(open('size.json')); print(s['iram_size'], s['dram_size'])"
```

For per-symbol breakdown:

```bash
$IDF_PATH/tools/uf2/elf2image.py build/<project>.elf  # if needed
xtensa-esp32-elf-objdump -d build/<project>.elf | grep '<.*>:' | head
```

The AMS7-specific gate `tools/check_idf_size_budget.py` (wrapped by `scripts/size_check.sh`) reads the JSON and fails on hard thresholds.

## DRAM (data RAM)

DRAM holds:

- `.data` — initialized globals (`int x = 5;`).
- `.bss` — zero-initialized globals (`int x;`).
- **Heap** — `malloc` / `new` returns here by default.
- **Stacks** — one stack per FreeRTOS task; `app_main`'s stack is fixed.

### Prefer static

Heap fragmentation is severe on ESP32 — there is no `mmap` or `sbrk`, just a fixed free list. Long-running firmware that `malloc`s in a loop will eventually fail with `ESP_ERR_NO_MEM`.

Rules:

- `static const` arrays for lookup tables.
- `static` (file-scope) for buffers reused across calls.
- `std::array<T, N>` or `std::span` over `std::vector`.
- Pool allocators if you really need dynamic.

When you must malloc, prefer `heap_caps_malloc(size, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL)` and free in matching scope. Always check the returned pointer.

### Stacks

FreeRTOS stacks grow downward; overflow corrupts whatever is below them. Tuning:

- Stack depth is in **words** (4 bytes on Xtensa, 4 bytes on RISC-V too). `4096` = 16 KiB.
- Over-budget: enable `CONFIG_COMPILER_STACK_CHECK_MODE_NORM` (compiler-instrumented) or `CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK` (hardware watchpoint, only one task at a time).
- Use `uxTaskGetStackHighWaterMark(handle)` to measure headroom at runtime.

`(AMS7)` AMS7 acquisition stacks are 8–16 KB; command-handler stack on the PRO CPU is 16 KB (`CONFIG_MAIN_TASK_STACK_SIZE=16384`).

### Internal vs PSRAM (DMA-capable)

`MALLOC_CAP_INTERNAL` requests memory in DRAM. `MALLOC_CAP_SPIRAM` requests external PSRAM (slow, no DMA). Combine as needed:

```cpp
// 8-bit accessible, internal (DMA-capable) — for SPI/I2S buffers
uint8_t *dma_buf = (uint8_t *)heap_caps_malloc(4096, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);

// large, no DMA requirement — JSON caches, log buffers
char *big_buf = (char *)heap_caps_malloc(64 * 1024, MALLOC_CAP_8BIT | MALLOC_CAP_SPIRAM);
```

Always check the return value — `MALLOC_CAP_SPIRAM` may fail if PSRAM is not configured, or return NULL if the chip has none.

## Flash

Most code lives in flash and is executed in place (XIP). The flash cache is on-chip and small (~32 KB on classic ESP32). Functions that are not in cache take a flash-read penalty.

To check cache hit rate at runtime:

```cpp
#include "esp_heap_caps.h"
ESP_LOGI(TAG, "free 8-bit internal: %u", heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
```

For static asserts on flash size, see `idf.py size` output. The relevant numbers are:

- **Flash app binary** — total image size.
- **`bytes free in the smallest app partition`** — partition headroom; matters for OTA.

## `.iram0.lit`, `.iram0.text`, and `.dram0.*`

The default linker script places:

- `.iram0.lit` — literal pools (constants referenced from IRAM).
- `.iram0.text` — `IRAM_ATTR` functions.
- `.dram0.data` / `.dram0.bss` — initialized / zero-initialized data.
- `.flash.text` — all other code.

`idf.py size` aggregates these. Per-section breakdown requires `xtensa-esp32-elf-size -A build/<project>.elf`.

## Common pitfalls

- **Calling a non-IRAM function from an ISR.** Symptom: intermittent crash in the ISR. Fix: mark the called function `IRAM_ATTR` or move the work to a task.
- **Using `printf` / `ESP_LOG*` from an ISR.** Symptom: large IRAM growth. Fix: use `xQueueSendFromISR` to defer the log to a task.
- **Malloc with `MALLOC_CAP_SPIRAM` on a chip without PSRAM.** Symptom: NULL return, hard fault on deref. Fix: fall back to internal with a smaller size, or fail loudly.
- **Stack overflow from deep recursion.** Symptom: hard fault or corruption deep in the call stack. Fix: convert to iteration, or bump the task's stack.
- **Static buffers in headers.** A `static constexpr` buffer in a header included by many `.cpp` files duplicates per translation unit, then collides at link. Use `inline constexpr` (C++17) or move to a single `.cpp`.
