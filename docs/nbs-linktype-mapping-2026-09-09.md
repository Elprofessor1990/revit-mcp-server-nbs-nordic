# NBSLinkType mapping (verified 2026-09-09)

The official NBS Nordic Revit addin (1.6.0, Revit 2027) stores its Link Type as a
number in the project parameter `NBS Override`, key `NBSLinkType`. The number is
not documented. It was established live and is now used as a fallback.

| Code | Addin dialog label | Our link mode      |
|------|--------------------|--------------------|
| 0    | Type and Instance  | `typeAndInstance`  |
| 1    | Type Only          | `typeOnly`         |
| 2    | Instance Only      | `instanceOnly`     |

## Evidence

- Revit's journal logs the addin's WinForms dialog. Selecting the combobox item
  `cB_LinkType.SelectItem(0, Type and Instance)` followed by OK ran the addin's
  transaction "Set NBS Nordic Overridde" and left `NBSLinkType=0` in the model.
- Selecting `cB_LinkType.SelectItem(1, Type Only)` followed by OK left
  `NBSLinkType=1`.
- The addin's resource strings list the combobox items in the order
  "Type and Instance", "Type Only", "Instance Only", so index 2 is Instance Only.
  Code 2 has not been observed live.
- The addin writes the value on Save (OK) in its Settings dialog. Sync Now does
  not change it.

## Where it is used

- `plugin/Core/NbsNativeSettings.cs` `LinkTypeCodes` / `DecodeLinkType`: the
  plugin reports `nativeLinkMode` next to the raw `nativeLinkType`, and the
  Settings page shows the decoded label.
- `server/src/integrations/nbs/ModelSettings.ts` `decodeNativeLinkType` /
  `resolveLinkMode`: `sync_revit_types_to_nbs` resolves the link mode as
  explicit argument → saved per-model choice → addin Link Type → error.
  `linkModeSource` in the sync summary reports which one applied.
- Unknown codes are never turned into a mode.

The value seeded when the addin has never configured a model remains
`NBSLinkType=1` (Type Only). The addin's own default for a fresh model has not
been verified.
