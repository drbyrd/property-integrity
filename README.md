# Property Integrity

Property Integrity is an Obsidian plugin release candidate for two bounded jobs:

- Recalculate explicitly configured numeric properties with exact decimal arithmetic.
- Support filtered related sums of either one stored amount or the exact difference between two configured amounts.
- Maintain explicitly configured reciprocal relationships between note properties.

The plugin is local-only, configuration-driven, and fail-closed. It does not discover schemas, synchronize with a remote service, replace Obsidian Bases, or infer relationship rules from note content.

This directory is a local release candidate authored by Machi Systems and licensed under MIT. The first release is intentionally desktop-only because mobile runtime behavior has not been validated. Publication remains blocked until the owner approves the exact repository and release destination.

Many-to-many rules may set `leftSerialization` to `quoted-wiki-link-list` when a property name requires a byte-preserving quoted YAML key. The option is generic and disabled by default.

## Privacy and network behavior

Property Integrity reads and writes only the vault paths and properties declared in its local configuration. It has no telemetry, remote synchronization, account integration, or network requests. Rules are disabled by default, previews do not write, and repeated identical failures pause only the affected rule.

## Compatibility

- Obsidian `1.4.4` or newer.
- Desktop only for the first release.
- Plain Markdown properties and links remain canonical; disabling or removing the plugin does not make notes unreadable.
- The plugin does not replace Bases or Dataview. It maintains only explicitly declared reusable properties and reciprocal links.

## Numeric rule shapes

`related-sum` adds one configured numeric property across related source notes. `related-difference-sum` subtracts a configured negative property from a configured positive property on each source note before summing. Both rule shapes accept `equals` and `not-equals` filters, use exact decimal arithmetic internally, and may write separate numeric, raw, and rounded display properties.

## Relationship rule shapes

`single-to-many` maintains one optional link on a member note and the reciprocal member list on owner notes. `many-to-many` maintains reciprocal link lists between two declared folders without inferring a cardinality limit. Both modes preserve plain wiki links, accept edits from either endpoint, reject out-of-scope or duplicate links, fail closed on conflicting simultaneous edits, and retain the existing preview, journal, undo, and three-identical-failure circuit breaker.

## Minimal configuration

The plugin stores its local configuration in `.obsidian/plugins/property-integrity/data.json`. Start with the plugin and every rule disabled. This generic example maintains an exact total from completed entries and a reciprocal item-to-group relationship:

```json
{
  "settings": {
    "schemaVersion": 1,
    "enabled": false,
    "numericRules": [
      {
        "id": "completed-entry-total",
        "kind": "related-sum",
        "activation": "disabled",
        "targetFolder": "Records/Accounts",
        "sourceFolder": "Records/Entries",
        "relationProperty": "Account",
        "amountProperty": "Amount",
        "outputProperty": "Total",
        "rawProperty": "Total Exact",
        "displayProperty": "Total Display",
        "displayDecimals": 2,
        "filters": [
          { "property": "Status", "operator": "equals", "value": "Complete" }
        ]
      }
    ],
    "relationshipRules": [
      {
        "id": "item-group",
        "kind": "single-to-many",
        "activation": "disabled",
        "memberFolder": "Work/Items",
        "memberPaths": ["Work/Items/Item One"],
        "memberProperty": "Group",
        "ownerFolder": "Work/Groups",
        "ownerPaths": ["Work/Groups/Group One", "Work/Groups/Group Two"],
        "inverseProperty": "Items"
      }
    ],
    "journal": { "enabled": true, "maxEntries": 500 }
  },
  "journal": [],
  "acceptedStates": {},
  "undoStack": []
}
```

Folders and optional exact path allowlists must be vault-relative. A single-to-many rule without `memberPaths` or `ownerPaths` retains folder-wide behavior; when supplied, each allowlist must be non-empty, unique, and inside its matching folder. Property names are exact and case-sensitive. Numeric inputs must be finite decimal values, and relationship values must resolve to notes inside the declared scope.

## Safe activation workflow

1. Back up the vault and keep every rule `disabled` while editing configuration.
2. Set one rule to `preview`, enable the plugin globally, and run **Property Integrity: Preview configured rules**.
3. Review every proposed path and property. Preview mode never writes.
4. Set only the reviewed rule to `active`, then run **Property Integrity: Apply active rules**.
5. Use **Property Integrity: Undo last applied change set** if the result is not expected.

The plugin refuses stale preimages, conflicting simultaneous relationship edits, duplicate links, out-of-scope links, unsafe folders, duplicate rule IDs, and unsupported settings schemas. Three identical failures pause only the affected rule.
