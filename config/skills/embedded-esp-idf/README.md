# Embedded ESP-IDF Skill

ESP-IDF v5.x C++ firmware patterns for Claude Code. Covers the `idf.py` workflow, FreeRTOS, IRAM/DRAM/PSRAM memory model, packed binary protocols with `static_assert`, Kconfig, drivers (I2C/SPI/GPIO/ADC/NVS/BLE/ESP-NOW), power management, and host-side tests that compile firmware headers without `idf.py`.

## What it provides

- **SKILL.md** — quick start + 7 deep-dive references + 2 helper scripts
- **references/idf-py-commands.md** — every `idf.py` subcommand + exit codes
- **references/freertos-patterns.md** — task lifecycle, ISR-to-task handoff, ringbuffer streams
- **references/memory-and-iram.md** — IRAM/DRAM/PSRAM model, `IRAM_ATTR`, `MALLOC_CAP_*`
- **references/kconfig.md** — `depends on` / `select` / `imply` / `range` / `choice`
- **references/packed-structs.md** — `__attribute__((packed))` + `static_assert(sizeof == N)`
- **references/logging-discipline.md** — `ESP_LOG*` + low-rate aggregate lines
- **references/host-tests.md** — host tests without `idf.py`
- **scripts/idf_env.sh** — sources the vendored ESP-IDF env, validates `idf.py` is reachable
- **scripts/size_check.sh** — runs the project size budget check (AMS7-aware) or falls back to `idf.py size`

## When it triggers

- Writing, reviewing, or debugging ESP-IDF C++ firmware
- Working with `idf.py build`/`flash`/`monitor`/`menuconfig`/`size`
- FreeRTOS task/queue/semaphore/mutex/ISR work
- IRAM/DRAM/PSRAM budgeting
- Packed binary protocols with `static_assert` on `sizeof`
- NVS, BLE/NimBLE, ESP-NOW
- Deep-sleep / light-sleep
- Adding Kconfig options
- Host-side C++ unit tests that compile firmware headers without `idf.py`

## AMS7-specific extensions

This skill was first authored for the AMS7 ambulatory-monitoring firmware at `/projects/ams7_esp32`. Rules tagged `(AMS7)` are project-specific — do not silently generalize them to other ESP-IDF projects. Universal ESP-IDF rules are the default.

## Manual install

```bash
cp -R SKILL.md references scripts ~/.claude/skills/embedded-esp-idf/
chmod +x ~/.claude/skills/embedded-esp-idf/scripts/*.sh
```

The BizarHarness installer can also install this automatically — select the **Embedded ESP-IDF** component.
