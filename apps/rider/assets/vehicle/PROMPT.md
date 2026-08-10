# Minibus map-marker — image generation prompt

The artwork this produces installs at `apps/rider/assets/vehicle/minibus.png`. See
`index.ts` in this folder for the one-line switch that turns it on.

Read "Why these constraints" at the bottom before you edit the prompt — several of
the lines that look like styling fluff are actually load-bearing for how the marker
behaves once it rotates on the map.

---

## 1. The prompt (paste this into Gemini)

> A single premium passenger minibus, photographed **from directly overhead** —
> true top-down orthographic view, like a satellite or ceiling camera looking
> straight down. The camera is exactly perpendicular to the ground: no
> perspective, no tilt, no three-quarter angle, no visible front grille, no
> visible side panels. Only the roof, windscreen, bonnet and rear deck are
> visible, and the vehicle's silhouette is a clean symmetrical rectangle with
> rounded corners.
>
> The minibus is **pointing straight up** — its nose/windscreen toward the top
> edge of the frame, its rear toward the bottom edge, perfectly vertical and
> perfectly centred in the canvas.
>
> Vehicle: a modern luxury shuttle van in the spirit of a Mercedes-Benz Sprinter
> or Toyota Hiace, but idealised and clean — 14-seater proportions, long
> wheelbase, softly rounded body, flush panels, no clutter.
>
> Materials and colour: pearlescent off-white bodywork with a subtle silver
> sheen, a dark graphite tinted glass roof panel and windscreen, slim gloss-black
> window surrounds, and a single thin accent stripe in vivid mint green
> (#4BE277) running along the roofline. Chrome-free, badge-free, text-free,
> plate-free — no lettering, no numbers, no logos anywhere on the vehicle.
>
> Lighting: soft, even studio lighting from above with gentle specular highlights
> along the roof crown. A soft diffuse contact shadow directly beneath the
> vehicle, tight and blurred, as if it is resting a few centimetres above the
> surface.
>
> Style: photorealistic 3D product render, high fidelity, crisp edges, clean and
> premium — the quality of an automotive configurator, not a game asset, not an
> illustration, not a flat vector icon, not cartoon, not isometric.
>
> Background: a completely flat, uniform, pure magenta (#FF00FF) field. No
> gradient, no vignette, no ground texture, no road, no markings, no scenery, no
> reflections on the background. Nothing but the vehicle, its contact shadow, and
> the flat magenta.
>
> Square 1:1 composition. The vehicle fills roughly 80% of the frame's height
> with even margin on all four sides.

## 2. Follow-up turns (Gemini rarely nails it first try)

Send these as edits on the generated image, one at a time, only for whatever it
got wrong:

- **Angle is off:** "Re-render this from a *perfectly* vertical overhead camera.
  I can still see the front of the vehicle — I should only see the roof,
  windscreen and bonnet, no grille and no side panels at all."
- **Not vertical / not centred:** "Rotate the vehicle so it points exactly
  straight up, and centre it precisely in the square canvas."
- **Background isn't flat:** "Replace the background with a single flat pure
  magenta #FF00FF. Remove all shadows cast onto the background except the soft
  contact shadow directly under the vehicle."
- **Text appeared:** "Remove all text, badges, numbers and licence plates from
  the vehicle. The bodywork must be completely blank."
- **Too toy-like:** "Make it more photorealistic and premium — sharper panel
  gaps, more realistic glass, less plastic."

## 3. After you have the image

1. **Key out the magenta** and export with a real alpha channel (remove.bg,
   Photoshop → Select Color Range, or `magick in.png -fuzz 12% -transparent
   magenta out.png`). Keep the contact shadow — it should survive as
   semi-transparent grey, not be deleted with the background.
2. **Crop tight** to the vehicle plus its shadow, then pad back out to a square
   with the vehicle's *body* centred. The centre of the image is the pivot point
   the map rotates about, so if the vehicle sits off-centre it will orbit rather
   than turn.
3. **Export three sizes** into this folder:
   - `minibus.png` — 128×128
   - `minibus@2x.png` — 256×256
   - `minibus@3x.png` — 384×384
4. **Flip the switch** in `index.ts`:
   ```ts
   export const VEHICLE_MODEL: ImageSourcePropType | null = require('./minibus.png');
   ```
5. Sanity-check it on a dark map: at 34pt the vehicle should still read as a
   vehicle, and you should be able to tell which end is the nose.

---

## Why these constraints

- **Top-down, not three-quarter.** `VehicleMarker` applies
  `transform: [{ rotate: bearing }]` to the flat image. Any perspective baked
  into the render is baked into a picture that then spins — a three-quarter view
  looks correct heading north and looks like the vehicle is lying on its side
  heading south. Only a straight-down view survives rotation.
- **Nose up.** Bearing is degrees clockwise from north, so 0° must already look
  like a vehicle driving north.
- **Magenta background, not "transparent".** Image models are unreliable at
  producing true alpha and usually hand back a white or checkerboard-*looking*
  background that is actually opaque pixels. A saturated colour that appears
  nowhere on the vehicle keys out cleanly and makes any fringing obvious.
- **Pearl white body, dark glass.** The rider map defaults to the dark Onyx
  style, where a dark vehicle disappears; the light body carries it. The dark
  glass band and baked contact shadow are what keep it legible if the map is ever
  in light mode.
- **Green only as a hairline accent.** `#4BE277` is the rider brand primary and
  also the route polyline colour — a green body would camouflage the vehicle
  against its own route line at exactly the moment the rider is looking for it.
- **No text.** Generative models garble small lettering, and at 34pt a garbled
  plate is just noise.
