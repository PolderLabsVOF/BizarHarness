# Coverage for C++ Tests

## Overview

Coverage measures which lines of production code are executed by your tests. The 80% line coverage gate means at least 80% of non-excluded lines must be covered before merging. This reference covers measurement tools, interpretation, exclusion patterns, and enforcement.

---

## Tools

| Tool | Description | Notes |
|------|-------------|-------|
| **gcov** | GCC's coverage tool — comes with `gcc` | Works with any CMake project compiled with `-fprofile-arcs -ftest-coverage` |
| **lcov** | Front-end for gcov — generates HTML/JSON reports | `apt install lcov` |
| **gcovr** | Alternative — generates Cobertura XML for CI | `pip install gcovr` |

---

## Setup

### CMake Integration

```cmake
# test/host/CMakeLists.txt
option(COVERAGE "Enable coverage reporting" OFF)

if(COVERAGE)
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fprofile-arcs -ftest-coverage")
  set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -fprofile-arcs -ftest-coverage")
endif()

# link gtest normally
target_link_libraries(test_policy PRIVATE gtest gmock pthread)

# on Linux, link gcov explicitly
if(COVERAGE)
  target_link_libraries(test_policy PRIVATE gcov)
endif()
```

### Build and Capture

```bash
cd test/host && mkdir -p build && cd build
cmake .. -DCOVERAGE=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build . -j$(nproc)
./test_policy          # run tests — gcov writes .gcda/.gcno files
lcov --capture --directory . --output coverage.info \
  --exclude '*/test_*' \
  --exclude '*/stubs/*' \
  --exclude '*/build/*' \
  --exclude '*/googletest/*' \
  --exclude '*/.cache/*'
```

### View HTML Report

```bash
genhtml coverage.info --output-directory coverage_html
# Open coverage_html/index.html in browser
```

### Check Only Source Files (not test code)

```bash
# Filter to only main/ and components/ sources
lcov --extract coverage.info '*/main/*' --output filtered.info
lcov --list filtered.info
```

---

## What 80% Coverage Means

| Metric | Description | Target |
|--------|-------------|--------|
| **Line coverage** | Percentage of source lines executed | ≥ 80% |
| **Branch coverage** | Percentage of branches (if/else, switch) taken | Not explicitly gated, but inspect for untested branches |
| **Function coverage** | Percentage of functions called | Should be 100% for public APIs |

**80% line coverage does NOT mean:**
- Every function is tested
- Every branch is exercised
- The code is bug-free

It means 80% of **executable lines** were executed at least once. You still need:
- Branch coverage for `if/else` and `switch`
- Negative tests for error paths
- Boundary value tests

---

## Files to Exclude

Exclude these from coverage reports:

```
*/test_*           — test source files (test_*.cpp)
*/stubs/*          — test stubs (freertos_stubs.cpp, etc.)
*/build/*          — CMake build directory
*/mocks/*          — mock implementations
*/googletest/*     — GoogleTest source
*/.cache/*         — any cache directories
*/generated/*      — auto-generated code
*/third_party/*    — third-party dependencies
```

### lcov Exclude Pattern

```bash
lcov --capture --directory . \
  --output coverage.info \
  --exclude '*/test_*' \
  --exclude '*/stubs/*' \
  --exclude '*/build/*' \
  --exclude '*/googletest/*' \
  --exclude '*/third_party/*'
```

---

## CI Integration: Enforcing the 80% Gate

### GitHub Actions

```yaml
- name: Run host tests with coverage
  run: |
    cd test/host
    mkdir -p build && cd build
    cmake .. -DCOVERAGE=ON -DCMAKE_BUILD_TYPE=Debug
    cmake --build . -j$(nproc)
    ./test_policy || { cat test_output.log; exit 1; }

- name: Capture coverage
  run: |
    lcov --capture --directory test/host/build \
      --output coverage.info \
      --exclude '*/test_*' --exclude '*/stubs/*' --exclude '*/build/*' \
      --exclude '*/googletest/*'
    lcov --extract coverage.info '*/main/*' --output src_coverage.info
    lcov --list src_coverage.info

- name: Check 80% gate
  run: |
    total=$(lcov --list src_coverage.info | grep -E "lines\.\.\." | awk '{print $2}' | tr -d '%')
    echo "Coverage: $total%"
    if (( $(echo "$total < 80" | bc -l) )); then
      echo "ERROR: Coverage $total% < 80% gate"
      lcov --list src_coverage.info
      exit 1
    fi
```

### GitLab CI

```yaml
coverage-test:
  script:
    - mkdir -p build && cd build
    - cmake .. -DCOVERAGE=ON -DCMAKE_BUILD_TYPE=Debug
    - cmake --build . -j$(nproc)
    - ./test_policy
    - lcov --capture --directory . --output coverage.info \
        --exclude '*/test_*' --exclude '*/stubs/*' --exclude '*/build/*'
    - lcov --extract coverage.info '*/main/*' --output src_coverage.info
    - lcov --list src_coverage.info
  coverage: /lines\.\.\.: (\d+\.\d+)%/
```

---

## Interpreting Coverage Reports

### What "covered" means

A line is covered if **any test** executes it at least once.

```cpp
bool is_valid(int x) {
  if (x > 0)     // line 2 — covered if x=1 tested
    return true; // line 3 — covered if x=1 tested
  return false;  // line 5 — covered if x=-1 tested
}
```

### What "not covered" means

```bash
$ lcov --list filtered.info
Overall coverage rate:
  lines......: 73.5%  (217 / 295)
  branches...: 58.3%  (42 / 72)
```

- **lines 73.5%** — below 80%, gate fails
- **branches 58.3%** — some `if` branches untested; add negative tests

### Finding Uncovered Lines

```bash
genhtml coverage.info --output-directory html --show-details
# Open html/*/*.cpp.gcov.html — uncovered lines are highlighted red
```

Or use `gcovr`:

```bash
gcovr --filter main/ --xml-pretty > coverage.xml
# coverage.xml can be imported into GitHub PR checks
```

---

## Coverage Gaps: How to Find and Fix

### 1. Uncovered Functions

```bash
lcov --list filtered.info | grep -E "function.*0\.0"
```

**Fix:** Write a test that calls the function.

### 2. Uncovered Branches

```bash
lcov --list filtered.info | grep -E "branch.*not executed"
```

**Fix:** Add a test for the untaken branch. Example: if `if (ptr == nullptr)` is untested, add:

```cpp
TEST(Datacollector, append_handles_nullptr) {
  EXPECT_EQ(datacollector_append(nullptr, 42.0), -1);
}
```

### 3. Uncovered Error Paths

```cpp
// production code
int datacollector_append(Datacollector* dc, double value) {
  if (dc == nullptr) return -1;   // ← often untested
  if (dc->count >= MAX) return -1;  // ← sometimes untested
  dc->readings[dc->count++] = value;
  return 0;
}
```

**Fix:** Add tests for both error conditions:

```cpp
TEST(Datacollector, append_returns_error_for_nullptr) {
  EXPECT_EQ(datacollector_append(nullptr, 42.0), -1);
}

TEST(Datacollector, append_returns_error_when_full) {
  Datacollector dc;
  for (int i = 0; i < MAX; ++i) datacollector_append(&dc, 0.0);
  EXPECT_EQ(datacollector_append(&dc, 99.0), -1);
}
```

---

## Coverage Exclusions: When and How

### Exclude Generated Code

```cmake
# In CMakeLists.txt — mark generated sources
set_source_files_properties(
    ${CMAKE_CURRENT_SOURCE_DIR}/generated/serde_autogen.cpp
    PROPERTIES HEADER_FILE_ONLY ON
)
```

Or via `lcov --remove`:

```bash
lcov --remove coverage.info '*/generated/*' --output cleaned.info
```

### Exclude Test Stubs

```bash
lcov --remove coverage.info '*/stubs/*' --output cleaned.info
```

### Exclude Platform-Specific Code

```cpp
// coverage: ignore start
#ifdef ESP_PLATFORM
    // ESP-IDF only
#endif
// coverage: ignore end
```

Note: GCC supports `#pragma GCC coverage_options` but it's fragile. Prefer exclusion at the `lcov` level.

---

## Common Pitfalls

### 1. 100% Coverage ≠ Correct Code

```cpp
// Tests achieve 100% coverage but don't test correctness
TEST(Math, add_returns_something) {
  EXPECT_NE(add(2, 2), 0);  // passes for add(2,2)=99 — wrong!
}
```

**Fix:** Test for **exact expected values**, not just non-zero.

### 2. Over-Excluding Files

Excluding `*_test.cpp` is fine. Excluding entire modules because they're "hard to test" is a smell — those modules need redesign.

### 3. Coverage as a Goal

Writing tests to increase coverage % (rather than to verify behavior) leads to:
- Meaningless tests (e.g., `EXPECT_TRUE(true)`)
- Skipped edge cases
- False confidence

Coverage is a **minimum bar**, not a target. Aim for **behavioral correctness** first.

---

## Quick Reference: Coverage Commands

```bash
# Full pipeline
cd test/host && mkdir -p build && cd build
cmake .. -DCOVERAGE=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build . -j$(nproc)
./test_policy || exit 1

# Capture (all files)
lcov --capture --directory . --output coverage.info \
  --exclude '*/test_*' --exclude '*/stubs/*' --exclude '*/build/*'

# Filter to only main/
lcov --extract coverage.info '*/main/*' --output src_coverage.info

# List summary
lcov --list src_coverage.info

# HTML output
genhtml src_coverage.info --output-directory coverage_html

# Enforce 80% gate
total=$(lcov --list src_coverage.info | grep "lines" | awk '{print $2}' | tr -d '%')
python3 -c "exit(0 if float('$total') >= 80.0 else 1)" || \
  { echo "FAIL: coverage $total% < 80%"; lcov --list src_coverage.info; exit 1; }
```

---

## Summary

- **Measure:** Use `gcov` + `lcov` (or `gcovr`) to capture and report coverage
- **Exclude:** Test files, stubs, mocks, generated code, third-party deps
- **Gate:** 80% line coverage on `main/` and `components/` (non-ESP-IDF)
- **Inspect:** Check branch coverage for untested `if/else` paths
- **Fix:** Add tests for uncovered lines and branches, not just to raise %
- **CI:** Enforce the gate in CI before merging