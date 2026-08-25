# idf.py commands

`idf.py` is the single entry point to ESP-IDF v5. All commands assume the IDF environment is sourced:

```bash
source esp/esp-idf/export.sh
```

If `idf.py` is not on PATH, `scripts/idf_env.sh` will print the source line and tell you whether the env is healthy.

## Core workflow

```bash
idf.py build                       # compile (incremental)
idf.py -p /dev/ttyUSB0 flash       # write image to board
idf.py -p /dev/ttyUSB0 monitor     # serial console (Ctrl-] to exit)
idf.py -p /dev/ttyUSB0 flash monitor   # flash then monitor in one shot
```

`-p` is the serial port. Linux: `/dev/ttyUSB0` or `/dev/ttyACM0`. macOS: `/dev/cu.usbserial-*`. Windows: `COM3`.

## Configuration

```bash
idf.py menuconfig                  # TUI Kconfig editor
idf.py menuconfig --no-target      # don't ask to set target
idf.py save-defconfig              # write minimal defconfig from current settings
```

`menuconfig` writes the result to `sdkconfig`. To apply a layered profile:

```bash
idf.py -B build_espnow_flow -C . \
       --sdkconfig sdkconfig.espnow_flow \
       build flash
```

The `-B build_<name>` puts the build output in `build_<name>/`, leaving the default `build/` clean.

## Build inspection

```bash
idf.py size                        # text: app partition + IRAM + DRAM
idf.py size --format json          # machine-readable for tooling
idf.py size --format csv           # spreadsheet-friendly
idf.py size --output-file size.json
idf.py size-components             # per-component breakdown
```

`idf.py size` exit code is 0 on success regardless of size; size policy lives in project-specific tools.

## Cleaning

```bash
idf.py clean                       # remove build artifacts but keep config
idf.py fullclean                   # remove build/ AND sdkconfig (then menuconfig again)
idf.py -B build_espnow_flow clean  # clean a specific build dir
```

`fullclean` is destructive — it deletes your local `sdkconfig` overrides. Commit your `sdkconfig` and any profile files first.

## Target and project

```bash
idf.py set-target esp32            # esp32 / esp32s2 / esp32s3 / esp32c3 / esp32h2
idf.py create-project foo          # scaffold a new project from a template
idf.py add-dependency "owner/repo^1.2.3"   # pull into managed_components/
```

After `set-target`, ESP-IDF regenerates component configs — clean build artifacts:

```bash
idf.py set-target esp32s3 && idf.py build
```

## Partition table

```bash
idf.py partition-table             # regenerate partition_table/*.bin from partitions.csv
idf.py erase-flash                 # erase entire flash (use with care)
```

`partitions.csv` is at the project root; `idf.py menuconfig → Partition Table` selects which CSV to use. Common layouts:

- `partitions_singleapp.csv` — single OTA-less app partition
- `partitions_two_ota.csv` — A/B OTA slots (default for OTA-enabled projects)
- A custom CSV — declare `app`, `data`, `nvs`, `phy_init`, `storage` partitions with explicit sizes

`(AMS7)` The AMS7 partition table reserves a large `storage` partition for SD-aware OTA staging.

## Monitor filters

```bash
idf.py -p /dev/ttyUSB0 monitor --print-filter="*:I"          # only INFO and above
idf.py monitor --print-filter="ams7driver:I espnow_summary:W" # per-tag levels
idf.py monitor --elf <elf_path>                             # decode panic backtraces
```

`-d` disables line-ending conversion (binary output). `-t` adds a timestamp prefix.

Inside the monitor, useful key bindings:

- `Ctrl-]` — exit
- `Ctrl-T` — toggle menu (send break, change filter, etc.)

## Build flags

```bash
idf.py -DCMAKE_BUILD_TYPE=Debug build          # Debug / Release / RelWithDebInfo / MinSizeRel
idf.py -DCONFIG_COMPILER_OPTIMIZATION_PERF=y build   # enable IDF performance optimizations
idf.py -DSDKCONFIG_DEFAULTS=sdkconfig.espnow_flow build
```

`-DSDKCONFIG_DEFAULTS` is equivalent to the `--sdkconfig` CLI flag and is useful for CI.

## OpenOCD / debugging

```bash
idf.py openocd                     # start OpenOCD for JTAG debugging
idf.py gdb                         # start xtensa-esp32-elf-gdb
idf.py gdbgui                      # GDB with a frontend
idf.py app-flash                   # flash only the app partition
idf.py bootloader-flash            # flash only the bootloader
```

GDB requires an `openocd` server on the default port (3333).

## OTA

```bash
idf.py app                         # build the app, ready for OTA push
idf.py ota                         # ... or `idf.py app` then push via HTTP
```

For SD-card OTA staging: copy `build/<project>.bin` to the SD card under the OTA path your bootloader expects, then reboot.

## Useful exit-code patterns

```bash
# CI: build, then size check
idf.py build && idf.py size

# AMS7: full CI gate
source esp/esp-idf/export.sh
idf.py build
tools/check_idf_size_budget.py
```

`scripts/size_check.sh` wraps the AMS7-specific size policy and falls back to `idf.py size` when run in a non-AMS7 project.

## Common pitfalls

- **Forgot to source the env.** Symptom: `idf.py: command not found`. Fix: `source esp/esp-idf/export.sh` per shell session.
- **Wrong target.** Symptom: linker errors about `esp_image_header_t` size mismatches or missing `esp_hw_support`. Fix: `idf.py set-target esp32` then rebuild.
- **`sdkconfig` drift.** Symptom: subtle behavior changes after a `git pull`. Fix: `idf.py menuconfig` to re-resolve, or `git checkout sdkconfig` and re-apply.
- **`-B build_<flow>` left stale.** Symptom: build picks up old sources. Fix: `idf.py -B build_<flow> fullclean`.
- **Monitor hangs on macOS.** Use `/dev/cu.usbserial-*` not `/dev/tty.usbserial-*` (the `tty.` node blocks open while the driver holds it).
