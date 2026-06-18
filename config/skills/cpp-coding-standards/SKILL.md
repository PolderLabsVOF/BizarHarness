---
name: cpp-coding-standards
description: C++ coding standards skill for writing, reviewing, and refactoring modern C++17/20 code. Trigger this skill when editing or reviewing C++ source files, fixing C++ build errors, or applying modern C++ idioms (RAII, smart pointers, structured bindings, concepts, etc.).
---

# C++ Coding Standards

## Overview

This skill enforces modern C++17/20 best practices: memory safety via RAII and smart pointers, const correctness, value semantics, and structured concurrency. Load this skill whenever you write new C++ code, review existing C++ code, or debug C++ build errors.

**For deep dives see:**
- `references/memory-safety.md` — RAII, smart pointers, Rule of Five/Zero
- `references/modern-idioms.md` — C++17/20 features with examples
- `references/error-handling.md` — exceptions, error codes, `std::expected`
- `references/concurrency.md` — mutex, lock_guard, atomic, thread
- `references/review-checklist.md` — fast pre-commit checklist

---

## Quick-Start Checklist

**Always do these in C++:**

- [ ] **RAII everywhere** — every resource (memory, file handle, mutex) must have an owner object with a destructor
- [ ] **No raw `new`/`delete`** — use `std::unique_ptr` and `std::make_unique`
- [ ] **Prefer `std::vector`** over raw arrays; call `.reserve()` when size is known
- [ ] **No C-style casts** — use `static_cast`, `reinterpret_cast`, `const_cast`
- [ ] **No `using namespace std;`** in headers
- [ ] **Mark functions `noexcept`** when they cannot throw
- [ ] **Use `[[nodiscard]]`** on functions returning values callers must not ignore
- [ ] **Pass aggregates and non-trivial types by `const&`**, primitives by value
- [ ] **Const-correct from the start** — `const` everywhere data does not mutate
- [ ] **Use `override`/`final`** on virtual methods; avoid virtual when not needed
- [ ] **No virtual destructor without a polymorphic base** — a `virtual ~T() = default;` with no base class is a residual from an abandoned inheritance design; either remove the `virtual` or introduce a real base
- [ ] **No unused standard-library headers** — only `#include` what you use; embedded builds pay for every transitive include
- [ ] **No Variable Length Arrays (VLAs)** — `char buf[n];` is a GCC extension, not standard C++; use `std::vector<char>` or `std::unique_ptr<char[]>`
- [ ] **Lock mutexes with `std::lock_guard`** or `std::scoped_lock`
- [ ] **Initialize all variables** — prefer `= {}` initialization
- [ ] **Include what you use** — every `#include` must be needed
- [ ] **Apply `std::make_unique`/`std::make_shared`** over direct `new`

---

## Memory Safety

### RAII (Resource Acquisition Is Initialization)

Every resource must be owned by a object whose destructor releases it. Never call `delete` explicitly.

```cpp
// GOOD
void process_file(const std::string& path) {
    std::ifstream in(path);          // RAII: destructor closes file
    // ... use in ...
}                                   // file automatically closed

// BAD — error-prone, leak-prone
void process_file_bad(const std::string& path) {
    std::ifstream* in = new std::ifstream(path);
    // ... use *in ...
    delete in;                       // easy to forget, early return bugs
}
```

### Smart Pointers

| Pointer Type | Ownership | Use When |
|---|---|---|
| `std::unique_ptr<T>` | exclusive | Single owner, no sharing needed |
| `std::shared_ptr<T>` | shared | Shared ownership (use sparingly) |
| `std::weak_ptr<T>` | non-owning | Breaking cycles of `shared_ptr` |

```cpp
// unique_ptr — default choice
auto ptr = std::make_unique<MyClass>(args);

// shared_ptr — only when ownership must be shared
auto shared = std::make_shared<MyClass>(args);

// weak_ptr — to observe a shared_ptr without owning
std::weak_ptr<MyClass> observer = shared;
if (auto locked = observer.lock()) {
    // use locked
}

// BAD: raw ownership transfer
MyClass* raw = new MyClass(args);
// ...
delete raw;
```

### Rule of Five / Rule of Zero

If you define any of: destructor, copy constructor, copy assignment, move constructor, move assignment — you likely need all five (Rule of Five). Otherwise, rely on the compiler-generated defaults (Rule of Zero).

```cpp
// Rule of Zero — prefer this
class Resource {
    std::vector<int> data_;
public:
    Resource() = default;
    Resource(std::vector<int> d) : data_(std::move(d)) {}
};

// Rule of Five — when you manage a raw resource
class RawOwner {
    int* raw_;
public:
    explicit RawOwner(size_t n) : raw_(new int[n]) {}
    ~RawOwner() { delete[] raw_; }

    // Copy
    RawOwner(const RawOwner& o) : raw_(new int[1]) { *raw_ = *o.raw_; }
    RawOwner& operator=(const RawOwner& o) {
        if (this != &o) { delete[] raw_; raw_ = new int[1]; *raw_ = *o.raw_; }
        return *this;
    }
    // Move
    RawOwner(RawOwner&& o) noexcept : raw_(std::exchange(o.raw_, nullptr)) {}
    RawOwner& operator=(RawOwner&& o) noexcept {
        if (this != &o) { delete[] raw_; raw_ = std::exchange(o.raw_, nullptr); }
        return *this;
    }
};
```

---

## Const Correctness

Mark every function and parameter `const` when the operation does not modify observable state.

```cpp
class Calculator {
    int state_ = 0;
public:
    // Const member function — does not modify state_
    int result() const { return state_; }

    // Non-const — modifies state_
    void add(int v) { state_ += v; }
};

// Const reference — callee cannot modify the argument
void print(const std::string& s) { std::cout << s; }

// BAD: missing const
int result() { return state_; }  // should be int result() const
```

Prefer `const` on member functions, on references and pointers to indicate non-modification, and on variables that should not change after initialization.

---

## Modern C++17/20 Idioms

### Structured Bindings

```cpp
// Unpack tuples/pairs/structs
auto [key, value] = std::pair{1, std::string("hello")};
auto [a, b, c] = std::array{1, 2, 3};

// Use with maps
for (const auto& [k, v] : my_map) { /* ... */ }
```

### `if constexpr`

Compile-time branch elimination — avoids instantiation of untaken branches.

```cpp
template <typename T>
auto process(const T& val) {
    if constexpr (std::is_integral_v<T>) {
        return val * 2;
    } else if constexpr (std::is_floating_point_v<T>) {
        return val * 2.0;
    } else {
        static_assert(sizeof(T) == 0, "Unsupported type");
        return T{};
    }
}
```

### `std::optional`

Represent a value that may or may not be present.

```cpp
std::optional<int> find(const std::vector<int>& v, int target) {
    for (auto it = v.begin(); it != v.end(); ++it) {
        if (*it == target) return {static_cast<int>(std::distance(v.begin(), it))};
    }
    return std::nullopt;
}

// Usage
if (auto idx = find(vec, 42)) {
    std::cout << "Found at " << *idx;
} else {
    std::cout << "Not found";
}
```

### `std::string_view`

Non-owning string slice — use for read-only string operations without copying.

```cpp
// GOOD: no allocation, no copy
void print_version(std::string_view prefix) {
    std::cout << prefix << "1.2.3\n";
}

// BAD: forces allocation and copy
void print_version(const std::string& prefix) {
    std::cout << prefix + "1.2.3\n";  // creates temporary string
}

// Prefer string_view for function parameters that don't need ownership
```

### Ranges (C++20)

```cpp
#include <ranges>

// Pipeline style
auto evens = std::views::filter(v, [](int x) { return x % 2 == 0; });
auto doubled = evens | std::views::transform([](int x) { return x * 2; });

// Projections with std::sort
std::sort(vec.begin(), vec.end(), {}, &Node::priority);  // sort by .priority
```

### Concepts (C++20)

Explicit constraints on template parameters — replaces SFINAE with readable syntax.

```cpp
template <typename T>
concept Numeric = std::integral<T> || std::floating_point<T>;

template <Numeric T>
T add(T a, T b) { return a + b; }

// Constrain containers
template <std::ranges::range R>
void print_all(const R& r) {
    for (const auto& elem : r) std::cout << elem << '\n';
}
```

---

## Error Handling

### Decision Guide

| Scenario | Recommended Approach |
|---|---|
| Constructor failure that invalidates object | Exception |
| Expected failure (not found, invalid input) | `std::optional` or error code |
| Library-level expected-failure cases | `std::expected<T, E>` (C++23; use `tl::expected` in C++17/20) |
| Performance-critical hot paths | Error codes or `std::error_code` |
| No way to recover | Exception / `std::terminate` |

### `std::expected` (C++23)

```cpp
// C++23
std::expected<Config, std::error_code> load_config(const std::string& path) {
    if (path.empty()) return std::unexpected(std::errc::invalid_argument);
    return Config{};
}

// Usage
auto cfg = load_config("app.cfg");
if (cfg) {
    use(cfg.value());
} else {
    handle_error(cfg.error());
}
```

### Exception Safety Levels

- **Nothrow** (`noexcept`): Operations that never throw — move constructors of `noexcept` types, swap, etc.
- **Strong**: Failed operation leaves program state unchanged (preferred for most code).
- **Basic**: Failed operation leaves object in a valid (but unspecified) state.
- **No guarantee**: Leaking, undefined behavior on failure — avoid.

```cpp
// Use noexcept sparingly — mark only functions that truly cannot fail
class Vector {
public:
    void clear() noexcept { size_ = 0; }  // cannot fail
    // ...
};
```

---

## Casting

**Never use C-style casts.** They are too permissive (can cast away `const`, `reinterpret` pointers unsafely).

```cpp
// GOOD
double d = 3.14;
int i = static_cast<int>(d);          // explicit numeric conversion

Base* base = new Derived;
Derived* derived = static_cast<Derived*>(base);  // downcast (validate with dynamic_cast)

const Object* co = /* ... */;
Object* mutable_obj = const_cast<Object*>(co);   // remove const (use with care)

// BAD — all of these are dangerous
int* p = (int*)some_void_ptr;          // C-style: no type checking
int j = (int)d;                        // C-style: too easy to miss
```

Use `dynamic_cast` for safe downcasts when runtime type checking is needed:
```cpp
Base* base = /* ... */;
Derived* derived = dynamic_cast<Derived*>(base);
if (derived) { /* use derived safely */ }
```

---

## Headers

### Include What You Use

Every `#include` must be actively used. Unused includes cause slower compilation and hidden dependencies.

```cpp
// In foo.cpp — include only what's needed
#include <vector>      // uses std::vector
#include <string>      // uses std::string
#include "foo.h"        // own header
```

### No `using namespace std;` in Headers

Putting `using namespace std;` in a header pollutes the namespace for every translation unit that includes it.

```cpp
// BAD — header.h
using namespace std;  // POLLUTES NAMESPACE
void helper(vector<int> v);  // ambiguous: ours or std?

// GOOD — header.h
#include <vector>
void helper(const std::vector<int>& v);  // explicit
```

Prefer to also avoid `using` directives in `.cpp` files in namespace scope; it is acceptable in local scope.

---

## Pass by Reference / Const-Ref

| Type | Recommended Passing |
|---|---|
| Built-in (`int`, `double`, pointer) | By value |
| Trivial struct (POD) | By value |
| Non-trivial class/struct | By `const&` |
| `std::string` | By `const&` |
| `std::vector` (out parameter) | By `&` (non-const ref) or return value |
| Callable (lambda, function) | By value or `auto&&` |

```cpp
// GOOD
void process(const std::string& input, std::vector<int>& output);
int primitive(int x);

// BAD
void process(std::string input);  // unnecessary copy
void process(std::string& input);  // invisible caller requirement + no rvalue support
```

---

## Containers

### `std::vector` — Default Choice

`std::vector` is the right default for a sequence. It has contiguous storage, good cache locality, and a complete standard library.

```cpp
// Reserve when size is known — avoids reallocations
std::vector<int> vec;
vec.reserve(1000);  // allocates space for 1000, size still 0
for (int i = 0; i < 1000; ++i) vec.push_back(i);

// Initialize with size
std::vector<int> sized(100, 0);  // 100 zeros

// Direct initialization
std::vector<int> init = {1, 2, 3, 4, 5};
```

### `std::array` — Fixed-Size

Use `std::array<T, N>` for fixed-size, compile-time-sized arrays. Unlike raw arrays, it supports iterators and works with the standard library.

```cpp
// GOOD
std::array<int, 5> fixed = {1, 2, 3, 4, 5};
for (int x : fixed) { /* ... */ }

// BAD
int raw[5] = {1, 2, 3, 4, 5};  // raw array, decays to pointer
```

### `std::map` / `std::unordered_map`

Use `std::map` when you need ordered keys or stable iterators. Use `std::unordered_map` when you need hash-table performance and don't need ordering.

```cpp
// Ordered — keys are sorted, O(log n) lookups
std::map<std::string, int> ordered;

// Unordered — O(1) average lookups, no ordering
std::unordered_map<std::string, int> hashmap;
hashmap.reserve(1000);  // reserve buckets for performance
```

---

## Attributes

### `[[nodiscard]]`

Mark functions where ignoring the return value is a bug.

```cpp
[[nodiscard]] int compute();
[[nodiscard]] std::expected<int, E> risky_operation();

// BAD — compiler may warn on caller ignoring nodiscard result
compute();  // warning if compute() is [[nodiscard]]
```

### `noexcept`

Mark functions that cannot throw. This enables optimizations (move constructors become `noexcept` automatically when appropriate) and documents API contracts.

```cpp
class MoveOnly {
    int* data_;
public:
    MoveOnly() noexcept : data_(nullptr) {}
    MoveOnly(MoveOnly&& o) noexcept : data_(std::exchange(o.data_, nullptr)) {}
    MoveOnly& operator=(MoveOnly&&) noexcept { /* ... */ return *this; }
    ~MoveOnly() { delete[] data_; }
};
```

### `override` / `final`

Use `override` on virtual methods that override a base class method. Use `final` on methods or classes that should not be further overridden.

```cpp
struct Base {
    virtual void update() {}
    virtual ~Base() = default;
};

struct Derived : Base {
    void update() override {}      // explicitly overrides Base::update
    void foo() final {}            // Derived::foo cannot be overridden
};

struct FinalClass final {
    // cannot be inherited
};
```

---

## Concurrency

### Mutex and Lock Guards

**Always** lock mutexes through `std::lock_guard` or `std::scoped_lock` (C++17). Never call `.lock()` and `.unlock()` directly — if an exception occurs between them, the mutex is permanently locked.

```cpp
#include <mutex>

std::mutex mtx;
int counter = 0;

// GOOD
void increment() {
    std::lock_guard<std::mutex> lock(mtx);  // RAII: unlocks on scope exit
    ++counter;
}

// BAD — exception-safe?
void increment_bad() {
    mtx.lock();
    ++counter;
    mtx.unlock();  // never called if ++counter throws
}
```

### `std::scoped_lock` (C++17) — Multiple Mutexes

```cpp
std::mutex m1, m2;
// GOOD: locks both without deadlock
std::scoped_lock lock(m1, m2);
```

### Atomics

Use `std::atomic` for simple shared counters, flags, and lock-free data structures. Prefer `std::atomic<T>` with trivial types.

```cpp
#include <atomic>

std::atomic<int> counter{0};

void increment() {
    counter.fetch_add(1, std::memory_order_relaxed);
}

// Simple bool flag
std::atomic<bool> done{false};
```

### `std::thread` Lifecycle

- Always `.join()` or `.detach()` — a `std::thread` that is neither joined nor detached causes `std::terminate`.
- Prefer `std::jthread` (C++20) which auto-joins on destruction.

```cpp
// GOOD — explicit join
std::thread t([&]() { do_work(); });
// ... do other work ...
if (t.joinable()) t.join();

// BETTER (C++20) — jthread auto-joins
std::jthread jt([&](std::stop_token st) {
    while (!st.stop_requested()) { do_work(); }
});  // automatically joins here
```

### Avoid Data Races

A data race is undefined behavior. Every shared variable must be:
1. Protected by a mutex (`std::lock_guard`), OR
2. Declared `std::atomic`, OR
3. Never modified concurrently (copy-on-write design)

---

## Common Anti-Patterns and Fixes

| Anti-Pattern | Fix |
|---|---|
| Raw `new`/`delete` | `std::unique_ptr` / `std::make_unique` |
| `using namespace std;` in header | Qualify names explicitly (`std::vector`) |
| Passing non-trivial types by value | Pass by `const&` |
| Ignoring `[[nodiscard]]` result | Fix the call site |
| C-style casts | `static_cast`, `reinterpret_cast`, `const_cast` |
| Locking a raw mutex without guard | `std::lock_guard` |
| Unused `#include`s | Remove or verify they're needed |
| Non-const member functions that don't modify state | Add `const` |
| `shared_ptr` for single ownership | `unique_ptr` |
| Virtual destructor missing | Add `virtual ~Base() = default;` |
| Uninitialized members | Use `= default` or member-initializer list |

---

## Do / Don't

### Do

```cpp
// DO: Use make_unique for single ownership
auto ptr = std::make_unique<Config>(filename);

// DO: Pass non-trivial types by const reference
void process(const std::vector<int>& data);

// DO: Use structured bindings
auto [id, name] = get_record();

// DO: Use [[nodiscard]] on important return values
[[nodiscard]] std::expected<int, Error> parse_number(std::string_view s);

// DO: Use override on virtual overrides
class Impl : public Base {
    void run() override { /* ... */ }
};

// DO: Reserve vector capacity when size is known
std::vector<double> vals;
vals.reserve(1000);
```

### Don't

```cpp
// DON'T: Use raw owning pointers
Config* cfg = new Config(filename);
delete cfg;

// DON'T: Use C-style casts
double d = 3.14;
int i = (int)d;  // static_cast<int>(d) is explicit and searchable

// DON'T: Put using namespace std; in a header
// #include <vector>
// using namespace std;  // NEVER in a header

// DON'T: Pass large objects by value (causes copy)
void print_big(std::string s);  // copies! use const std::string&

// DON'T: Lock a mutex without lock_guard
mtx.lock();
// ... code that might throw ...
mtx.unlock();  // leaked if exception thrown above

// DON'T: Use shared_ptr for single, non-shared ownership
auto single = std::make_shared<Widget>();  // use unique_ptr instead
```
