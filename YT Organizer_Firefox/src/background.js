const api = typeof browser !== "undefined" ? browser : chrome;
const STATE_KEY = "ytOrganizerState";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const emptyState = () => ({
  categories: {},
  channels: {},
  videoCache: {}
});

const normalizeName = (name) => name.trim().toLowerCase();

async function getState() {
  const stored = await api.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] || emptyState();
}

async function saveState(state) {
  await api.storage.local.set({ [STATE_KEY]: state });
}

function findCategoryByName(state, name) {
  const target = normalizeName(name);
  return Object.values(state.categories).find((cat) => normalizeName(cat.name) === target);
}

function ensureCategory(state, name) {
  const existing = findCategoryByName(state, name);
  if (existing) return { state, category: existing, created: false };
  const maxOrder = Object.values(state.categories).reduce((m, c) => Math.max(m, c.order ?? 0), 0);
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const category = { id, name: name.trim(), createdAt: Date.now(), channelIds: [], order: maxOrder + 1 };
  state.categories[id] = category;
  return { state, category, created: true };
}

function attachChannelToCategory(state, channel, categoryId) {
  const category = state.categories[categoryId];
  if (!category) return { state, status: "missing-category" };
  if (!state.channels[channel.channelId]) {
    state.channels[channel.channelId] = {
      channelId: channel.channelId,
      title: channel.title || "",
      url: channel.url,
      categories: [],
      addedAt: Date.now()
    };
  } else {
    if (channel.title) state.channels[channel.channelId].title = channel.title;
    state.channels[channel.channelId].url = channel.url;
  }

  const alreadyInCategory = category.channelIds.includes(channel.channelId);
  if (alreadyInCategory) {
    return { state, status: "exists", categories: [...state.channels[channel.channelId].categories] };
  }

  category.channelIds.push(channel.channelId);
  state.channels[channel.channelId].categories.push(categoryId);
  return { state, status: "added", categories: [...state.channels[channel.channelId].categories] };
}

function detachChannelFromCategory(state, channelId, categoryId) {
  const category = state.categories[categoryId];
  const channel = state.channels[channelId];
  if (!category || !channel) return state;
  category.channelIds = category.channelIds.filter((id) => id !== channelId);
  channel.categories = channel.categories.filter((id) => id !== categoryId);
  return state;
}

async function handleSaveCreator(message) {
  const state = await getState();
  const { category, created } = ensureCategory(state, message.categoryName);
  const result = attachChannelToCategory(state, message.channel, category.id);
  await saveState(result.state);
  return {
    status: result.status,
    category,
    createdCategory: created,
    channelCategories: result.categories
  };
}

async function getCategoriesList() {
  const state = await getState();
  return Object.values(state.categories).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function getChannelStatus(channelId) {
  const state = await getState();
  const channel = state.channels[channelId];
  if (!channel) return { categories: [] };
  const categories = channel.categories
    .map((id) => state.categories[id])
    .filter(Boolean)
    .map((cat) => ({ id: cat.id, name: cat.name }));
  return { categories };
}

function parseRss(xmlText) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const entries = Array.from(doc.querySelectorAll("entry"));
    return entries.map((entry) => {
      const videoId = entry.querySelector("yt\\:videoId, videoId")?.textContent || "";
      const title = entry.querySelector("title")?.textContent || "Untitled";
      const link = entry.querySelector("link[rel='alternate']")?.getAttribute("href") || `https://www.youtube.com/watch?v=${videoId}`;
      const publishedAt = entry.querySelector("published")?.textContent || new Date().toISOString();
      const thumbnail = entry.querySelector("media\\:thumbnail")?.getAttribute("url") || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return { videoId, title, url: link, publishedAt, thumbnail };
    });
  } catch (err) {
    return [];
  }
}

async function fetchChannelFeed(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const res = await fetch(feedUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Feed request failed ${res.status}`);
  const xml = await res.text();
  const parsed = parseRss(xml) || [];
  return parsed.slice(0, 5);
}

async function loadVideosForCategory(categoryId) {
  const state = await getState();
  const category = state.categories[categoryId];
  if (!category) return { videos: [], error: "Category not found" };
  const aggregate = [];

  for (const channelId of category.channelIds) {
    const channel = state.channels[channelId];
    if (!channel) continue;

    const cached = state.videoCache[channelId];
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
    let videos = cached?.videos || [];

    if (!isFresh) {
      try {
        videos = await fetchChannelFeed(channelId);
        state.videoCache[channelId] = { fetchedAt: Date.now(), videos };
      } catch (err) {
        console.warn("RSS fetch failed", channelId, err);
      }
    }

    for (const video of videos.slice(0, 5)) {
      aggregate.push({
        ...video,
        channelId,
        channelTitle: channel.title
      });
    }
  }

  await saveState(state);
  aggregate.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return { videos: aggregate };
}

async function handleOptionsAction(message) {
  const state = await getState();
  let updated = false;

  if (message.type === "CREATE_CATEGORY") {
    const { category, created } = ensureCategory(state, message.name);
    updated = created;
    if (!created) return { category, existed: true };
  }

  if (message.type === "RENAME_CATEGORY") {
    const category = state.categories[message.categoryId];
    if (category) {
      category.name = message.newName.trim();
      updated = true;
    }
  }

  if (message.type === "DELETE_CATEGORY") {
    const category = state.categories[message.categoryId];
    if (category) {
      for (const channelId of category.channelIds) {
        detachChannelFromCategory(state, channelId, category.id);
      }
      delete state.categories[message.categoryId];
      updated = true;
    }
  }

  if (message.type === "REMOVE_CHANNEL_FROM_CATEGORY") {
    detachChannelFromCategory(state, message.channelId, message.categoryId);
    updated = true;
  }

  if (message.type === "UPDATE_CATEGORY_ORDER") {
    const category = state.categories[message.categoryId];
    if (category) {
      category.order = message.order ?? category.order ?? 0;
      updated = true;
    }
  }

  if (updated) {
    await saveState(state);
  }

  return { state: updated ? state : undefined };
}

function validateImportedState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { categories, channels } = raw;
  if (!categories || typeof categories !== "object") return null;
  if (!channels || typeof channels !== "object") return null;
  return { categories: { ...categories }, channels: { ...channels }, videoCache: {} };
}

async function resolveChannelFromUrl(url) {
  try {
    const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oembed.ok) {
      const data = await oembed.json();
      const authorUrl = data.author_url || "";
      const authorName = data.author_name || "";
      const channelId =
        authorUrl.match(/channel\/([^/]+)/)?.[1] ||
        authorUrl.match(/user\/([^/]+)/)?.[1] ||
        authorUrl.match(/c\/([^/]+)/)?.[1];
      if (channelId) {
        return {
          channelId,
          title: authorName || "YouTube Creator",
          url: authorUrl || `https://www.youtube.com/channel/${channelId}`
        };
      }
    }
  } catch (err) {
    // continue to fallback
  }

  try {
    const res = await fetch(url, { credentials: "omit" });
    if (res.ok) {
      const html = await res.text();
      const channelId = html.match(/"channelId":"(UC[^"]+)"/)?.[1];
      const channelName =
        html.match(/"channelName":"([^"]+)"/)?.[1] ||
        html.match(/"ownerChannelName":"([^"]+)"/)?.[1] ||
        html.match(/<meta itemprop="name" content="([^"]+)"/)?.[1] ||
        "YouTube Creator";
      if (channelId) {
        return {
          channelId,
          title: channelName,
          url: `https://www.youtube.com/channel/${channelId}`
        };
      }
    }
  } catch (err) {
    // ignore
  }

  return null;
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "SAVE_CREATOR") {
      sendResponse(await handleSaveCreator(message));
      return;
    }

    if (message.type === "GET_CATEGORIES") {
      sendResponse({ categories: await getCategoriesList() });
      return;
    }

    if (message.type === "GET_CHANNEL_STATUS") {
      sendResponse(await getChannelStatus(message.channelId));
      return;
    }

    if (message.type === "GET_VIDEOS_FOR_CATEGORY") {
      sendResponse(await loadVideosForCategory(message.categoryId));
      return;
    }

    if (message.type === "GET_STATE") {
      sendResponse({ state: await getState() });
      return;
    }

    if (["CREATE_CATEGORY", "RENAME_CATEGORY", "DELETE_CATEGORY", "REMOVE_CHANNEL_FROM_CATEGORY", "UPDATE_CATEGORY_ORDER"].includes(message.type)) {
      sendResponse(await handleOptionsAction(message));
      return;
    }

    if (message.type === "IMPORT_STATE") {
      const validated = validateImportedState(message.state);
      if (!validated) {
        sendResponse({ error: "Invalid import payload" });
        return;
      }
      await saveState(validated);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "RESOLVE_CHANNEL_FROM_URL") {
      const channel = await resolveChannelFromUrl(message.url);
      sendResponse({ channel });
      return;
    }

    sendResponse({ error: "Unknown message" });
  })();
  return true;
});
