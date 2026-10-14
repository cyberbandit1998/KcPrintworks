# Home page banner photo

The home page banner uses the owner's workshop photograph, in two crops of the same picture:

| File                            | Size       | Used for                                           |
| ------------------------------- | ---------- | -------------------------------------------------- |
| `kcprintworks-hero.webp`        | 1916 x 821 | desktop and tablet (full photograph)               |
| `kcprintworks-hero-mobile.webp` | 1100 x 821 | phones (the printers' side of the same photograph) |

The full-resolution original is `apps/storefront/assets/hero/wide-photo-original.png` (kept **outside** `public/`, so it is not served
to visitors). It was supplied as `Wide Photo.png`, 1916 x 821 px. Next resizes and re-encodes both files for each screen
(`/_next/image/`), the desktop one is fetched only on screens 40em (640 px) and wider and the phone one only on narrower screens.
The photo is decorative (`alt=""`): the headline and buttons are real text laid over it, so nothing in it needs a description.

## Replacing the photo

1. Put the new full-size original in `apps/storefront/assets/hero/`.
2. Regenerate the two files (Pillow: `pip install pillow`; change the crop box if the printers sit elsewhere in the new photo):

   ```python
   from PIL import Image
   src = Image.open('apps/storefront/assets/hero/wide-photo-original.png').convert('RGB')
   W, H = src.size
   src.save('apps/storefront/public/images/kcprintworks-hero.webp', 'WEBP', quality=90, method=6)
   src.crop((700, 0, 1800, H)).save('apps/storefront/public/images/kcprintworks-hero-mobile.webp', 'WEBP', quality=90, method=6)
   ```

3. If the sizes changed, update `HERO_WIDE` and `HERO_PHONE` (`width`/`height`) at the top of `src/app/page.tsx`. If the printers moved,
   adjust `--hero-focus-x` / `--hero-focus-y` in `src/styles/tokens.css` (where the wide photo is anchored when a screen crops it).
4. Look at it at 320, 768, 1440 and 1920 px, and run the tests (`tests/e2e/hero.spec.ts` checks the layout and that the overlay is darker on
   the left than over the printers).

**Sharper on big screens:** the supplied photo is 1916 px wide, so it is crisp up to a 1920 px screen but soft on 4K or very high-density
displays. An original 2800 to 3200 px wide, saved the same way, fixes that with no code change (update the two sizes in step 3).

Next keeps resized photos for four hours keyed by their address. A freshly started container has an empty cache, so a new image always
shows the new photo; the end-to-end test server clears the cache itself.
