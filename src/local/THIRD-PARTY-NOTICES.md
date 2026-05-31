# Third-party notices — src/local

Chippy bundles the following third-party components. Each is retained under its own
license, with its notice kept alongside it. See the project root `LICENSE` and `NOTICE`
for the Chippy license (Apache-2.0).

## DOMPurify

- **Component:** DOMPurify (HTML sanitization boundary)
- **Author:** Cure53 and contributors
- **Version (target):** 3.2.6
- **License:** Apache-2.0 OR MPL-2.0
- **Vendored as:** `dompurify.min.js` (flat, at the app root)
- **Upstream:** https://github.com/cure53/DOMPurify
- **Status:** ⚠️ The vendored `dompurify.min.js` is currently a **placeholder** (no
  sanitization). Replace it with the real 3.2.6 minified build before Step 5. Download:
  `https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.6/purify.min.js`

## Roboto

- **Component:** Roboto (UI typeface)
- **Author:** Google
- **License:** Apache-2.0
- **Upstream:** https://github.com/googlefonts/roboto
- **Status:** Referenced as the primary UI font family in `style.css`. Bundle the font
  files (and keep this notice) when the typeface is shipped locally rather than relying
  on a system fallback.
