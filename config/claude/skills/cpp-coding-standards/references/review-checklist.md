# C++ Code Review Checklist

Use this checklist when reviewing C++ pull requests or before committing.

## Memory Safety

- [ ] No raw `new` or `delete` — use `std::unique_ptr` / `std::make_unique`
- [ ] No owning raw pointers as class members (prefer `std::unique_ptr`)
- [ ] Shared ownership genuinely needed? Consider if `unique_ptr` suffices
- [ ] `shared_ptr` cycles broken with `weak_ptr`?
- [ ] Virtual destructor declared on any polymorphic base class
- [ ] All special member functions (Rule of Five) declared if needed
- [ ] No use-after-free: references/pointers outlive the data they refer to
- [ ] Arrays allocated with `new Type[n]` are `delete[]`d (or better, use `vector`)

## RAII and Resource Management

- [ ] File handles, mutexes, sockets use RAII wrappers (destructor cleans up)
- [ ] `std::lock_guard` / `std::scoped_lock` used for mutex locking — not raw `.lock()/.unlock()`
- [ ] Every `std::thread` has `.join()` or `.detach()` called before destruction
- [ ] Prefer `std::jthread` (C++20) for automatic stop and join

## Const Correctness

- [ ] Member functions that don't modify state are marked `const`
- [ ] Non-modifying parameters passed by `const&` (or by value if cheap-to-copy)
- [ ] `const` variables used where data doesn't change after init
- [ ] `const_iterator` used when iteration doesn't modify

## Modern C++ Usage

- [ ] Uses C++17/20 features where appropriate (structured bindings, `if constexpr`, `std::optional`, `string_view`)
- [ ] No C-style casts — uses `static_cast`, `reinterpret_cast`, `const_cast`
- [ ] `[[nodiscard]]` on functions returning values that must not be ignored
- [ ] `override` used on all virtual method overrides
- [ ] `noexcept` used correctly (only on functions that truly cannot throw)
- [ ] `std::make_unique` / `std::make_shared` used instead of direct `new`

## Headers and Includes

- [ ] No `using namespace std;` in header files
- [ ] No unused `#include` directives
- [ ] Include order: related header first, then standard library, then external libs
- [ ] Header is self-contained (includes everything it uses)

## Containers and Types

- [ ] `std::vector` preferred over raw arrays for dynamic sequences
- [ ] `std::vector::reserve()` called when size is known ahead of time
- [ ] `std::array` used for fixed-size compile-time-known arrays
- [ ] `std::string_view` used for read-only string params (no ownership)
- [ ] `std::optional` used instead of sentinel values (e.g., `-1`, `nullptr`) for optional values
- [ ] No `std::endl` in hot paths (flushes the stream)

## Error Handling

- [ ] Expected failures (not found, invalid input) handled without exceptions
- [ ] Exceptions used only for truly exceptional/unrecoverable conditions
- [ ] No exception thrown from destructors (use `noexcept` and `std::terminate` instead if needed)
- [ ] Exception safety level appropriate for the function (at minimum: no resource leaks)
- [ ] `std::expected<T, E>` (C++23) or error codes used in library/API code

## Concurrency

- [ ] Shared mutable state protected by `std::mutex` / `std::lock_guard`
- [ ] No data races on shared variables
- [ ] `std::atomic` used for simple shared counters and flags
- [ ] Thread lifecycle managed correctly (`join()`/`detach()` or `jthread`)
- [ ] No passing of references to locals into detached threads

## Performance Considerations

- [ ] No unnecessary copies (pass by `const&`, use `std::move`, prefer move over copy)
- [ ] No hidden allocations in hot paths (e.g., `s + "text"` inside a loop)
- [ ] Vector `reserve()` before known-size loops
- [ ] Emplacement used when inserting into containers: `vec.emplace_back(args...)` over `vec.push_back(Type(args...))`

## Initialization

- [ ] All variables initialized before use
- [ ] Member variables initialized in initializer list or with default member initializers
- [ ] No use of default-initialized built-in types without assignment

## Code Quality

- [ ] No `goto` statements
- [ ] No macros for anything that can be a `constexpr`, `inline`, or template
- [ ] Template code in headers uses explicit `typename T` or `class T`
- [ ] No hardcoded magic numbers — use named constants or `constexpr`
- [ ] `auto` used appropriately (not hiding intent)

## Testing

- [ ] New code has corresponding unit tests
- [ ] Edge cases covered: empty containers, zero/negative values, boundary conditions
- [ ] No commented-out test code committed
