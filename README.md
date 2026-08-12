# PhantomBot Control (Stream Deck)

Control **PhantomBot** from your Elgato Stream Deck. The plugin talks to your bot over PhantomBot's **authenticated HTTP panel API**. You can **run chat commands** from keys (one command per key); the codebase is structured so more actions can be added later.

> **Not official PhantomBot software.** This project is independent: it is not affiliated with, endorsed by, or supported by the [PhantomBot](https://github.com/PhantomBot/PhantomBot) project. Author: **McAwful**.

**Contents:** [What you get](#what-you-get) · [For Stream Deck users](#for-stream-deck-users) · [For developers](#for-developers) · [Security and privacy](#security-and-privacy) · [Links](#links) · [License](#license)

---

## What you get

- **Per-key command** — Each key stores its own command text. The plugin adds a leading `!` if you omit it (PhantomBot treats `!` as a chat command).
- **Shared bot settings** — Bot URL, panel **webauth** token, and bot Twitch username are saved once as **plugin global settings** (shared by every key).
- **Connection test** — From the property inspector, **Test** checks URL and token before you rely on keys.
- **TLS options** — Optional **Don't verify HTTPS certificates** for self-signed or broken chains, with in-app warnings. Plain `http://` is supported with its own warning (often fine on a trusted local network).
- **Key title** — The label on the device is whatever you set in Stream Deck's **Title** field; it is not copied from the command text.

---

## For Stream Deck users

### What you need

- **Stream Deck** app **6.9** or newer (see `com.mcawful.pbstreamdeck.sdPlugin/manifest.json` → `Software.MinimumVersion`).
- **Node.js 20** on your PC — Stream Deck runs this plugin with the embedded Node runtime version declared in the manifest (`Nodejs.Version`).
- **PhantomBot** reachable over HTTP/HTTPS, with a valid panel **webauth** token (often from `botlogin.txt` or your panel setup, depending on how you run PhantomBot).

### Get the plugin (Marketplace)

**Recommended:** install **PhantomBot Control** from the **Elgato Marketplace** (the same catalog the Stream Deck app uses).

1. Open the **Stream Deck** app and go to the **Stream Deck Store** (or **Marketplace** / plugin store, depending on your app version).
2. Search for **PhantomBot Control** and choose **Install**.

You can also browse plugins on the [Elgato Marketplace](https://marketplace.elgato.com/stream-deck/plugins) in a web browser; after you install from there, Stream Deck picks up the plugin like any other store install.

Updates appear through the store like other Marketplace plugins.

### Install locally (optional)

Use this path if you prefer a file from GitHub, need a specific build, or are testing a change that is not on the store yet.

**Packaged file** (for example a `.streamDeckPlugin` from [Releases](https://github.com/mcawful/pb-streamdeck-plugin/releases)):

1. Quit Stream Deck if the installer suggests it.
2. Double-click the `.streamDeckPlugin` file so Stream Deck registers it.
3. Restart Stream Deck if the plugin does not show up.

**From this repository (advanced):** build the bundle first ([Build from source](#build-from-source)), then register `com.mcawful.pbstreamdeck.sdPlugin` with Stream Deck (for example **`streamdeck link`** from [@elgato/cli](https://www.npmjs.com/package/@elgato/cli), or by copying the folder into Stream Deck's plugins directory for your OS).

After a **local** install or manual upgrade, restart Stream Deck or run:

```bash
streamdeck restart com.mcawful.pbstreamdeck
```

### First-time setup (bot connection)

You usually configure the bot **once** for the whole plugin. Change it only if your URL, token, or bot username changes.

1. Add the **Run Command** action from the **PhantomBot Control** category.
2. Select the key and open the **property inspector** (right-hand panel in Stream Deck).
3. Expand **Bot connection configuration**.
4. Set:
    - **Bot URL** — Base URL of PhantomBot's HTTP endpoint (with `http://` or `https://`). A trailing slash is optional.
    - **Bot webauth token** — Sent as the `webauth` header (panel token).
    - **Bot Twitch username** — Sent as the `user` header (who PhantomBot treats as sending the command for permission checks).
5. Click **Test**. You should see a success message if URL and token are correct.
6. If you use **HTTPS** and it fails only because of certificate trust (self-signed, local CA, etc.), you may enable **Don't verify HTTPS certificates** after reading the warning. Prefer fixing the certificate when you can.
7. If you use **`http://`**, read the in-app warning: traffic is not encrypted; that is often acceptable on a **trusted local network** only.

### Command field

Under **Command**, enter the chat command **with or without** `!` (for example `commercial 30` or `!commercial 30`). Set the key **Title** in Stream Deck to whatever you want shown on the hardware.

### Troubleshooting (users)

- **Alert on key press** — Often missing global settings (URL, token, username), empty command, or PhantomBot returned an error. Check Stream Deck **plugin logs** if needed (Stream Deck → plugin / diagnostics depending on version).
- **Test never completes** — Firewall, wrong URL, or PhantomBot not running. Confirm the URL opens from a browser on the same machine when appropriate.
- **HTTPS works in browser but not in plugin** — Certificate trust issue; try the verify option only if you understand the risk, or use `http://` on a trusted LAN.

---

## For developers

### Repository layout

```
com.mcawful.pbstreamdeck.sdPlugin/   # Shipped plugin bundle (manifest, locale, UI, icons, Rollup output)
  manifest.json                      # Plugin metadata, actions, Stream Deck / Node version requirements
  en.json                              # English strings (store / UI)
  bin/plugin.js                        # Produced by `npm run build` (do not edit by hand)
  ui/phantomControl.html               # Property inspector (HTML + inline script)
  imgs/plugin/                         # Marketplace, category, and action imagery
src/                                   # TypeScript source (compiled into bin/plugin.js)
  plugin.ts                            # Entry: register actions; inspector → plugin (e.g. connection test)
  actions/runCommand.ts                # Run Command action: keyDown → PhantomBot HTTP
  settings.ts                          # Global vs per-action settings types
  lib/phantomBot.ts                    # Undici: PUT /dbquery; HEAD /dbquery connection test (405 = OK)
  lib/toBool.ts                        # Boolean coercion for persisted settings
  lib/streamDeckConnection.ts          # sendToPropertyInspector with explicit action context
```

### Build from source

```bash
npm install
npm run build
```

Output: `com.mcawful.pbstreamdeck.sdPlugin/bin/plugin.js`.

During development:

```bash
npm run watch
```

This rebuilds on change and runs `streamdeck restart com.mcawful.pbstreamdeck` when the Rollup watch cycle ends (requires Elgato CLI on your `PATH`).

### Scripts

| Command                | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `npm run build`        | Production Rollup bundle into `com.mcawful.pbstreamdeck.sdPlugin/bin/`                  |
| `npm run watch`        | Watch mode + restart plugin (see note above)                                            |
| `npm run typecheck`    | `tsc --noEmit`                                                                          |
| `npm run format`       | `prettier --write .` (respects `.prettierignore`)                                       |
| `npm run format:check` | `prettier --check .` — useful in CI                                                     |
| `npm run validate`     | `streamdeck validate com.mcawful.pbstreamdeck.sdPlugin` (requires Elgato CLI on `PATH`) |
| `npm run pack`         | `npm run build` then `streamdeck pack …` → `com.mcawful.pbstreamdeck.streamDeckPlugin`  |

Elgato CLI: [validate](https://docs.elgato.com/streamdeck/cli/commands/validate), [pack](https://docs.elgato.com/streamdeck/cli/commands/pack).

### How it talks to PhantomBot (technical)

On **key press**, the plugin sends an authenticated **`PUT`** to `{baseUrl}/dbquery` with headers `user`, `message`, and `webauth`. The `message` body is normalized so chat commands start with `!`.

The **connection test** first sends an authenticated **`HEAD`** to `{baseUrl}/dbquery`. PhantomBot 3.7+ responds with **405 Method Not Allowed** when auth succeeds (non-GET methods are rejected after authentication), and the plugin treats that as success. For older PhantomBot versions, the plugin falls back to authenticated **`GET`** `{baseUrl}/dbquery?table=modules&tableExists` and treats **200** as success. Timeouts and errors are surfaced in the property inspector.

HTTP is implemented with [Undici](https://github.com/nodejs/undici). Optional `rejectUnauthorized: false` is applied only when the user enables insecure HTTPS and the URL scheme is `https:`.

For PhantomBot server behavior, refer to upstream source (for example `HTTPAuthenticatedHandler` and related HTTP handlers in the PhantomBot repo).

### Property inspector

The UI loads [sdpi-components](https://sdpi-components.dev/) from the CDN declared in `phantomControl.html`. Global settings and per-key settings are read/written through the Stream Deck client APIs in that script.

### Node.js debugging (manifest)

Released builds use **`Nodejs.Debug`: `disabled`** in `manifest.json` (better for end users). For local debugging you may temporarily set it to **`enabled`** so you can attach a debugger to the plugin process; revert before shipping a release build.

### Stack

- [Elgato `@elgato/streamdeck`](https://www.npmjs.com/package/@elgato/streamdeck) SDK (TypeScript)
- [Rollup](https://rollupjs.org/) for bundling
- [Undici](https://github.com/nodejs/undici) for HTTP

---

## Security and privacy

- **Webauth and URL** are stored in Stream Deck **global plugin settings** (like other plugins). Treat the machine account and Stream Deck backups accordingly.
- **`http://`** sends tokens and commands in **cleartext** on the network segment between Stream Deck's host and PhantomBot.
- **Disable certificate verification** for HTTPS weakens TLS and is intended only for controlled environments; the UI explains the tradeoff.

---

## Links

- **This repo:** [github.com/mcawful/pb-streamdeck-plugin](https://github.com/mcawful/pb-streamdeck-plugin) — [Issues](https://github.com/mcawful/pb-streamdeck-plugin/issues)
- **Install from Marketplace:** [marketplace.elgato.com/stream-deck/plugins](https://marketplace.elgato.com/stream-deck/plugins) (search for **PhantomBot Control**)
- **PhantomBot (upstream):** [github.com/PhantomBot/PhantomBot](https://github.com/PhantomBot/PhantomBot)

---

## License

[MIT](LICENSE) — Copyright (c) 2026 McAwful
