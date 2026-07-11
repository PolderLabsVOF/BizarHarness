# Modern C++17/20 Idioms

This reference covers the most impactful modern C++ features with minimal examples.

## Structured Bindings

Unpack tuples, pairs, structs, and arrays into named variables.

```cpp
#include <tuple>
#include <map>

// Pair/tuple
auto [key, value] = std::pair{1, std::string("hello")};

// Array
auto [a, b, c] = std::array{1, 2, 3};

// Struct — works if all members are public
struct Point { double x, y, z; };
Point p{1.0, 2.0, 3.0};
auto [px, py, pz] = p;

// Map iteration
std::map<std::string, int> ages{{"Alice", 30}, {"Bob", 25}};
for (const auto& [name, age] : ages) {
    std::cout << name << ": " << age << '\n';
}

// Multiple return values
std::tuple<int, std::string, double> compute() { return {42, "answer", 3.14}; }
auto [code, label, score] = compute();
```

## `if constexpr`

Compile-time conditional code execution — the unselected branch is not instantiated.

```cpp
#include <type_traits>

template <typename T>
auto inspect(const T& val) {
    if constexpr (std::is_integral_v<T>) {
        return "integer";
    } else if constexpr (std::is_floating_point_v<T>) {
        return "floating-point";
    } else {
        return "other";
    }
}

// Works where SFINAE would require complex enable_if
template <typename T>
T doubled(T x) {
    if constexpr (std::is_integral_v<T>) {
        return x + x;  // valid only for integral T
    } else {
        return x * 2.0;  // valid only for floating-point T
    }
}
```

## `std::optional`

Represents a value that may or may not be present. Alternative to pointer-returning APIs.

```cpp
#include <optional>

// Return optional
std::optional<int> find_index(const std::vector<int>& v, int target) {
    for (auto it = v.begin(); it != v.end(); ++it) {
        if (*it == target)
            return {static_cast<int>(std::distance(v.begin(), it))};
    }
    return std::nullopt;
}

// Check and use
if (auto idx = find_index(vec, 42)) {
    std::cout << "Found at " << *idx << '\n';
} else {
    std::cout << "Not found\n";
}

// Transform an optional without unwrapping
std::optional<std::string> name = /* ... */;
auto greeting = name.transform([](const std::string& n) { return "Hello, " + n; });
```

## `std::string_view`

Non-owning view into a string. Use for read-only string operations without copying.

```cpp
#include <string_view>

// Function takes a view — no ownership, no allocation
bool ends_with(std::string_view s, std::string_view suffix) {
    return s.size() >= suffix.size() && s.substr(s.size() - suffix.size()) == suffix;
}

// Calling with different string types — no conversion/copy
std::string s = "filename.txt";
std::string_view sv = s;
ends_with(sv, ".txt");           // string_view
ends_with("literal", ".txt");    // const char* converts to string_view
ends_with(sv, std::string(".log"));  // string converts to string_view

// AVOID: storing string_view as a class member — it doesn't own the data
// (only safe if another owning string keeps the data alive)
```

## `std::variant` (C++17)

Type-safe union — an object that holds one of several specified types.

```cpp
#include <variant>

std::variant<int, std::string, double> v = 42;

// Check and access
if (std::holds_alternative<int>(v)) {
    int i = std::get<int>(v);
}

// Visitor pattern
std::visit([](const auto& val) {
    std::cout << val << '\n';
}, v);

// Overload helper (C++17 doesn't have std::visit overload; use this pattern)
template <class... Ts> struct overload : Ts... { using Ts::operator()...; };
template <class... Ts> overload(Ts...) -> overload<Ts...>;

std::visit(overload{
    [](int i) { std::cout << "int: " << i << '\n'; },
    [](const std::string& s) { std::cout << "string: " << s << '\n'; },
    [](double d) { std::cout << "double: " << d << '\n'; }
}, v);
```

## `std::any` (C++17)

Holds any single value of any type. Use when the set of possible types is open-ended.

```cpp
#include <any>

std::any a = 42;
a = std::string("hello");
a = 3.14;

if (a.type() == typeid(double)) {
    double d = std::any_cast<double>(a);
}

// Safer: check before cast
if (auto* pd = std::any_cast<double>(&a)) {
    std::cout << *pd << '\n';
}
```

## Ranges (C++20)

```cpp
#include <ranges>
#include <algorithm>

std::vector<int> v = {1, 2, 3, 4, 5, 6};

// Filter and transform lazily — no new vector allocation
auto evens = v | std::views::filter([](int x) { return x % 2 == 0; });
auto doubled = evens | std::views::transform([](int x) { return x * 2; });

for (int x : doubled) std::cout << x << ' ';  // 4 8 12

// Range-based sort (C++20 — simpler than iterators)
std::ranges::sort(v);

// Find
auto it = std::ranges::find(v, 3);

// All / any / none
bool has_negative = std::ranges::any_of(v, [](int x) { return x < 0; });

// Projections — sort by member without lambda boilerplate
struct Employee { std::string name; int level; };
std::vector<Employee> emps{{"Bob", 3}, {"Alice", 1}, {"Carol", 2}};
std::ranges::sort(emps, {}, &Employee::level);  // sort by .level
```

## Concepts (C++20)

Explicit, named constraints on template parameters. Replace SFINAE with readable syntax.

```cpp
#include <concepts>
#include <type_traits>

// Define a concept
template <typename T>
concept Numeric = std::integral<T> || std::floating_point<T>;

// Use in template parameters
template <Numeric T>
T add(T a, T b) { return a + b; }

static_assert(add(1, 2) == 3);
static_assert(add(1.5, 2.5) == 4.0);
// add("a", "b") — fails to instantiate: const char* is not Numeric

// Built-in concepts
static_assert(std::ranges::range<std::vector<int>>);
static_assert(std::copyable<int>);

// Combining concepts
template <typename T>
concept Comparable = requires(T a, T b) {
    { a < b } -> std::convertible_to<bool>;
    { a == b } -> std::convertible_to<bool>;
};
```

## `std::format` (C++20)

Type-safe, Python-style string formatting.

```cpp
#include <format>
#include <chrono>

// Instead of printf/sprintf/cout combos
std::string s = std::format("{} + {} = {}", 1, 2, 3);  // "1 + 2 = 3"
std::string t = std::format("{:>10}", 42);              // right-aligned, width 10
std::string u = std::format("{:.2f}", 3.14159);        // "3.14"
std::string v = std::format("{:02x}", 255);            // "ff"

// Named arguments
std::cout << std::format("Hello, {name}! You are {age} years old.\n",
                         std::format_args::arg("name", "Alice"), /* arg */);
```

## `std::span` (C++20)

Non-owning view into a contiguous sequence — replacement for pointer+length pairs.

```cpp
#include <span>

// Instead of (T* ptr, size_t count)
void print_all(std::span<const int> data) {
    for (int x : data) std::cout << x << ' ';
}

std::vector<int> vec{1, 2, 3};
std::array<int, 3> arr{4, 5, 6};
int raw[] = {7, 8, 9};

print_all(vec);   // works
print_all(arr);  // works
print_all(raw);  // works — decays to span<int, 3>
print_all({raw, 2});  // explicit length
```

## `[[likely]]` / `[[unlikely]]` (C++20)

Branch prediction hints for performance-critical paths.

```cpp
bool process(int x) {
    if (x > 0) [[likely]] {
        // compiler may rearrange code for the common case
        return do_positive(x);
    }
    [[unlikely]] {
        return do_non_positive(x);
    }
}
```
