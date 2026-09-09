# Native NBS Sync Now compatibility repair

## Verified cause

The model `MCP - test.rvt` contained only the eleven parameters provisioned by
`NbsProjectBridge`. In particular, `NBS Override` and `NBS Project Date` were absent.
The installed NBS 1.6.0.0 `GetNBSO` reads `NBS Override` and initializes its
`NBSOverwriteobj` from the `NBSOverride=` entry. `Sync Now.Execute` dereferences
that object immediately afterwards. With the field missing, the object remains
null. The native ribbon logs only the enclosing reflection invocation exception.

The Revit journal also reports minor API assembly-version differences. Those
warnings still occur with successful sync and were not the verified cause.
The separate public component-creation API HTTP 404 is not explained by this repair.

## Changes

- Provision the two missing official project parameters using the vendor GUIDs.
- Initialize the native settings format only as needed; preserve existing flags,
  timestamps, link mode and unknown options. Reject ambiguous/corrupt settings.
- Keep all three project/settings fields out of element snapshots and deny writes
  to them through the ordinary NBS element parameter sync operation.
- Enable group-instance variation for the five supported instance parameters.
- Report native-settings readiness and missing group-variation settings.
- Add a plugin-only installation option; do not replace NBS vendor DLLs.

The vendor definition file contains forty fields, including optional fields.
Adding all forty was not necessary to restore native sync; thirteen core fields
are now provisioned.

## Live verification

The open model was repaired in a single undoable transaction group. Its previous
saved RVT was copied to `artifacts/nbs-compatibility/MCP-test-before-repair.rvt`.
This disk backup does not include edits that were unsaved before the repair.
The missing native settings were recovered from the latest NBS settings instance
for project 10668, preserving Type and Instance (`NBSLinkType=0`).

Native Sync Now was posted through Revit's command dispatcher. The temporary
exception trace captured no NBS exceptions and was detached afterwards. The model
received `NBSSyncModelDate=2026-09-09 03:24:19`. The NBS API confirmed model 10154
in project 10668, last synced at 03:24:17, containing 50 Generic - 200mm walls and
20 other elements. The walls remain unlinked to building components; this does
not claim that .001-.050 classification assignments were created.

Reconnecting with the repaired bridge preserved the native settings byte-for-byte.
Live attempts to write each project setting through the element-sync operation
were rejected. Release R27 build, ten native-settings checks, and all nineteen
existing NBS tests passed. Build warnings concern existing obsolete WebRequest
usage/package metadata; the isolated tests also saw an unavailable NuGet audit feed.

## Persistent installation

Installed on 2026-09-09 at 03:38 local time after Revit was confirmed closed.
Both installed DLL/PDB hashes match the Release R27 build. Backup:
`artifacts/install-backup-20260909-033802-358/`.
The native NBS addin, server, tool schemas and command registry were preserved.
Fresh verification passed: Release R27 build, TypeScript typecheck, 19 NBS tests
and 10 native-settings checks. Native Sync Now was verified before shutdown;
the permanently installed assembly still needs a post-restart smoke test.

Save and close Revit, then run from the repository:

```powershell
./scripts/install-nbs-update.ps1 -PluginOnly
```

The installer backs up and verifies only the MCP plugin DLL/PDB and requires
Revit to be closed. The repaired model must have been saved to preserve its
parameter changes. If those edits were not saved before shutdown, use the updated
MCP Settings > NBS Nordic project connection to provision the missing fields again.
Reopening Revit loads the installed assembly.

Reference: https://support.nbsnordic.dk/article/119-der-opstar-en-fejl-nar-man-prover-at-synkronisere
