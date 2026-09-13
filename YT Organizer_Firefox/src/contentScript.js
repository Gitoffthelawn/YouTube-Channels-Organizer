const BTN_ID = "yto-save-creator-btn";
const MODAL_ID = "yto-save-modal";
const TOAST_ID = "yto-toast";
const api = typeof browser !== "undefined" ? browser : chrome;
let lastInjectedUrl = "";
let outsideClickHandler = null;

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// One flat priority chain, tried on every page type, rather than branching
// on watch-vs-channel: a selector that doesn't apply to the current page
// simply won't match, so this stays correct without needing to track which
// page layout YouTube is currently using. Two separate chains previously
// drifted out of sync with the popup's own fallback detector, which is what
// caused inconsistent "channel not detected" results between the two.
function getChannelId() {
  // The canonical link only resolves to a /channel/UC... URL when you're
  // actually on a channel page (on the watch page it points at the video),
  // so it doubles as a safe channel-page-only signal without extra checks.
  const canonicalId = document.querySelector('link[rel="canonical"]')?.href?.match(/channel\/(UC[\w-]+)/)?.[1] || "";
  if (canonicalId) return canonicalId;

  const metaId = document.querySelector('meta[itemprop="channelId"]')?.getAttribute("content") || "";
  if (metaId) return metaId;

  // Last resort: that meta tag is absent on some current watch-page markup
  // (confirmed via live inspection), but YouTube always embeds the real
  // channel id in its own internal JSON state inside an inline <script> tag,
  // regardless of what shows up in visible meta tags.
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    if (!text || !text.includes("channelId")) continue;
    const match = text.match(/"channelId":"(UC[\w-]+)"/);
    if (match) return match[1];
  }
  return "";
}

function getChannelInfo() {
  const channelId = getChannelId();
  const channelName =
    document.querySelector("#owner #channel-name a")?.textContent?.trim() ||
    document.querySelector("#channel-name #text")?.textContent?.trim() ||
    document.querySelector("ytd-channel-name #text")?.textContent?.trim() ||
    document.querySelector("ytd-channel-name #container")?.textContent?.trim() ||
    document.querySelector("yt-dynamic-text-view-model h1")?.textContent?.trim() ||
    document.querySelector('meta[itemprop="name"]')?.getAttribute("content") ||
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    "";
  const channelUrl =
    document.querySelector("#owner #channel-name a")?.href ||
    document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
    "";

  if (!channelId || !channelName) return null;
  return {
    channelId,
    title: channelName,
    url: channelUrl || `https://www.youtube.com/channel/${channelId}`
  };
}

function createButton() {
  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.textContent = "Save creator";
  btn.addEventListener("click", openSaveModal);
  return btn;
}

// A fixed-position button anchored to the viewport, rather than inserted next
// to YouTube's Subscribe button, sidesteps YouTube's frequently-changing DOM
// entirely - there's no id/class to chase across redesigns.
function injectButton() {
  const currentUrl = location.href;
  if (currentUrl === lastInjectedUrl && document.getElementById(BTN_ID)) return;
  lastInjectedUrl = currentUrl;

  if (document.getElementById(BTN_ID)) return;
  document.body.appendChild(createButton());
}

function closeModal() {
  const modal = document.getElementById(MODAL_ID);
  if (modal) modal.remove();
  if (outsideClickHandler) {
    document.removeEventListener("click", outsideClickHandler);
    outsideClickHandler = null;
  }
}

function showToast(text) {
  let toast = document.getElementById(TOAST_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = TOAST_ID;
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2200);
}

// The button is now always on screen, so it can be clicked before YouTube's
// SPA has finished populating the channel metadata in the DOM (e.g. right
// after navigating to a new video). Give it a brief window to catch up
// instead of failing immediately.
async function waitForChannelInfo(retries = 6, delayMs = 250) {
  for (let i = 0; i < retries; i++) {
    const channel = getChannelInfo();
    if (channel) return channel;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

async function openSaveModal() {
  closeModal();
  if (!getChannelInfo()) showToast("Detecting channel...");
  const channel = await waitForChannelInfo();
  if (!channel) {
    showToast("Channel not detected");
    return;
  }

  const categories = (await api.runtime.sendMessage({ type: "GET_CATEGORIES" })).categories || [];
  const status = await api.runtime.sendMessage({ type: "GET_CHANNEL_STATUS", channelId: channel.channelId });
  const optionsHtml = categories
    .map((c) => `<div class="yto-select-option" data-value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>`)
    .join("");
  const existingText = status.categories?.length ? `Already in: ${status.categories.map((c) => escapeHtml(c.name)).join(", ")}` : "";

  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="yto-modal-content">
      <div class="yto-modal-header">
        <div class="yto-modal-title">Save "${channel.title}"</div>
        <button class="yto-close-btn" aria-label="Close">×</button>
      </div>
      <label class="yto-label">Select an existing category</label>
      <div class="yto-select" id="yto-category-select">
        <button type="button" class="yto-select-trigger" id="yto-select-trigger">
          <span id="yto-select-label">Select an existing category</span>
          <span class="yto-select-arrow">▾</span>
        </button>
        <div class="yto-select-menu hidden" id="yto-select-menu">
          ${categories.length ? optionsHtml : '<div class="yto-select-empty">No categories yet</div>'}
        </div>
      </div>
      <label class="yto-label">Or create new</label>
      <input id="yto-category-input" placeholder="Enter new category name" />
      ${existingText ? `<div class="yto-existing">${existingText}</div>` : ""}
      <div class="yto-actions">
        <button id="yto-save-btn">Save</button>
        <button id="yto-cancel-btn" class="secondary">Cancel</button>
      </div>
    </div>
  `;

  modal.querySelector(".yto-close-btn").addEventListener("click", closeModal);
  modal.querySelector("#yto-cancel-btn").addEventListener("click", closeModal);

  let selectedCategory = "";
  const selectTrigger = modal.querySelector("#yto-select-trigger");
  const selectMenu = modal.querySelector("#yto-select-menu");
  const selectLabel = modal.querySelector("#yto-select-label");
  const categoryInput = modal.querySelector("#yto-category-input");

  selectTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    selectMenu.classList.toggle("hidden");
  });

  selectMenu.querySelectorAll(".yto-select-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      selectedCategory = opt.dataset.value;
      selectLabel.textContent = selectedCategory;
      selectMenu.classList.add("hidden");
      categoryInput.value = "";
    });
  });

  outsideClickHandler = () => selectMenu.classList.add("hidden");
  document.addEventListener("click", outsideClickHandler);

  modal.querySelector("#yto-save-btn").addEventListener("click", async () => {
    const categoryName = categoryInput.value.trim() || selectedCategory;
    if (!categoryName) {
      showToast("Enter or select a category");
      return;
    }
    const result = await api.runtime.sendMessage({
      type: "SAVE_CREATOR",
      categoryName,
      channel
    });
    if (result.status === "exists") {
      showToast(`Already in "${categoryName}"`);
    } else {
      showToast(`Saved to "${result.category.name}"`);
    }
    closeModal();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.body.appendChild(modal);
  categoryInput.focus();
}

function observeNavigation() {
  document.addEventListener("yt-navigate-finish", () => injectButton());
  window.addEventListener("popstate", () => injectButton());
}

injectButton();
observeNavigation();

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_CHANNEL_INFO") {
    sendResponse({ channel: getChannelInfo() });
  }
});
