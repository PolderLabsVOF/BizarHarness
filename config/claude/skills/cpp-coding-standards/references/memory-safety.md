# Memory Safety in Modern C++

This reference covers RAII, smart pointers, and the Rule of Five/Zero.

## RAII — Resource Acquisition Is Initialization

Every resource (heap memory, file handle, mutex, socket, etc.) must be owned by an object whose destructor performs cleanup. This guarantees cleanup even when exceptions are thrown.

```cpp
// GOOD — file closes automatically at scope exit
void read_file(const std::string& path) {
    std::ifstream in(path);
    std::string line;
    while (std::getline(in, line)) {
        process(line);
    }
} // destructor closes file, no matter how we exit

// BAD — manual cleanup, error-prone
void read_file_bad(const std::string& path) {
    std::ifstream* in = new std::ifstream(path);
    std::string line;
    while (std::getline(*in, line)) {  // throws? leaks *in
        process(line);
    }
    delete in;
}
```

### Common RAII Types in the Standard Library

| Type | Resource |
|---|---|
| `std::unique_ptr` | Heap memory (single owner) |
| `std::shared_ptr` | Heap memory (shared owner) |
| `std::ifstream` / `std::ofstream` | File handles |
| `std::lock_guard` / `std::scoped_lock` | Mutex lock |
| `std::jthread` (C++20) | Thread join on destruction |

## Smart Pointers

### `std::unique_ptr<T>`

Exclusive ownership. The default choice. Zero overhead over raw pointer.

```cpp
#include <memory>

// Creation
auto p1 = std::make_unique<int>(42);
auto p2 = std::make_unique<std::vector<int>>(10, 0);

// Custom deleter (rare — only when type needs special cleanup)
auto file_deleter = [](FILE* f) { if (f) fclose(f); };
std::unique_ptr<FILE, decltype(file_deleter)> fp(fopen("data.txt", "r"), file_deleter);

// Transfer ownership
std::unique_ptr<int> source = std::make_unique<int>(1);
std::unique_ptr<int> dest = std::move(source);  // source is now nullptr
assert(!source);
assert(*dest == 1);

// Release the raw pointer (rare — only for C interop)
int* raw = p1.release();
delete raw;  // you now own it — avoid this
```

### `std::shared_ptr<T>`

Shared ownership via reference counting. Use **only** when ownership genuinely must be shared. Prefer `unique_ptr` otherwise.

```cpp
auto shared = std::make_shared<int>(100);

// Copy increases ref count
auto shared2 = shared;  // ref count = 2

// shared_ptr can be created from unique_ptr
auto unique = std::make_unique<double>(3.14);
std::shared_ptr<double> from_unique = std::move(unique);

// Weak pointer — breaks cycles
std::weak_ptr<int> weak = shared;
if (auto locked = weak.lock()) {
    // use *locked safely
}  // locked goes out of scope, ref count unchanged

// Custom deleter — stored separately from the control block
auto deleter = [](FILE* f) { fclose(f); };
std::shared_ptr<FILE> f(fopen("x.txt", "r"), deleter);
```

**Performance notes:**
- `shared_ptr` is twice the size of a raw pointer (control block + pointer)
- Atomic reference count increments/decrements on copy/destroy
- `make_shared` allocates the object and control block in one allocation (preferred)

### `std::weak_ptr<T>`

Non-owning observer of a `shared_ptr`. Use to break reference cycles (A owns B, B observes A without owning).

```cpp
class Observer;
class Subject {
    std::vector<std::weak_ptr<Observer>> observers_;
public:
    void notify() {
        for (auto& w : observers_) {
            if (auto o = w.lock()) o->on_update();
        }
    }
};
```

## Rule of Five

If you define **any one** of the five special member functions below, you likely need to define **all five**:

1. Destructor
2. Copy constructor
3. Copy assignment operator
4. Move constructor
5. Move assignment operator

```cpp
class Buffer {
    int* data_ = nullptr;
    size_t size_ = 0;
public:
    explicit Buffer(size_t n) : data_(new int[n]), size_(n) {}

    ~Buffer() { delete[] data_; }

    // Copy constructor
    Buffer(const Buffer& o) : data_(new int[o.size_]), size_(o.size_) {
        std::copy(o.data_, o.data_ + o.size_, data_);
    }

    // Copy assignment operator
    Buffer& operator=(const Buffer& o) {
        if (this != &o) {
            delete[] data_;
            data_ = new int[o.size_];
            size_ = o.size_;
            std::copy(o.data_, o.data_ + o.size_, data_);
        }
        return *this;
    }

    // Move constructor
    Buffer(Buffer&& o) noexcept : data_(std::exchange(o.data_, nullptr)), size_(std::exchange(o.size_, 0)) {}

    // Move assignment operator
    Buffer& operator=(Buffer&& o) noexcept {
        if (this != &o) {
            delete[] data_;
            data_ = std::exchange(o.data_, nullptr);
            size_ = std::exchange(o.size_, 0);
        }
        return *this;
    }
};
```

## Rule of Zero

Prefer **not** defining any special members and letting the compiler generate them correctly. Use standard library containers and smart pointers to manage resources.

```cpp
// Rule of Zero — no manual resource management needed
class Point {
    double x_ = 0, y_ = 0;
public:
    Point() = default;
    Point(double x, double y) : x_(x), y_(y) {}
    double distance_to(const Point& o) const {
        double dx = x_ - o.x_, dy = y_ - o.y_;
        return std::sqrt(dx*dx + dy*dy);
    }
};
// Compiler-generated copy/move/dtor are all correct here
```

## Common Mistakes

```cpp
// WRONG: Shared ownership where unique ownership suffices
auto widget = std::make_shared<Widget>();
process(std::shared_ptr<Widget>(widget));  // unnecessary ref count bump

// WRONG: Memory leak via raw new in container
std::vector<int*> v;
v.push_back(new int(1));  // who deletes these?

// RIGHT: Smart pointers in containers
std::vector<std::unique_ptr<int>> v;
v.push_back(std::make_unique<int>(1));  // auto-deleted

// WRONG: Missing virtual destructor in base class
struct Base {
    virtual void foo() {}
    // Missing virtual destructor — deleting through base pointer is UB
};
struct Derived : Base {
    std::vector<int> data;
};

Base* b = new Derived;
delete b;  // UB: Derived's destructor not called

// RIGHT: Virtual destructor
struct Base {
    virtual ~Base() = default;  // polymorphic bases need virtual dtor
    virtual void foo() {}
};
```
