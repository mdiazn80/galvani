# Myo BLE protocol notes

The source of truth is [`myohw.h`](https://github.com/thalmiclabs/myo-bluetooth/blob/master/myohw.h) from `thalmiclabs/myo-bluetooth`, which declares interface version 1.2. [`pyomyo`](https://github.com/PerlinWarp/pyomyo) is the reference for behavior the header doesn't cover. The implementation is in `src-tauri/src/myo/protocol.rs`.

## Confirmed with a real Myo

Tested on one armband with firmware 1.5.1970 and hardware REV-D, on macOS on Apple Silicon:

- **Byte order:** little-endian. Firmware reads as `01 00 05 00 b2 07 02 00`, and the orientation quaternion has a norm of 1.000.
- **Connection:** stayed up for over 10 minutes with `SetSleepMode(NeverSleep)` and no invalid packets.
- **EMG rate:** about 24 notifications per second on each of the 4 characteristics. The rate starts near 170–180 Hz and settles around 185–195 Hz, against a nominal 200 Hz. The cause of the shortfall is unknown.
- **IMU rate:** 45–49 Hz, against a nominal 50 Hz.
- **Device name:** the scan's advertised name works. Renaming isn't tested.
- **SKU:** this armband reports `0` (unknown), so SKU can't be relied on to identify the model.
- **Band direction:** with the arm hanging and the blue LED line toward the elbow, X acceleration is about −0.97 g. Flipping the band reverses the axis, which is an inference and not a separate measurement.
- **Scanning:** the first scan after the permission prompt found nothing, and the next one did.
- **Gestures:** rest, fist, wave in, wave out and double tap were reported. Tap events are frequent, even from ordinary movement.
- **Undocumented classifier event:** type 7 appeared shortly before the arm unsynced. `myohw.h` doesn't list it, so it's kept as unknown. It might be the warm-up event the original brief mentions, which is unconfirmed.
- **Battery level:** it went from 94% to 96% within 30 seconds. If the armband wasn't charging, the 2-point rule for estimating charging can give false positives.
- **Arm detection:** with the armband on the right arm and the LED line toward the elbow, the sync event reported `Left` and `TowardElbow`. The 3D view shows the arm moving correctly under the opposite assumption (+X toward the wrist), so the sync result can't be trusted for this device. It may be a single wrong sync, or related to the active custom classifier.
- **Characteristics:** besides the documented ones, the device exposes `0x0104` (notify, classifier service), `0x0602` (indicate, IMU service) and `0x2A29` (read, manufacturer name). Galvani doesn't use them, and none is known to report charging.
- **Orientation:** the quaternion maps the band's axes to a world whose Z axis is vertical and whose heading is arbitrary. It changes between sessions, so movement has to be measured relative to a reference posture. The 3D view built on this follows a real arm correctly, as checked by the user.

Not tested with a real Myo: automatic reconnection after a real connection drop, and resetting the armband when quitting the app.

## UUIDs

Base UUID: `d506XXXX-a904-deb9-4748-2c7f4a124842`, where `XXXX` is the short ID.

| Service | Characteristic | ID | Access | Content |
|---|---|---|---|---|
| Control (`0x0001`) | MyoInfo | `0x0101` | read | 20 bytes, see below |
| Control | FirmwareVersion | `0x0201` | read | major, minor, patch, hardware revision (4 × `u16`) |
| Control | Command | `0x0401` | write | Commands, see below |
| IMU (`0x0002`) | IMUData | `0x0402` | notify | Orientation, accelerometer, gyroscope (10 × `i16`) |
| IMU | MotionEvent | `0x0502` | indicate | Type, tap direction, tap count |
| Classifier (`0x0003`) | ClassifierEvent | `0x0103` | indicate | Type and event data |
| EMG (`0x0005`) | EmgData0–3 | `0x0105`, `0x0205`, `0x0305`, `0x0405` | notify | 2 samples × 8 channels (`i8`) |
| Battery (`0x180F`, standard) | Battery Level | `0x2A19` | read, notify | Percentage |
| GAP (standard) | Device Name | `0x2A00` | read, write | Name |

## Layouts

**MyoInfo (20 bytes):** serial number (6), unlock pose (`u16`), active classifier type, active classifier index, has custom classifier, stream indicating, SKU, reserved (7).

**IMU scales:** orientation ÷ 16384 (unit quaternion), accelerometer ÷ 2048 (g), gyroscope ÷ 16 (°/s).

**Poses:** rest `0`, fist `1`, wave in `2`, wave out `3`, fingers spread `4`, double tap `5`, unknown `0xFFFF`.

**Classifier events:** arm synced `1` (arm, X direction), arm unsynced `2`, pose `3` (`u16`), unlocked `4`, locked `5`, sync failed `6` (result).

## Commands

Each command is `command, payload_size, payload…`.

| Command | ID | Payload |
|---|---|---|
| Set mode | `0x01` | EMG (`0` none, `2` filtered, `3` raw), IMU (`0` none, `1` data, `2` events, `3` all, `4` raw), classifier (`0` off, `1` on) |
| Vibrate | `0x03` | `0` none, `1` short, `2` medium, `3` long |
| Deep sleep | `0x04` | None |
| Vibrate2 | `0x07` | 6 steps of duration in ms (`u16`) and strength (`u8`); unused steps are zero |
| Set sleep mode | `0x09` | `0` normal, `1` never sleep |
| Unlock | `0x0A` | `0` lock, `1` timed, `2` hold |
| User action | `0x0B` | `0` single |

## Battery

The documented battery service exposes only the level. Neither `myohw.h` nor pyomyo has any charging state, so Galvani estimates charging from the level rising by at least 2 points, read every minute. This can't detect charging at a full battery. Connections log all of the device's characteristics at debug level, in case an undocumented one reports it.

## Decisions where the sources disagree

| Topic | `myohw.h` | pyomyo | Decision |
|---|---|---|---|
| Byte order | Says all values are big-endian | Reads everything as little-endian | **Little-endian**, confirmed with a real Myo |
| `ClassifierEvent` size | 3 bytes | Reads 6 bytes | Require at least 3 bytes and ignore the rest |
| Warm-up classifier event | Absent | Absent | Not implemented; unknown types are kept as `Unknown` |
| Firmware 1.5.1970 | Absent | Absent | `LATEST_KNOWN_FIRMWARE` constant, with an unverified origin |

## EMG rate

`myohw.h` sets the streaming rate at 200 Hz, and each notification carries 2 samples. That means 100 notifications per second across the 4 characteristics, or 25 Hz per characteristic on average. `MockMyo` follows this.

The original brief estimated "4 characteristics × 2 samples × 50 Hz = 200 Hz", but that product is 400. Real measurements match the 25 Hz figure.

## Undocumented behavior (pyomyo only)

Both are planned as experimental features in phase 6:

- **LEDs:** command `0x06` with 6 bytes, logo RGB followed by line RGB.
- **Preprocessed EMG mode:** EMG mode `0x01`, 50 Hz, delivered on a different attribute as 8 × `u16` plus a mask byte.

## macOS limitations

- CoreBluetooth doesn't expose the MAC address, and `btleplug` returns an empty one. Use the peripheral ID instead.
- `NSBluetoothAlwaysUsageDescription` is required in `Info.plist`.
- Apple restricts access to the GAP service, so renaming the armband probably won't work. To be confirmed in phase 2.
- Apps can't choose connection parameters freely, so sustaining 200 Hz is the main technical risk.
