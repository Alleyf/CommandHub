# Command Hub

Command Hub is a cross-platform desktop app for managing long-running CLI commands from one modern UI.

Typical examples:

- `openclaw gateway start`
- `npm run dev`
- `python server.py`
- any local daemon-like command that normally lives in a terminal tab

## Stack

- `Electron` for the desktop shell and process lifecycle
- `React` for the interface
- `Vite` for the renderer build

## Features

- silent background start, with hidden shell window on Windows
- unified command configuration: executable, args, working directory, env vars
- start, stop, restart and delete
- runtime status with PID and uptime
- persistent logs
- local JSON config storage
- cross-platform support for Windows, macOS and Linux

## Development

Install dependencies:

```powershell
npm install
```

Run the Electron app in development:

```powershell
npm run start
```

Build the renderer:

```powershell
npm run build
```

## Storage

Command Hub stores config and logs inside Electron's user data directory, in a `command-hub` folder.

## Command Fields

- `Executable`: the command to run, for example `openclaw`
- `Arguments`: extra args, for example `gateway start`
- `Working Directory`: optional working dir
- `Environment Variables`: one `KEY=VALUE` per line
- `Auto Restart`: restart after unexpected exit
