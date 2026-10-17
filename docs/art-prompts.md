# Character artwork generation

Generated for this desktop-pet project on 2026-10-17 using the built-in `image_gen.imagegen` tool in transparent-background mode. No CLI/API fallback, hand-drawn SVG stand-in, or external artist asset was used.

The user supplied a reference screenshot containing cute and mature silver-haired lavender dragon characters. It was used as a character and style reference; the screenshot, title, frame, and background are not included in the project. The generated files retain their original RGBA alpha channels without post-processing. Character design provenance is the user-supplied reference; this note does not claim ownership of underlying third-party character rights.

## Delivered assets

| File | Canvas | Grid | Cell | Order |
| --- | --- | --- | --- | --- |
| `assets/cute.png` | 1536 × 1024 | 4 columns × 2 rows | 384 × 512 | idle, wave, crouch, eat, headpat, sleep, busy, success |
| `assets/mature.png` | 1536 × 1024 | 4 columns × 2 rows | 384 × 512 | idle, wave, crouch, eat, headpat, sleep, busy, success |

Read cells left to right, top to bottom. Each image is a single PNG sprite sheet. Artwork was visually inspected, and alpha transparency and dimensions were checked programmatically using Windows System.Drawing. Some poses naturally sit lower and have different silhouettes; these are expressive pose frames, not an interpolated animation sequence. Runtime motion should be supplied by gentle CSS transforms. No copy of the reference screenshot is committed.

Generation history: the first cute-sheet request returned a network error. Retrying the identical built-in request succeeded; the mature sheet succeeded on its first request. Original generated image identifiers: cute `exec-992f00ac-2697-45da-add4-c7ebed1b4f25.png`; mature `exec-e7ef5c7e-6462-4a99-a09c-211788e72f12.png`.

## Cute sheet prompt

```text
Use case: stylized-concept
Asset type: production desktop-pet RGBA sprite sheet.
Input image: reference for character design, palette and anime drawing style only. Do not reproduce the screenshot, caption, border, or backdrop.
Primary request: create exactly EIGHT full-body poses of the cute chibi variation of the silver-haired lavender dragon girl shown on the LEFT of the reference. Same consistent character across all poses: long flowing silver-lilac hair, two small pale dragon horns, lilac dragon tail, rosy violet eyes, ornate modest white and lavender layered dress with lilac ribbons and delicate gold accents, little white shoes. Adorable 3-head-tall chibi proportions, friendly expression, clean polished anime illustration, clearly visible silhouette.
Layout is crucial: output landscape PNG 1536 by 1024 pixels if possible; exactly 4 equal columns and 2 equal rows, eight equal 384x512 cells, no visible grid. One character entirely inside each cell, generous transparent padding, same scale in each cell, center x of each cell, common ground baseline 92 percent down each cell. No overlap between cells. Keep every horn, hair strand, tail tip, food and hand within its own cell.
Exact order left to right then top to bottom: 1 idle relaxed standing; 2 cheerful small one-hand wave; 3 crouching/squatting with hands resting on knees; 4 seated neatly holding a small bowl and spoon eating happily; 5 gentle headpat reaction with eyes closed and hands near cheeks, a small translucent hand lightly touching the top of her head; 6 asleep curled neatly on her tail with closed eyes, no pillow; 7 concentrating with a small glowing blue orb between her hands; 8 delighted success pose with both small hands raised and two tiny sparkles.
Scene/backdrop: genuinely TRANSPARENT alpha background. No solid white background, no checkerboard baked into pixels, no floor, no shadows extending outside the character. No text, no numerals, no labels, no watermark, no logos, no caption. All eight characters retain matching face, costume, hair, and palette. SFW and modest.
```

## Mature sheet prompt

```text
Use case: stylized-concept
Asset type: production desktop-pet RGBA sprite sheet.
Input image: reference for character design, palette and polished anime art style only. Do not reproduce the screenshot, caption, border, or backdrop.
Primary request: create exactly EIGHT full-body poses of the elegant MATURE ADULT variation of the silver-haired lavender dragon woman shown on the RIGHT of the reference. Same consistent adult character across all poses: graceful adult woman proportions, long flowing silver-lilac hair, two pale dragon horns, long lilac scaled dragon tail, rosy violet eyes, ornate modest layered white and lavender flowing dress with long skirt, lilac ribbons and delicate gold accents, small white shoes. Warm dignified expression and refined anime illustration. NO chibi proportions. Long sleeves, covered bust, no exposed underwear or cleavage, no sexualized posing.
Layout is crucial: output landscape PNG 1536 by 1024 pixels if possible; exactly 4 equal columns and 2 equal rows, eight equal 384x512 cells, no visible grid. One character entirely inside each cell, generous transparent padding, same character scale across cells, center x of each cell, common ground baseline 92 percent down each cell. No overlap between cells. Keep every horn, hair strand, skirt, tail tip, food and hand within its own cell. Fit the entire elegant long dress and horns inside each cell.
Exact order left to right then top to bottom: 1 idle relaxed standing with a gentle smile; 2 graceful one-hand wave; 3 crouching/squatting gracefully with skirt gathered modestly and hands on knees; 4 seated neatly holding a small bowl and spoon eating with a warm smile; 5 gentle headpat reaction with eyes closed and soft smile, a small translucent hand lightly touching the top of her head; 6 asleep curled neatly on her tail with closed eyes and skirt covering her legs, no pillow; 7 concentrating with a small glowing blue orb between her hands; 8 delighted success pose with hands raised gracefully and two tiny sparkles.
Scene/backdrop: genuinely TRANSPARENT alpha background. No solid white background, no checkerboard baked into pixels, no floor, no shadows extending outside the character. No text, no numerals, no labels, no watermark, no logos, no caption. All eight characters retain matching face, costume, hair, and palette. SFW, elegant and modest.
```
