# Error Handling in Modern C++

This reference covers when to use exceptions, error codes, or `std::expected`.

## Decision Guide

| Scenario | Recommended Approach |
|---|---|
| Constructor failure that leaves object in invalid state | Exception |
| Expected failure (element not found, invalid input format) | `std::optional`, error code, or `std::expected` |
| Library with many failure modes | `std::error_code` or `std::expected<T, E>` |
| Performance-critical hot path where exceptions are unacceptable | Error codes |
| Impossible failure (e.g., `std::terminate`) | Let it crash |
| Memory allocation failure | `std::bad_alloc` exception (let it propagate) |

**Golden rule:** Throw exceptions for *exceptional* conditions — things that should not happen in normal operation and from which the caller cannot reasonably recover. Do not use exceptions for expected failure cases (file not found, invalid user input).

## Exceptions

### Throwing and Catching

```cpp
#include <stdexcept>

class ConfigError : public std::runtime_error {
public:
    explicit ConfigError(const std::string& msg) : std::runtime_error(msg) {}
};

void load_config(const std::string& path) {
    std::ifstream in(path);
    if (!in) {
        throw ConfigError("Cannot open config: " + path);
    }
    // ...
}

// Caller
try {
    load_config("app.cfg");
} catch (const ConfigError& e) {
    std::cerr << "Config error: " << e.what() << '\n';
} catch (const std::exception& e) {
    std::cerr << "Unexpected: " << e.what() << '\n';
}
```

### Constructor Failure

Prefer to signal constructor failure via:
1. A `static` factory function that returns `std::optional` or `std::expected`
2. Throwing an exception (acceptable if construction failure is truly exceptional)

```cpp
// Approach 1: Factory returning optional
class Widget {
    Widget(int param) {}  // private or non-public
public:
    static std::optional<Widget> create(int param) {
        if (param < 0) return std::nullopt;
        return Widget(param);
    }
};

// Approach 2: Exception for truly unexpected failure
class NetworkConnection {
public:
    NetworkConnection(const std::string& host, int port) {
        if (port < 0 || port > 65535)
            throw std::invalid_argument("Invalid port: " + std::to_string(port));
    }
};
```

## Error Codes

Traditional C-style error handling via return values. Works well in performance-sensitive code and for system-level APIs.

```cpp
#include <system_error>

enum class MyError { NotFound = 1, InvalidInput, Timeout };

// Return std::error_code — idiomatic C++ error code
std::error_code read_data(const std::string& path, std::vector<char>& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::errc::no_such_file_or_directory;
    out.assign(std::istreambuf_iterator<char>(in), {});
    return {};  // empty error_code = success
}

// Usage
std::vector<char> data;
std::error_code ec = read_data("file.bin", data);
if (ec) {
    std::cerr << "Read failed: " << ec.message() << '\n';
    return;
}
// use data
```

## `std::expected<T, E>` (C++23)

The preferred way to handle expected failures in modern C++. Available in C++23; use the `std::expected` proposal or the `tl::expected` library for C++17/20.

```cpp
// C++23 std::expected
#include <expected>

std::expected<int, std::error_code> parse_int(std::string_view s) {
    int result = 0;
    for (char c : s) {
        if (!std::isdigit(c))
            return std::unexpected(std::errc::invalid_argument);
        result = result * 10 + (c - '0');
    }
    return result;
}

// Usage
auto opt = parse_int("123abc");
if (opt) {
    std::cout << "Value: " << *opt << '\n';
} else {
    std::cerr << "Parse failed: " << opt.error().message() << '\n';
}

// Transform with .and_then (monadic interface in C++23)
auto doubled = parse_int("42").transform([](int x) { return x * 2; });
// doubled == 84
```

### Monadic Operations (C++23)

```cpp
// and_then — chain operations that can fail
auto result = read_config()
    .and_then([](const Config& c) -> std::expected<Settings, E> {
        return validate(c);
    })
    .transform([](const Settings& s) {
        return process(s);  // successful transform
    });

// or_else — handle failure
auto with_fallback = read_config().or_else([](auto) {
    return read_default_config();
});

// transform_error — map error type
auto with_err_msg = parse_int("abc").transform_error([](std::errc e) {
    return std::string(std::strerror(std::make_error_code(e).value()));
});
```

## `std::optional` for Expected Absence

When the only "failure" is that a value is not present, `std::optional` is the right tool.

```cpp
std::optional<int> find_user(const std::string& name) {
    for (auto& [n, id] : user_db) {
        if (n == name) return {id};
    }
    return std::nullopt;
}

if (auto uid = find_user("Bob")) {
    std::cout << "User ID: " << *uid << '\n';
} else {
    std::cout << "User not found\n";
}
```

## Exception Safety Guarantees

Four levels of exception safety:

| Level | Guarantee | Use When |
|---|---|---|
| **Nothrow** (`noexcept`) | Operation never throws | Move constructors, swap, essential operations |
| **Strong** | Failed op leaves state unchanged | Most business logic |
| **Basic** | Failed op leaves object valid | Destructors, `operator=` |
| **No guarantee** | Any behavior on failure | Avoid |

```cpp
class Widget {
    std::vector<int> data_;
public:
    // Strong exception safety — copy-on-write pattern
    void replace(std::vector<int> new_data) {
        std::vector<int> tmp = std::move(new_data);  // copy into temp
        data_.swap(tmp);  // noexcept swap
        // old data_ is in tmp, destroyed when tmp goes out of scope
    }

    // noexcept on functions that cannot fail
    void clear() noexcept { data_.clear(); }
    bool empty() const noexcept { return data_.empty(); }
};
```

## noexcept — When to Use

Use `noexcept` on functions that **cannot** throw by design. This enables optimizations and documents API contracts.

```cpp
// Destructors should be noexcept (the default)
class Resource {
    int* ptr_ = nullptr;
public:
    ~Resource() { delete[] ptr_; }  // implicitly noexcept
};

// Move constructors of containers are noexcept — this matters
// A vector will use move() instead of copy() if the move ctor is noexcept
struct Important {
    std::vector<int> big_data;
    Important(Important&&) noexcept = default;  // ensure noexcept
};

// Mark observers noexcept
template <typename T>
bool is_empty(const std::vector<T>& v) noexcept {
    return v.empty();  // cannot throw — .empty() is noexcept
}
```

**Do NOT mark a function `noexcept` if it can throw.** Misleading `noexcept` violates caller expectations and can cause `std::terminate` to be called unexpectedly.
