# Host-side tests

ESP-IDF firmware that depends on FreeRTOS, drivers, and NVS cannot run on the host. But policy modules, payload encoders/decoders, pure-C++ algorithms, and protocol parsers can — and should — be unit-tested on the host with a normal C++ toolchain.

`(AMS7)` AMS7's host tests are deliberately lightweight: one `.cpp` test file + one `run_*_test.sh` shell wrapper. No CMake host build, no fakes library, no GoogleTest. The whole test is `g++ -std=c++17 ... && ./a.out`.

For larger projects with GoogleTest / Catch2 / fakes, see the **`cpp-testing`** skill.

## AMS7 pattern (test + run script)

A typical test file in `tests/connectivity/`:

```cpp
// tests/connectivity/espnow_imu_frame_test.cpp
#include <cassert>
#include <cstdio>

#include "espnow_imu_frame.hpp"

int main() {
    core_espnow_imu_frame_v1_t frame = {};
    espnow_imu_frame_init(&frame, 0x1234U, 9U, 55U,
                          1, -2, 3, -4, 5, -6);

    assert(frame.magic == CORE_ESPNOW_IMU_MAGIC);
    assert(frame.version == CORE_ESPNOW_IMU_VERSION);
    assert(frame.frame_type == CORE_ESPNOW_FRAME_IMU_RAW);
    assert(frame.id == 0x1234U);
    assert(frame.seq == 9U);
    assert(frame.age_ms == 55U);
    assert(frame.accel_x == 1);
    assert(frame.accel_y == -2);
    assert(frame.accel_z == 3);
    assert(frame.gyro_x == -4);
    assert(frame.gyro_y == 5);
    assert(frame.gyro_z == -6);

    std::puts("espnow_imu_frame_test: ok");
    return 0;
}
```

And the wrapper `tests/connectivity/run_espnow_imu_frame_test.sh`:

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

Run it:

```bash
bash tests/connectivity/run_espnow_imu_frame_test.sh
```

The wrapper does three things: compile, link, run. Add `g++` flags (`-Wall -Wextra -Werror`) for stricter checking.

## What can be host-tested

- **Packed structs and frame encoders** — `espnow_*_frame_*`, `gateway_command_*`, `marker_*`. Pure data marshalling.
- **Policy modules** — `connectivity_mode_policy`, `electrode_detach_gate`, `acquisition_command_policy`. Pure decision logic.
- **Pure algorithms** — `hr_fused`, `resp_fallback`, `summary_metrics`. Make sure they don't `malloc` or call FreeRTOS and they're trivially host-testable.
- **State machines** — anything that's a transition table plus a few event handlers.

## What must NOT be host-tested

- Anything that includes `<freertos/FreeRTOS.h>`.
- Anything that includes `esp_log.h` (unless you fake it).
- Anything that includes driver headers (`driver/spi_master.h`, `driver/i2c.h`).
- Anything that pulls in NVS, BLE, Wi-Fi, ESP-NOW stacks.

If a header you want to test transitively includes one of these, factor the pure logic out into a separate translation unit. The split is usually: `policy.hpp/cpp` for pure logic, `policy_runtime.cpp` for the FreeRTOS-aware glue.

## Fakes for FreeRTOS (when you need them)

If you have a real CMake host project (not the AMS7 minimal pattern) and want to test code that touches FreeRTOS, use the **`cpp-testing`** skill's fakes recipe. The minimum useful fakes:

- `fake_freertos.h` — declares the FreeRTOS API surface used by the code under test, with hooks (`xQueueCreate` returns a recorded handle, etc.).
- `fake_log.h` — empty `ESP_LOG*` macros or a recorded message list.

Keep fakes local to the test, not in `main/`. Use `BUILD_ONLY_FAKES` or a separate `tests/host/` CMake target.

## CMake host project (alternative to per-test shell scripts)

For larger suites:

```cmake
# tests/host/CMakeLists.txt
cmake_minimum_required(VERSION 3.16)
project(ams7_host_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(test_espnow_imu
    ../../main/connectivity/espnow_imu_frame.cpp
    espnow_imu_frame_test.cpp
)
target_include_directories(test_espnow_imu PRIVATE
    ${CMAKE_SOURCE_DIR}/../../main/connectivity
)
```

```bash
cmake -S tests/host -B tests/host/build
cmake --build tests/host/build
./tests/host/build/test_espnow_imu
```

Tradeoffs vs the AMS7 minimal pattern:

| Aspect           | AMS7 shell wrapper              | CMake host project        |
|------------------|---------------------------------|---------------------------|
| Setup cost       | Zero — one shell script per test| One CMakeLists to maintain |
| Linking firmware | Direct `g++ ... file.cpp`       | Same, via CMake rules     |
| Adding fakes     | None                            | Add a `fake/` directory   |
| Test discovery   | Manual                          | `ctest`                   |
| CI integration   | `find tests -name run_*.sh`     | `ctest --output-on-failure` |
| Build parallelism| Sequential                      | Parallel via `cmake --build` |

Both are valid. AMS7 picks the shell wrapper because every test is one file and one assertion set — `ctest` overhead is not worth it.

## Tests vs fixtures

AMS7 has `tests/fixtures/` for replay inputs (recorded sensor traces used to drive host tests):

```cpp
// tests/fixtures/replay/ecg_2024-09-12.bin  — raw bytes recorded from a real run
```

Load fixtures in tests via `std::ifstream` rather than copy-pasting bytes into the test source.

## Common pitfalls

- **Including `<esp_log.h>` from a header that's host-tested.** Fix: forward-declare the log macros in the header, include the real one only in `.cpp`. Or include the AMS7 fake `tests/support/host_include/esp_log.h` if one exists.
- **`malloc` in pure logic.** Symptom: host test runs fine but firmware crashes from fragmentation. Fix: allocate in the wrapper, pass a buffer in.
- **Globals with static initialization.** Symptom: works on host, fails on target because init order is different. Fix: prefer explicit `init()` calls.
- **Asserting on floating-point equality.** Use a tolerance: `assert(std::abs(a - b) < 1e-3)`.
- **Forgetting `-Werror` in CI.** Compile-only warnings become ship-time bugs. The AMS7 host tests are silent on warnings by default; consider adding `-Wall -Wextra` to your shell wrappers.
- **Test passes on host, fails on firmware.** The two are usually equivalent for pure logic, but always cross-check with a firmware-side integration test (a debug print, a recorded trace, or an ESP-NOW roundtrip).

## When to grow beyond the minimal pattern

Stay with the shell wrapper while:

- Test count is < ~30.
- Each test is one `.cpp` plus one shell script.
- No fakes needed.
- CI just iterates `tests/ -name run_*.sh`.

Migrate to a CMake host project when:

- You need `ctest` for CI parallelism and reporting.
- You need fakes (FreeRTOS, log, drivers).
- A test needs to link multiple firmware modules together.
- You want fixtures automatically discovered.
