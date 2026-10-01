# Supported LED hardware

Claude Buddy drives a **BJ_LED_M** Bluetooth LE RGB LED strip controller, the kind controlled by the **bojiaLED** phone app. It's the small inline box on the strip's cable.

## Tested device

| | |
|---|---|
| Advertised name | `BJ_LED_M` |
| Batch | 2025 |
| Firmware string (read from EE01/EE02) | `BJP10Y68CV19` |
| Host | macOS (CoreBluetooth, via [`@abandonware/noble`](https://github.com/abandonware/noble)) |

## Bluetooth layout

| UUID | Properties | Used for |
|---|---|---|
| Service `0xEEA0` | | |
| `0xEE02` | read, write, write without response | **commands** (acknowledged writes) |
| `0xEE01` | read, notify, write without response | notifications (sends `12 13 14` after connecting; meaning unknown) |

## Commands

| Command | Bytes | Status |
|---|---|---|
| Power off | `69 96 02 01 00` | ✅ verified |
| Colour | `69 96 05 02 RR GG BB` | ✅ verified |
| Power on | `69 96 02 01 01` | works in practice |
| Brightness | none; the app scales the RGB values | n/a |
| Built-in effect | `69 96 03 03 <00–15> <speed 0–10>` | ⚠️ untested |

The packets match the open-source [BlueLights](https://pypi.org/project/BlueLights/) and [bj_led](https://github.com/8none1/bj_led) projects. Unlike bj_led, which writes to `EE01`, this controller responds to `EE02`.

## Good to know

- **One connection at a time.** While Buddy is connected, the phone app can't connect, and the other way round. Use **Disconnect** in Buddy before using the phone app.
- **macOS hides MAC addresses.** Devices are identified by a CoreBluetooth UUID that stays the same on one Mac.
- **Other controllers** use different protocols and are **not supported**, for example ELK-BLEDOM, Triones, or Magic Home BLE.

## Check your controller

```sh
npm run led:probe                        # find it and list its services (sends nothing)
npm run led:probe -- --send off,on,red   # send a few test commands
```

If yours shows service `EEA0` with `EE01`/`EE02` and responds to `--send off`, it should work. If it uses other bytes, add them in `src/main/led/protocol.ts`; everything device-specific is in that file.
