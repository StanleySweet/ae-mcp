# Finding: AE's prefs file is localized *and* NFD-decomposed

Date: 2026-10-15
Area: `apps/installer/AeMcpSetup.Core/ScriptingPref.cs` (also the former
`packages/core/src/scripting-pref.ts`)

## Symptom

The Setup **scripting permission** row never cleared on a French After Effects:
it kept reporting *"Open After Effects once so it writes its preferences, then run
Setup again."* — even after AE had run once and was quit. The row alternated
between that message and the *"Quit After Effects, then Retry"* prompt, so it
looked like a permission problem. It is not.

## Cause

`FindPrefsFile` matched the main prefs file by `name.endsWith("Prefs.txt")`. On a
localized AE the file is not named that:

- **English:** `Adobe After Effects 26.5 Prefs.txt`
- **French:** `Adobe After Effects 26.5 Préfs.txt` (with `é`)

Two independent traps stack:

1. **Localized name.** AE names the file after the UI language, so `Prefs.txt`
   is English-only.
2. **NFD on macOS.** macOS returns filenames in decomposed Unicode (NFD): the
   `é` is stored as `e` + U+0301. A literal `"Préfs.txt"` in source is NFC
   (U+00E9) and does **not** match the NFD string. Verified on this Mac:

   ```
   'Adobe After Effects 26.5 Préfs.txt'   NFC? False
     endswith ascii 'Prefs.txt'      → False
     endswith NFC  'Préfs.txt'       → False   (U+00E9)
     endswith NFD  'Pre\u0301fs.txt' → True
   ```

So the ASCII check returned `null` → the "open AE once" row. The TS original had
the identical bug (`.endsWith('Prefs.txt')`), i.e. it was never exercised on a
non-English install.

The prefs file itself is `-rw-r--r-- <user> staff` in the user's home — **fully
writable, no elevation involved.**

## Fix

Compare on the NFC-normalized filename and accept both names:

```csharp
var name = Path.GetFileName(path).Normalize(NormalizationForm.FormC);
return name.EndsWith("Prefs.txt", StringComparison.Ordinal)
    || name.EndsWith("Pr\u00e9fs.txt", StringComparison.Ordinal);  // é as U+00E9, fixed
```

`Prefs-*.txt` siblings (`Prefs-effects.txt`, `Prefs-text.txt`, …) still do not
match, so the main file is unambiguous. Regression tests write the NFD name
(`"… Pre\u0301fs.txt"`) and assert it is found, and that the variants are not.

## Takeaway

Any other code that looks up an AE file by an English literal name has the same
latent bug on a localized install. Grep for hard-coded `Prefs.txt`/English AE
filenames before trusting them.
