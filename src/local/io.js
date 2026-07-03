// SPDX-License-Identifier: Apache-2.0
//
// io.js — persistence layer: File System Access wrappers built on format.js.
//
// Classic script: attaches to window.Chippy.io. Must load AFTER format.js so
// Chippy.format is available. Browser-only at call time (File System Access API),
// but the pure guards (isSafeImagePath, sanitizeName) run anywhere.
// Data format: ../../documentation/datadefinition.md.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});
  const fmt = Chippy.format || {};

  /* ------------------------------ constants ---------------------------- */

  // App-managed files carry the .chippy.md suffix, so they can never collide
  // with a user discussion (sanitizeName strips dots, so no discussion file can
  // ever end in .chippy.md). "navigation", "tags", "names", and "summary" are
  // therefore ordinary discussion names.
  const NAV_FILE = 'navigation.chippy.md';
  const TAGS_FILE = 'tags.chippy.md';
  const NAMES_FILE = 'names.chippy.md';
  const SUMMARY_FILE = 'summary.chippy.md';
  // Pre-v3.1 legacy filenames — read once by the migration, then removed.
  const LEGACY_NAV = 'navigation.md';
  const LEGACY_TAGS = 'tags.md';
  const LEGACY_NAMES = 'names.md';
  const LEGACY_SUMMARY = 'summary.md';
  const NUL = String.fromCharCode(0);

  /* ------------------------------ pure guards -------------------------- */

  // Keep only [A-Za-z0-9_ -]:  "R&D" -> "RD".
  function sanitizeName(name) {
    return String(name).replace(/[^A-Za-z0-9_ -]/g, '');
  }

  // A stored image reference must be a relative path inside the data folder.
  // Reject: empty / >512, NUL, backslash, leading separator, drive letter, URL
  // scheme, or a segment that is empty / "." / "..". Spaces are allowed.
  function isSafeImagePath(p) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 512) return false;
    if (p.includes(NUL)) return false;
    if (p.includes('\\')) return false;
    if (p.startsWith('/')) return false;
    if (/^[A-Za-z]:/.test(p)) return false;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(p)) return false;
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.' || seg === '..') return false;
    }
    return true;
  }

  function isDiscussionFile(filename) {
    if (!filename.endsWith('.md')) return false;
    if (filename.endsWith('.archive.md')) return false;
    if (filename.endsWith('.chippy.md')) return false; // app-managed namespace
    return true;
  }

  function imageFilename(d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.jpg`;
  }

  /* --------------------------- low-level file IO ----------------------- */

  async function readFileText(dirHandle, filename) {
    const fh = await dirHandle.getFileHandle(filename);
    return await (await fh.getFile()).text();
  }

  async function writeFileText(dirHandle, filename, text) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  async function fileExists(dirHandle, filename) {
    try { await dirHandle.getFileHandle(filename); return true; }
    catch (_) { return false; }
  }

  /* ------------------------------ open folder -------------------------- */

  async function openFolder() {
    // Test-only seam: a harness may inject a directory handle (e.g. an OPFS root)
    // via window.__chippyTest.dirHandle to bypass the OS picker. Never set in
    // production, so the picker path is unchanged for real users.
    const t = root.__chippyTest;
    if (t && t.dirHandle) return t.dirHandle;
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  }

  /* --------------------------- discussion files ------------------------ */

  async function listDiscussions(dirHandle) {
    const names = [];
    for await (const [entryName, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && isDiscussionFile(entryName)) {
        names.push(entryName.replace(/\.md$/, ''));
      }
    }
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }

  // Archived discussions live as "<stem>.archive.md" and are not returned by
  // listDiscussions. Return their stems so the nav reconciler can keep/track them.
  async function listArchived(dirHandle) {
    const out = [];
    const suffix = '.archive.md';
    for await (const [entryName, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && entryName.endsWith(suffix) && !entryName.endsWith('.chippy' + suffix)) {
        out.push(entryName.slice(0, -suffix.length));
      }
    }
    return out;
  }

  // Reconcile the navigation list against what is actually on disk. The folder
  // is the source of truth: discussion .md files may be added or removed by
  // outside/automated processes, so on every startup we drop nav entries whose
  // file is gone and add entries for files that aren't listed yet. Existing
  // entries keep their metadata (favorite, tag, archived) and order; new ones
  // are appended alphabetically. Non-archived entries are matched to "<stem>.md"
  // and archived entries to "<stem>.archive.md". Pure except for the directory
  // read — the caller persists via saveNav only when { changed } is true.
  async function reconcileNavWithFiles(dirHandle, nav) {
    const activeStems = new Set(await listDiscussions(dirHandle));
    const archivedStems = new Set(await listArchived(dirHandle));
    const src = (nav && nav.discussions) || [];
    const kept = [];
    const seenActive = new Set();
    const seenArchived = new Set();
    for (const d of src) {
      const stem = sanitizeName(d.name);
      if (d.archived) {
        if (archivedStems.has(stem) && !seenArchived.has(stem)) { kept.push(d); seenArchived.add(stem); }
      } else if (activeStems.has(stem) && !seenActive.has(stem)) {
        kept.push(d); seenActive.add(stem);
      }
    }
    const added = [];
    for (const stem of activeStems) {
      if (!seenActive.has(stem)) added.push({ name: stem, favorite: false, archived: false, tag: null });
    }
    for (const stem of archivedStems) {
      if (!seenArchived.has(stem)) added.push({ name: stem, favorite: false, archived: true, tag: null });
    }
    added.sort((a, b) => a.name.localeCompare(b.name));
    const discussions = kept.concat(added);
    const changed = discussions.length !== src.length ||
      discussions.some((d, i) => src[i] !== d);
    return { nav: Object.assign({}, nav, { discussions }), changed };
  }

  async function loadDiscussion(dirHandle, name) {
    const filename = sanitizeName(name) + '.md';
    return fmt.parseDiscussion(await readFileText(dirHandle, filename), filename);
  }

  async function saveDiscussion(dirHandle, member) {
    await writeFileText(dirHandle, sanitizeName(member.name) + '.md',
      fmt.serializeDiscussion(member));
  }

  async function archiveDiscussion(dirHandle, name) {
    const stem = sanitizeName(name);
    const text = await readFileText(dirHandle, stem + '.md');
    await writeFileText(dirHandle, stem + '.archive.md', text);
    await dirHandle.removeEntry(stem + '.md');
  }

  async function getSubfolder(dirHandle, stem, create) {
    try { return await dirHandle.getDirectoryHandle(stem, { create: !!create }); }
    catch (_) { return null; }
  }

  async function moveImageFolder(dirHandle, oldStem, newStem) {
    const src = await getSubfolder(dirHandle, oldStem, false);
    if (!src) return;
    const dst = await dirHandle.getDirectoryHandle(newStem, { create: true });
    for await (const [fname, handle] of src.entries()) {
      if (handle.kind !== 'file') continue;
      const blob = await handle.getFile();
      const w = await (await dst.getFileHandle(fname, { create: true })).createWritable();
      await w.write(blob); await w.close();
    }
    await dirHandle.removeEntry(oldStem, { recursive: true });
  }

  async function renameDiscussion(dirHandle, oldName, newName) {
    const oldStem = sanitizeName(oldName);
    const newStem = sanitizeName(newName);
    if (oldStem === newStem) return;

    const member = await loadDiscussion(dirHandle, oldName);
    member.name = newName;
    for (const e of member.entries) {
      if (e.body && e.body.includes(`](${oldStem}/`)) {
        e.body = e.body.split(`](${oldStem}/`).join(`](${newStem}/`);
      }
    }
    await saveDiscussion(dirHandle, member);
    await moveImageFolder(dirHandle, oldStem, newStem);
    await dirHandle.removeEntry(oldStem + '.md');
  }

  /* ------------------------------ index files -------------------------- */

  async function loadIndexes(dirHandle) {
    if (await fileExists(dirHandle, NAV_FILE)) {
      const nav = fmt.parseNav(await readFileText(dirHandle, NAV_FILE));
      const tags = (await fileExists(dirHandle, TAGS_FILE))
        ? fmt.parseTags(await readFileText(dirHandle, TAGS_FILE)) : [];
      const names = (await fileExists(dirHandle, NAMES_FILE))
        ? fmt.parseNames(await readFileText(dirHandle, NAMES_FILE)) : [];
      return { nav, tags, names };
    }
    return migrateLegacyIndexes(dirHandle);
  }

  // One-time migration to the .chippy.md layout. Runs only when no
  // navigation.chippy.md exists yet. Handles both legacy generations:
  // the pre-v3.1 split layout (navigation.md + tags.md + names.md) and the
  // older single-file navigation.md with inline ## Tags / ## Names sections
  // (datadefinition §3.4). The new files are written first; the legacy files
  // are removed afterwards — effectively a rename — so "navigation", "tags",
  // "names", and "summary" become ordinary discussion names from then on.
  async function migrateLegacyIndexes(dirHandle) {
    const navText = await readFileText(dirHandle, LEGACY_NAV); // absent -> throws, as before
    // Each index is taken from its dedicated legacy file when present, falling
    // back to the gen-1 inline ## Tags / ## Names sections of navigation.md
    // independently — a missing tags.md must never blank the names (or vice
    // versa). (dev.96 regression: the old all-or-nothing check fell back to the
    // inline parser for both lists when either file was absent, migrating
    // empty registries and deleting the surviving legacy file.)
    const inline = fmt.migrateLegacyNav(navText);
    const nav = { discussions: inline.discussions, theme: inline.theme };
    const tags = (await fileExists(dirHandle, LEGACY_TAGS))
      ? fmt.parseTags(await readFileText(dirHandle, LEGACY_TAGS)) : inline.tags;
    const names = (await fileExists(dirHandle, LEGACY_NAMES))
      ? fmt.parseNames(await readFileText(dirHandle, LEGACY_NAMES)) : inline.names;
    // A "summary" entry in a legacy navigation list was reserved-file
    // pollution, never a real discussion — drop it during the migration.
    nav.discussions = (nav.discussions || []).filter(d => d.name !== 'summary');

    await writeFileText(dirHandle, NAV_FILE, fmt.serializeNav(nav));
    await writeFileText(dirHandle, TAGS_FILE, fmt.serializeTags(tags));
    await writeFileText(dirHandle, NAMES_FILE, fmt.serializeNames(names));
    if ((await fileExists(dirHandle, LEGACY_SUMMARY)) && !(await fileExists(dirHandle, SUMMARY_FILE))) {
      await writeFileText(dirHandle, SUMMARY_FILE, await readFileText(dirHandle, LEGACY_SUMMARY));
    }
    for (const f of [LEGACY_NAV, LEGACY_TAGS, LEGACY_NAMES, LEGACY_SUMMARY]) {
      try { await dirHandle.removeEntry(f); } catch (_) { /* not present */ }
    }
    return { nav, tags, names };
  }

  async function saveNav(dirHandle, nav) {
    await writeFileText(dirHandle, NAV_FILE, fmt.serializeNav(nav));
  }
  async function saveTags(dirHandle, tags) {
    await writeFileText(dirHandle, TAGS_FILE, fmt.serializeTags(tags));
  }
  async function saveNames(dirHandle, names) {
    await writeFileText(dirHandle, NAMES_FILE, fmt.serializeNames(names));
  }

  async function readSummary(dirHandle) {
    if (!(await fileExists(dirHandle, SUMMARY_FILE))) return null;
    return readFileText(dirHandle, SUMMARY_FILE);
  }
  async function writeSummary(dirHandle, text) {
    await writeFileText(dirHandle, SUMMARY_FILE, text);
  }

  /* ------------------------------ image store -------------------------- */

  const ImageStore = {
    async saveImage(dirHandle, discussionName, blob, when) {
      const stem = sanitizeName(discussionName);
      const sub = await dirHandle.getDirectoryHandle(stem, { create: true });
      const fname = imageFilename(when);
      const w = await (await sub.getFileHandle(fname, { create: true })).createWritable();
      await w.write(blob); await w.close();
      return `${stem}/${fname}`;
    },

    async getImageUrl(dirHandle, relPath) {
      if (!isSafeImagePath(relPath)) {
        console.warn('[chippy] rejected unsafe image path:', relPath);
        return null;
      }
      const slash = relPath.indexOf('/');
      const sub = await dirHandle.getDirectoryHandle(relPath.slice(0, slash));
      const file = await (await sub.getFileHandle(relPath.slice(slash + 1))).getFile();
      return URL.createObjectURL(file);
    },

    async deleteImage(dirHandle, relPath) {
      if (!isSafeImagePath(relPath)) {
        console.warn('[chippy] rejected unsafe image path:', relPath);
        return false;
      }
      const slash = relPath.indexOf('/');
      const sub = await dirHandle.getDirectoryHandle(relPath.slice(0, slash));
      await sub.removeEntry(relPath.slice(slash + 1));
      return true;
    },

    async moveImage(dirHandle, relPath, targetDiscussionName) {
      if (!isSafeImagePath(relPath)) {
        console.warn('[chippy] rejected unsafe image path:', relPath);
        return null;
      }
      const slash = relPath.indexOf('/');
      const srcSub = await dirHandle.getDirectoryHandle(relPath.slice(0, slash));
      const fname = relPath.slice(slash + 1);
      const blob = await (await srcSub.getFileHandle(fname)).getFile();
      const dstStem = sanitizeName(targetDiscussionName);
      const dstSub = await dirHandle.getDirectoryHandle(dstStem, { create: true });
      const w = await (await dstSub.getFileHandle(fname, { create: true })).createWritable();
      await w.write(blob); await w.close();
      await srcSub.removeEntry(fname);
      return `${dstStem}/${fname}`;
    }
  };

  /* ------------------------------ export ------------------------------- */

  Chippy.io = {
    NAV_FILE, TAGS_FILE, NAMES_FILE, SUMMARY_FILE,
    sanitizeName, isSafeImagePath, isDiscussionFile,
    openFolder, listDiscussions, listArchived, reconcileNavWithFiles,
    loadDiscussion, saveDiscussion,
    archiveDiscussion, renameDiscussion,
    loadIndexes, saveNav, saveTags, saveNames,
    readSummary, writeSummary,
    ImageStore
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
