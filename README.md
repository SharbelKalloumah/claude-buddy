# Claude Buddy

A floating 3D desktop widget that shows what Claude Code is doing, and can light up a Bluetooth LED strip when Claude needs you.

| State | Widget | LED strip (default) |
|---|---|---|
| `idle` | slow float, green ring | don't change |
| `working` | fast blue ring, orbiting dots | off |
| `needs_input` | yellow mascot bounces, red ring, whistle | 🚨 police lights |
| `done` | happy bounce, green ring; back to idle after 8s | off |

The mascot is a rigged voxel character with soft rounded blocks: a big head on a flexible neck, eyebrows, eye glints, cheek blush, a springy antenna that wobbles with every move, oversized hands and short legs, with squash & stretch plus dust puffs on every landing. He has 10 poses (casual, confident, curious, thinking, excited, confused, sleepy, proud, surprised) and signature moves (head bob, lean, peek, shrug, bounce, hop, spin, look back, stretch, wiggle, side step, freeze, yawn, wave). While idle he runs little routines in one of five moods (calm, playful, curious, confident, sleepy), which changes every few minutes. The ring around him is a status halo: it glows, a bright pulse sweeps around it, tick marks show the spin, comet dots with trails ride it while Claude works, sparkles burst when a task finishes, and it tips and ripples with his movement. The code is in `src/renderer/widget/mascot/`.

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

## Talk to him

Click the mascot to start talking, hold him for push-to-talk, or press **⌃⌥Space** from anywhere. What you say is transcribed on your Mac and pasted straight into the Claude Code prompt, ready for you to review and hit Enter.

First-time setup on macOS:

1. **Dictation on** — System Settings → Keyboard → Dictation. Apple's offline speech models only load when this is on.
2. **Microphone + Accessibility** — open Settings → Voice → **Grant access**. Accessibility is what lets Buddy paste into your terminal.

Nothing leaves your Mac: `native/stt.swift` uses Apple's on-device recogniser, built by `npm run build:native` (needs Xcode Command Line Tools). Drag the widget by holding and moving the mouse anywhere on it.

## Settings

Open them with **⚙** or right-click → **Settings…**. Changes save immediately.

- **General:** your name, which the mascot uses in its speech bubbles (defaults to your account name).
- **Voice:** turn talking on or off, set the shortcut and language, choose whether Buddy presses Enter for you, and grant the macOS permissions.
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
native/              macOS on-device speech helper (Swift)
hooks/               Claude Code hook definitions
docs/                hardware notes
test/                npm test (no hardware needed)
```

## Development

```sh
npm test
```

The tests cover the LED protocol, transport, controller, patterns, settings and lighting rules against a simulated device.
