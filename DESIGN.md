# Astir: Signal

Signal is the owner's selected direction from the [original five studies](docs/design-exploration/README.md). It is a working daily list, not a dashboard: the day, actual remaining work and checkboxes are the visual center. D22 in the [spec](docs/specs/2026-11-16-astir-v1.md) records the selection; D46 records the implementation defaults for appearance.

## Identity and type

The stepped mark suggests getting up and moving. `src/ui/Brand.tsx` shares it across loading, sign-in, browser handoff and the signed-in UI. The stable yellow-and-ink app icon and favicon use the same silhouette. `src-tauri/app-icon.svg` owns the native icon source; regenerate the existing desktop assets with `npx tauri icon src-tauri/app-icon.svg`.

Archivo is the single family: sturdy, open text for tasks and its heavier weights for Signal's sign-like headings. It is bundled as a variable WOFF2, not requested from a font service. Its SIL OFL ships at `public/licenses/Archivo-OFL.txt`. The scale is 16 / 20 / 28 / 48 / 96px, with the Today heading adapting between 48 and 72px in a narrow window. Text stays at least 16px. Numeric progress and counts use tabular figures.

## Palettes

All colors live in `src/appearance/themes.css`. Avoid hard-coded product colors in individual components.

| Theme | Mode | Background | Text | Progress surface | Action accent |
| --- | --- | --- | --- | --- | --- |
| Signal | Light | `#ffffff` | `#20251f` | `#f4d447` | `#20251f` |
| Blueprint | Light | `#ffffff` | `#1e3248` | `#c7ddf8` | `#214f85` |
| Fern | Light | `#fbfdf9` | `#233e2d` | `#d6e3b8` | `#28513b` |
| Midnight | Dark | `#172832` | `#edf4f3` | `#284953` | `#a5d8d2` |
| Carbon | Dark | `#242522` | `#f2f1e8` | `#494128` | `#edcf80` |

The `astir-theme` preference is per device, outside account sync. The small HTML-head entry applies it before React renders. An unset or invalid preference follows the OS (Signal / Midnight); selecting any palette explicitly pins it. Other tabs and the quick-add webview follow storage changes. If persistence is blocked, the palette still applies and Settings explains how to retain it.

## Composition

Spacing is based on 4px. Panels have square corners and separate through flat color; controls use 4px corners. The progress block is the deliberate bold element. There are no shadows for elevation, gradients, entrance animations or ongoing decorative motion. A 2px navigation rule anchors the workspace. Focus uses an explicit 3px outline, and primary targets are at least 44px.

```text
Wide browser (1120px and above)
[brand / Today / History / named lists / New list / Settings / Sign out]
[Today + date + Add task                  ][ring / remaining / reset]
[Today's one list, in the owner's order, with the add box under it     ]

Windows utility window (440px default)
[brand                     Settings / Sign out]
[Today / History / named lists / New list      ]
[date                                         ]
[Today                                Add task]
[ring / remaining / reset                     ]
[Today's one list: drag handle, check, title  ]
[Add box: Once / Every day / Chosen days      ]

Narrow Settings
[header and navigation                        ]
[Settings / account                           ]
[Appearance: two-column palette picker        ]
[Day boundary / Windows options / devices     ]
[Export / sign-out / account deletion         ]
```

The browser and native app use the same components. Width, not a platform fork, determines the composition. The Windows shell starts narrow and remains resizable. Settings scrolls vertically in one readable column; controls and prose wrap within that column. Rename and delete actions live inside each task's details so rows stay usable in a narrow window.

## Verification and critique

Two screenshot rounds captured Today and Settings in all five palettes at **1440, 430 and 390px**. Inspected contact sheets and individual captures. First-round refinement made the narrow Today heading fluid and added visible creation-field labels. Second-round captures retain readable task text and all Settings controls, with no horizontal overflow. A populated daily list and the full Settings screen scroll vertically in the narrow layout, as intended.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `src/index.css`, `src/today/TodayScreen.tsx:169` | Purple identity and a narrow, rounded layout at every window width | Signal typography, stepped identity, square task panels and responsive columns | Applies the owner's selected direction while preserving daily-list behavior. |
| MEDIUM | `src/today/ItemRow.tsx:75` | Three row actions competed with task titles in a narrow window | One details action, with rename and delete inside details | Keeps the task title and checkbox easy to use at the desktop target width. |
| LOW | `src/today/AddForms.tsx`, `src/lists/ListScreen.tsx`, `src/today/ItemDetails.tsx` | Creation inputs depended on placeholder or accessible-only labels | Persistent visible labels | The field's purpose remains visible while typing. |

Checks performed:

- Production build / TypeScript and ESLint passed; the design-taste source linter reported **0 FAIL, 0 WARN**.
- All **208 existing tests** passed.
- Browser verification exercised task completion, adding tasks, long titles, renaming, subtasks, theme selection, keyboard selection and focus, persistence across reload, cross-window propagation, invalid preferences and blocked storage.
- Today and Settings had no horizontal overflow at **360, 390, 430, 720, 960 and 1440px**.
- Computed Settings text contrast passed the applicable 4.5:1 / 3:1 thresholds for all five palettes. The app rendered under the production web CSP, with local fonts and CSS-based palette swatches.
- An actual service-worker offline restart preserved the chosen theme, local tasks and Archivo font; theme changes still worked offline.
- Windows-only Settings controls and the 520 × 108 quick-add component rendered at their target widths in Chromium with simulated Tauri IPC. The debug Windows executable compiled successfully using the installed Visual Studio 2022 development environment.

No new placeholder claims or product copy were introduced. Preview screenshots use synthetic tasks and an `example.test` account, not real account data. Tinted task groups and the progress ring are intentional D22 features. Not verified: interactive operation of the newly built executable inside an installed WebView2 window, or tray/background behavior in that new executable. No sync or native background logic changed.
