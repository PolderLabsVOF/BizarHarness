# Kconfig

Kconfig is the build-time configuration system ESP-IDF inherits from the Linux kernel. Options live in `Kconfig` files, are presented through `idf.py menuconfig`, and resolve to `CONFIG_*` macros visible in C/C++.

## Where Kconfig files live

ESP-IDF automatically sources a `Kconfig` file from every registered component. The top-level `Kconfig.projbuild` is required and seeds the project menu. Conventions:

- `main/Kconfig` — app-level options. Always include `main "AMS7 Project Options"` style menus.
- `components/<name>/Kconfig` — component-private options; only visible if the component is included in the build.
- `Kconfig.projbuild` — root-level options that gate top-of-tree decisions.

`(AMS7)` AMS7 puts its entire menu under `main/Kconfig` (single file, ~430 lines), with the menu title `"AMS7 Project Options"`. Every project-defined option uses the `AMS7_*` prefix.

## Adding a simple bool option

```kconfig
menu "Connectivity Workflow"

config AMS7_SUMMARY_ENABLE
    bool "Enable ESP-NOW summary workflow"
    default n
    help
        Master switch for the recording workflow that starts with BLE
        control and then switches to ESP-NOW summary mode after
        acquisition begins. Keep disabled to preserve the BLE-only
        workflow.

endmenu
```

The `CONFIG_AMS7_SUMMARY_ENABLE` macro is then visible everywhere in C/C++:

```cpp
#if CONFIG_AMS7_SUMMARY_ENABLE
    init_espnow_summary();
#endif
```

## Types

| Type        | C macro                              | Notes                                  |
|-------------|--------------------------------------|----------------------------------------|
| `bool`      | `CONFIG_FOO` (1 or undefined)        | `default y` or `default n`             |
| `int`       | `CONFIG_FOO` (int literal)           | `range MIN MAX` is recommended         |
| `hex`       | `CONFIG_FOO` (hex literal)           | Useful for bitmasks and addresses      |
| `string`    | `CONFIG_FOO` (string literal)        | `default "literal"`                    |
| `choice`    | selects one of several values        | Use for mutually-exclusive options     |

```kconfig
config AMS7_HR_HOLD_MS
    int "Hold time for fused HR before fallback (ms)"
    depends on AMS7_VITALS_ENABLE
    range 0 60000
    default 10000
    help
        How long to keep reporting fused HR after the fused pipeline
        reports a confident beat, before falling back to the simple
        backend. 0 disables the hold.
```

In code:

```cpp
#if CONFIG_AMS7_HR_HOLD_MS > 0
    const TickType_t kHoldTicks = pdMS_TO_TICKS(CONFIG_AMS7_HR_HOLD_MS);
#endif
```

`menuconfig` values are stored in `sdkconfig` as `CONFIG_<NAME>=<value>` lines. `idf.py menuconfig` is the editor.

## Dependencies and implications

```kconfig
config AMS7_BLE_VITALS_ENABLE
    bool "Enable custom BLE vitals characteristic"
    depends on AMS7_VITALS_ENABLE
    default y
```

- `depends on AMS7_VITALS_ENABLE` — option is **invisible** unless `AMS7_VITALS_ENABLE=y`. Selecting it auto-selects the dep.
- `select AMS7_ESPNOW_ENABLE` — when **this** option is enabled, force `AMS7_ESPNOW_ENABLE=y`.
- `imply AMS7_ESPNOW_LIVE_ECG_ENABLE` — when **this** option is enabled, set `AMS7_ESPNOW_LIVE_ECG_ENABLE=y` unless the user explicitly disabled it (softer than `select`).

`select` chains can cause cycles if used carelessly — prefer `depends on` for prerequisites.

## Ranges

```kconfig
config AMS7_ESPNOW_WIFI_CHANNEL
    int "ESP-NOW Wi-Fi channel"
    range 1 13
    default 6
```

The value is validated by menuconfig; `range` rejects out-of-range entries.

## Choices

```kconfig
choice AMS7_HR_BACKEND
    prompt "Heart-rate backend"
    default AMS7_HR_BACKEND_FUSED
    depends on AMS7_VITALS_ENABLE

config AMS7_HR_BACKEND_SIMPLE
    bool "Simple R-peak detector"

config AMS7_HR_BACKEND_FUSED
    bool "Fused multi-source pipeline"

endchoice
```

Only one of the listed `config`s can be `y` at a time. Use `# CONFIG_AMS7_HR_BACKEND_FUSED is not set` to switch.

## Sourcing custom Kconfig files

In a component's top-level `Kconfig` (sourced automatically), include sub-files:

```kconfig
mainmenu "My Component"

menu "Sensor Options"
source "Kconfig.sensor"
endmenu
```

Or in `CMakeLists.txt`, register the file as part of the component:

```cmake
idf_component_register(
    ...
    KCONFIG
        "Kconfig"
)
```

For project-wide overlays, create `sdkconfig.espnow_flow` (or similar) and pass `--sdkconfig` to `idf.py`. Layers are applied in order: defaults, then `sdkconfig`, then any `--sdkconfig` files.

## Help text

Always include a `help` block. menuconfig shows it on the option's help line; the project documentation pulls it from `Kconfig` when generating reference. Keep it under ~10 lines.

## AMS7 conventions (project-specific)

- Prefix every project-defined option with `AMS7_`. Never use `CONFIG_FOO` for an AMS7-introduced symbol.
- Group options by feature in `menu "..."` blocks. AMS7 groups: Connectivity Workflow, Vitals, ESP-NOW, Logging, etc.
- Default to `n` for any feature that increases IRAM/flash — acquisition builds are size-sensitive.
- For "trial debug" toggles, name them `*_TRIAL_DEBUG_LOG_ENABLE` and gate `ESP_LOG*` calls behind them — never compile trial-debug logs into release by default.
- Add a `help` block on every option. AMS7 reviewers check for missing help text.

## Common pitfalls

- **Forgetting `default`.** menuconfig prompts for a value on first use; this is annoying. Always set a sensible default.
- **`select` cycle.** `A select B; B select A` causes menuconfig to error. Use `depends on` instead.
- **Component Kconfig included in disabled component.** If a component's Kconfig has options, that component must be discoverable. Check `EXTRA_COMPONENT_DIRS` in `CMakeLists.txt`.
- **Renaming an option without a migration.** Renaming `AMS7_X` to `AMS7_Y` leaves `sdkconfig` referring to the old name. `menuconfig` will silently drop the new option. Fix: add a `config AMS7_Y` with `default AMS7_X` then remove `AMS7_X`.
- **`range` on a `bool`.** Doesn't make sense — Kconfig will refuse. Use a `choice` instead.
