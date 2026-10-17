# Updated character artwork · 1.1.0

Generated with the built-in `image_gen.imagegen` tool in transparent-background mode. No CLI/API fallback or manual raster redraw.

The user supplied two more precise front/side/back reference sheets: an adult mature form and a cute chibi form. These supersede the initial design reference for the horns, face, hair, knot ornament, dragon wings and tail. The user separately asked to retain the earlier long-skirt characteristics, so each generation also uses the previous sprite sheet strictly as a dress/style reference.

The source reference photos are not included in the public repository. Final project assets are `assets/cute.png` and `assets/mature.png`, replacing the earlier generated sheets. Both are 1536 × 1024 RGBA PNGs. Grid order remains idle, wave, crouch, eat, headpat, sleep, busy, success; four columns, two rows. Generated alpha is preserved. Original generated filenames: cute `exec-5900e200-0165-4b68-966f-a1374865e55a.png`; mature `exec-3a1a9606-53db-45be-a158-cd8dd19bfda2.png`.

## Cute prompt

```text
Use case: character-reference sprite sheet edit. Production desktop pet asset, polished delicate anime illustration.
Reference image 1 is the NEW authoritative character model sheet. Match its identity faithfully: white-silver long flowing hair with pale lavender ends, lavender purple eyes, single curled ahoge, two symmetric ivory RIDGED dragon horns, pointed elf ears, the interwoven white knot-shaped hair ornament with dangling tassel, a pair of clearly visible lavender batlike DRAGON WINGS with pale ribs and scalloped membranes, and a fluffy-looking white scaled dragon tail shading lavender toward the curled tip. These anatomical and accessory features should remain recognizable across ALL eight poses. Do not replace the wings with ribbons or omit them.
Reference image 2 is the EXISTING sprite sheet, used ONLY for retaining the previous flowing dress features and soft rendering style: ornate white and lavender multilayer long skirt with translucent ruffles and asymmetric cascading panels, delicate metallic trim and ribbons. User explicitly wants to retain these earlier long-skirt characteristics while adopting the new model's other traits. Do not retain old mismatched horns or omit wings. Costume is elegant, fully clothed and nonsexual.
Deliver EXACTLY 8 full-body pose sprites arranged in a perfectly regular 4-column by 2-row grid, one isolated character in each equal cell. Landscape PNG 1536 x 1024 if possible, each cell 384 x 512. No grid lines or labels. Every pose including horns, wings, tail, hands, food, sparkles and skirt MUST fit entirely inside its own cell with at least 20px clear TRANSPARENT margins, no overlap with neighboring cells, no cropped tips. All standing poses use the same body scale, centered horizontally, feet baseline at 93% down their cell. Seated/crouching/sleeping poses keep consistent anatomical size and common bottom baseline.
Exact left-to-right, top-to-bottom order:
1 neutral standing, front-facing, relaxed gentle expression, wings slightly spread;
2 one-hand friendly wave, mostly front-facing;
3 actually squatting/crouching low, knees bent, hands resting on knees, skirt draped over legs;
4 sitting neatly eating from a small bowl with spoon;
5 pleased headpat reaction, eyes closed, a small hand gently resting between her horns, keep hand inside this cell;
6 sleeping curled beside/on her curled tail, eyes shut, skirt covers legs, wings neatly folded, no bed;
7 concentrating on a small blue glowing orb between both hands, this is WORKING status, clearly alert and focused;
8 happy success pose, hands raised, two small sparkles, this is FINISHED status.
Background: actual TRANSPARENT alpha. No colored, grey, white or checkerboard backdrop, no scenery, no floor, no ambient glows across empty background, no cast shadows outside character, no text, numerals, caption, frame or watermark. The same character and costume in all eight cells. Crisp clean silhouette at desktop scale.
Variant: CUTE form from reference 1: accurate cute chibi proportions around 3 heads tall, very large round lavender eyes, small face and compact body, gentle adorable expressions. Keep a visibly flowing layered white-lavender skirt, even in cute form. Do not turn into adult proportions.
```

## Mature prompt

```text
Use case: character-reference sprite sheet edit. Production desktop pet asset, polished delicate anime illustration.
Reference image 1 is the NEW authoritative character model sheet. Match its identity faithfully: white-silver long flowing hair with pale lavender ends, lavender purple eyes, single curled ahoge, two symmetric ivory RIDGED dragon horns, pointed elf ears, the interwoven white knot-shaped hair ornament with dangling tassel, a pair of clearly visible lavender batlike DRAGON WINGS with pale ribs and scalloped membranes, and a fluffy-looking white scaled dragon tail shading lavender toward the curled tip. These anatomical and accessory features should remain recognizable across ALL eight poses. Do not replace the wings with ribbons or omit them.
Reference image 2 is the EXISTING sprite sheet, used ONLY for retaining the previous flowing dress features and soft rendering style: ornate white and lavender multilayer long skirt with translucent ruffles and asymmetric cascading panels, delicate metallic trim and ribbons. User explicitly wants to retain these earlier long-skirt characteristics while adopting the new model's other traits. Do not retain old mismatched horns or omit wings. Costume is elegant, fully clothed and nonsexual.
Deliver EXACTLY 8 full-body pose sprites arranged in a perfectly regular 4-column by 2-row grid, one isolated character in each equal cell. Landscape PNG 1536 x 1024 if possible, each cell 384 x 512. No grid lines or labels. Every pose including horns, wings, tail, hands, food, sparkles and skirt MUST fit entirely inside its own cell with at least 20px clear TRANSPARENT margins, no overlap with neighboring cells, no cropped tips. All standing poses use the same body scale, centered horizontally, feet baseline at 93% down their cell. Seated/crouching/sleeping poses keep consistent anatomical size and common bottom baseline.
Exact left-to-right, top-to-bottom order:
1 neutral standing, front-facing, relaxed gentle expression, wings slightly spread;
2 one-hand friendly wave, mostly front-facing;
3 actually squatting/crouching low, knees bent, hands resting on knees, skirt draped over legs;
4 sitting neatly eating from a small bowl with spoon;
5 pleased headpat reaction, eyes closed, a small hand gently resting between her horns, keep hand inside this cell;
6 sleeping curled beside/on her curled tail, eyes shut, skirt covers legs, wings neatly folded, no bed;
7 concentrating on a small blue glowing orb between both hands, this is WORKING status, clearly alert and focused;
8 happy success pose, hands raised, two small sparkles, this is FINISHED status.
Background: actual TRANSPARENT alpha. No colored, grey, white or checkerboard backdrop, no scenery, no floor, no ambient glows across empty background, no cast shadows outside character, no text, numerals, caption, frame or watermark. The same character and costume in all eight cells. Crisp clean silhouette at desktop scale.
Variant: MATURE form from reference 1: graceful adult woman proportions around 6.5 heads tall, long legs, refined narrower lavender eyes, calm dignified expression and flowing long hair. NOT chibi. Preserve the earlier layered floor-length white/lavender dress with its cascading sheer ruffles and asymmetric front opening, tasteful and fully clothed. Wings are narrower when front-facing, but clearly visible on both sides. Fit the entire long dress in every cell.
```
