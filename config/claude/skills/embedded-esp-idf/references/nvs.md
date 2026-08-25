# NVS (Non-Volatile Storage) on ESP-IDF

NVS stores small key-value pairs in flash and survives reboot. ESP-IDF provides `nvs_flash.h` (low-level) and `nvs.h` (typed handle API). Most firmware code uses the typed handle API.

## Initialization — once at boot

`nvs_flash_init()` must be called **exactly once at application startup**, not on every operation. Calling it in a getter/setter is an anti-pattern.

```cpp
// GOOD — in app_main()
extern "C" void app_main() {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    // ... start tasks, services, etc.
}

// BAD — calling nvs_flash_init() in every Get/Set is wasteful
esp_err_t Configuration::GetInt(const char* key, int32_t* out) {
    nvs_flash_init();  // <-- wrong
    nvs_handle_t h;
    nvs_open("ns", NVS_READONLY, &h);
    // ...
}
```

For partition-encrypted or large NVS partitions, also handle `ESP_ERR_NVS_NO_FREE_PAGES` and `ESP_ERR_NVS_NEW_VERSION_FOUND` by erase + retry. See `examples/storage/nvs_value_iterator` in ESP-IDF.

## Namespaces and handles

Open a handle per operation or per long-lived component:

```cpp
// Per-operation (simple, slightly more overhead)
nvs_handle_t h;
ESP_ERROR_CHECK(nvs_open("ams7cfg", NVS_READWRITE, &h));
int32_t val = 42;
ESP_ERROR_CHECK(nvs_set_i32(h, "ble_adv", val));
ESP_ERROR_CHECK(nvs_commit(h));
nvs_close(h);

// Per-component (preferred for hot paths)
class ConfigStore {
public:
    esp_err_t Init() {
        esp_err_t err = nvs_open("ams7cfg", NVS_READWRITE, &handle_);
        if (err != ESP_OK) return err;
        // optional: pre-load known keys
        return ESP_OK;
    }
    ~ConfigStore() { nvs_close(handle_); }
private:
    nvs_handle_t handle_{};
};
```

`nvs_commit()` is **required** for write durability — `nvs_set_*` only updates the in-memory cache.

## Typed vs blob storage

| Type | Use for |
|---|---|
| `nvs_set_i8/u8/i16/u16/i32/u64` | Counters, flags, IDs, durations |
| `nvs_set_str` | Variable-length strings (max 4000 bytes per key, ~1984 bytes safe) |
| `nvs_set_blob` | Packed structs, calibration data, JSON payloads |
| `nvs_set_str` with fixed keys | Persistent default values (e.g., `feature_flag_default` = "on") |

Use **typed keys** for atomic per-field updates; use **blob** only when the data is always written and read as a unit (otherwise partial writes corrupt the format).

## Error handling

`ESP_ERROR_CHECK_WITHOUT_ABORT(nvs_set_*(...))` silently swallows NVS failures. The caller has no way to know the persist operation succeeded. Two patterns:

```cpp
// 1. Propagate the error to the caller
esp_err_t ConfigStore::SetInt(const char* key, int32_t val) {
    esp_err_t err = nvs_set_i32(handle_, key, val);
    if (err != ESP_OK) return err;
    return nvs_commit(handle_);
}

// 2. Log and degrade gracefully
esp_err_t err = nvs_set_i32(handle_, key, val);
if (err != ESP_OK) {
    ESP_LOGE(TAG, "nvs_set_i32(%s) failed: %s", key, esp_err_to_name(err));
    return;  // caller decides what to do
}
```

Avoid bare `ESP_ERROR_CHECK_WITHOUT_ABORT` followed by an assumed-success return value.

## Common pitfalls

- **Forgetting `nvs_commit()`** — `nvs_set_*` is buffered; without commit, values are lost on power cycle
- **Using the same handle from two tasks** — `nvs_handle_t` is not thread-safe; serialize access or use one handle per task
- **Hitting the 4-6 KB per-namespace limit** — large blobs need a dedicated namespace; check `nvs_get_stats()` first
- **Storing `std::string` directly** — NVS stores C strings, convert with `.c_str()` for write and `nvs_get_str` + sized buffer for read
- **Initializing on every getter** — see "Initialization" above
- **Hardcoded partition not present** — confirm `partitions.csv` includes an `nvs` entry; default is usually fine but custom layouts can break

## Kconfig gating for NVS debug

Expose NVS internals under a debug option so production builds stay quiet:

```kconfig
config AMS7_NVS_DEBUG_ENABLE
    bool "Enable verbose NVS logging"
    default n
    help
        When enabled, every NVS get/set logs a line. Disable in production
        to avoid per-write console output.
```

## AMS7-specific patterns

`(AMS7)` The AMS7 firmware uses the namespace `"ams7cfg"` for runtime feature flags and study metadata. The NVS handle is owned by `Configuration` in `main/ams7conf.cpp`. The boot path in `main/ams7_esp32.cpp` calls `nvs_flash_init()` once before any `Configuration` access.

`(AMS7)` Persisted feature-flag defaults are stored as NVS strings (e.g., `ble_adv_snapshot_default = "on"`) — the runtime override is in RAM only. This lets `_SAVE` commands persist while plain `!FEATURE=true` commands stay ephemeral.
