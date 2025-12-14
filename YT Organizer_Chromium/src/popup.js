const popupCategorySelect = document.getElementById("popup-category-select");
const popupCategoryInput = document.getElementById("popup-category-input");
const saveStatus = document.getElementById("save-status");
const currentChannelEl = document.getElementById("current-channel");

let currentTabChannel = null;

const statusMsg = (text) => {
  currentChannelEl.textContent = text;
};

document.getElementById("library-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/library.html") });
});

async function loadCategories() {
  const res = await chrome.runtime.sendMessage({ type: "GET_CATEGORIES" });
  const categories = res.categories || [];
  popupCategorySelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select an existing category";
  popupCategorySelect.appendChild(placeholder);
  categories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = cat.name;
    popupCategorySelect.appendChild(opt);
  });
}

async function detectChannelFromTab() {
  saveStatus.textContent = "";
  statusMsg("Detecting channel...");
  currentTabChannel = null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    statusMsg("No active tab.");
    return;
  }
  const isYouTube = tab.url && tab.url.includes("youtube.com");
  const isWatch = tab.url && tab.url.includes("youtube.com/watch");
  if (!isYouTube) {
    statusMsg("Not a YouTube page.");
    return;
  }
  if (!isWatch) {
    statusMsg("Open a YouTube watch page to save the creator.");
    return;
  }

  // First try messaging the content script (if present).
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_CHANNEL_INFO" });
    if (res?.channel) {
      currentTabChannel = res.channel;
      statusMsg(`Detected: ${res.channel.title}`);
      await showChannelMembership();
      return;
    }
  } catch (e) {
    // ignore; fall through to injected script
  }

  // Fallback: execute a small script to extract channel info.
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const channelId = document.querySelector('meta[itemprop="channelId"]')?.getAttribute("content") || "";
        const title =
          document.querySelector("#owner #channel-name a")?.textContent?.trim() ||
          document.querySelector("ytd-channel-name #container")?.textContent?.trim() ||
          document.querySelector('meta[itemprop="name"]')?.getAttribute("content") ||
          "";
        const url = document.querySelector("#owner #channel-name a")?.href || (channelId ? `https://www.youtube.com/channel/${channelId}` : "");
        if (!channelId || !title) return null;
        return { channelId, title, url };
      }
    });
    if (result) {
      currentTabChannel = result;
      statusMsg(`Detected: ${result.title}`);
      await showChannelMembership();
      return;
    }
  } catch (err) {
    // continue to URL resolver below
  }

  // Final fallback: resolve via background using oEmbed/page scrape.
  try {
    const res = await chrome.runtime.sendMessage({ type: "RESOLVE_CHANNEL_FROM_URL", url: tab.url });
    if (res?.channel) {
      currentTabChannel = res.channel;
      statusMsg(`Detected: ${res.channel.title}`);
      await showChannelMembership();
      return;
    }
  } catch (err) {
    // ignore
  }

  statusMsg("No creator detected on this tab.");
}

async function showChannelMembership() {
  if (!currentTabChannel) return;
  const status = await chrome.runtime.sendMessage({
    type: "GET_CHANNEL_STATUS",
    channelId: currentTabChannel.channelId
  });
  if (status.categories?.length) {
    statusMsg(
      `Detected: ${currentTabChannel.title} (in: ${status.categories
        .map((c) => c.name)
        .join(", ")})`
    );
  }
}

document.getElementById("popup-save-btn").addEventListener("click", async () => {
  if (!currentTabChannel) {
    saveStatus.textContent = "No creator detected on this tab.";
    return;
  }
  const categoryName = (popupCategoryInput.value || popupCategorySelect.value).trim();
  if (!categoryName) {
    saveStatus.textContent = "Enter a category name.";
    return;
  }
  try {
    saveStatus.textContent = "Saving...";
    const result = await chrome.runtime.sendMessage({
      type: "SAVE_CREATOR",
      categoryName,
      channel: currentTabChannel
    });
    saveStatus.textContent = result?.status === "exists"
      ? `Already in "${categoryName}".`
      : `Saved to "${result?.category?.name || categoryName}".`;
    popupCategoryInput.value = "";
    await loadCategories();
    await showChannelMembership();
  } catch (err) {
    saveStatus.textContent = "Save failed. Check permissions and try again.";
  }
});

loadCategories();
detectChannelFromTab();
