# Claude Buddy

A floating 3D desktop widget that shows what Claude Code is doing, and can light up a Bluetooth LED strip when Claude needs you.

| State | Widget | LED strip (default) |
|---|---|---|
| `idle` | slow float, green ring | don't change |
| `working` | fast blue ring, orbiting dots | off |
| `needs_input` | yellow mascot bounces, red ring, whistle | 🚨 police lights |
| `done` | happy bounce, green ring; back to idle after 8s | off |

The mascot also cracks jokes in a speech bubble, and sometimes wears sunglasses when a task is done. Change the lines in the `QUIPS` list in `src/renderer/widget/renderer.js`; `{name}` is replaced with your name from Settings.

## Install and run

```sh
npm install
npm start                # foreground
npm run launch-buddy     # background
```

Needs Node 18+ and `curl`. Only one copy runs at a time.

- **Drag** the mascot to move it.
- **⚙** next to the label opens Settings. Its dot shows the LED strip connection: green means connected, yellow connecting, red error.
- **Right-click the label** for *Always on top*, *Sound*, *Settings…* and *Quit*.

## Settings

Open them with **⚙** or right-click → **Settings…**. Changes save immediately.

- **General:** your name, which the mascot uses in its speech bubbles (defaults to your account name).
- **Sounds:** turn sounds on or off and set the volume. Choose a sound for *Needs you*, *Done* and *Working* from Wolf whistle, Police siren, Doorbell, Chime, Beep-beep, Success, Ta-da, Pop and Click, each with a ▶ preview. The *Needs you* sound can repeat every 30 seconds.

- **LED lights:** turn LED lights on or off entirely, and choose whether to connect automatically when Buddy starts. The manual controls are here too: Connect, ON/OFF, colour and brightness.
- **Device:** **Detect devices** scans for compatible controllers. Choose which one to use, or *Forget* it so Buddy uses any compatible controller.
- **When to light:** pick a pattern for each state: *Don't change*, *Off*, *Solid colour*, *Pulse*, *Blink* or *Police lights*. Each has a colour and a ▶ 5-second preview.
  - After you accept a request, Claude goes back to **Working**. Set that to *Off* to turn the strip off, or to *Solid colour* to keep a steady light.

## Supported LEDs

**BJ_LED_M** Bluetooth LE RGB strip controllers (the bojiaLED phone app) are supported. Tested on a 2025 unit with firmware `BJP10Y68CV19`. Other controller families, such as ELK-BLEDOM or Triones, use different protocols and won't work.

The controller accepts **one connection at a time**, so close the phone app before connecting from Buddy.

See [docs/HARDWARE.md](docs/HARDWARE.md) for the Bluetooth layout, the verified commands and how to check your own controller:

```sh
npm run led:probe                        # find it and list its services (sends nothing)
npm run led:probe -- --send off,on,red   # send test commands
```

## Claude Code hooks

Hooks in `~/.claude/settings.json` post the state to `http://127.0.0.1:7788/<state>`:

| Event | State |
|---|---|
| `SessionStart` | `idle` |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | `working` |
| `PermissionRequest`, `Notification` (permission / input prompts) | `needs_input` |
| `Stop` | `done` |

```sh
node scripts/merge-hooks.js --dry-run   # preview the change
node scripts/merge-hooks.js             # back up settings.json, then merge
node scripts/merge-hooks.js --remove    # uninstall (removes only these hooks)
```

The merge script never touches your other settings. To have a session start the widget automatically, merge `hooks/claude-settings-hooks.autostart.json` instead.

Test the states by hand:

```sh
curl -X POST http://127.0.0.1:7788/needs_input
curl -X POST http://127.0.0.1:7788/idle
```

The server listens on `127.0.0.1` only. Unknown paths return 404.

## Change the port

Set the port for both the widget and Claude Code:

```sh
CLAUDE_BUDDY_PORT=7799 npm start
```

```json
{ "env": { "CLAUDE_BUDDY_PORT": "7799" } }
```

The JSON goes in `~/.claude/settings.json`.

## Project layout

```
src/main/            main process: windows, state server, settings, lighting rules
src/main/led/        LED strip: protocol, BLE transport, controller, patterns
src/preload/         context bridges for the widget and settings windows
src/renderer/        widget (mascot + 💡 panel) and settings pages
scripts/             launcher, hook installer, LED probe
hooks/               Claude Code hook definitions
docs/                hardware notes
test/                npm test (no hardware needed)
```

## Development

```sh
npm test
```

The tests cover the LED protocol, transport, controller, patterns, settings and lighting rules against a simulated device.
