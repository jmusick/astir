# Design review

Reviewed November 17, 2026 using the design-taste build workflow. These are visual direction prototypes, not a production redesign.

## Tells

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | Original `src/index.css:10` and the Today screen | Purple identity with a generic system-font treatment | Five separate identity systems in this folder | The owner requested alternatives to the initial visual direction. The production CSS is unchanged. |
| LOW | `preview.js:80` | Repeated decorative captions beneath task-group headings | Hidden captions in the working task panels | Task category names already explain their content; removing the captions makes the app more useful at everyday window heights. |

No violet gradients, glass, glow, fake charts, decorative monospace, emoji icons, or repeated entrance animations. Tinted task panels and real progress rings are retained because they are the owner's D22 product decision, with different compositions in each direction. Signal's strong yellow block is intentionally tied to its sign-inspired identity. Grove uses a green journal palette rather than the cream / terracotta formula.

## Floor

- Ran the skill's source linter: **0 FAIL, 0 WARN**.
- Ran `npm run lint`: **passed**, including the new browser script.
- Captured and opened full-page screenshots at **1440px and 390px** for every design, in both critique rounds.
- Checked horizontal overflow at **390, 768, 1024, 1280, and 1440px**: none in the sample Today screens.
- Computed visible text contrast in Chromium: all five desktop designs passed the applicable **4.5:1 normal / 3:1 large text** thresholds. Inspected the phone captures for contrast and wrapping. Decorative SVG artwork is not a text contrast test.
- Verified native checkbox semantics and labels, buttons/links, visible keyboard focus, task details, validation, task creation, named-list navigation, History, Settings feedback and Reset sample in all five designs.
- Verified that switching concepts preserves sample edits and that an undated task added to a named list stays out of Today.
- Exercised a long task title containing literal markup; it wraps and is treated as text.
- Verified that each design loads its own bundled fonts; no third-party requests are needed while viewing the gallery. Upstream SIL OFL files are included.
- Source controls have at least 44px targets, reduced ornament, semantic headings, a skip link, browser theme colors and themed focus/selection/native controls. Phone concept-picker labels use 14px inside 44px targets; app text is at least 16px.

## Motion

No animations or timed transitions. The frequently used task surface updates immediately. No motion loop is needed for this review.

## Critique

**Round one:** opened all ten full-page captures. The five identities and primary task hierarchy were clear. Desktop screens spent too much height on workspace chrome, captions and loose task rows. Phone layouts wrapped cleanly, with the task categories and reset time retained.

**Round two:** removed the extra workspace bar, hid repeated captions and tightened desktop rows; captured and opened all ten final images. All tasks remain readable with no clipping or horizontal overflow. Grove and Folio deliberately stack their groups and therefore scroll sooner than Signal's three-column composition. The comparison sheet uses crops of these final captures, rather than separately drawn UI.

Interaction verification found and fixed an overly broad concept-picker selector before delivery. The final browser checks passed. The automated contrast checker initially followed Folio's positioned navigation back to the red rail background; an explicit white navigation background now matches the rendered desktop surface and makes the check unambiguous.

## Sample content and limits

All task titles, notes, recurrence descriptions, reminder times, list names/counts, past-day examples and the November 17 display date are illustrative. Replace them with real account data when applying a selected direction.

Not verified: native Tauri/WebView2 rendering, full production feature/state coverage, screen-reader announcements in assistive software, every possible user-content length, and trademark availability of the logo concepts. These prototypes have no network or async data loading, so production loading/offline/error states are outside this study. The selected design will still need those states, final icon sizes, and actual application integration. No changes were made to the app or its existing tests.
