const BTN_ID = "yto-save-creator-btn";
const MODAL_ID = "yto-save-modal";
const TOAST_ID = "yto-toast";
const api = typeof browser !== "undefined" ? browser : chrome;
let lastInjectedUrl = "";

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function getChannelInfo() {
  const channelId =
    document.querySelector('meta[itemprop="channelId"]')?.getAttribute("content") ||
    "";
  const channelName =
    document.querySelector("#owner #channel-name a")?.textContent?.trim() ||
    document.querySelector("ytd-channel-name #container")?.textContent?.trim() ||
    document.querySelector('meta[itemprop="name"]')?.getAttribute("content") ||
    "";
  const channelUrl =
    document.querySelector("#owner #channel-name a")?.href ||
    (channelId ? `https://www.youtube.com/channel/${channelId}` : "");

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

function injectButton() {
  const currentUrl = location.href;
  if (currentUrl === lastInjectedUrl && document.getElementById(BTN_ID)) return;
  lastInjectedUrl = currentUrl;

  const container =
    document.querySelector("#owner #subscribe-button") ||
    document.querySelector("#owner") ||
    document.querySelector("#meta-contents");

  if (!container) return;

  if (document.getElementById(BTN_ID)) {
    return;
  }

  const btn = createButton();
  container.appendChild(btn);
}

function closeModal() {
  const modal = document.getElementById(MODAL_ID);
  if (modal) modal.remove();
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

async function openSaveModal() {
  closeModal();
  const channel = getChannelInfo();
  if (!channel) {
    showToast("Channel not detected");
    return;
  }

  const categories = (await api.runtime.sendMessage({ type: "GET_CATEGORIES" })).categories || [];
  const status = await api.runtime.sendMessage({ type: "GET_CHANNEL_STATUS", channelId: channel.channelId });
  const escapedOptions = categories.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join("");
  const existingText = status.categories?.length ? `Already in: ${status.categories.map((c) => escapeHtml(c.name)).join(", ")}` : "";

  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="yto-modal-content">
      <div class="yto-modal-header">
        <div class="yto-modal-title">Save "${channel.title}"</div>
        <button class="yto-close-btn" aria-label="Close">×</button>
      </div>
      <label class="yto-label">Choose or create category</label>
      <input id="yto-category-input" list="yto-category-datalist" placeholder="e.g., AI Creators" />
      <datalist id="yto-category-datalist">
        ${escapedOptions}
      </datalist>
      ${existingText ? `<div class="yto-existing">${existingText}</div>` : ""}
      <div class="yto-actions">
        <button id="yto-save-btn">Save</button>
        <button id="yto-cancel-btn" class="secondary">Cancel</button>
      </div>
    </div>
  `;

  modal.querySelector(".yto-close-btn").addEventListener("click", closeModal);
  modal.querySelector("#yto-cancel-btn").addEventListener("click", closeModal);

  modal.querySelector("#yto-save-btn").addEventListener("click", async () => {
    const categoryName = modal.querySelector("#yto-category-input").value.trim();
    if (!categoryName) {
      showToast("Enter a category name");
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
  modal.querySelector("#yto-category-input").focus();
}

function observeNavigation() {
  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-finish", () => setTimeout(injectButton, 300));
  window.addEventListener("popstate", () => setTimeout(injectButton, 300));
}

injectButton();
observeNavigation();

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_CHANNEL_INFO") {
    sendResponse({ channel: getChannelInfo() });
  }
});
