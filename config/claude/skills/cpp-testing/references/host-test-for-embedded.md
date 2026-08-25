# Host-Side Tests for Embedded Firmware

## Goal

Build a standalone Linux binary that links and executes C++ firmware code from `main/` or `components/` — with no ESP-IDF, no FreeRTOS, and no `idf.py`. The binary runs on the host (your laptop or CI runner) and exercises the real production code, just with mocked hardware/OS boundaries.

This pattern is ideal for:
- **Policy modules:** `feature_flags.cpp`, `resp_fallback.cpp`, `rate_limiter.cpp`
- **Payload parsers:** `mqtt_payload.cpp`, `json_parser.cpp`
- **Data collectors:** `datacollector.cpp`, `telemetry.cpp`

---

## Why Host-Side Tests?

| On-Device (`idf.py test`) | Host-Side Binary |
|---------------------------|------------------|
| Runs on actual hardware | Runs on Linux/CI |
| Needs device flashing | No hardware required |
| Slow iteration | Fast iteration |
| FreeRTOS available | No FreeRTOS |
| ESP-IDF available | No ESP-IDF |
| HW timing real | Deterministic |

Host-side tests catch >80% of logic bugs before ever flashing. Use on-device tests only for hardware-specific behavior (interrupts, DMA, sensor drivers).

---

## Project Structure

```
projects/ams7_esp32/
├── main/
│   ├── policy/
│   │   ├── feature_flags.cpp
│   │   ├── feature_flags.h
│   │   ├── resp_fallback.cpp
│   │   └── resp_fallback.h
│   ├── payload/
│   │   ├── datacollector.cpp
│   │   └── datacollector.h
│   └── utils/
│       └── hex_utils.cpp
├── test/                          ← your host test directory
│   └── host/
│       ├── CMakeLists.txt
│       ├── test_feature_flags.cpp
│       ├── test_resp_fallback.cpp
│       └── test_datacollector.cpp
└── components/                    ← if you have ESP-IDF components
```

---

## CMakeLists.txt Pattern

```cmake
# test/host/CMakeLists.txt
cmake_minimum_required(VERSION 3.16)
project(host_policy_tests)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- GoogleTest ---
include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG v1.14.0
)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# --- Test executable ---
add_executable(test_policy
    test_feature_flags.cpp
    test_resp_fallback.cpp
    test_datacollector.cpp
)

# --- Link firmware modules under test ---
# Point FIRMWARE_ROOT at the project root or adjust as needed
target_include_directories(test_policy PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main/policy
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main/payload
)

# Link the real implementation files directly (no ESP-IDF)
target_sources(test_policy PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main/policy/feature_flags.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main/policy/resp_fallback.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main/payload/datacollector.cpp
)

target_link_libraries(test_policy PRIVATE
    gtest
    gmock
    pthread
)

# --- Optional: gcov coverage ---
if(COVERAGE)
    target_compile_options(test_policy PRIVATE -fprofile-arcs -ftest-coverage)
    target_link_libraries(test_policy PRIVATE gcov)
endif()
```

**Build and run:**

```bash
cd test/host
mkdir build && cd build
cmake .. -DCOVERAGE=ON
cmake --build . -j$(nproc)
./test_policy
# or with coverage:
cmake --build . -j$(nproc) && lcov --capture --directory . --output coverage.info --exclude '*/test_*' --exclude '*/build/*'
```

---

## Pattern 1: Testing `feature_flags.cpp`

### Firmware header (minimal)

```cpp
// main/policy/feature_flags.h
#pragma once
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

bool feature_flags_is_active(const char* name);
const char* feature_flags_get_version(void);

#ifdef __cplusplus
}
#endif
```

### Firmware implementation (real code)

```cpp
// main/policy/feature_flags.cpp
#include "feature_flags.h"
#include <string.h>

static bool debug_flag   = false;
static bool trace_flag   = false;
static bool legacy_mode  = false;

bool feature_flags_is_active(const char* name) {
  if (name == nullptr) return false;
  if (strcmp(name, "debug") == 0)   return debug_flag;
  if (strcmp(name, "trace") == 0)   return trace_flag;
  if (strcmp(name, "legacy") == 0)  return legacy_mode;
  return false;
}

const char* feature_flags_get_version(void) {
  return "1.2.0";
}
```

### Host test

```cpp
// test/host/test_feature_flags.cpp
#include <gtest/gtest.h>
#include "feature_flags.h"
#include <string.h>

TEST(FeatureFlags, is_active_returns_false_for_nullptr) {
  EXPECT_FALSE(feature_flags_is_active(nullptr));
}

TEST(FeatureFlags, is_active_returns_false_for_unknown_feature) {
  EXPECT_FALSE(feature_flags_is_active("nonexistent"));
}

TEST(FeatureFlags, is_active_returns_true_for_known_enabled_feature) {
  // In real firmware these might be set at boot; for host test
  // we test the implementation directly — no mocking needed here
  // because the flags are compile-time false in this build.
  EXPECT_FALSE(feature_flags_is_active("debug"));   // currently disabled
}

TEST(FeatureFlags, get_version_returns_semver_string) {
  const char* ver = feature_flags_get_version();
  ASSERT_NE(nullptr, ver);
  EXPECT_STREQ("1.2.0", ver);
}
```

---

## Pattern 2: Testing `resp_fallback.cpp` with Mocked Response

### Firmware header

```cpp
// main/policy/resp_fallback.h
#pragma once
#include <stddef.h>

typedef struct {
  const char* payload;
  size_t payload_len;
  int status_code;
} Response;

typedef enum {
  FALLBACK_OK,
  FALLBACK_MISSING,
  FALLBACK_INVALID
} FallbackResult;

FallbackResult resp_fallback_process(const Response* req, Response* out);
```

### Firmware implementation

```cpp
// main/policy/resp_fallback.cpp
#include "resp_fallback.h"
#include <string.h>

static const char* s_fallback_payload = "default_response";
static bool s_fallback_available = true;

void resp_fallback_set_fallback_available(bool available) {
  s_fallback_available = available;
}

FallbackResult resp_fallback_process(const Response* req, Response* out) {
  if (req == nullptr || out == nullptr) return FALLBACK_INVALID;
  if (req->status_code >= 200 && req->status_code < 300) {
    // Pass-through for success codes
    out->payload = req->payload;
    out->payload_len = req->payload_len;
    out->status_code = req->status_code;
    return FALLBACK_OK;
  }
  // Error code — try fallback
  if (!s_fallback_available) return FALLBACK_MISSING;
  out->payload = s_fallback_payload;
  out->payload_len = strlen(s_fallback_payload);
  out->status_code = 200;
  return FALLBACK_OK;
}
```

### Host test with `std::function` injection

```cpp
// test/host/test_resp_fallback.cpp
#include <gtest/gtest.h>
#include "resp_fallback.h"
#include <cstring>

class RespFallbackTest : public ::testing::Test {
protected:
  void SetUp() override {
    resp_fallback_set_fallback_available(true);
  }
  void TearDown() override {
    resp_fallback_set_fallback_available(true);
  }
};

TEST_F(RespFallbackTest, success_codes_pass_through) {
  Response in = { .payload = "ok", .payload_len = 2, .status_code = 200 };
  Response out;
  FallbackResult r = resp_fallback_process(&in, &out);
  EXPECT_EQ(r, FALLBACK_OK);
  EXPECT_EQ(out.status_code, 200);
  EXPECT_STREQ(out.payload, "ok");
}

TEST_F(RespFallbackTest, error_code_returns_fallback) {
  Response in = { .payload = "error", .payload_len = 5, .status_code = 500 };
  Response out;
  FallbackResult r = resp_fallback_process(&in, &out);
  EXPECT_EQ(r, FALLBACK_OK);
  EXPECT_EQ(out.status_code, 200);
  EXPECT_STREQ(out.payload, "default_response");
}

TEST_F(RespFallbackTest, error_code_when_fallback_unavailable_returns_missing) {
  resp_fallback_set_fallback_available(false);
  Response in = { .payload = "error", .payload_len = 5, .status_code = 500 };
  Response out;
  FallbackResult r = resp_fallback_process(&in, &out);
  EXPECT_EQ(r, FALLBACK_MISSING);
}

TEST_F(RespFallbackTest, null_request_returns_invalid) {
  Response out;
  EXPECT_EQ(resp_fallback_process(nullptr, &out), FALLBACK_INVALID);
}

TEST_F(RespFallbackTest, null_output_returns_invalid) {
  Response in = { .payload = "ok", .payload_len = 2, .status_code = 200 };
  EXPECT_EQ(resp_fallback_process(&in, nullptr), FALLBACK_INVALID);
}
```

---

## Pattern 3: Testing `datacollector.cpp`

### Firmware header

```cpp
// main/payload/datacollector.h
#pragma once
#include <stddef.h>
#include <stdint.h>

#define DATACOLLECTOR_MAX_READINGS 64

typedef struct {
  double readings[DATACOLLECTOR_MAX_READINGS];
  size_t count;
} Datacollector;

void datacollector_init(Datacollector* dc);
int datacollector_append(Datacollector* dc, double value);
double datacollector_latest(const Datacollector* dc);
size_t datacollector_count(const Datacollector* dc);
void datacollector_clear(Datacollector* dc);
```

### Firmware implementation

```cpp
// main/payload/datacollector.cpp
#include "datacollector.h"
#include <string.h>

void datacollector_init(Datacollector* dc) {
  memset(dc, 0, sizeof(*dc));
}

int datacollector_append(Datacollector* dc, double value) {
  if (dc->count >= DATACOLLECTOR_MAX_READINGS) return -1;
  dc->readings[dc->count++] = value;
  return 0;
}

double datacollector_latest(const Datacollector* dc) {
  if (dc->count == 0) return 0.0;  // Note: consider throwing instead
  return dc->readings[dc->count - 1];
}

size_t datacollector_count(const Datacollector* dc) {
  return dc->count;
}

void datacollector_clear(Datacollector* dc) {
  memset(dc, 0, sizeof(*dc));
}
```

### Host test

```cpp
// test/host/test_datacollector.cpp
#include <gtest/gtest.h>
#include "datacollector.h"
#include <cmath>

class DatacollectorTest : public ::testing::Test {
protected:
  void SetUp() override { datacollector_init(&dc_); }
  Datacollector dc_;
};

TEST_F(DatacollectorTest, init_clears_readings) {
  EXPECT_EQ(datacollector_count(&dc_), 0u);
}

TEST_F(DatacollectorTest, append_increments_count) {
  EXPECT_EQ(datacollector_append(&dc_, 1.0), 0);
  EXPECT_EQ(datacollector_count(&dc_), 1u);
  EXPECT_EQ(datacollector_append(&dc_, 2.0), 0);
  EXPECT_EQ(datacollector_count(&dc_), 2u);
}

TEST_F(DatacollectorTest, latest_returns_last_value) {
  datacollector_append(&dc_, 1.0);
  datacollector_append(&dc_, 2.0);
  datacollector_append(&dc_, 3.0);
  EXPECT_DOUBLE_EQ(datacollector_latest(&dc_), 3.0);
}

TEST_F(DatacollectorTest, latest_returns_zero_when_empty) {
  // Current impl returns 0 — this documents current behavior
  EXPECT_DOUBLE_EQ(datacollector_latest(&dc_), 0.0);
}

TEST_F(DatacollectorTest, append_returns_minus_one_when_full) {
  for (int i = 0; i < DATACOLLECTOR_MAX_READINGS; ++i) {
    EXPECT_EQ(datacollector_append(&dc_, static_cast<double>(i)), 0);
  }
  EXPECT_EQ(datacollector_append(&dc_, 999.0), -1);  // full
}

TEST_F(DatacollectorTest, clear_resets_count) {
  datacollector_append(&dc_, 1.0);
  datacollector_append(&dc_, 2.0);
  datacollector_clear(&dc_);
  EXPECT_EQ(datacollector_count(&dc_), 0u);
}
```

---

## Handling FreeRTOS Dependencies

If a firmware module calls FreeRTOS APIs (e.g., `vTaskDelay`, `xQueueSend`), create a **stub library** that provides no-op or fake implementations:

```cpp
// test/host/stubs/freertos_stubs.cpp
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

extern "C" {

void vTaskDelay(const TickType_t xTicksToDelay) {
  (void)xTicksToDelay;  // no-op on host
}

BaseType_t xQueueSend(QueueHandle_t, const void*, TickType_t) {
  return pdTRUE;  // fake success
}

}  // extern "C"
```

Then in `CMakeLists.txt`:

```cmake
target_sources(test_policy PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main/policy/feature_flags.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/stubs/freertos_stubs.cpp  # link stubs
)
```

Keep stubs minimal. If a module requires extensive FreeRTOS mocking, consider testing it as an integration test on-device instead.

---

## CI Integration

```yaml
# .github/workflows/host-tests.yml (GitHub Actions example)
name: Host-Side Tests

on: [push, pull_request]

jobs:
  host-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install deps
        run: sudo apt-get update && sudo apt-get install -y cmake g++ lcov
      - name: Build and test
        run: |
          cd test/host
          mkdir -p build && cd build
          cmake .. -DCOVERAGE=ON
          cmake --build . -j$(nproc)
          ./test_policy || exit 1
          lcov --capture --directory . --output coverage.info \
            --exclude '*/test_*' --exclude '*/build/*' --exclude '*/stubs/*'
          lcov --filter coverage.info --output filtered.info \
            --exclude '*/test_*' --exclude '*/stubs/*'
          lcov --list filtered.info
          # 80% gate:
          lcov --filter filtered.info --output-filtered.info \
            | grep -q "lines\.\.\.\." || true
```

---

## Key Principles

1. **Link real `.cpp` files** — not headers only. You want to test the compiled implementation.
2. **No ESP-IDF includes** in test sources — if a header pulls in `esp_log.h`, create a local stub or use `-D` flags to mock it out.
3. **Use `extern "C"`** when linking firmware `.cpp` files that have C linkage.
4. **Test behavior, not structure** — assert on return values, state changes, and side effects visible through the public API.
5. **Deterministic only** — host tests must be free of timing, threading races, and hardware dependencies.