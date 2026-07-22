---
name: cpp-testing
description: Use this skill when writing or improving C++ tests, choosing a test framework, designing host-side tests for embedded firmware, or running a test-gate / TDD workflow. Triggers on tasks involving GoogleTest, Catch2, doctest, mocking, coverage, or host-test binaries for firmware modules.
---

# C++ Testing Skill

## Overview

This skill provides guidance for writing effective C++ tests across the full testing pyramid: unit, integration, host-side, and on-device. It covers framework selection, test layering, host-test patterns for embedded firmware, TDD workflow, coverage targets, mocking strategies, and common anti-patterns.

Key use cases:
- Writing new tests for a C++ module
- Choosing between GoogleTest, Catch2, and doctest
- Setting up a host-side test binary that links firmware C++ code without ESP-IDF or FreeRTOS
- Running a test-gate to verify 80% coverage before merging
- Applying TDD to firmware policy/payload modules

## Test Framework Selection

| Framework | Best For | Strengths | Weaknesses |
|-----------|----------|-----------|------------|
| **GoogleTest** | Large projects, parametric tests, fixtures | Rich feature set, wide adoption, `TEST_P`, `TEST_F`, death tests | Verbose, heavy |
| **Catch2** | Quick to write, expressive | Single-header, BDD-style, very low boilerplate | Slower compile, less `gtest` ecosystem |
| **doctest** | Header-only, compile-time speed | Fast compile, lightweight, C++17 | Less ecosystem, newer |

**Recommendation:** Default to GoogleTest for embedded/firmware projects — its `TEST_P`/`TEST_F` and death tests are well-suited to policy modules. Use Catch2 when you want minimal friction for small utilities. Use doctest when compile speed is critical.

See `references/framework-compare.md` for code samples.

## Test Layering

```
┌─────────────────────────────────────┐
│     Host-Side Integration Tests     │  ← Binary links firmware .cpp, tests policy/payload
├─────────────────────────────────────┤
│       On-Device Integration Tests   │  ← Runs on target; tests HW / interrupts
├─────────────────────────────────────┤
│         Unit Tests (isolated)       │  ← Pure C++, mocked deps, fast
└─────────────────────────────────────┘
```

- **Unit tests:** Test a single class/function in isolation. Link a `.cpp` directly into the test binary with mocked dependencies.
- **Host-side integration tests:** Compile a `test_*.cpp` binary that links one or more firmware modules from `main/` or `components/`. No ESP-IDF, no FreeRTOS. Use for policy, payload, and datacollector modules.
- **On-device tests:** Run on the actual hardware. Require `idf.py test` and device flashing.

See `references/host-test-for-embedded.md` for the CMake setup pattern.

## Host-Side Test Pattern for Embedded Firmware

The goal: build a standalone Linux binary that links firmware C++ code and runs assertions — no ESP-IDF, no FreeRTOS.

**CMake pattern (minimal):**

```cmake
# test/host/CMakeLists.txt
cmake_minimum_required(VERSION 3.16)
project(host_feature_flags_test)

add_executable(test_feature_flags
    ${CMAKE_CURRENT_SOURCE_DIR}/test_feature_flags.cpp
    ${FIRMWARE_ROOT}/main/policy/feature_flags.cpp
)
target_compile_features(test_feature_flags PRIVATE cxx_std_17)
target_link_libraries(test_feature_flags PRIVATE gtest gmock pthread)
```

**Test source pattern:**

```cpp
// test/host/test_feature_flags.cpp
#include <gtest/gtest.h>
#include "feature_flags.h"   // firmware header — no ESP-IDF, no FreeRTOS

// Mock any firmware-freeRTOS deps via abstract interface or std::function injection
namespace mock {
  std::function<bool(const char*)> is_active_override;
}

bool is_feature_active(const char* name) {
  if (mock::is_active_override) return mock::is_active_override(name);
  return feature_flags_impl(name);  // call real impl
}

TEST(FeatureFlags, returns_true_for_known_feature) {
  mock::is_active_override = [](const char* n) { return strcmp(n, "debug") == 0; };
  EXPECT_TRUE(is_feature_active("debug"));
}
```

See `references/host-test-for-embedded.md` for full examples testing `feature_flags.cpp`, `resp_fallback.cpp`, and `datacollector.cpp`.

## TDD Workflow for C++

1. **Red** — Write a failing test first. Compile and run; confirm it fails for the right reason.
2. **Green** — Write the minimum production code to make the test pass. No optimization yet.
3. **Refactor** — Clean up production and test code. Re-run tests to confirm they still pass.
4. **Repeat** — Add the next test case.

**Tips for C++ TDD:**
- Keep tests compilable at all times (even if currently failing).
- Use `ASSERT_*` when continued execution after failure is meaningless.
- Write one logical assertion per test (multiple `EXPECT_*` is fine).
- Name tests `Subject_Under_Test_Behavior_Expected`. Example: `RespFallback_returns_original_when_fallback_unavailable`.

See `references/tdd-workflow.md` for a step-by-step walkthrough.

## Coverage

**80% line coverage** is the default gate. For a test-gate to pass:
- At least 80% of all `.cpp` files in `main/` and `components/` must be covered.
- **Exclude:** mock files (`*_mock.cpp`, `*_mock.h`), generated code, third-party sources.
- Coverage is measured with `gcov` / `lcov`. Run: `cmake --build build -- -j && lcov --capture --directory . --output coverage.info --exclude '*/mocks/*' --exclude '*/build/*'`

**What to cover:**
- All public class methods (including error paths)
- All `if/else` and `switch` branches
- Edge cases: empty input, null pointers, boundary values, error returns
- Negative tests: verify the code fails gracefully for bad inputs

See `references/coverage.md` for `gcov`/`lcov` setup and exclusion patterns.

## Mocking Strategies

### 1. Abstract Interface (Dependency Inversion)

Define a pure virtual interface and inject a test double:

```cpp
// interfaces.h
struct IFeatureStorage {
  virtual bool read(const char* key, std::string& out) = 0;
  virtual ~IFeatureStorage() = default;
};

// production code uses IFeatureStorage*
class FeatureFlags {
public:
  explicit FeatureFlags(IFeatureStorage* storage) : storage_(storage) {}
  bool is_active(const char* name);
private:
  IFeatureStorage* storage_;
};

// test double
struct FakeStorage : IFeatureStorage {
  bool read(const char* key, std::string& out) override {
    if (strcmp(key, "debug") == 0) { out = "true"; return true; }
    return false;
  }
};

TEST(FeatureFlags, uses_injected_storage) {
  FakeStorage fake;
  FeatureFlags ff(&fake);
  EXPECT_TRUE(ff.is_active("debug"));
}
```

### 2. Link-Time Seam

Compile the module under test with a fake implementation at link time. Replace the real `*.cpp` with a test stub. Useful when you cannot modify the source or inject dependencies:

```cmake
# Link test stub instead of production implementation
target_sources(test_feature_flags PRIVATE fake_feature_flags.cpp)
```

### 3. `std::function` Injection

Pass behavior as `std::function` for runtime flexibility:

```cpp
class RespFallback {
public:
  using response_check_t = std::function<bool(const Response&)>;
  explicit RespFallback(response_check_t checker) : checker_(std::move(checker)) {}
  // ...
};
```

This is the lightest option — no interface hierarchy needed.

See `references/mocking.md` for detailed patterns and tradeoffs.

## Fixtures and TEST_F / TEST_P

### TEST_F (Fixture-based)

Use `TEST_F` when multiple tests share setup/teardown logic:

```cpp
class DatacollectorTest : public ::testing::Test {
protected:
  void SetUp() override { collector_ = std::make_unique<Datacollector>(); }
  void TearDown() override { collector_.reset(); }
  std::unique_ptr<Datacollector> collector_;
};

TEST_F(DatacollectorTest, appends_reading) {
  collector_->append(42.0);
  EXPECT_DOUBLE_EQ(collector_->latest(), 42.0);
}
```

### TEST_P (Parametric)

Use `TEST_P` when the same test logic applies to multiple parameter sets:

```cpp
class RespFallbackParamTest : public ::testing::TestWithParam<const char*> {};

TEST_P(RespFallbackParamTest, handles_named_response) {
  const char* name = GetParam();
  RespFallback rf;
  EXPECT_NO_THROW(rf.process(name));
}

INSTANTIATE_TEST_SUITE_P(NamedResponses, RespFallbackParamTest,
  ::testing::Values("keepalive", "chunked", "gzip"));
```

## Assertion Choice: EXPECT_* vs ASSERT_*

| Macro | Behavior on failure | Use when... |
|-------|---------------------|-------------|
| `EXPECT_*` | Continues test execution | Primary assertions; multiple related checks |
| `ASSERT_*` | Aborts immediately | Precondition failure; continuing is meaningless |

**Rule:** Default to `EXPECT_*`. Use `ASSERT_*` when failure would make subsequent assertions invalid (e.g., null pointer dereference, file open failure).

## Test Naming Convention

Follow the pattern: `Subject_Under_Test_Behavior_Expected`

```
RespFallback_returns_original_when_fallback_unavailable
FeatureFlags_is_active_returns_true_for_enabled_feature
Datacollector_latest_throws_when_collection_empty
```

Avoid: `test1`, `TestFeatureFlags`, `test_is_active` — they don't communicate intent.

## Common Anti-Patterns

1. **Testing private methods** — Test the public interface only. Private method changes break tests unnecessarily.
2. **Overspecifying** — Don't assert on exact ordering unless that's the contract. Prefer behavioral assertions.
3. **Missing negative tests** — Always test the error/edge path, not just the happy path.
4. **Global state leakage** — Each test must be independent. Reset shared state in `SetUp()`.
5. **Mocking too much** — If you're mocking everything, you're not testing the real code. Prefer integration tests for module interactions.
6. **Flaky tests** — Avoid timing, threading races, and filesystem dependencies in unit tests.

## Do / Don't

### Do

```cpp
// DO: Use descriptive test names
TEST(FeatureFlags, is_active_returns_false_for_unknown_feature) {
  EXPECT_FALSE(flags.is_active("nonexistent"));
}

// DO: Use ASSERT_* for preconditions
TEST(Datacollector, latest_throws_when_empty) {
  ASSERT_FALSE(collector->has_readings());  // guard before calling latest()
  EXPECT_THROW(collector->latest(), std::runtime_error);
}

// DO: Test through the public interface
TEST(RespFallback, returns_original_when_fallback_missing) {
  RespFallback rf;
  Response out = rf.process(Response{"original"});
  EXPECT_EQ(out.payload, "original");
}
```

### Don't

```cpp
// DON'T: Test private methods — test the public API instead
TEST(FeatureFlags, DISABLED_test_internal_state) { /* ... */ }

// DON'T: Overspecify — don't assert on internal state
TEST(FeatureFlags, is_active_caches_result) {  // fragile, tests implementation
  flags.is_active("debug");
  EXPECT_EQ(flags.cache_size(), 1);  // too specific
}

// DON'T: Forget negative tests
TEST(FeatureFlags, is_active_handles_nullptr) {
  // Always test error paths
  EXPECT_FALSE(flags.is_active(nullptr));
}
```

## References

Detailed guides on specific topics:

- **`references/framework-compare.md`** — GoogleTest vs Catch2 vs doctest with code samples
- **`references/host-test-for-embedded.md`** — CMake host-test setup, testing policy modules without ESP-IDF
- **`references/mocking.md`** — Abstract interfaces, link-time seams, `std::function` injection
- **`references/tdd-workflow.md`** — Red-green-refactor walkthrough in C++
- **`references/coverage.md`** — gcov/lcov setup, 80% gate, what to exclude