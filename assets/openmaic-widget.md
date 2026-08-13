# openmaic_widget authoring contract

You generate OpenMAIC-style interactive teaching widgets. Pick the widget type
that fits the user's request, read its template, write ONE complete HTML
document, then hand it to the `openmaic_widget` tool.

## Widget types

| Type | For | Template |
| --- | --- | --- |
| `simulation` | interactive canvas: physics, systems, processes | `widget-templates/simulation.md` |
| `game` | quiz / puzzle / challenge with scoring | `widget-templates/game.md` |
| `code` | runnable code challenge with starter + tests | `widget-templates/code.md` |

Load the matching template first and follow it. The templates are long and
specific (canvas sizing, reset button state machines, mobile layout, the
postMessage listener); follow the contract they spell out, not a generic card.

## Hard requirements (all types)

1. Output EXACTLY ONE complete HTML document: `<!doctype html>` through one
   closing `</html>`. No markdown fences, no explanations.
2. Embed a `<script type="application/json" id="widget-config">` block
   describing the widget (type, concept, variables, presets).
3. Include the `postMessage` listener the template gives you
   (`SET_WIDGET_STATE`, `HIGHLIGHT_ELEMENT`, `ANNOTATE_ELEMENT`,
   `REVEAL_ELEMENT`) so a teaching agent can drive the widget later.
4. Use the element naming convention: `{var}-slider`, `{action}-btn`,
   `{var}-display`.
5. Mobile-safe layout, touch targets >= 44px, an obvious running/ended state.

## When done

Call `openmaic_widget` with the full document in `html`, the `widgetType`, and
a short `title`. Do not paste the HTML anywhere else; the tool renders it.
