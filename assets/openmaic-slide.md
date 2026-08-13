# openmaic_slide authoring contract

You write one OpenMAIC slide as JSON and hand it to the `openmaic_slide`
tool. Follow the official OpenMAIC slide-content contract.

## The contract

Load `slide-template/system.md` (the slide-content generator contract) and
`slide-template/user.md` (the per-scene fill-in). Follow system.md for element
kinds, geometry, margins, and text rules.

## Canvas

The canvas is fixed at **1280 × 720 px** (16:9). Position every element inside
it with the margins system.md requires (top/bottom ≥ 50, left/right ≥ 50 from
the edge). You do NOT write `viewportSize` or `viewportRatio`; the tool sets
them for you.

## Output shape

Write the slide as:

```json
{ "background": { "type": "solid", "color": "#ffffff" }, "elements": [ ... ] }
```

- `elements` is the only required key (a non-empty array). `background` is optional.
- Follow system.md for each element's type and fields (text / shape / line /
  image / table / chart / latex / code).
- Text `content` is HTML; keep each bullet under ~20 words (~30 Chinese chars).

## Rules

- One page, a handful of elements, not a dense deck.
- Elements render in array order; put background shapes before text.
- Give every element a unique string `id`.

## When done

Call `openmaic_slide` with the object in `slide` and a short `title`. The tool
normalizes the canvas (1280 × 720) and renders it with OpenMAIC's official
renderer.
