# Finding: the osascript job file raced the startup loader

Date: 2026-10-14
Area: transport (`packages/server/src/osascript-transport.ts`)
Issue: #159

## What happens

The bridge exposes two transports (ADR 0001): **A** the startup loader, a script
in `Scripts/Startup` that polls `~/.ae-mcp/bridge/inbox` on a timer, and **B**
osascript, which writes a job file and runs a `DoScriptFile` trigger that loads
the payload and calls `AEMCP.processJob(jobFile)`.

The loader is installed unconditionally and keeps polling `inbox/` whether or not
the server has selected transport B. Transport B used to write its job to the
same `inbox/<id>.json` the loader watches, so both raced for the file: when the
loader won, it processed the job and deleted the file before the trigger read
it, and the trigger then wrote `INVALID_MESSAGE "job is not valid JSON"` (the
job file was gone, `aemcpReadFile` returned null). Whichever transport wrote the
outbox result last, the server read.

## Evidence

Reproduced on Mac 1 (AE 2026, fr_FR) while the startup loader was installed:

- 30 sequential `ae_comp_info` calls over the MCP server: **21/30** returned
  `INVALID_MESSAGE "job is not valid JSON"`.
- Dropping a hand-written job into `inbox/` with no MCP call produced a result
  file in `outbox/` within ~2 s — proving the loader consumes `inbox/` on its own.

## Fix

Write transport B's job file to `bridge/jobs/<id>.json` (next to its trigger),
which the loader never polls. After the fix the same 30 sequential calls returned
**30/30 ok, 0 invalid**.

## Trap to remember

Any new queue file that the server writes must not land in `inbox/` while the
loader is installed. `inbox/` belongs to transport A alone.
