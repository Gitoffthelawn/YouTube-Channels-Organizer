const STATE_KEY = "ytOrganizerState";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const VIDEOS_PER_CHANNEL = 15; // RSS feed max, fetched raw so Shorts can be filtered out
const RESULT_PER_CHANNEL = 5; // non-Short videos surfaced per channel
const FEATURED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const emptyState = () => ({
  categories: {},
  channels: {},
  videoCache: {},
  shortsCache: {},
  featuredCache: {}
});

const normalizeName = (name) => name.trim().toLowerCase();

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY] || emptyState();
  state.shortsCache ||= {};
  state.featuredCache ||= {};
  return state;
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

function findCategoryByName(state, name) {
  const target = normalizeName(name);
  return Object.values(state.categories).find(
    (cat) => normalizeName(cat.name) === target
  );
}

function ensureCategory(state, name) {
  const existing = findCategoryByName(state, name);
  if (existing) return { state, category: existing, created: false };
  const maxOrder = Object.values(state.categories).reduce((m, c) => Math.max(m, c.order ?? 0), 0);
  const id = crypto.randomUUID();
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
  gcOrphanedChannel(state, channelId);
  return state;
}

// Removes a channel (and its cached data) once it belongs to no category.
function gcOrphanedChannel(state, channelId) {
  const channel = state.channels[channelId];
  if (!channel || channel.categories.length) return;
  delete state.channels[channelId];
  delete state.videoCache[channelId];
  delete state.featuredCache[channelId];
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

function parseRssWithDom(xmlText) {
  try {
    if (typeof DOMParser === "undefined") return null;
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const entries = Array.from(doc.querySelectorAll("entry"));
    return entries.map((entry) => {
      const videoId = entry.querySelector("yt\\:videoId, videoId")?.textContent || "";
      const title = entry.querySelector("title")?.textContent || "Untitled";
      const link = entry.querySelector("link[rel='alternate']")?.getAttribute("href") || `https://www.youtube.com/watch?v=${videoId}`;
      const publishedAt = entry.querySelector("published")?.textContent || new Date().toISOString();
      const thumbnail =
        entry.querySelector("media\\:thumbnail")?.getAttribute("url") ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const description = entry.querySelector("media\\:description")?.textContent || "";
      const viewCount = Number(entry.querySelector("media\\:statistics")?.getAttribute("views") || 0);
      return { videoId, title, url: link, publishedAt, thumbnail, description, viewCount };
    });
  } catch (err) {
    return null;
  }
}

// The regex fallback (always used in the MV3 service worker, which has no
// DOMParser) sees raw XML, so entities like &amp; must be decoded by hand.
function decodeXmlEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseRssFallback(xmlText) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xmlText)) && items.length < VIDEOS_PER_CHANNEL) {
    const block = match[1];
    const videoId = (block.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1] || "";
    const title = decodeXmlEntities((block.match(/<title>(<!\[CDATA\[)?([\s\S]*?)(\]\]>)?<\/title>/) || [])[2]?.trim() || "Untitled");
    const link = (block.match(/<link rel="alternate" href="(.*?)"/) || [])[1] || `https://www.youtube.com/watch?v=${videoId}`;
    const publishedAt = (block.match(/<published>(.*?)<\/published>/) || [])[1] || new Date().toISOString();
    const thumbnail =
      (block.match(/<media:thumbnail url="(.*?)"/) || [])[1] ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const description = decodeXmlEntities((block.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || "");
    const viewCount = Number((block.match(/<media:statistics views="(\d+)"/) || [])[1] || 0);
    items.push({ videoId, title, url: link, publishedAt, thumbnail, description, viewCount });
  }
  return items;
}

// No official "is this a Short" flag exists in the RSS feed. YouTube redirects
// /shorts/{id} requests to /watch?v={id} for anything that isn't actually a
// Short, so the final response URL tells us which bucket a video is in.
async function probeIsShort(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, { redirect: "follow", cache: "no-store" });
    return res.url.includes("/shorts/");
  } catch (err) {
    return false;
  }
}

async function annotateShorts(state, videos) {
  const unknown = videos.filter((v) => v.videoId && state.shortsCache[v.videoId] === undefined);
  if (unknown.length) {
    const results = await Promise.allSettled(unknown.map((v) => probeIsShort(v.videoId)));
    unknown.forEach((v, i) => {
      state.shortsCache[v.videoId] = results[i].status === "fulfilled" ? results[i].value : false;
    });
  }
  return videos.map((v) => ({ ...v, isShort: Boolean(state.shortsCache[v.videoId]) }));
}

async function fetchChannelFeed(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const res = await fetch(feedUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Feed request failed ${res.status}`);
  const xml = await res.text();
  const parsed =
    parseRssWithDom(xml)?.filter(Boolean) ||
    parseRssFallback(xml);
  return { videos: parsed.slice(0, VIDEOS_PER_CHANNEL), channelTitle: parseFeedAuthor(xml) };
}

// The feed's top-level <author><name> is the channel's own name, straight from
// YouTube, so it's used to correct titles that were saved from a stale or
// wrong page (e.g. a video title, or another channel's name).
function parseFeedAuthor(xml) {
  const name = xml.match(/<name>(<!\[CDATA\[)?([\s\S]*?)(\]\]>|)<\/name>/)?.[2]?.trim() || "";
  return decodeXmlEntities(name);
}

async function loadVideosForCategory(categoryId) {
  const state = await getState();
  const category = state.categories[categoryId];
  if (!category) return { videos: [], errors: [{ error: "Category not found" }] };

  const errors = [];

  const perChannel = await Promise.allSettled(
    category.channelIds.map(async (channelId) => {
      const channel = state.channels[channelId];
      if (!channel) return [];

      const cached = state.videoCache[channelId];
      // Channels whose title hasn't been checked against the feed yet bypass
      // the cache once, so names saved by older versions get corrected now.
      const isFresh = cached && channel.titleFromFeed && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
      let videos = cached?.videos || [];

      if (!isFresh) {
        try {
          const feed = await fetchChannelFeed(channelId);
          videos = feed.videos;
          state.videoCache[channelId] = { fetchedAt: Date.now(), videos };
          if (feed.channelTitle) {
            channel.title = feed.channelTitle;
            channel.titleFromFeed = true;
          }
          channel.url = `https://www.youtube.com/channel/${channelId}`;
        } catch (err) {
          errors.push({ channelId, channelTitle: channel.title, error: String(err.message || err) });
          console.warn("RSS fetch failed", channelId, err);
        }
      }

      const annotated = await annotateShorts(state, videos);
      const nonShorts = annotated.filter((v) => !v.isShort).slice(0, RESULT_PER_CHANNEL);
      return nonShorts.map((video) => ({ ...video, channelId, channelTitle: channel.title }));
    })
  );

  const aggregate = perChannel.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  await saveState(state);

  aggregate.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return { videos: aggregate, errors };
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
      for (const channelId of [...category.channelIds]) {
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

// Maps any supported YouTube page URL to the URL whose server-rendered HTML
// describes the channel: watch pages by video id, channel pages by their base
// path (so /@x/videos and /@x/shorts share one cache entry).
function normalizeChannelSourceUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (err) {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    return videoId ? { kind: "video", videoId, url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` } : null;
  }
  const channelPath = url.pathname.match(/^\/(channel\/[^/]+|c\/[^/]+|user\/[^/]+|@[^/]+)/)?.[1];
  return channelPath ? { kind: "channel", url: `https://www.youtube.com/${channelPath}` } : null;
}

// Pulls the JSON object assigned to `varName` out of a page's inline scripts.
// Brace-matched rather than regex-terminated, since video descriptions can
// contain arbitrary text like "};var" that would cut a lazy regex short.
function extractInitialJson(html, varName) {
  const marker = new RegExp(`${varName}\\s*=\\s*\\{`).exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length - 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch (err) {
    return value;
  }
}

function parseChannelFromHtml(html, source) {
  let channelId = "";
  let title = "";

  if (source.kind === "video") {
    const details = extractInitialJson(html, "ytInitialPlayerResponse")?.videoDetails;
    // Guard against ever attributing a video to the wrong channel: only trust
    // the response if it is actually about the video we asked for.
    if (details && details.videoId === source.videoId) {
      channelId = details.channelId || "";
      title = details.author || "";
    }
    if (!channelId) {
      channelId = html.match(/"channelId":"(UC[\w-]{22})"/)?.[1] || "";
      const owner = html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/)?.[1];
      title = owner ? decodeJsonString(owner) : "";
    }
  } else {
    const meta = extractInitialJson(html, "ytInitialData")?.metadata?.channelMetadataRenderer;
    channelId = meta?.externalId || html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] || "";
    title = meta?.title || html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || "";
  }

  if (!channelId || !title) return null;
  return { channelId, title, url: `https://www.youtube.com/channel/${channelId}` };
}

const channelResolveCache = new Map();
const RESOLVE_TTL_MS = 10 * 60 * 1000;

// Always resolves from freshly fetched server HTML instead of the tab's DOM:
// YouTube is a SPA, so the inline <script> state and <meta> tags in an open
// tab still describe whichever page was loaded first, not the current one.
async function resolveChannelFromUrl(rawUrl) {
  const source = normalizeChannelSourceUrl(rawUrl);
  if (!source) return null;

  const cached = channelResolveCache.get(source.url);
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.channel;

  try {
    const res = await fetch(source.url, { credentials: "include" });
    if (!res.ok) return null;
    const channel = parseChannelFromHtml(await res.text(), source);
    if (channel) channelResolveCache.set(source.url, { channel, at: Date.now() });
    return channel;
  } catch (err) {
    return null;
  }
}

async function refreshChannelTitle(channelId) {
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    const res = await fetch(feedUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const xml = await res.text();
    const nameMatch = xml.match(/<name>(<!\[CDATA\[)?([\s\S]*?)(\]\]>|)<\/name>/);
    const name = nameMatch?.[2]?.trim();
    if (!name) return null;
    const state = await getState();
    if (!state.channels[channelId]) return null;
    state.channels[channelId].title = name;
    await saveState(state);
    return state.channels[channelId];
  } catch (err) {
    return null;
  }
}

// Scrapes a channel's self-curated "Featured channels" shelf. YouTube has no
// API for algorithmic "similar channels" (relatedToVideoId was deprecated),
// so this only surfaces channels the creator themselves chose to cross-link.
function parseFeaturedChannels(html, excludeChannelId) {
  const seen = new Map();
  const rendererRegex = /"channelRenderer":\{"channelId":"(UC[\w-]{10,})"[\s\S]{0,600}?"title":\{"simpleText":"([^"]+)"/g;
  let match;
  while ((match = rendererRegex.exec(html))) {
    const [, channelId, title] = match;
    if (channelId === excludeChannelId || seen.has(channelId)) continue;
    seen.set(channelId, {
      channelId,
      title: title.replace(/\\u0026/g, "&"),
      url: `https://www.youtube.com/channel/${channelId}`
    });
  }
  return Array.from(seen.values());
}

async function getFeaturedChannels(channelId) {
  const state = await getState();
  const cached = state.featuredCache[channelId];
  if (cached && Date.now() - cached.fetchedAt < FEATURED_TTL_MS) {
    return { channels: cached.channels };
  }

  try {
    const res = await fetch(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/channels`, {
      credentials: "omit"
    });
    if (!res.ok) return { channels: cached?.channels || [] };
    const html = await res.text();
    const channels = parseFeaturedChannels(html, channelId);
    state.featuredCache[channelId] = { fetchedAt: Date.now(), channels };
    await saveState(state);
    return { channels };
  } catch (err) {
    return { channels: cached?.channels || [], error: String(err.message || err) };
  }
}

function validateImportedState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { categories, channels, videoCache } = raw;
  if (!categories || typeof categories !== "object") return null;
  if (!channels || typeof channels !== "object") return null;
  // shallow clone
  return {
    categories: { ...categories },
    channels: { ...channels },
    videoCache: videoCache && typeof videoCache === "object" ? { ...videoCache } : {},
    shortsCache: {},
    featuredCache: {}
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "SAVE_CREATOR") {
      const result = await handleSaveCreator(message);
      sendResponse(result);
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

    if (message.type === "RESOLVE_CHANNEL_FROM_URL") {
      const channel = await resolveChannelFromUrl(message.url);
      sendResponse({ channel });
      return;
    }

    if (message.type === "REFRESH_CHANNEL_TITLE") {
      const channel = await refreshChannelTitle(message.channelId);
      sendResponse({ channel });
      return;
    }

    if (message.type === "GET_FEATURED_CHANNELS") {
      sendResponse(await getFeaturedChannels(message.channelId));
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

    sendResponse({ error: "Unknown message" });
  })();
  return true;
});
