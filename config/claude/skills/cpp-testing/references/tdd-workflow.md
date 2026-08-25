# TDD Workflow for C++

## Overview

Test-Driven Development (TDD) follows a short red-green-refactor cycle:

1. **Red** — Write a failing test before touching production code.
2. **Green** — Write the minimum production code to make the test pass.
3. **Refactor** — Clean up both test and production code, keeping tests green.

The goal is **narrow, fast feedback**: every line of production code has a failing test that motivated it.

---

## The Cycle in Detail

### Step 1: Red — Write a Failing Test

Write the smallest possible test that describes the behavior you want:

```cpp
// test/host/test_rate_limiter.cpp
#include <gtest/gtest.h>
#include "rate_limiter.h"

TEST(RateLimiter, allows_request_under_limit) {
  RateLimiter rl(10);  // 10 requests per second
  // First request should be allowed
  EXPECT_TRUE(rl.allow());
}
```

Compile and run. It **must fail** because `rate_limiter.h` / `rate_limiter.cpp` don't exist yet:

```
error: 'RateLimiter' file not found
```

This is the correct outcome — you've specified what you want before building it.

### Step 2: Green — Write Minimum Production Code

Create the stub to make it compile, then the implementation to make it pass:

```cpp
// main/policy/rate_limiter.h
#pragma once
class RateLimiter {
public:
  explicit RateLimiter(int max_per_second);
  bool allow();
};
```

```cpp
// main/policy/rate_limiter.cpp
#include "rate_limiter.h"

RateLimiter::RateLimiter(int max_per_second) {}
bool RateLimiter::allow() { return true; }  // minimum: always allow
```

Run tests — they should pass. You now have a compiling, passing test.

### Step 3: Refactor

Now add the second test:

```cpp
TEST(RateLimiter, blocks_request_over_limit) {
  RateLimiter rl(2);
  rl.allow();  // request 1
  rl.allow();  // request 2
  EXPECT_FALSE(rl.allow());  // request 3 — over limit
}
```

Run tests — this new test **fails** (current impl always returns `true`). Go back to Step 2.

```cpp
// main/policy/rate_limiter.cpp — minimum change
#include "rate_limiter.h"
#include <atomic>

RateLimiter::RateLimiter(int max_per_second) : max_per_second_(max_per_second), count_(0) {}

bool RateLimiter::allow() {
  int current = count_.load();
  if (current >= max_per_second_) return false;
  count_.store(current + 1);
  return true;
}
```

Run tests — all pass. Repeat the cycle.

---

## Structuring Tests for TDD

### Arrange-Act-Assert (AAA)

```cpp
TEST(RateLimiter, blocks_over_limit) {
  // Arrange
  RateLimiter rl(1);
  rl.allow();  // consume the one allowed request

  // Act
  bool allowed = rl.allow();

  // Assert
  EXPECT_FALSE(allowed);
}
```

### One Logical Assertion Per Test

Prefer multiple `EXPECT_*` calls that are all checking related aspects of one behavior over one test per `EXPECT_*`. Example:

```cpp
// Good — one test, multiple related EXPECTs
TEST(RespFallback, error_returns_fallback_and_sets_status) {
  Response in = { .payload = "error", .payload_len = 5, .status_code = 500 };
  Response out;
  FallbackResult r = resp_fallback_process(&in, &out);
  EXPECT_EQ(r, FALLBACK_OK);
  EXPECT_EQ(out.status_code, 200);
  EXPECT_STREQ(out.payload, "default_response");
}
```

### Test Naming for TDD

Name tests to describe **behavior**, not implementation:

```
GOOD:  RespFallback_returns_fallback_when_upstream_fails
GOOD:  Datacollector_append_returns_minus_one_when_full
BAD:   TestRespFallback  (no behavior described)
BAD:   Test1             (meaningless)
```

---

## TDD for Embedded Firmware Modules

### Example: `feature_flags.cpp` from scratch

**Start:** You have an empty `feature_flags.cpp` with only a header stub.

**Test 1:** `is_active_returns_false_for_unknown_feature`

```cpp
TEST(FeatureFlags, is_active_returns_false_for_unknown_feature) {
  EXPECT_FALSE(feature_flags_is_active("nonexistent"));
}
```

Compile → link error (no implementation). Add stub:

```cpp
bool feature_flags_is_active(const char* name) { return false; }
```

Test passes. (You chose the simplest implementation that makes the test pass.)

**Test 2:** `is_active_returns_true_for_known_feature`

```cpp
TEST(FeatureFlags, is_active_returns_true_for_known_feature) {
  EXPECT_TRUE(feature_flags_is_active("debug"));
}
```

Test fails (still returns `false`). Implement:

```cpp
bool feature_flags_is_active(const char* name) {
  if (strcmp(name, "debug") == 0) return true;
  return false;
}
```

Test passes.

**Test 3:** `is_active_returns_false_for_nullptr`

```cpp
TEST(FeatureFlags, is_active_returns_false_for_nullptr) {
  EXPECT_FALSE(feature_flags_is_active(nullptr));
}
```

Add the null check. Tests pass.

**Refactor:** Replace chain of `if/strcmp` with a lookup table:

```cpp
static bool flags[] = { false, false, false };  // debug=0, trace=1, legacy=2
```

The tests **still pass** because they assert on behavior, not representation.

---

## Red-Green-Refactor in Practice

### Red Flags (stop and refactor if you see these)

- **Test takes too long to write** — break it into smaller pieces
- **Test requires many mocks** — the module under test may have too many dependencies (consider interface injection)
- **Production code can't be tested in isolation** — the module needs refactoring before tests can be written
- **Tests are brittle** — if renaming a private method breaks a test, you're testing the wrong thing

### Refactoring Rules

1. **Never change tests to make production code pass.** Change production code to make tests pass.
2. **Keep tests deterministic.** No random values, no timing dependencies.
3. **Test behavior, not implementation.** If you refactor internal representation and tests break, the tests were overspecified.
4. **Run the full test suite after every refactor** — green before, green after.

---

## What to Test First

### Priority 1: Happy Path (primary behavior)

```cpp
TEST(RateLimiter, allows_requests_under_limit) { ... }
```

### Priority 2: Edge Cases (boundary values)

```cpp
TEST(RateLimiter, allows_zero_limit_as_always_blocked) { ... }
TEST(RateLimiter, handles_negative_limit) { ... }  // invalid input
```

### Priority 3: Error Paths

```cpp
TEST(Datacollector, append_returns_error_when_full) { ... }
TEST(RespFallback, returns_invalid_when_nullptr) { ... }
```

### Priority 4: Negative Tests (the "what shouldn't happen")

```cpp
TEST(FeatureFlags, is_active_does_not_crash_on_nullptr) { ... }
TEST(RateLimiter, does_not_allow_over_limit_regardless_of_speed) { ... }
```

---

## Test Coverage in TDD

TDD naturally drives coverage high because:
- Every line of production code was written to satisfy a test
- You can't add code without a failing test first

However, TDD alone doesn't guarantee 80% coverage. Run `lcov` after the full suite to identify untested branches:

```bash
cmake --build build -j$(nproc)
./test_policy
lcov --capture --directory build --output coverage.info \
  --exclude '*/test_*' --exclude '*/stubs/*' --exclude '*/build/*'
lcov --list coverage.info  # inspect
```

Add missing tests for any uncovered lines before opening a PR.

---

## When TDD Is Not Worth It

- **Trivial accessors** — `getter()` / `setter()` with no logic
- **Generated code** — auto-generated `serde`, `protobuf` bindings
- **One-off scripts** — not part of the production codebase
- **Quick prototypes** — exploratory code that will be thrown away

For these, write tests **after** if the code becomes permanent.

---

## TDD and the 80% Coverage Gate

TDD gets you to ~60-70% coverage naturally. The last 10-20% requires disciplined addition of:

1. **Branch coverage** — every `if/else` and `switch` branch
2. **Error paths** — every function that can return an error code
3. **Negative tests** — every `if (ptr == nullptr)` path

Use `lcov --list coverage.info | grep -E "BRAN|BR" ` to find uncovered branches.

---

## Summary: TDD Checklist

Before each commit:
- [ ] Every new public method has at least one test
- [ ] Tests follow AAA structure
- [ ] Test names describe behavior (Subject_Behavior_Expected)
- [ ] Tests pass on first run (green)
- [ ] No test is skipped (`DISABLED_`) unless there's a tracked issue
- [ ] 80% line coverage gate passes (`lcov`)
- [ ] No new `// TODO` or `// FIXME` in test code