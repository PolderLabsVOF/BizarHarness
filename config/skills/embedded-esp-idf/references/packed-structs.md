# Packed binary protocols

Wire-format frames over ESP-NOW, BLE characteristic writes, or any byte-oriented transport must have deterministic layout. ESP32 is little-endian natively, but `__attribute__((packed))` structs are still required to lock field offsets across compilers and configurations.

## The canonical AMS7 frame shape

Every AMS7 wire frame lives in `main/connectivity/espnow_*_frame.hpp` and follows the same pattern. The IMU frame is the cleanest example:

```cpp
// main/connectivity/espnow_imu_frame.hpp
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CORE_ESPNOW_IMU_MAGIC     0x494dU   // ASCII 'I','M'
#define CORE_ESPNOW_IMU_VERSION   1U
#define CORE_ESPNOW_FRAME_IMU_RAW 1U

typedef struct __attribute__((packed)) {
    uint16_t magic;         // identifies the frame family on the wire
    uint8_t  version;       // protocol version of this struct
    uint8_t  frame_type;    // sub-type within the family
    uint16_t id;            // sender / subject id
    uint16_t seq;           // monotonic sequence
    uint16_t age_ms;        // capture age in ms (sender-stamped)
    int16_t  accel_x, accel_y, accel_z;
    int16_t  gyro_x,  gyro_y,  gyro_z;
} core_espnow_imu_frame_v1_t;

void espnow_imu_frame_init(core_espnow_imu_frame_v1_t *frame,
                           uint16_t id,
                           uint16_t seq,
                           uint16_t age_ms,
                           int16_t accel_x,
                           int16_t accel_y,
                           int16_t accel_z,
                           int16_t gyro_x,
                           int16_t gyro_y,
                           int16_t gyro_z);

#ifdef __cplusplus
}
static_assert(sizeof(core_espnow_imu_frame_v1_t) == 22,
              "core_espnow_imu_frame_v1_t must be 22 bytes");
#else
_Static_assert(sizeof(core_espnow_imu_frame_v1_t) == 22,
               "core_espnow_imu_frame_v1_t must be 22 bytes");
#endif
```

This pattern is **load-bearing** for the project:

- `magic` is the first 16 bits so the receiver can reject foreign frames in O(1) before parsing.
- `version` distinguishes `_v1_t` from `_v2_t` so the receiver can dispatch to the right decoder.
- `frame_type` distinguishes sub-types within the same magic family (e.g., `IMU_RAW` vs a future `IMU_QUAT`).
- A trailing `static_assert` locks the on-wire size — adding a field is a build error, not a silent wire-format drift.

`(AMS7)` Naming convention is `core_<transport>_<family>_frame_v<N>_t`. Static asserts are mandatory on every wire struct.

## The universal five rules

1. **`__attribute__((packed))`** on every wire struct. Never rely on natural alignment.
2. **`static_assert(sizeof(T) == N)`** for every wire struct. The assertion fires at compile time, not over the air.
3. **Fixed-width types** only: `uint16_t`, `int16_t`, `uint32_t`, `int32_t`. Never `int`, `long`, `short`.
4. **Magic byte first**, then version, then frame_type. Let the receiver reject foreign frames cheaply.
5. **Length-prefixed framing** on the wire: 2 bytes little-endian length, then that many bytes of payload. No delimiter scanning, no escape bytes.

## Byte order

ESP32 is little-endian natively; a `uint16_t` written via `memcpy` lands as low-byte-then-high-byte. When porting to a big-endian host (or a future big-endian SoC), use explicit byte-swap helpers instead of leaving `<<` chains:

```cpp
// Bad: silent byte-order dependence
uint32_t be = (raw[0] << 24) | (raw[1] << 16) | (raw[2] << 8) | raw[3];

// Good: explicit and obvious
#include <endian.h>
uint32_t value = le32toh(*reinterpret_cast<const uint32_t *>(raw));
```

Most ESP-IDF code uses the native LE order and stays put — the explicit byte swap is only needed when a host tool expects BE or when you genuinely don't know the SoC.

## Versioning and capability bits

When you need to evolve a frame without breaking old receivers, **bump the version** and add a `_v2_t`. Old receivers see the new magic and ignore it; new receivers see the version byte and dispatch:

```cpp
typedef struct __attribute__((packed)) {
    uint16_t magic;
    uint8_t  version;       // 2
    uint8_t  frame_type;
    uint16_t id;
    uint16_t seq;
    uint32_t timestamp_us;  // new in v2
    /* ... existing fields ... */
} core_espnow_imu_frame_v2_t;

static_assert(sizeof(core_espnow_imu_frame_v2_t) == 30,
              "core_espnow_imu_frame_v2_t must be 30 bytes");
```

For optional fields, use a `capability_bits` bitmask after the header:

```cpp
typedef struct __attribute__((packed)) {
    uint16_t magic;
    uint8_t  version;
    uint8_t  frame_type;
    uint16_t id;
    uint16_t seq;
    uint32_t cap_bits;      // bit 0 = has_quaternion, bit 1 = has_temperature, ...
    /* ... variable ... */
} core_espnow_capability_frame_v1_t;
```

Receivers mask-and-test `cap_bits` to know which optional fields are present.

## Wire framing (length-prefixed)

ESP-NOW itself has a 250-byte MTU per packet and 6-byte receiver MAC; AMS7 adds a 2-byte length prefix and a magic-byte envelope:

```
+--------+--------+--------------+----------+
| length | magic  |   payload    | (rounded |
| (u16)  | (u16)  |  (frame_t)   |  to MTU) |
+--------+--------+--------------+----------+
```

The receiver reads `length`, then reads exactly `length` bytes. If `length` exceeds the packet, the packet is dropped. If `magic` does not match a known family, drop.

For ESP-NOW specifically, AMS7 frames use a per-frame structure with sender-stamped `age_ms` so receivers can detect stale samples without keeping state.

## Init functions

Always provide an `_init` function that fills the struct from named arguments. This is the only thing that touches the wire struct's bytes, so the layout can change without callers changing:

```cpp
void espnow_imu_frame_init(core_espnow_imu_frame_v1_t *frame,
                           uint16_t id, uint16_t seq, uint16_t age_ms,
                           int16_t ax, int16_t ay, int16_t az,
                           int16_t gx, int16_t gy, int16_t gz) {
    frame->magic      = CORE_ESPNOW_IMU_MAGIC;
    frame->version    = CORE_ESPNOW_IMU_VERSION;
    frame->frame_type = CORE_ESPNOW_FRAME_IMU_RAW;
    frame->id         = id;
    frame->seq        = seq;
    frame->age_ms     = age_ms;
    frame->accel_x    = ax;  frame->accel_y = ay;  frame->accel_z = az;
    frame->gyro_x     = gx;  frame->gyro_y  = gy;  frame->gyro_z  = gz;
}
```

The init function is the seam — add a field, the init function gets a new argument, every caller updates. The wire size assertion catches a missed caller at compile time.

## Sending and receiving

```cpp
// Send: copy struct bytes into a flat buffer, prefix with length, hand to ESP-NOW.
core_espnow_imu_frame_v1_t f{};
espnow_imu_frame_init(&f, id, seq, age_ms, ax, ay, az, gx, gy, gz);
uint8_t wire[2 + sizeof(f)];
wire[0] = sizeof(f) & 0xff;
wire[1] = (sizeof(f) >> 8) & 0xff;
memcpy(wire + 2, &f, sizeof(f));
esp_now_send(peer, wire, sizeof(wire));
```

```cpp
// Receive: validate length, magic, version; then consume fields.
void on_recv(const uint8_t *data, size_t len) {
    if (len < 2 + sizeof(core_espnow_imu_frame_v1_t)) return;
    uint16_t want = (uint16_t)data[0] | ((uint16_t)data[1] << 8);
    if (want != sizeof(core_espnow_imu_frame_v1_t)) return;
    core_espnow_imu_frame_v1_t f;
    memcpy(&f, data + 2, sizeof(f));
    if (f.magic != CORE_ESPNOW_IMU_MAGIC || f.version != CORE_ESPNOW_IMU_VERSION) return;
    handle_imu(&f);
}
```

## Common pitfalls

- **No `static_assert`.** A field added in one header silently breaks every receiver. Always lock `sizeof`.
- **`int` or `long` fields.** Their size varies across compilers and platforms; never use them on the wire.
- **Natural alignment assumed.** Without `__attribute__((packed))`, the compiler may insert padding that you cannot see at the source level.
- **Magic-byte collision.** Two frame families accidentally using the same 2-byte magic. Pick from a sparse range; document in `docs/transport_payload_reference.md`.
- **Sending the struct directly via ESP-NOW.** ESP-NOW needs a flat byte buffer and a length prefix; sending `&frame, sizeof(frame)` skips the length prefix and confuses the receiver's parser.
- **Endianness assumptions on the host.** If a host-side tool (Rust gateway, Python decoder) reads the bytes, it must apply the same byte order. Document in `docs/transport_payload_reference.md`.
