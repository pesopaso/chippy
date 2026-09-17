# Third-party notices — src/local

Chippy bundles the following third-party components. Each is retained under its own
license, with its notice kept alongside it. See the project root `LICENSE` and `NOTICE`
for the Chippy license (Apache-2.0).

## DOMPurify

- **Component:** DOMPurify (HTML sanitization boundary)
- **Author:** Cure53 and contributors
- **Version:** 3.4.15
- **License:** Apache-2.0 OR MPL-2.0
- **Vendored as:** `dompurify.min.js` (flat, at the app root)
- **Upstream:** https://github.com/cure53/DOMPurify
- **Status:** Real minified build vendored (official `dist/purify.min.js` from the
  upstream 3.4.15 tag). To upgrade: replace the file with the new tag's build and
  update the version here and in the About dialog (`main.js`).

## Roboto

- **Component:** Roboto (UI typeface)
- **Author:** Google
- **License:** Apache-2.0
- **Upstream:** https://github.com/googlefonts/roboto
- **Status:** Referenced as the primary UI font family in `style.css`. Bundle the font
  files (and keep this notice) when the typeface is shipped locally rather than relying
  on a system fallback.
