const categoriesEl = document.getElementById("categories");
const addStatus = document.getElementById("add-status");

document.getElementById("add-category-btn").addEventListener("click", async () => {
  const name = document.getElementById("new-category-name").value.trim();
  if (!name) {
    addStatus.textContent = "Enter a category name.";
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: "CREATE_CATEGORY", name });
  addStatus.textContent = res?.existed ? "Category already exists." : "Category added.";
  document.getElementById("new-category-name").value = "";
  await loadState();
});

async function loadState() {
  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  render(res.state || { categories: {}, channels: {} });
}

function render(state) {
  categoriesEl.innerHTML = "";
  const categories = Object.values(state.categories);
  if (!categories.length) {
    categoriesEl.innerHTML = '<div class="empty">No categories yet.</div>';
    return;
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));
  categories.forEach((cat) => {
    const wrapper = document.createElement("div");
    wrapper.className = "category";
    wrapper.innerHTML = `
      <div class="category-header">
        <div><strong>${cat.name}</strong> (${cat.channelIds.length})</div>
        <div class="category-actions">
          <button class="secondary" data-action="rename">Rename</button>
          <button class="secondary" data-action="delete">Delete</button>
        </div>
      </div>
      <div class="creators"></div>
    `;
    const creatorsEl = wrapper.querySelector(".creators");
    if (!cat.channelIds.length) {
      creatorsEl.innerHTML = '<div class="empty">No creators yet.</div>';
    } else {
      cat.channelIds.forEach((channelId) => {
        const channel = state.channels[channelId];
        if (!channel) return;
        const row = document.createElement("div");
        row.className = "creator";
        row.innerHTML = `
          <div><a href="${channel.url}" target="_blank">${channel.title}</a></div>
          <button class="secondary" data-action="remove" data-channel="${channelId}">Remove</button>
        `;
        creatorsEl.appendChild(row);
      });
    }

    wrapper.querySelector("[data-action='rename']").addEventListener("click", async () => {
      const newName = prompt("New name", cat.name);
      if (!newName) return;
      await chrome.runtime.sendMessage({ type: "RENAME_CATEGORY", categoryId: cat.id, newName });
      await loadState();
    });

    wrapper.querySelector("[data-action='delete']").addEventListener("click", async () => {
      if (!confirm(`Delete category "${cat.name}"?`)) return;
      await chrome.runtime.sendMessage({ type: "DELETE_CATEGORY", categoryId: cat.id });
      await loadState();
    });

    wrapper.querySelectorAll("[data-action='remove']").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const channelId = e.currentTarget.getAttribute("data-channel");
        await chrome.runtime.sendMessage({
          type: "REMOVE_CHANNEL_FROM_CATEGORY",
          categoryId: cat.id,
          channelId
        });
        await loadState();
      });
    });

    categoriesEl.appendChild(wrapper);
  });
}

loadState();
