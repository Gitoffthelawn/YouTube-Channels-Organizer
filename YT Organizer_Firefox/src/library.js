const api = typeof browser !== "undefined" ? browser : chrome;
const categoryListEl = document.getElementById("category-list");
const videosEl = document.getElementById("videos");
const emptyEl = document.getElementById("empty");
const activeCategoryNameEl = document.getElementById("active-category-name");
const importStatus = document.getElementById("import-status");
const suggestionsEl = document.getElementById("suggestions");
const suggestionsListEl = document.getElementById("suggestions-list");
const groupToggleEl = document.getElementById("group-toggle");

let categories = [];
let activeCategoryId = localStorage.getItem("ytOrgActiveCategory") || null;
let stateCache = { categories: {}, channels: {} };
let currentVideos = [];
let groupMode = localStorage.getItem("ytOrgGroupMode") || "all";

const ICONS = {
  drag: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.3"/><circle cx="11" cy="3" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="13" r="1.3"/><circle cx="11" cy="13" r="1.3"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4.5h10M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M6.5 7.5v4M9.5 7.5v4M4 4.5l.7 8.2a1 1 0 001 .9h4.6a1 1 0 001-.9l.7-8.2"/></svg>'
};

groupToggleEl.querySelectorAll("button").forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.group === groupMode);
});

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function formatViews(count) {
  if (!count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}

// ---------- Sidebar ----------

function renderSidebar() {
  categoryListEl.innerHTML = "";
  if (!categories.length) {
    categoryListEl.innerHTML = '<div class="sidebar-empty">No categories yet.</div>';
    return;
  }

  categories.forEach((cat) => {
    const row = document.createElement("div");
    row.className = "category-row" + (cat.id === activeCategoryId ? " active" : "");
    row.setAttribute("draggable", "true");
    row.dataset.categoryId = cat.id;

    const main = document.createElement("div");
    main.className = "category-row-main";
    main.innerHTML = `
      <span class="drag-handle">${ICONS.drag}</span>
      <span class="category-name">${cat.name}</span>
      <span class="category-count">${cat.channelIds.length}</span>
      <span class="category-row-actions">
        <button data-action="rename" title="Rename">${ICONS.edit}</button>
        <button data-action="delete" title="Delete">${ICONS.trash}</button>
      </span>
    `;
    row.appendChild(main);
    categoryListEl.appendChild(row);

    main.addEventListener("click", (e) => {
      if (e.target.closest(".category-row-actions")) return;
      if (e.target.closest(".drag-handle")) return;
      if (row.dataset.editing === "1") return;
      setActiveCategory(cat.id);
    });

    main.querySelector('[data-action="rename"]').addEventListener("click", (e) => {
      e.stopPropagation();
      startRename(cat, main);
    });

    main.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete category "${cat.name}"? This removes its creators too.`)) return;
      await api.runtime.sendMessage({ type: "DELETE_CATEGORY", categoryId: cat.id });
      if (activeCategoryId === cat.id) activeCategoryId = null;
      await loadCategories();
    });
  });

  setupDragReorder();
}

function startRename(cat, main) {
  const nameEl = main.querySelector(".category-name");
  const input = document.createElement("input");
  input.className = "category-name-input";
  input.value = cat.name;
  main.closest(".category-row").dataset.editing = "1";
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== cat.name) {
      await api.runtime.sendMessage({ type: "RENAME_CATEGORY", categoryId: cat.id, newName });
    }
    await loadCategories();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      loadCategories();
    }
  });
  input.addEventListener("click", (e) => e.stopPropagation());
}

function setupDragReorder() {
  let dragEl = null;
  categoryListEl.querySelectorAll(".category-row").forEach((rowEl) => {
    rowEl.addEventListener("dragstart", (e) => {
      dragEl = rowEl;
      rowEl.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    rowEl.addEventListener("dragend", () => {
      if (dragEl) dragEl.classList.remove("dragging");
      categoryListEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
      dragEl = null;
    });
    rowEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragEl || dragEl === rowEl) return;
      rowEl.classList.add("drag-over");
    });
    rowEl.addEventListener("dragleave", () => rowEl.classList.remove("drag-over"));
    rowEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      rowEl.classList.remove("drag-over");
      if (!dragEl || dragEl === rowEl) return;
      const nodes = Array.from(categoryListEl.querySelectorAll(".category-row"));
      const draggedIdx = nodes.indexOf(dragEl);
      const targetIdx = nodes.indexOf(rowEl);
      if (draggedIdx === -1 || targetIdx === -1) return;
      if (draggedIdx < targetIdx) {
        categoryListEl.insertBefore(dragEl, rowEl.nextSibling);
      } else {
        categoryListEl.insertBefore(dragEl, rowEl);
      }
      await persistOrder();
    });
  });
}

async function persistOrder() {
  const nodes = Array.from(categoryListEl.querySelectorAll(".category-row"));
  for (let i = 0; i < nodes.length; i++) {
    const id = nodes[i].dataset.categoryId;
    await api.runtime.sendMessage({ type: "UPDATE_CATEGORY_ORDER", categoryId: id, order: i + 1 });
  }
  await loadCategories();
}

document.getElementById("new-category-btn").addEventListener("click", () => {
  document.getElementById("new-category-row").classList.remove("hidden");
  document.getElementById("new-category-name").focus();
});

document.getElementById("cancel-category-btn").addEventListener("click", () => {
  document.getElementById("new-category-row").classList.add("hidden");
  document.getElementById("new-category-name").value = "";
});

document.getElementById("add-category-btn").addEventListener("click", async () => {
  const input = document.getElementById("new-category-name");
  const name = input.value.trim();
  if (!name) return;
  await api.runtime.sendMessage({ type: "CREATE_CATEGORY", name });
  input.value = "";
  document.getElementById("new-category-row").classList.add("hidden");
  await loadCategories();
});

document.getElementById("new-category-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("add-category-btn").click();
});

// ---------- Video panel ----------

async function setActiveCategory(categoryId) {
  activeCategoryId = categoryId;
  localStorage.setItem("ytOrgActiveCategory", categoryId);
  categoryListEl.querySelectorAll(".category-row").forEach((r) => {
    r.classList.toggle("active", r.dataset.categoryId === categoryId);
  });
  const cat = categories.find((c) => c.id === categoryId);
  activeCategoryNameEl.textContent = cat ? cat.name : "Select a category";
  suggestionsEl.classList.add("hidden");
  await loadVideos(categoryId);
  loadSuggestions(categoryId);
}

async function loadVideos(categoryId) {
  videosEl.innerHTML = "<div class='empty'>Loading...</div>";
  emptyEl.style.display = "none";
  const res = await api.runtime.sendMessage({ type: "GET_VIDEOS_FOR_CATEGORY", categoryId });
  currentVideos = res.videos || [];
  renderVideos();
  if (res.errors?.length) {
    const summary = res.errors.map((e) => `${e.channelTitle || e.channelId || "unknown"}: ${e.error}`).join("; ");
    console.warn(`Some channels failed to refresh - ${summary}`);
  }
}

function renderVideos() {
  const videos = currentVideos;
  videosEl.innerHTML = "";

  if (!videos.length) {
    emptyEl.textContent = "No videos found yet.";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  if (groupMode === "creator") {
    videosEl.className = "creator-groups";
    const groups = new Map();
    videos.forEach((v) => {
      if (!groups.has(v.channelId)) groups.set(v.channelId, { channelId: v.channelId, title: v.channelTitle, videos: [] });
      groups.get(v.channelId).videos.push(v);
    });
    const sortedGroups = Array.from(groups.values()).sort(
      (a, b) => new Date(b.videos[0].publishedAt).getTime() - new Date(a.videos[0].publishedAt).getTime()
    );
    sortedGroups.forEach((group) => {
      const section = document.createElement("div");
      section.className = "creator-group";
      const title = document.createElement("div");
      title.className = "creator-group-title";
      title.innerHTML = `<span>${group.title}</span><button class="creator-group-remove" title="Remove creator from category">${ICONS.trash}</button>`;
      title.querySelector(".creator-group-remove").addEventListener("click", async () => {
        if (!activeCategoryId) return;
        if (!confirm(`Remove "${group.title}" from this category?`)) return;
        await api.runtime.sendMessage({
          type: "REMOVE_CHANNEL_FROM_CATEGORY",
          categoryId: activeCategoryId,
          channelId: group.channelId
        });
        await loadCategories();
      });
      const grid = document.createElement("div");
      grid.className = "videos";
      group.videos.forEach((vid) => grid.appendChild(renderVideoCard(vid)));
      section.append(title, grid);
      videosEl.appendChild(section);
    });
  } else {
    videosEl.className = "videos";
    videos.forEach((vid) => videosEl.appendChild(renderVideoCard(vid)));
  }
}

function renderVideoCard(vid) {
  const card = document.createElement("div");
  card.className = "video";
  const viewsText = formatViews(vid.viewCount);
  card.innerHTML = `
    <div class="video-thumb">
      <img src="${vid.thumbnail}" alt="${vid.title}" loading="lazy" />
    </div>
    <a class="video-title" href="${vid.url}" data-video-id="${vid.videoId || ""}">${vid.title}</a>
    <div class="meta">${vid.channelTitle} • ${timeAgo(vid.publishedAt)}${viewsText ? " • " + viewsText : ""}</div>
  `;
  card.addEventListener("click", (e) => {
    e.preventDefault();
    openPlayer(vid);
  });
  return card;
}

document.getElementById("refresh-btn").addEventListener("click", async () => {
  if (activeCategoryId) {
    await loadVideos(activeCategoryId);
  } else {
    await loadCategories();
  }
});

groupToggleEl.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    groupMode = btn.dataset.group;
    localStorage.setItem("ytOrgGroupMode", groupMode);
    groupToggleEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    renderVideos();
  });
});

// ---------- Similar / featured creators ----------

async function loadSuggestions(categoryId) {
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat || !cat.channelIds.length) {
    suggestionsEl.classList.add("hidden");
    return;
  }

  const existingIds = new Set(Object.keys(stateCache.channels || {}));
  const sampleChannels = cat.channelIds.slice(0, 3);
  const results = await Promise.allSettled(
    sampleChannels.map((channelId) => api.runtime.sendMessage({ type: "GET_FEATURED_CHANNELS", channelId }))
  );

  if (categoryId !== activeCategoryId) return; // user navigated away while fetching

  const merged = new Map();
  results.forEach((r) => {
    if (r.status !== "fulfilled") return;
    (r.value?.channels || []).forEach((ch) => {
      if (existingIds.has(ch.channelId) || merged.has(ch.channelId)) return;
      merged.set(ch.channelId, ch);
    });
  });

  if (!merged.size) {
    suggestionsEl.classList.add("hidden");
    return;
  }

  suggestionsListEl.innerHTML = "";
  merged.forEach((ch) => {
    const chip = document.createElement("div");
    chip.className = "suggestion-chip";
    chip.innerHTML = `
      <a href="${ch.url}" target="_blank" rel="noreferrer">${ch.title}</a>
      <button title="Save to this category">+</button>
    `;
    chip.querySelector("button").addEventListener("click", async () => {
      await api.runtime.sendMessage({ type: "SAVE_CREATOR", categoryName: cat.name, channel: ch });
      chip.remove();
      await loadCategories();
    });
    suggestionsListEl.appendChild(chip);
  });
  suggestionsEl.classList.remove("hidden");
}

// ---------- Import / export ----------

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("export-btn").addEventListener("click", async () => {
  const res = await api.runtime.sendMessage({ type: "GET_STATE" });
  const state = res.state || {};
  const { categories: cats = {}, channels = {} } = state;
  downloadJson("yt-organizer-export.json", { categories: cats, channels });
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  importStatus.textContent = "Importing...";
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const res = await api.runtime.sendMessage({ type: "IMPORT_STATE", state: parsed });
    if (res?.error) {
      importStatus.textContent = `Import failed: ${res.error}`;
    } else {
      importStatus.textContent = "Import successful.";
      await loadCategories();
    }
  } catch (err) {
    importStatus.textContent = "Import failed: invalid file.";
  } finally {
    e.target.value = "";
    setTimeout(() => (importStatus.textContent = ""), 4000);
  }
});

// ---------- Load ----------

async function loadCategories() {
  const res = await api.runtime.sendMessage({ type: "GET_STATE" });
  const state = res.state || { categories: {}, channels: {} };
  stateCache = state;
  categories = Object.values(state.categories || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  renderSidebar();

  if (categories.length) {
    if (!activeCategoryId || !state.categories[activeCategoryId]) {
      activeCategoryId = categories[0].id;
    }
    await setActiveCategory(activeCategoryId);
  } else {
    activeCategoryId = null;
    activeCategoryNameEl.textContent = "Select a category";
    videosEl.innerHTML = "";
    suggestionsEl.classList.add("hidden");
    emptyEl.textContent = 'No categories yet. Click "+" to create one.';
    emptyEl.style.display = "block";
  }
}

loadCategories();

// ---------- Player ----------
// Many creators restrict embedding to an allowlist of domains (YouTube error 153),
// which a browser extension can never be on, so inline playback isn't reliable.
// Opening the actual watch page in a new tab always works.

function extractVideoId(vid) {
  if (vid.videoId) return vid.videoId;
  try {
    return new URL(vid.url).searchParams.get("v");
  } catch (err) {
    return null;
  }
}

function openPlayer(vid) {
  const videoId = extractVideoId(vid);
  const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : vid.url;
  window.open(targetUrl, "_blank", "noreferrer");
}
