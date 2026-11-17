# Astir: five visual directions

These are reviewable, isolated Today-screen prototypes, not a change to the shipped UI or the v1 decisions. D22 remains in effect; exploring alternatives here is part of choosing the next design. Every direction keeps a progress ring, distinct habits / today-only / due-from-lists sections, round checkboxes, rollover age, and reset time.

The job: help one person see what remains today, finish it, and start fresh tomorrow. Astir's own material is the daily reset, the meaning of “astir” (awake and moving), a growing completion ring, recurring rituals, carried tasks, persistent named lists, an account-defined midnight, and quiet offline reliability. The designs emphasize these instead of inventing charts or collaboration features.

## Systems

| Direction | Palette and roles | Type and reason | Composition and mark |
| --- | --- | --- | --- |
| Daybreak | sky `#eaf3fa`, paper `#ffffff`, ink `#17354b`, blue `#235b7b`, marigold `#f6bc54`, secondary `#4e6677` | Bricolage Grotesque for a personable, waking-up headline; Nunito Sans for open, readable everyday controls. | Blue navigation rail, a sunrise-shaped progress space, paired habit and task panels. The logo is a rising sun crossing a horizon. |
| Grove | mist `#eef3ec`, white `#fbfdf9`, forest `#214b37`, ink `#203c2c`, leaf `#c8d8bd`, secondary `#52654e` | Lora gives the daily heading the familiarity of a personal journal; Source Sans 3 keeps longer task lists clean. | Green sidebar, broad open task column, dedicated daily-progress column. A seedling A connects repeatable habits with growth. |
| Signal | white `#ffffff`, yellow `#f4d447`, ink `#20251f`, chalk `#f3f4ee`, olive `#555e49`, border `#727966` | Archivo's variable weights put strong sign-painting headings and compact, highly readable task text in one family. | Horizontal navigation, an oversized Today heading, a yellow progress block, a three-column working surface. An ascending stepped A suggests getting moving. |
| Tide | navy `#152630`, panel `#203641`, teal `#95cfca`, sand `#e5c29e`, white `#f0f5f5`, secondary `#aec2cb` | Manrope's open geometric forms keep a dark daily workspace approachable and readable without a second display face. | Compact icon-and-word rail, centered task workspace, small progress ring beside the date. A continuous wave makes an A inside a circle. No glow or gradients. |
| Folio | paper `#ffffff`, pale blue `#eef2f5`, ink `#202c38`, crimson `#ac2945`, rose `#f9eef0`, secondary `#52616e` | Barlow Condensed makes Today feel like a clear appointment on a wall calendar; Barlow gives the task text related proportions at a comfortable width. | Narrow vertical brand column, navigation across the top, large left day / progress column and right task stack. A folded-corner A is a small, legible app mark. |

Type scales use 16 / 20 / 28 / 48 / 72px (responsive display sizes only between those stops). Base spacing is 4px, with section spacing larger than row spacing. Daybreak uses 24px section corners and 8px controls; Grove 12px / 6px; Signal 0px / 4px; Tide 16px / 8px; Folio 6px / 4px. Surfaces separate by flat color, with borders only for controls and useful row separation. No animated entrances or recurring motion.

## First viewport sketches

```text
Daybreak  [blue rail] [Today + date       sunrise progress]
                     [Habits         ][Today only      ]
                     [Due from your lists              ]
Grove     [green rail][Today       ][daily progress     ]
                     [Habits      ][reset time         ]
                     [Today only  ][                   ]
                     [Due lists   ][                   ]
Signal    [brand     Today / History / Lists / Settings ]
          [TODAY + date           ][yellow progress     ]
          [Habits        ][Today only     ][Due lists   ]
Tide      [nav rail]  [Today + date        ring         ]
                     [Habits            ][Today only   ]
                     [Due from your lists              ]
Folio     [mark][navigation                             ]
          [name][large day + ring][Habits               ]
                [date / reset   ][Today only           ]
                                [Due lists            ]
```

The gallery toolbar belongs to the review tool, not the app. Every prototype uses the same illustrative task data and starts at 3 of 9 done. Task checkboxes and adding tasks are functional in memory; switching directions preserves the sample session. Navigation opens sample named lists, History, or Settings. No account, network, or real task data is used. Sample content to replace: task titles, notes, times, list names and counts, and date. Each direction has its own responsive composition at 390px.

## Review

See REVIEW.md for the performed checks and the two screenshot critique rounds. Font files and their upstream OFL licenses are included locally so the preview does not rely on a third-party font request.
