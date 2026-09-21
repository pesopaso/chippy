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

  // Every file Chippy owns ends in .chippy.md (datadefinition §1). Strip that
  // suffix and look at the remainder: sanitizeName strips dots, so a stem never
  // contains one — a remainder WITHOUT a dot is an active discussion, a
  // remainder ending in ".archive" is an archived discussion, and one ending in
  // ".sys" is an app-managed system file. The namespaces cannot collide, so
  // "navigation", "tags", "names", and "summary" are ordinary discussion names.
  const CHIPPY_SUFFIX = '.chippy.md';
  const ARCHIVE_SUFFIX = '.archive' + CHIPPY_SUFFIX;
  const SYS_SUFFIX = '.sys' + CHIPPY_SUFFIX;
  const NAV_FILE = 'navigation' + SYS_SUFFIX;
  const TAGS_FILE = 'tags' + SYS_SUFFIX;
  const NAMES_FILE = 'names' + SYS_SUFFIX;
  const SUMMARY_FILE = 'summary' + SYS_SUFFIX;
  // Gen-2 (v3.1 – v3.3.0-dev.36) system filenames — renamed once to *.sys.chippy.md.
  const GEN2_NAV = 'navigation' + CHIPPY_SUFFIX;
  const GEN2_TAGS = 'tags' + CHIPPY_SUFFIX;
  const GEN2_NAMES = 'names' + CHIPPY_SUFFIX;
  const GEN2_SUMMARY = 'summary' + CHIPPY_SUFFIX;
  // Pre-v3.1 legacy filenames — read once by the migration, then removed.
  const LEGACY_NAV = 'navigation.md';
  const LEGACY_TAGS = 'tags.md';
  const LEGACY_NAMES = 'names.md';
  const LEGACY_SUMMARY = 'summary.md';
  // Pre-dev.37 discussion filenames: "<stem>.md" / "<stem>.archive.md". Still
  // readable; renamed to the .chippy.md layout by migrateDiscussionFilenames.
  const LEGACY_DISCUSSION_SUFFIX = '.md';
  const LEGACY_ARCHIVE_SUFFIX = '.archive.md';
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

  // Filename builders — the only place a discussion filename is assembled.
  function discussionFilename(stem) { return stem + CHIPPY_SUFFIX; }
  function archiveFilename(stem) { return stem + ARCHIVE_SUFFIX; }

  // A stem is valid when sanitizing it is a no-op (so it never contains a dot).
  function isValidStem(stem) { return stem.length > 0 && sanitizeName(stem) === stem; }

  // Classify a root-level filename (datadefinition §1):
  //   discussion         <stem>.chippy.md
  //   archive            <stem>.archive.chippy.md
  //   sys                <name>.sys.chippy.md
  //   legacy-discussion  <stem>.md            (pre-dev.37, migrated on load)
  //   legacy-archive     <stem>.archive.md    (pre-dev.37, migrated on load)
  //   other              anything else (including unknown *.<kind>.chippy.md)
  // Only filenames whose stem is a valid sanitized stem are classified as a
  // discussion/archive; "foo.bar.md" is 'other' — it never was loadable by name.
  function classifyFilename(filename) {
    const f = String(filename);
    if (f.endsWith(CHIPPY_SUFFIX)) {
      const rest = f.slice(0, -CHIPPY_SUFFIX.length);
      if (rest.endsWith('.sys')) return { kind: 'sys', stem: rest.slice(0, -4) };
      if (rest.endsWith('.archive')) {
        const stem = rest.slice(0, -8);
        return isValidStem(stem) ? { kind: 'archive', stem } : { kind: 'other', stem: rest };
      }
      return isValidStem(rest) ? { kind: 'discussion', stem: rest } : { kind: 'other', stem: rest };
    }
    if (f.endsWith(LEGACY_ARCHIVE_SUFFIX)) {
      const stem = f.slice(0, -LEGACY_ARCHIVE_SUFFIX.length);
      return isValidStem(stem) ? { kind: 'legacy-archive', stem } : { kind: 'other', stem };
    }
    if (f.endsWith(LEGACY_DISCUSSION_SUFFIX)) {
      const stem = f.slice(0, -LEGACY_DISCUSSION_SUFFIX.length);
      return isValidStem(stem) ? { kind: 'legacy-discussion', stem } : { kind: 'other', stem };
    }
    return { kind: 'other', stem: f };
  }

  function isDiscussionFile(filename) {
    return classifyFilename(filename).kind === 'discussion';
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

  async function removeIfExists(dirHandle, filename) {
    try { await dirHandle.removeEntry(filename); return true; }
    catch (_) { return false; }
  }

  // File System Access has no portable rename: copy the text, then remove the
  // source. Never overwrites — the caller checks the target first.
  async function renameTextFile(dirHandle, from, to) {
    await writeFileText(dirHandle, to, await readFileText(dirHandle, from));
    await dirHandle.removeEntry(from);
  }

  // Snapshot of the root-level file names (never iterate a directory while
  // renaming inside it).
  async function listRootFiles(dirHandle) {
    const out = [];
    for await (const [entryName, handle] of dirHandle.entries()) {
      if (handle.kind === 'file') out.push(entryName);
    }
    return out;
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

  // Active discussion stems. Current-layout files win; a legacy "<stem>.md"
  // that the sweep could not rename (see migrateDiscussionFilenames) is still
  // listed, so no discussion ever disappears from the app.
  async function listDiscussions(dirHandle) {
    const stems = new Set();
    for (const f of await listRootFiles(dirHandle)) {
      const c = classifyFilename(f);
      if (c.kind === 'discussion' || c.kind === 'legacy-discussion') stems.add(c.stem);
    }
    return [...stems].sort((a, b) => a.localeCompare(b));
  }

  // Archived discussions live as "<stem>.archive.chippy.md" and are not returned
  // by listDiscussions. Return their stems so the nav reconciler can keep/track them.
  async function listArchived(dirHandle) {
    const stems = new Set();
    for (const f of await listRootFiles(dirHandle)) {
      const c = classifyFilename(f);
      if (c.kind === 'archive' || c.kind === 'legacy-archive') stems.add(c.stem);
    }
    return [...stems];
  }

  // Reconcile the navigation list against what is actually on disk. The folder
  // is the source of truth: discussion files may be added or removed by
  // outside/automated processes, so on every startup we drop nav entries whose
  // file is gone and add entries for files that aren't listed yet. Existing
  // entries keep their metadata (favorite, tag, archived) and order; new ones
  // are appended alphabetically. Non-archived entries are matched to
  // "<stem>.chippy.md" and archived entries to "<stem>.archive.chippy.md". Pure
  // except for the directory read — the caller persists via saveNav only when
  // { changed } is true.
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

  // Resolve the file an active discussion currently lives in: the .chippy.md
  // name, or the legacy "<stem>.md" as a fallback while a folder is only
  // partially migrated. Returns null when neither exists.
  async function resolveDiscussionFile(dirHandle, stem) {
    const cur = discussionFilename(stem);
    if (await fileExists(dirHandle, cur)) return cur;
    const legacy = stem + LEGACY_DISCUSSION_SUFFIX;
    if (await fileExists(dirHandle, legacy)) return legacy;
    return null;
  }

  async function loadDiscussion(dirHandle, name) {
    const stem = sanitizeName(name);
    const filename = (await resolveDiscussionFile(dirHandle, stem)) || discussionFilename(stem);
    return fmt.parseDiscussion(await readFileText(dirHandle, filename), filename);
  }

  // Always writes the .chippy.md name; a surviving legacy "<stem>.md" is removed
  // after the successful write (write-through migration).
  async function saveDiscussion(dirHandle, member) {
    const stem = sanitizeName(member.name);
    await writeFileText(dirHandle, discussionFilename(stem), fmt.serializeDiscussion(member));
    await removeIfExists(dirHandle, stem + LEGACY_DISCUSSION_SUFFIX);
  }

  async function archiveDiscussion(dirHandle, name) {
    const stem = sanitizeName(name);
    const src = await resolveDiscussionFile(dirHandle, stem);
    if (!src) throw new Error('Cannot archive: no file for "' + stem + '".');
    await writeFileText(dirHandle, archiveFilename(stem), await readFileText(dirHandle, src));
    await dirHandle.removeEntry(src);
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
    // Never overwrite another discussion's file (store checks stems too; this
    // guards direct callers and files that exist on disk but not in the nav).
    // The legacy "<stem>.md" counts as taken as well — it may still be pending
    // migration.
    if (await resolveDiscussionFile(dirHandle, newStem)) {
      throw new Error('Cannot rename: ' + discussionFilename(newStem) + ' already exists.');
    }

    const oldFile = await resolveDiscussionFile(dirHandle, oldStem);
    const member = await loadDiscussion(dirHandle, oldName);
    member.name = newName;
    for (const e of member.entries) {
      if (e.body && e.body.includes(`](${oldStem}/`)) {
        e.body = e.body.split(`](${oldStem}/`).join(`](${newStem}/`);
      }
    }
    await saveDiscussion(dirHandle, member);
    await moveImageFolder(dirHandle, oldStem, newStem);
    if (oldFile) await dirHandle.removeEntry(oldFile);
  }

  // Folder-open sweep (v3.3.0-dev.37): rename pre-dev.37 discussion files to the
  // .chippy.md layout — "<stem>.md" -> "<stem>.chippy.md" and
  // "<stem>.archive.md" -> "<stem>.archive.chippy.md". Rules:
  //   - runs after the system-file migration (loadIndexes enforces the order:
  //     a gen-2 "tags.chippy.md" would otherwise be taken for a discussion "tags");
  //   - never overwrites: when the target exists the old file is left untouched;
  //   - per-file failures (e.g. an unmaterialized cloud placeholder) are skipped
  //     and retried on the next open; the sweep itself never throws;
  //   - only files with a valid sanitized stem are touched; "foo.bar.md" and
  //     the like were never loadable by name and stay as they are;
  //   - idempotent: a migrated folder costs one directory listing.
  // Returns { renamed: [[from, to]], skipped: [[from, reason]] }.
  async function migrateDiscussionFilenames(dirHandle) {
    const renamed = [];
    const skipped = [];
    let files;
    try { files = await listRootFiles(dirHandle); }
    catch (err) { console.warn('[chippy] filename sweep: cannot list folder', err); return { renamed, skipped }; }
    const present = new Set(files);
    for (const f of files) {
      const c = classifyFilename(f);
      let to = null;
      if (c.kind === 'legacy-discussion') to = discussionFilename(c.stem);
      else if (c.kind === 'legacy-archive') to = archiveFilename(c.stem);
      if (!to) continue;
      if (present.has(to)) {
        skipped.push([f, 'target exists']);
        console.warn('[chippy] filename sweep: kept ' + f + ' — ' + to + ' already exists');
        continue;
      }
      try {
        await renameTextFile(dirHandle, f, to);
        present.add(to);
        renamed.push([f, to]);
      } catch (err) {
        skipped.push([f, String(err && err.message || err)]);
        console.warn('[chippy] filename sweep: could not rename ' + f, err);
      }
    }
    if (renamed.length) console.info('[chippy] filename sweep renamed ' + renamed.length + ' file(s):', renamed);
    return { renamed, skipped };
  }

  /* ------------------------------ index files -------------------------- */

  // Load the system files, migrating older folder layouts first, then run the
  // discussion filename sweep. The order is fixed: system files are moved out
  // of the plain *.chippy.md namespace BEFORE any "<stem>.md" is renamed into it.
  async function loadIndexes(dirHandle) {
    let result;
    if (await fileExists(dirHandle, NAV_FILE)) {
      const nav = fmt.parseNav(await readFileText(dirHandle, NAV_FILE));
      const tags = (await fileExists(dirHandle, TAGS_FILE))
        ? fmt.parseTags(await readFileText(dirHandle, TAGS_FILE)) : [];
      const names = (await fileExists(dirHandle, NAMES_FILE))
        ? fmt.parseNames(await readFileText(dirHandle, NAMES_FILE)) : [];
      result = { nav, tags, names };
    } else if (await fileExists(dirHandle, GEN2_NAV)) {
      result = await migrateGen2Indexes(dirHandle);
    } else {
      result = await migrateLegacyIndexes(dirHandle);
    }
    await migrateDiscussionFilenames(dirHandle);
    return result;
  }

  // Gen-2 -> gen-3 (v3.3.0-dev.37): the four system files move from
  // "<name>.chippy.md" to "<name>.sys.chippy.md". Pure renames; a file that is
  // absent is simply absent afterwards too. Runs only while navigation.sys.chippy.md
  // does not exist yet.
  async function migrateGen2Indexes(dirHandle) {
    const pairs = [[GEN2_NAV, NAV_FILE], [GEN2_TAGS, TAGS_FILE], [GEN2_NAMES, NAMES_FILE], [GEN2_SUMMARY, SUMMARY_FILE]];
    for (const [from, to] of pairs) {
      if (!(await fileExists(dirHandle, from))) continue;
      if (await fileExists(dirHandle, to)) { await removeIfExists(dirHandle, from); continue; }
      await renameTextFile(dirHandle, from, to);
    }
    const nav = fmt.parseNav(await readFileText(dirHandle, NAV_FILE));
    const tags = (await fileExists(dirHandle, TAGS_FILE))
      ? fmt.parseTags(await readFileText(dirHandle, TAGS_FILE)) : [];
    const names = (await fileExists(dirHandle, NAMES_FILE))
      ? fmt.parseNames(await readFileText(dirHandle, NAMES_FILE)) : [];
    return { nav, tags, names };
  }

  // One-time migration from the pre-v3.1 layouts straight to the *.sys.chippy.md
  // layout. Runs only when neither navigation.sys.chippy.md nor the gen-2
  // navigation.chippy.md exists. Handles both legacy generations: the pre-v3.1
  // split layout (navigation.md + tags.md + names.md) and the older single-file
  // navigation.md with inline ## Tags / ## Names sections (datadefinition §3.4).
  // The new files are written first; the legacy files are removed afterwards —
  // effectively a rename — so "navigation", "tags", "names", and "summary"
  // become ordinary discussion names from then on.
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
      await removeIfExists(dirHandle, f);
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
    CHIPPY_SUFFIX, ARCHIVE_SUFFIX, SYS_SUFFIX,
    NAV_FILE, TAGS_FILE, NAMES_FILE, SUMMARY_FILE,
    sanitizeName, isSafeImagePath, isDiscussionFile,
    classifyFilename, discussionFilename, archiveFilename,
    openFolder, listDiscussions, listArchived, reconcileNavWithFiles,
    loadDiscussion, saveDiscussion,
    archiveDiscussion, renameDiscussion,
    migrateDiscussionFilenames,
    loadIndexes, saveNav, saveTags, saveNames,
    readSummary, writeSummary,
    ImageStore
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
