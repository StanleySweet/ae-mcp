# After Effects 26.5 hides its windows from Accessibility

Date: 2026-10-17
Area: `ae_dialogs` (`packages/server/src/dialogs.ts`)

## Finding

With Accessibility granted (`UI elements enabled` is true), System Events sees
`count of windows` = 0 for the process "After Effects", even while a modal dialog
blocks the bridge. Only the menu bar is exposed. So `ae_dialogs list` can never
find a dialog by its `AXDialog` subrole, and `dismiss` used to answer `none`.

Seen with the MOGRT export modal ("au moins un contrôleur de propriété"), which
froze every later bridge job until the user pressed Escape.

## Consequence

- `dismiss` falls back to a blind Escape when AE exposes no window
  (`escape-blind`). Escape closes the modal and does nothing harmful without one.
- "the bridge wrote no result" now tells the caller to try `ae_dialogs dismiss`.
- `list` stays empty on 26.5: a blocked bridge is the only signal of a dialog.
- Prevent modals at the source: check AE's preconditions in the bridge before
  calling an API that may answer with a dialog (as `mogrt.export` now does).
