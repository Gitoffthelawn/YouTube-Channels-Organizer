const api = typeof browser !== "undefined" ? browser : chrome;
const tabsEl = document.getElementById("tabs");
const videosEl = document.getElementById("videos");
const emptyEl = document.getElementById("empty");
const modeButtons = document.querySelectorAll(".mode-btn");
const videosView = document.getElementById("videos-view");
const creatorsView = document.getElementById("creators-view");
const categoriesEl = document.getElementById("categories");
const addStatus = document.getElementById("add-status");
const importStatus = document.getElementById("import-status");
const tabsContainer = document.getElementById("tabs");
const tabsPrev = document.getElementById("tabs-prev");
const tabsNext = document.getElementById("tabs-next");

let categories = [];
let activeCategoryId = null;
let stateCache = { categories: {}, channels: {} };

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

function renderTabs() {
  tabsEl.innerHTML = "";
  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (cat.id === activeCategoryId ? " active" : "");
    btn.textContent = cat.name;
    btn.addEventListener("click", () => setActiveCategory(cat.id));
    tabsEl.appendChild(btn);
  });
  updateTabsNav();
}

async function setActiveCategory(categoryId) {
  activeCategoryId = categoryId;
  renderTabs();
  await loadVideos(categoryId);
}

async function loadVideos(categoryId) {
  videosEl.innerHTML = "<div class='empty'>Loading...</div>";
  const res = await api.runtime.sendMessage({ type: "GET_VIDEOS_FOR_CATEGORY", categoryId });
  const vids = res.videos || [];
  renderVideos(vids);
}

function renderVideos(videos) {
  videosEl.innerHTML = "";
  if (!videos.length) {
    emptyEl.textContent = "No videos found yet.";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  videos.forEach((vid) => {
    const card = document.createElement("div");
    card.className = "video";
    card.innerHTML = `
      <img src="${vid.thumbnail}" alt="${vid.title}" />
      <a class="video-title" href="${vid.url}" data-video-id="${vid.videoId || ""}">${vid.title}</a>
      <div class="meta">${vid.channelTitle} • ${timeAgo(vid.publishedAt)}</div>
    `;
    videosEl.appendChild(card);
    const open = () => {
      const videoId = vid.videoId || new URL(vid.url).searchParams.get("v") || "";
      const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : vid.url;
      window.open(targetUrl, "_blank", "noreferrer");
    };
    card.addEventListener("click", (e) => {
      if ((e.target).classList.contains("video-title")) {
        e.preventDefault();
      }
      open();
    });
    card.querySelector(".video-title").addEventListener("click", (e) => {
      e.preventDefault();
      open();
    });
  });
}

document.getElementById("refresh-btn").addEventListener("click", async () => {
  if (activeCategoryId) {
    await loadVideos(activeCategoryId);
  } else {
    await loadCategories();
  }
});

document.getElementById("add-category-btn").addEventListener("click", async () => {
  const name = document.getElementById("new-category-name").value.trim();
  if (!name) {
    addStatus.textContent = "Enter a category name.";
    return;
  }
  const res = await api.runtime.sendMessage({ type: "CREATE_CATEGORY", name });
  addStatus.textContent = res?.existed ? "Category already exists." : "Category added.";
  document.getElementById("new-category-name").value = "";
  await loadCategories();
});

function renderCreators(state) {
  categoriesEl.innerHTML = "";
  const cats = Object.values(state.categories || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!cats.length) {
    categoriesEl.innerHTML = '<div class="empty">No categories yet.</div>';
    return;
  }

  cats.forEach((cat) => {
    const wrapper = document.createElement("div");
    wrapper.className = "category";
    wrapper.setAttribute("draggable", "true");
    wrapper.dataset.categoryId = cat.id;

    const header = document.createElement("div");
    header.className = "category-header";
    const left = document.createElement("div");
    left.innerHTML = `<strong>${cat.name}</strong> (${cat.channelIds.length})`;
    const actions = document.createElement("div");
    actions.className = "category-actions";
    const renameBtn = document.createElement("button");
    renameBtn.dataset.action = "rename";
    renameBtn.textContent = "Rename";
    const deleteBtn = document.createElement("button");
    deleteBtn.dataset.action = "delete";
    deleteBtn.textContent = "Delete";
    actions.append(renameBtn, deleteBtn);
    header.append(left, actions);

    const creatorsSlot = document.createElement("div");
    creatorsSlot.className = "creators";

    if (!cat.channelIds.length) {
      creatorsSlot.innerHTML = '<div class="empty">No creators yet.</div>';
    } else {
      cat.channelIds.forEach((channelId) => {
        const channel = state.channels[channelId];
        if (!channel) return;
        const row = document.createElement("div");
        row.className = "creator";
        const link = document.createElement("a");
        link.href = channel.url;
        link.target = "_blank";
        link.textContent = channel.title || "Loading...";
        const removeBtn = document.createElement("button");
        removeBtn.dataset.action = "remove";
        removeBtn.dataset.channel = channelId;
        removeBtn.setAttribute("aria-label", "Remove");
        removeBtn.textContent = "x";
        row.append(link, removeBtn);
        creatorsSlot.appendChild(row);

        ensureChannelName(channelId, channel.title).then((freshName) => {
          if (freshName && freshName !== channel.title) {
            link.textContent = freshName;
          }
        });
      });
    }

    wrapper.append(header, creatorsSlot);

    renameBtn.addEventListener("click", async () => {
      const newName = prompt("New name", cat.name);
      if (!newName) return;
      await api.runtime.sendMessage({ type: "RENAME_CATEGORY", categoryId: cat.id, newName });
      await loadCategories();
    });

    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete category "${cat.name}"?`)) return;
      await api.runtime.sendMessage({ type: "DELETE_CATEGORY", categoryId: cat.id });
      await loadCategories();
    });

    creatorsSlot.querySelectorAll("[data-action='remove']").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const channelId = e.currentTarget.getAttribute("data-channel");
        await api.runtime.sendMessage({
          type: "REMOVE_CHANNEL_FROM_CATEGORY",
          categoryId: cat.id,
          channelId
        });
        await loadCategories();
      });
    });

    categoriesEl.appendChild(wrapper);
  });

  let dragEl = null;
  categoriesEl.querySelectorAll(".category").forEach((catEl) => {
    catEl.addEventListener("dragstart", (e) => {
      dragEl = catEl;
      catEl.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    catEl.addEventListener("dragend", () => {
      if (dragEl) dragEl.classList.remove("dragging");
      categoriesEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
      dragEl = null;
    });
    catEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragEl || dragEl === catEl) return;
      catEl.classList.add("drag-over");
    });
    catEl.addEventListener("dragleave", () => catEl.classList.remove("drag-over"));
    catEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      catEl.classList.remove("drag-over");
      if (!dragEl || dragEl === catEl) return;
      const nodes = Array.from(categoriesEl.querySelectorAll(".category"));
      const draggedIdx = nodes.indexOf(dragEl);
      const targetIdx = nodes.indexOf(catEl);
      if (draggedIdx === -1 || targetIdx === -1) return;
      if (draggedIdx < targetIdx) {
        categoriesEl.insertBefore(dragEl, catEl.nextSibling);
      } else {
        categoriesEl.insertBefore(dragEl, catEl);
      }
      await persistOrder();
    });
  });
}

async function persistOrder() {
  const nodes = Array.from(categoriesEl.querySelectorAll(".category"));
  for (let i = 0; i < nodes.length; i++) {
    const id = nodes[i].dataset.categoryId;
    await api.runtime.sendMessage({ type: "UPDATE_CATEGORY_ORDER", categoryId: id, order: i + 1 });
  }
  await loadCategories();
}

async function loadCategories() {
  const res = await api.runtime.sendMessage({ type: "GET_STATE" });
  const state = res.state || { categories: {}, channels: {} };
  stateCache = state;
  categories = Object.values(state.categories || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  renderTabs();
  if (categories.length) {
    if (!activeCategoryId || !state.categories[activeCategoryId]) {
      activeCategoryId = categories[0].id;
    }
    setActiveCategory(activeCategoryId);
  } else {
    videosEl.innerHTML = "";
    emptyEl.textContent = "No categories yet. Save a creator to get started.";
    emptyEl.style.display = "block";
  }
  renderCreators(state);
}

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.getAttribute("data-mode");
    if (mode === "videos") {
      videosView.classList.remove("hidden");
      creatorsView.classList.add("hidden");
    } else {
      videosView.classList.add("hidden");
      creatorsView.classList.remove("hidden");
    }
  });
});

tabsPrev.addEventListener("click", () => {
  tabsContainer.scrollBy({ left: -200, behavior: "smooth" });
});
tabsNext.addEventListener("click", () => {
  tabsContainer.scrollBy({ left: 200, behavior: "smooth" });
});

function updateTabsNav() {
  // could disable buttons based on scrollLeft if desired
}

async function ensureChannelName(channelId, currentTitle) {
  if (currentTitle && currentTitle !== "YouTube Creator") return currentTitle;
  const res = await api.runtime.sendMessage({ type: "REFRESH_CHANNEL_TITLE", channelId });
  return res?.channel?.title || currentTitle;
}

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
  const { categories = {}, channels = {} } = state;
  downloadJson("yt-organizer-export.json", { categories, channels });
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
  }
});

loadCategories();
