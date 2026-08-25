# Framework Compare: GoogleTest vs Catch2 vs doctest

## Overview

All three frameworks are C++17-compatible, header-only (or single-header), and support fixtures, parametrics, and mocking. The choice is primarily ergonomic and project-specific.

---

## GoogleTest

**Installation:** `apt install libgtest-dev` or `FetchContent` CMake include.

**Strengths:**
- `TEST_F` (fixture), `TEST_P` (parametric), death tests, `ScopedFakeTimer`
- Widest ecosystem: `gmock` for mocking, `gtest-param-test` for parameterized
- XML/JSON/HTML output for CI integration
- Well-understood by embedded/firmware teams

**Sample:**

```cpp
#include <gtest/gtest.h>

class StackTest : public ::testing::Test {
protected:
  void SetUp() override { stack_.clear(); }
  std::vector<int> stack_;
};

TEST_F(StackTest, push_increases_size) {
  stack_.push_back(1);
  EXPECT_EQ(stack_.size(), 1u);
}

TEST_F(StackTest, pop_returns_last_element) {
  stack_.push_back(1);
  stack_.push_back(2);
  EXPECT_EQ(stack_.back(), 2);
  stack_.pop_back();
  EXPECT_EQ(stack_.size(), 1u);
}
```

**Parametric example:**

```cpp
class StringEncodeTest : public ::testing::TestWithParam<const char*> {};

TEST_P(StringEncodeTest, encodes_known_formats) {
  const char* fmt = GetParam();
  EXPECT_NO_THROW(encode(fmt));
}

INSTANTIATE_TEST_SUITE_P(KnownFormats, StringEncodeTest,
  ::testing::Values("utf-8", "iso-8859-1", "windows-1252"));
```

**Best for:** Large codebases, embedded firmware, projects needing `gmock`, parametric tests, or death tests.

---

## Catch2

**Installation:** Single header: `curl -L https://github.com/catchorg/Catch2/releases/download/v3.5.4/catch2_with_main.hpp -o include/catch2_with_main.hpp`

**Strengths:**
- BDD-style `SCENARIO` / `GIVEN` / `WHEN` / `THEN` DSL available
- Minimal boilerplate — no `TEST_F` needed for simple cases
- Rich assertion syntax: `REQUIRE`, `CHECK`, `REQUIRE_THAT`, `CHECK_THAT`

**Sample:**

```cpp
#define CATCH_CONFIG_MAIN
#include <catch2/catch_test_macros.hpp>

unsigned int factorial(unsigned int n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

TEST_CASE("factorial computes correctly", "[factorial]") {
  CHECK(factorial(0) == 1);
  CHECK(factorial(1) == 1);
  CHECK(factorial(4) == 24);
  CHECK(factorial(5) == 120);
}
```

**BDD-style:**

```cpp
SCENARIO("stack behavior") {
  GIVEN("an empty stack") {
    std::vector<int> stack;
    WHEN("an element is pushed") {
      stack.push_back(42);
      THEN("size increases") { CHECK(stack.size() == 1); }
    }
  }
}
```

**Best for:** Quick-to-write tests, BDD-style readability, smaller utilities.

**Weakness:** Slower compile times than doctest; less ecosystem (no built-in mocking — pair with `trompeloeil` or manual fakes).

---

## doctest

**Installation:** Single header: `curl -L https://github.com/doctest/doctest/releases/download/v2.4.11/doctest.h -o include/doctest.h`

**Strengths:**
- Fastest compile time of the three
- Lightweight — minimal impact on build times
- `CHECK`/`REQUIRE` similar to Catch2
- Sub-test support via `SUBTEST`

**Sample:**

```cpp
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>

int add(int a, int b) { return a + b; }

TEST_CASE("addition works") {
  CHECK(add(2, 3) == 5);
  CHECK(add(-1, 1) == 0);
  REQUIRE(add(0, 0) == 0);  // REQUIRE aborts on failure
}
```

**Best for:** Compile-time-sensitive projects, small-to-medium codebases, projects that already use many headers.

**Weakness:** Smaller ecosystem; mocking requires manual fakes or `trompeloeil`.

---

## Side-by-Side Comparison

| Feature | GoogleTest | Catch2 | doctest |
|---------|-----------|--------|---------|
| Header-only | No (needs gtest lib) | Yes | Yes |
| Compile speed | Medium | Slow | Fast |
| `TEST_F` (fixtures) | Yes | Via `SECTION` | Via `SUBCASE` |
| `TEST_P` (parametric) | Yes | No | No |
| Death tests | Yes | No | No |
| Built-in mocking | gmock | No | No |
| BDD DSL | No | Yes | No |
| CI XML output | Yes | Yes | Yes |
| C++17 required | Yes | Yes | Yes |
| Ecosystem size | Large | Medium | Small |

---

## Recommendation for Embedded/Firmware Host Tests

Default to **GoogleTest** + **gmock**:
- `TEST_F` / `TEST_P` are well-suited to firmware policy modules
- `gmock` provides struct-level mocking via `MATCHER` / `ON_CALL`
- `EXPECT_DEATH` / `EXPECT_DEATH_IF_SUPPORTED` useful for error-injection tests
- Widely understood — existing firmware teams will recognize it

Use **Catch2** when you want BDD-style readability for payload parsing or protocol tests.

Use **doctest** when build time is a bottleneck and you only need simple `CHECK` assertions.

---

## Mixing Frameworks

It is possible to link multiple frameworks into the same binary, but avoid this — it causes confusion and doubled setup cost. Pick one framework per binary.

If you need both BDD-style and parametric tests, use GoogleTest's `TEST_F` with `DESCRIPTION` or use Catch2's `SECTION` mechanism instead of `TEST_P`.