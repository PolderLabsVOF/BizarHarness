# Mocking Strategies in C++

## Overview

Mocking lets you test a unit in isolation by replacing its dependencies with controlled test doubles. In C++, the three primary strategies are:

1. **Abstract Interface** — dependency inversion with a pure virtual interface
2. **Link-Time Seam** — replace a compiled object at link time
3. **`std::function` Injection** — pass behavior as a callable at runtime

Each has a different trade-off between isolation, compile-time cost, and how much you need to modify existing code.

---

## 1. Abstract Interface (Dependency Inversion)

### Concept

Define a pure virtual interface. The class under test accepts a pointer/reference to the interface. In tests, pass a fake implementation.

### When to Use

- You control the design and can introduce interfaces
- You need fine-grained control over mock behavior (ON_CALL, EXPECT_CALL)
- You want to test multiple implementations of the same interface

### Code Example

```cpp
// === interfaces/sensor_reading.h ===
#pragma once
#include <cstdint>
#include <optional>

struct ISensor {
  virtual ~ISensor() = default;
  virtual std::optional<double> read() = 0;
  virtual bool is_connected() = 0;
};

// === main/policy/temp_monitor.h ===
#pragma once
#include "sensor_reading.h"

class TempMonitor {
public:
  explicit TempMonitor(ISensor* sensor) : sensor_(sensor) {}
  bool has_valid_reading();
  double last_reading();
private:
  ISensor* sensor_;
};

// === main/policy/temp_monitor.cpp ===
#include "temp_monitor.h"
#include <algorithm>

bool TempMonitor::has_valid_reading() {
  return sensor_->is_connected() && sensor_->read().has_value();
}

double TempMonitor::last_reading() {
  auto v = sensor_->read();
  return v.value_or(0.0);
}

// === test/host/test_temp_monitor.cpp ===
#include <gtest/gtest.h>
#include "temp_monitor.h"
#include "sensor_reading.h"
#include <optional>

struct FakeSensor : ISensor {
  std::optional<double> fake_value = std::nullopt;
  bool connected = false;

  std::optional<double> read() override { return fake_value; }
  bool is_connected() override { return connected; }
};

TEST(TempMonitor, has_valid_reading_true_when_connected_and_has_value) {
  FakeSensor fake;
  fake.connected = true;
  fake.fake_value = 23.5;
  TempMonitor monitor(&fake);
  EXPECT_TRUE(monitor.has_valid_reading());
  EXPECT_DOUBLE_EQ(monitor.last_reading(), 23.5);
}

TEST(TempMonitor, has_valid_reading_false_when_disconnected) {
  FakeSensor fake;
  fake.connected = false;
  fake.fake_value = 23.5;
  TempMonitor monitor(&fake);
  EXPECT_FALSE(monitor.has_valid_reading());
}

TEST(TempMonitor, has_valid_reading_false_when_no_value) {
  FakeSensor fake;
  fake.connected = true;
  fake.fake_value = std::nullopt;
  TempMonitor monitor(&fake);
  EXPECT_FALSE(monitor.has_valid_reading());
}
```

### Trade-offs

| Pros | Cons |
|------|------|
| Full control over mock behavior | Requires interface in production code |
| Works with `gmock` (`ON_CALL`, `EXPECT_CALL`) | Adds indirection to class design |
| Tests are fully isolated | Can be verbose for simple cases |

---

## 2. Link-Time Seam

### Concept

Compile a different version of a file at link time to replace the production implementation. The test links its own `.cpp` that provides a minimal or fake implementation of the dependency.

### When to Use

- You cannot modify the existing production code to accept interfaces
- The dependency is a single global function or static method
- You want to test a module without any runtime injection mechanism

### Code Example

```cpp
// === main/policy/heartbeat.h ===
#pragma once
bool heartbeat_send(uint32_t interval_ms);

// === main/policy/heartbeat.cpp ===
#include "heartbeat.h"
#include "esp_timer.h"  // FreeRTOS/ESP-IDF — not available on host

bool heartbeat_send(uint32_t interval_ms) {
  esp_timer_start_periodic(..., interval_ms * 1000);
  return true;
}

// === test/host/CMakeLists.txt ===
# Replace real heartbeat.cpp with stub at link time
add_executable(test_heartbeat
    test_heartbeat.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main/policy/heartbeat.cpp   # production
    ${CMAKE_CURRENT_SOURCE_DIR}/stubs/heartbeat_stub.cpp          # our fake
)
```

```cpp
// === test/host/stubs/heartbeat_stub.cpp ===
#include "heartbeat.h"

bool heartbeat_send(uint32_t interval_ms) {
  // No-op on host — just return true
  (void)interval_ms;
  return true;
}
```

```cpp
// === test/host/test_heartbeat.cpp ===
#include <gtest/gtest.h>
#include "heartbeat.h"

TEST(Heartbeat, send_returns_true) {
  EXPECT_TRUE(heartbeat_send(1000));
}

TEST(Heartbeat, send_accepts_zero_interval) {
  EXPECT_TRUE(heartbeat_send(0));
}
```

### Trade-offs

| Pros | Cons |
|------|------|
| No production code changes needed | Only works when you control what's linked |
| Works with any C/C++ function | Can mask integration issues if stub is too fake |
| Simple to implement | No runtime control — compile-time replacement only |

---

## 3. `std::function` Injection

### Concept

Make behavior injectable via `std::function` member variables set at construction or via setters. No interface hierarchy needed.

### When to Use

- You want minimal boilerplate
- The dependency is a simple callable (function, functor, lambda)
- You don't need `gmock` expectations — simple behavior is enough

### Code Example

```cpp
// === main/policy/resp_fallback.h ===
#pragma once
#include <functional>
#include "resp_fallback_types.h"  // Response, FallbackResult

class RespFallback {
public:
  using response_check_t = std::function<bool(const Response&)>;
  using fallback_fn_t = std::function<FallbackResult(const Response*, Response*)>;

  explicit RespFallback(response_check_t checker = nullptr,
                        fallback_fn_t fallback_fn = nullptr)
      : checker_(std::move(checker)), fallback_fn_(std::move(fallback_fn)) {}

  FallbackResult process(const Response* req, Response* out);

private:
  response_check_t checker_;
  fallback_fn_t fallback_fn_;
};

// === test/host/test_resp_fallback.cpp ===
#include <gtest/gtest.h>
#include "resp_fallback.h"

TEST(RespFallback, uses_checker_when_provided) {
  bool checker_called = false;
  RespFallback rf(
    [&checker_called](const Response&) {
      checker_called = true;
      return true;
    },
    nullptr
  );
  Response out;
  Response in = { .payload = "test", .payload_len = 4, .status_code = 500 };
  rf.process(&in, &out);
  EXPECT_TRUE(checker_called);
}

TEST(RespFallback, uses_fallback_fn_when_checker_fails) {
  bool fallback_called = false;
  RespFallback rf(
    [](const Response&) { return false; },  // checker returns false
    [&fallback_called](const Response*, Response* out) {
      fallback_called = true;
      out->payload = "fallback";
      out->status_code = 200;
      return FallbackResult::FALLBACK_OK;
    }
  );
  Response out;
  Response in = { .payload = "error", .payload_len = 5, .status_code = 500 };
  FallbackResult r = rf.process(&in, &out);
  EXPECT_TRUE(fallback_called);
  EXPECT_EQ(r, FallbackResult::FALLBACK_OK);
}
```

### Trade-offs

| Pros | Cons |
|------|------|
| Zero boilerplate — no interface needed | Cannot use `EXPECT_CALL` / `ON_CALL` with gmock |
| Lambda-friendly | Lambdas can't be stored in `std::function` if they capture |
| Works with existing code (add a setter) | Tests must provide real behavior if production doesn't |

---

## 4. gmock (GoogleMock) — Struct-Level MATCHER

When using GoogleTest, `gmock` provides `MATCHER` and `ON_CALL` for fine-grained expectations on structs:

```cpp
#include <gmock/gmock.h>
#include <gtest/gtest.h>

struct Reading {
  double temperature;
  uint32_t timestamp;
};

MATCHER_P(TempNear, expected, "") {
  return std::abs(arg.temperature - expected) < 0.5;
}

TEST(Sensor, reading_near_expected) {
  ::testing::MockFunction<bool(const Reading&)> mock_check;
  ON_CALL(mock_check, Call)
    .WillByDefault(::testing::Return(true));

  EXPECT_CALL(mock_check, Call(TempNear(25.0))).Times(1);

  Reading r = { 25.1, 123456 };
  mock_check.Call(r);
}
```

For simple structs, `MATCHER` is cleaner than writing a full fake class.

---

## Choosing a Strategy

| Situation | Recommended Strategy |
|-----------|---------------------|
| New code, you control design | Abstract Interface + `gmock` |
| Testing existing code with no interface | Link-Time Seam |
| Simple callable dependency, no gmock needed | `std::function` Injection |
| Struct-level assertions | `MATCHER` / `ON_CALL` |
| Need `EXPECT_CALL` with complex behavior | Abstract Interface + `gmock` |
| FreeRTOS/ESP-IDF call in production code | Link-Time Seam (stub at link) |

---

## Anti-Patterns

### Don't Over-Mock

```cpp
// BAD — mocking everything means you're not testing real code
TEST(System, processes_data) {
  auto mock_storage = std::make_unique<MockStorage>();
  auto mock_network = std::make_unique<MockNetwork>();
  ON_CALL(*mock_storage, read).WillByDefault(...);
  ON_CALL(*mock_network, send).WillByDefault(...);
  System sys(std::move(mock_storage), std::move(mock_network));
  // This tests nothing real
}
```

**Better:** Test `System` with real `Storage` and mocked `Network`, or vice versa. Only mock at boundaries.

### Don't Mock Value Types

```cpp
// BAD — no need to mock a simple struct
struct Config { int timeout_ms; bool enabled; };

// GOOD — construct directly, no mock needed
Config cfg{1000, true};
```

### Don't Mock Stateless Utilities

```cpp
// BAD — mocking a pure function like strlen is wasteful
// GOOD — just call strlen in tests directly
EXPECT_EQ(strlen("hello"), 5);
```

---

## Combining Strategies

You can combine strategies in the same project. For example:
- Use **Abstract Interface** for `ISensor`, `IStorage` (core domain interfaces)
- Use **Link-Time Seam** for FreeRTOS / ESP-IDF API calls
- Use **`std::function`** for simple policy callbacks

The key principle: **mock at boundaries, not deep inside the system**.