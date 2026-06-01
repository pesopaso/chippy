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

  const NAV_FILE = 'navigation.md';
  const TAGS_FILE = 'tags.md';
  const NAMES_FILE = 'names.md';
  const SUMMARY_FILE = 'summary.md';
  const RESERVED = new Set([NAV_FILE, TAGS_FILE, NAMES_FILE, SUMMARY_FILE]);
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
    if (RESERVED.has(filename)) return false;
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
    const navText = await readFileText(dirHandle, NAV_FILE);
    const hasTags = await fileExists(dirHandle, TAGS_FILE);
    const hasNames = await fileExists(dirHandle, NAMES_FILE);

    if (hasTags && hasNames) {
      return {
        nav: fmt.parseNav(navText),
        tags: fmt.parseTags(await readFileText(dirHandle, TAGS_FILE)),
        names: fmt.parseNames(await readFileText(dirHandle, NAMES_FILE))
      };
    }

    // Legacy single-file layout — migrate once.
    const migrated = fmt.migrateLegacyNav(navText);
    const nav = { discussions: migrated.discussions, theme: migrated.theme };
    await writeFileText(dirHandle, TAGS_FILE, fmt.serializeTags(migrated.tags));
    await writeFileText(dirHandle, NAMES_FILE, fmt.serializeNames(migrated.names));
    await writeFileText(dirHandle, NAV_FILE, fmt.serializeNav(nav));
    return { nav, tags: migrated.tags, names: migrated.names };
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
    sanitizeName, isSafeImagePath,
    openFolder, listDiscussions, loadDiscussion, saveDiscussion,
    archiveDiscussion, renameDiscussion,
    loadIndexes, saveNav, saveTags, saveNames,
    readSummary, writeSummary,
    ImageStore
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
