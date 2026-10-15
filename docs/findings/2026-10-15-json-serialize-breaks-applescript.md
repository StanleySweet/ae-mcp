# Finding: `JsonSerializer.Serialize` breaks the AppleScript elevation

Date: 2026-10-15

## Symptom

The Setup app never prompted for an administrator password, so the After Effects
startup loader was never installed — the install "succeeded" with no loader. The
elevation call returned `false` with no visible error.

## Cause

`InstallLoader.OsascriptElevatedWriteAsync` built the elevation command with
`System.Text.Json.JsonSerializer.Serialize(shellCommand)` to produce the
AppleScript string literal:

```csharp
var script = $"do shell script {JsonSerializer.Serialize(shellCommand)} with administrator privileges";
```

`JsonSerializer`'s **default encoder is HTML-safe**: it escapes `'`, `&`, `<`,
`>` to `\u0027`, `\u0026`, `\u003c`, `\u003e`. AppleScript string literals have
**no** `\uXXXX` escape, so osascript received a literal `\u0027` and failed:

```
syntax error: « " » prévu(s) mais jeton inconnu trouvé(s). (-2741)
```

osascript exits non-zero **before** the authorization prompt, so no prompt,
no loader, no error surfaced (`Shell.SucceedsAsync` → `false`).

The same command built by hand with Node's `JSON.stringify` worked, because
`JSON.stringify` does not HTML-escape — which is why the manual install
succeeded and hid the bug.

## Fix

Build the AppleScript literal with real AppleScript escaping instead of JSON:

```csharp
public static string QuoteAppleScript(string value)
    => $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";
```

`InstallLoader.ElevationScript(shellCommand)` wraps `QuoteAppleScript` with the
`do shell script … with administrator privileges` frame. Regression tests pin the
exact output and assert it contains no `\u00`.

## Scope / related traps

- `BridgeCall` also uses `JsonSerializer.Serialize`, but safely: one call writes a
  **JSON file** (any valid JSON, escapes and all) and the other builds a **JS**
  string literal, where `\uXXXX` is a valid JS escape. Do not "fix" those.
- General rule: **never** use `JsonSerializer.Serialize` (or any HTML-safe JSON
  encoder) to build a source literal for a language that has no `\uXXXX` escape —
  AppleScript, shell, etc.

## Verification

- Probe: the fixed script no longer errors; osascript waits for the prompt.
- `InstallLoaderTests`: `ElevationScriptLeavesShellQuotesAndAmpersandsIntact`,
  `QuoteAppleScriptEscapesBackslashesAndDoubleQuotes`.
