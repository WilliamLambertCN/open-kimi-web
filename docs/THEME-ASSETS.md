# Theme background assets

These five background textures were generated with the built-in image generation tool from the project's atmospheric theme concept boards. They contain no UI, labels, accounts, or session data. UI controls and text are rendered by the application, not baked into the images.

Each PNG is 1536 × 1024. The files live in `packages/launcher/src/mobile/backgrounds/` and are bundled with the launcher. Only the selected theme's background is requested by CSS; Original does not select a background asset. No external image service is used at runtime.

The concept boards are visual references, not pixel-exact source files. Background smoke was reconstructed from them. Maintain the reference arc positions and panel transparency when changing layout; color similarity alone is insufficient.

## Generation prompts

Visual anchors for implementation:

- Aurora: a cyan arc descending along the right edge and turning toward the lower center.
- Twilight: diffuse lavender clouds with a dusty pink ribbon at the lower right.
- Ember: a warm coral and peach ribbon crossing the lower-right plum background.
- Mineral: sage-green double arcs over a deep petrol-green background.
- Nocturne: a dark center with fine violet upper-right and blue lower-right filaments.
- Shared UI: hexagonal brand and assistant markers, outlined new-chat button, a thin accent line on the selected session, translucent bordered panels, a circular send button, and compact mobile typography.
- Keep actual session content and state. Do not fabricate a completed task or a connected status to match the reference illustration.

### aurora.png

Create ONE production web app background asset, landscape 3:2, high resolution. Reference image is ONLY a style and composition reference. Extract/reconstruct the atmospheric BACKDROP of 01 AURORA upper left panel only. Deep ocean blue #0A1D2A, petrol #0F3B4A. A fine luminous cyan turquoise smoke ribbon descends from x75% top, curves outward at right edge and sweeps toward x35% bottom, an elegant wide C curve. Ice blue core highlights, tiny delicate dust, dark quiet left 35%. Remove ALL UI, text, letters, icons, panels, phone/computer frames, swatches, borders, white presentation canvas. Edge-to-edge dark abstract smoky backdrop ONLY. Preserve the reference smoke flow and visual texture, not a generic smooth gradient, not stripes, not a colorful galaxy photograph. Continuous dark background suited for legible UI overlaid by code. No sharp objects, no starscape, no text whatsoever.

### twilight.png

Create ONE production web app background asset, landscape 3:2, high resolution. Reference image is ONLY a style and composition reference. Extract/reconstruct the atmospheric BACKDROP of 02 TWILIGHT upper right panel only. Indigo base #181A2B and #2A2F4A. Broad wispy lavender smoky atmosphere across upper-right and center, dusty pink/lilac luminous diagonal ribbon sweeps from far right at y55% to x55% bottom. Soft muted bloom, subtle organic grain, dark quiet left 30%. Remove ALL UI, text, letters, icons, panels, phone/computer frames, swatches, borders, white presentation canvas. Edge-to-edge dark abstract smoky backdrop ONLY. Preserve the reference smoke flow and visual texture, not a generic smooth gradient, not stripes, not a colorful galaxy photograph. Continuous dark background suited for legible UI overlaid by code. No sharp objects, no starscape, no text whatsoever.

### ember.png

Create ONE production web app background asset, landscape 3:2, high resolution. Reference image is ONLY a style and composition reference. Extract/reconstruct the atmospheric BACKDROP of 03 EMBER lower left panel only. Plum charcoal base #1A1220 and wine #3B1F2E. Fine smoky coral #E0646A peach #F6A58C ember ribbon blazing softly on right lower third, sweeping diagonally from right y50% down to center-bottom, warm diffuse cloudy center. Dark quiet left 30%. Remove ALL UI, text, letters, icons, panels, phone/computer frames, swatches, borders, white presentation canvas. Edge-to-edge dark abstract smoky backdrop ONLY. Preserve the reference smoke flow and visual texture, not a generic smooth gradient, not stripes, not a colorful galaxy photograph. Continuous dark background suited for legible UI overlaid by code. No sharp objects, no starscape, no text whatsoever.

### mineral.png

Create ONE production web app background asset, landscape 3:2, high resolution. Reference image is ONLY a style and composition reference. Extract/reconstruct the atmospheric BACKDROP of 04 MINERAL lower right panel only. Deep petrol green #0F2322 base with #26433E. Organic sage mint smoky double arc, soft upper arc from x65% top curling left toward center, and larger mint/sage arc sweeps from far right middle to x40% bottom. Pale earthy green smoke #A6DCC8, subtle filaments. Dark quiet left 30%. Remove ALL UI, text, letters, icons, panels, phone/computer frames, swatches, borders, white presentation canvas. Edge-to-edge dark abstract smoky backdrop ONLY. Preserve the reference smoke flow and visual texture, not a generic smooth gradient, not stripes, not a colorful galaxy photograph. Continuous dark background suited for legible UI overlaid by code. No sharp objects, no starscape, no text whatsoever.

### nocturne.png

Create ONE production web app background asset, landscape 3:2, high resolution. Reference image is ONLY a style and composition reference. Extract/reconstruct the atmospheric BACKDROP of 05 NOCTURNE desktop backdrop. Nearly black ink #080B10 #0C111A base. Restrained fine cloudy violet filaments at upper right curve down along right edge into desaturated blue #83B8E8 wisps near bottom-right, broad delicate C-shaped smoke contour. Low luminance, extremely dark quiet center-left, ethereal fine texture. Match reference precisely. Remove ALL UI, text, letters, icons, panels, phone/computer frames, swatches, borders, white presentation canvas. Edge-to-edge dark abstract smoky backdrop ONLY. Preserve the reference smoke flow and visual texture, not a generic smooth gradient, not stripes, not a colorful galaxy photograph. Continuous dark background suited for legible UI overlaid by code. No sharp objects, no starscape, no text whatsoever.
