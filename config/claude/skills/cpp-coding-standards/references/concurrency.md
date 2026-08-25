# Concurrency in Modern C++

This reference covers mutexes, atomics, threads, and common concurrency patterns.

## Core Principle: No Data Races

A **data race** is simultaneous, unsynchronized access to the same memory location where at least one access is a write. It is **undefined behavior**.

Every shared variable must be:
1. Protected by a mutex (`std::lock_guard`), OR
2. Declared `std::atomic`, OR
3. Never modified concurrently (read-only after initialization)

## Mutex and Lock Guards

### `std::lock_guard` — Simplest Guard

RAII lock — unlocks on scope exit.

```cpp
#include <mutex>

std::mutex mtx;
int counter = 0;

void increment() {
    std::lock_guard<std::mutex> lock(mtx);  // acquires lock
    ++counter;  // safe: only one thread here at a time
}  // destructor releases lock
```

### `std::unique_lock` — Flexible Guard

Supports deferred locking, timed locking, and manual unlock.

```cpp
std::mutex mtx;
std::unique_lock<std::mutex> lock(mtx);  // locks immediately
lock.unlock();   // temporarily unlock
lock.lock();     // relock
// ...
// automatically unlocks when lock goes out of scope

// Deferred — lock is not acquired yet
std::unique_lock<std::mutex> deferred(mtx, std::defer_lock);
// ... other code ...
deferred.lock();  // now lock
deferred.unlock(); // unlock early if needed
```

### `std::scoped_lock` (C++17) — Multiple Mutexes

Locks multiple mutexes without deadlock (uses the deadlock-avoidance algorithm).

```cpp
std::mutex m1, m2, m3;

// GOOD: locks all three safely — avoids deadlock
std::scoped_lock lock(m1, m2, m3);
// ... access protected data ...
```

### The Deadlock Problem

Lock mutexes in a **fixed order** if using multiple `lock_guard`/`unique_lock`. Or prefer `scoped_lock`.

```cpp
// DANGEROUS: different threads lock in opposite orders → deadlock
void transfer(Account& from, Account& to, int amount) {
    std::lock_guard<std::mutex> l1(from.mtx);
    std::lock_guard<std::mutex> l2(to.mtx);  // deadlock if another thread does to→from
    from.balance -= amount;
    to.balance += amount;
}

// SAFE: scoped_lock locks both simultaneously
void transfer(Account& from, Account& to, int amount) {
    std::scoped_lock lock(from.mtx, to.mtx);  // no deadlock
    from.balance -= amount;
    to.balance += amount;
}
```

## Atomics

Use `std::atomic` for simple shared values where the type supports lock-free operations.

```cpp
#include <atomic>

// Basic types
std::atomic<int> counter{0};
counter.fetch_add(1);           // returns old value
counter++;                       // simple ops also work
int old = counter.exchange(42);  // read and write

// Memory ordering
counter.store(1, std::memory_order_relaxed);   // only use for counters
counter.store(1, std::memory_order_release);  // release semantics
int x = counter.load(std::memory_order_acquire);  // acquire semantics

// Default memory_order_seq_cst is safest and the default — use it unless you
// have measured that relaxed/acq_rel gives meaningful gains

// Boolean flag
std::atomic<bool> ready{false};
void producer() { ready.store(true, std::memory_order_release); }
void consumer() {
    while (!ready.load(std::memory_order_acquire)) {
        std::this_thread::yield();
    }
    // consume
}
```

## `std::atomic` with User-Defined Types

A `std::atomic<T>` requires `T` to be trivially copyable and lock-free for the operations to be available.

```cpp
struct Point { int x; int y; };

// std::atomic<Point> — only works if Point is trivially copyable and
// the platform provides lock-free atomics for its size
static_assert(std::is_trivially_copyable_v<Point>);
static_assert(std::atomic<Point>::is_always_lock_free());
```

## Threads

### `std::thread` Lifecycle — Critical Rule

**Every `std::thread` must be either joined (`.join()`) or detached (`.detach()`) before destruction.** A `std::thread` that is neither joined nor detached calls `std::terminate`.

```cpp
#include <thread>

void background_task(int param) { /* ... */ }

// GOOD — explicit join
std::thread t(background_task, 42);
t.join();   // wait for completion

// GOOD — detached (fire and forget, but lose ability to synchronize)
std::thread t(background_task, 42);
t.detach(); // thread continues running independently

// DANGEROUS — terminate() called
{
    std::thread t(background_task, 42);
    // t not joined or detached here
} // std::terminate() called
```

### `std::jthread` (C++20) — Auto-Join

Automatically joins on destruction. Prefer `std::jthread` over `std::thread` in C++20.

```cpp
#include <thread>

void cancellable_work(std::stop_token token) {
    while (!token.stop_requested()) {
        do_step();
    }
}

std::jthread jt(cancellable_work);
// ... work happens in background ...
// jt destroyed here → automatically requests stop and joins
```

### Stop Tokens (C++20)

Gracefully stop a `jthread` without polling a flag.

```cpp
void long_task(std::stop_token token) {
    for (size_t i = 0; i < 1000; ++i) {
        if (token.stop_requested()) {
            std::cout << "Stopped at " << i << '\n';
            return;  // clean exit
        }
        compute_step(i);
    }
}

std::jthread worker(long_task);
std::this_thread::sleep_for(std::chrono::milliseconds(10));
worker.request_stop();  // signals stop_requested()
```

## `std::condition_variable`

Used to block a thread until another thread signals that a condition is true.

```cpp
#include <condition_variable>
#include <queue>

std::mutex mtx;
std::condition_variable cv;
std::queue<int> q;

void producer() {
    for (int i = 0; i < 10; ++i) {
        {
            std::lock_guard<std::mutex> lock(mtx);
            q.push(i);
        }
        cv.notify_one();  // wake one waiting consumer
    }
}

void consumer() {
    while (true) {
        std::unique_lock<std::mutex> lock(mtx);
        cv.wait(lock, [&] { return !q.empty() || /* done signal */; });
        if (q.empty()) break;  // producer done
        int val = q.front();
        q.pop();
        lock.unlock();  // unlock while processing (optional)
        // process val
    }
}
```

## `std::future` and `std::promise`

One-shot communication from a background thread to a caller.

```cpp
#include <future>

std::promise<int> p;
std::future<int> f = p.get_future();

std::thread t([&p]() {
    // compute result
    p.set_value(42);
    // or on error: p.set_exception(std::make_exception_ptr(std::runtime_error("fail")));
});

int result = f.get();  // blocks until value is set
t.join();
```

### `std::async` — Simpler Parallelism

Launch a task asynchronously and get a future.

```cpp
#include <future>

// LaunchPolicy::async = run in separate thread
// LaunchPolicy::deferred = lazy evaluation in calling thread
auto fut = std::async(std::launch::async, []() {
    return compute_expensive_result();
});

int result = fut.get();  // blocks until ready
```

## Common Concurrency Mistakes

```cpp
// WRONG: Forgetting to protect shared data
std::string shared;  // data race: multiple threads write
void writer() { shared = "hello"; }
void reader() { std::cout << shared; }
std::thread t1(writer), t2(reader);  // DATA RACE

// RIGHT: Protect with mutex
std::mutex mtx;
std::string shared;
void writer() {
    std::lock_guard<std::mutex> lock(mtx);
    shared = "hello";
}
void reader() {
    std::lock_guard<std::mutex> lock(mtx);
    std::cout << shared;
}

// WRONG: Passing references to local variables to threads
void bad() {
    std::string s = "data";
    std::thread t([&s]() { use(s); });  // reference to local — DANGER
    t.detach();  // s destroyed, thread still uses it
}

// RIGHT: Move or copy into the thread
void good() {
    std::string s = "data";
    std::thread t([s]() { use(s); });  // copy into thread's closure
    t.join();  // or jthread
}

// WRONG: Locking a mutex and calling an unknown function (potential deadlock)
// If the function tries to lock the same mutex → deadlock
void dangerous(std::mutex& m) {
    std::lock_guard<std::mutex> lock(m);
    call_unknown_function();  // might lock m again
}
```

## Summary Table

| Primitive | Use When |
|---|---|
| `std::mutex` | Protect a single variable or small critical section |
| `std::lock_guard` | Simple RAII lock (most common) |
| `std::unique_lock` | Deferred/timed locking, condition variables |
| `std::scoped_lock` | Locking multiple mutexes at once |
| `std::atomic` | Simple shared counters, flags, lock-free data |
| `std::thread` | Create a thread (remember join/detach) |
| `std::jthread` | Thread that should auto-join and support stop tokens |
| `std::condition_variable` | Block until a condition is signaled |
| `std::future`/`std::promise` | One-shot result from background task |
| `std::async` | Simple parallel task without explicit thread management |
