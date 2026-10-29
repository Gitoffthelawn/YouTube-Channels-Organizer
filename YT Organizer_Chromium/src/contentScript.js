const BTN_ID = "yto-save-creator-btn";
const MODAL_ID = "yto-save-modal";
const TOAST_ID = "yto-toast";
let outsideClickHandler = null;

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const isSupportedPage = () =>
  (location.pathname === "/watch" && new URLSearchParams(location.search).has("v")) ||
  /^\/(channel|c|user)\/[^/]+|^\/@[^/]+/.test(location.pathname);

// Resolution happens in the background from freshly fetched page HTML. The
// tab's own DOM can't be trusted for this: YouTube is a SPA, so the inline
// <script> state and <meta> tags keep describing whichever video or channel
// was loaded first, which made every later save target that first channel.
async function resolveChannel() {
  const res = await chrome.runtime.sendMessage({ type: "RESOLVE_CHANNEL_FROM_URL", url: location.href });
  return res?.channel || null;
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
// entirely - there's no id/class to chase across redesigns. It's only shown on
// pages that belong to a single creator.
function updateButton() {
  const existing = document.getElementById(BTN_ID);
  if (!isSupportedPage()) {
    existing?.remove();
    return;
  }
  if (!existing) document.body.appendChild(createButton());
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

async function openSaveModal() {
  closeModal();
  const pageUrl = location.href;
  const detectingToast = setTimeout(() => showToast("Detecting channel..."), 300);
  const channel = await resolveChannel().catch(() => null);
  clearTimeout(detectingToast);
  // The user may have moved on to another video while this was resolving.
  if (location.href !== pageUrl) return;
  if (!channel) {
    showToast("Channel not detected");
    return;
  }

  const categories = (await chrome.runtime.sendMessage({ type: "GET_CATEGORIES" })).categories || [];
  const status = await chrome.runtime.sendMessage({ type: "GET_CHANNEL_STATUS", channelId: channel.channelId });
  const optionsHtml = categories
    .map((c) => `<div class="yto-select-option" data-value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>`)
    .join("");
  const existingText = status.categories?.length ? `Already in: ${status.categories.map((c) => escapeHtml(c.name)).join(", ")}` : "";

  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="yto-modal-content">
      <div class="yto-modal-header">
        <div class="yto-modal-title">Save "${escapeHtml(channel.title)}"</div>
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
    const result = await chrome.runtime.sendMessage({
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
  // A modal left open across navigation would save the previous page's channel.
  document.addEventListener("yt-navigate-start", closeModal);
  document.addEventListener("yt-navigate-finish", updateButton);
  window.addEventListener("popstate", updateButton);
}

updateButton();
observeNavigation();
