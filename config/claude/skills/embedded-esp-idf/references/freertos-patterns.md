# FreeRTOS patterns

ESP-IDF v5 uses FreeRTOS. Most of these patterns are the same as FreeRTOS elsewhere; the ESP32-specific bits are task pinning, ISR rules (no blocking), and `portTICK_PERIOD_MS`.

## Task lifecycle

Create, run, delete:

```cpp
void acquisition_task(void *arg) {
    while (true) {
        // ... do work, sleep, wait on a queue ...
    }
    vTaskDelete(nullptr);  // never reached in a normal acquisition loop
}

void start() {
    xTaskCreatePinnedToCore(
        acquisition_task,            // task function
        "acq",                       // name (shown in runtime stats)
        4096,                        // stack depth in WORDS (not bytes) on ESP32
        nullptr,                     // arg
        20,                          // priority (0 = idle, higher = more preemptive)
        nullptr,                     // optional task handle
        1                            // core ID (0 = APP CPU on classic ESP32, 1 = PRO CPU)
    );
}
```

Notes:

- Stack depth is in **words**, not bytes. On ESP32 (32-bit) `4096` = 16 KB. Allocate generously for tasks with deep call chains; oversized stack wastes DRAM but undersized stack corrupts memory silently.
- Pass `nullptr` if you do not need the handle. Use the handle later for `vTaskSuspend` / `vTaskResume` / `vTaskDelete`.
- Pinning is mandatory for acquisition paths — non-pinned tasks can bounce between cores and lose cache locality.

`(AMS7)` AMS7 acquisition tasks run at priority 20+, pinned to core 0 (APP CPU). The PRO CPU (core 1) handles BLE/Wi-Fi by default.

## Priorities

| Range  | Use for                                                    |
|--------|------------------------------------------------------------|
| 0      | Idle task only — do not use                                |
| 1–4    | Normal app tasks, command handling, BLE host               |
| 5–19   | Latency-sensitive but not real-time (rate control, queues) |
| 20–24  | Real-time acquisition, time-critical ISRs                  |

Do not stack many tasks at priority 20+ — round-robin between them defeats the point.

## Pinning to cores

ESP32 dual-core (Xtensa LX6):

- **Core 0 (APP CPU)** — protocol stacks (Wi-Fi, BLE), low-level drivers.
- **Core 1 (PRO CPU)** — `app_main` runs here by default.

Pick a split that puts time-critical work on the under-used core. `xTaskCreatePinnedToCore(handle, name, stack, arg, prio, handle_out, core_id)`.

ESP32-S3 / C3 / H2 are single-core: pinning is a no-op but the API still works.

## Queues

Producer/consumer with bounded queues. Decouples ISR rate from task rate.

```cpp
QueueHandle_t evt_q = xQueueCreate(16, sizeof(uint32_t));

// Producer (task context)
uint32_t pin = read_pin();
xQueueSend(evt_q, &pin, pdMS_TO_TICKS(10));

// Consumer
uint32_t pin;
if (xQueueReceive(evt_q, &pin, portMAX_DELAY) == pdTRUE) {
    handle(pin);
}
```

Use `portMAX_DELAY` only when the consumer must never return. Use `pdMS_TO_TICKS(N)` when the consumer should time out (e.g., to check a "stop" flag).

## ISR → task handoff

ISRs must not block. The standard handoff uses `xQueueSendFromISR` and the higher-priority-task-woken flag:

```cpp
static QueueHandle_t gpio_evt_q;

void IRAM_ATTR gpio_isr(void *arg) {
    uint32_t pin = (uint32_t)arg;
    BaseType_t hpw = pdFALSE;
    xQueueSendFromISR(gpio_evt_q, &pin, &hpw);
    if (hpw == pdTRUE) portYIELD_FROM_ISR();
}

void consumer_task(void *arg) {
    uint32_t pin;
    while (true) {
        if (xQueueReceive(gpio_evt_q, &pin, portMAX_DELAY) == pdTRUE) {
            // process pin (NOT in ISR context — can block here)
        }
    }
}
```

Alternatives:

- `xTaskNotifyFromISR` / `xTaskNotifyWait` — single-task notifications, very fast.
- `xTimerPendFunctionCallFromISR` — defer a callback into the timer service task (useful for one-shot IRAM work).
- Direct event bits with `xEventGroupSetBitsFromISR` — broadcast to multiple waiters.

## Stream and ring buffers

For variable-length byte streams (e.g., SPI DMA into a parser):

```cpp
StreamBufferHandle_t sb = xStreamBufferCreate(2048, 256);   // total, trigger
// Producer (DMA ISR)
xStreamBufferSendFromISR(sb, data, len, &hpw);
// Consumer task
uint8_t buf[256];
size_t got = xStreamBufferReceive(sb, buf, sizeof(buf), pdMS_TO_TICKS(100));
```

`xRingbufferCreate` (IDF) is the lock-free variant — better for high-rate ISR streams where the producer must never wait.

## Semaphores and mutexes

```cpp
SemaphoreHandle_t ready = xSemaphoreCreateBinary();
xSemaphoreGive(ready);
xSemaphoreTake(ready, portMAX_DELAY);

SemaphoreHandle_t in_flight = xSemaphoreCreateCounting(4, 0);   // max 4, starts empty
```

Mutexes for shared resources:

```cpp
SemaphoreHandle_t cfg_lock = xSemaphoreCreateMutex();
if (xSemaphoreTake(cfg_lock, pdMS_TO_TICKS(100)) == pdTRUE) {
    // ... access shared resource ...
    xSemaphoreGive(cfg_lock);
}
```

**Recursive mutexes** (`xSemaphoreCreateRecursiveMutex`) for code that may take the same lock twice in a call chain.

## Timers

```cpp
TimerHandle_t t = xTimerCreate("rate", pdMS_TO_TICKS(1000), pdTRUE, nullptr, [](TimerHandle_t x) {
    // fired every 1000 ms; called in the timer service task (NOT ISR context)
});
xTimerStart(t, 0);
```

One-shot for delayed work:

```cpp
TimerHandle_t oneshot = xTimerCreate("once", pdMS_TO_TICKS(50), pdFALSE, nullptr, cb);
xTimerStart(oneshot, 0);
```

## Event groups

Useful when a task must wait for several subsystems to be ready before proceeding:

```cpp
EventGroupHandle_t eg = xEventGroupCreate();
xEventGroupSetBits(eg, BIT_SD_READY | BIT_BLE_READY | BIT_ACQ_READY);

EventBits_t bits = xEventGroupWaitBits(
    eg,
    BIT_SD_READY | BIT_BLE_READY | BIT_ACQ_READY,
    pdFALSE,                  // don't clear on exit
    pdTRUE,                   // wait for ALL bits
    portMAX_DELAY
);
```

## Watchdog

The IDF task watchdog resets the system if a task does not feed it within a window. Always feed:

```cpp
void heavy_task(void *arg) {
    while (true) {
        // chunk of work
        vTaskDelay(pdMS_TO_TICKS(10));          // yields — watchdog is fed by idle
        // OR if you spin:
        // vTaskDelay(1);                          // minimum yield
    }
}
```

If a task really must spin for >1 second (rare), subscribe it to the watchdog and call `esp_task_wdt_reset()` periodically. Long ISR-disabled windows also trip the watchdog — keep them < one tick (`portTICK_PERIOD_MS` = 10 ms by default).

## portTICK_PERIOD_MS

Always convert via `pdMS_TO_TICKS(ms)`:

```cpp
vTaskDelay(pdMS_TO_TICKS(100));      // 100 ms regardless of tick rate
xQueueReceive(q, &x, pdMS_TO_TICKS(50));
```

Never multiply by hand (`ms * portTICK_PERIOD_MS`) — it lies when the tick rate changes.

## Common pitfalls

- **Blocking in an ISR.** Symptom: hard fault or watchdog reset. Fix: defer to a task via `xQueueSendFromISR` / `xTaskNotifyFromISR`.
- **Stack too small.** Symptom: random crashes after a few minutes, often deep in call chains. Fix: bump stack depth, or enable `CONFIG_COMPILER_STACK_CHECK_MODE_NORM` to catch overflows at runtime.
- **Priority inversion.** Symptom: low-priority task holds a mutex, blocks a high-priority task. Fix: `xSemaphoreCreateRecursiveMutex` and keep critical sections short.
- **Forgetting `portYIELD_FROM_ISR`.** Symptom: producer wakes the consumer but the consumer doesn't run until the next tick. Fix: check the `xHigherPriorityTaskWoken` returned from `*FromISR` and yield.
- **Non-pinned tasks bouncing cores.** Symptom: jittery timing, occasional cache misses. Fix: pin acquisition and protocol tasks explicitly.
