const apiKeyInput = document.getElementById('apiKey');
const toggleApiKeyVisibilityButton = document.getElementById('toggleApiKeyVisibility');
const saveApiKeyButton = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const apiKeySection = document.getElementById('apiKeySection');
const accordionHeader = document.querySelector('.accordion-header');

const channelInfoDiv = document.getElementById('channelInfo');
const channelActionsDiv = document.getElementById('channelActions');
const channelNameSpan = document.getElementById('channelName');
const channelIdSpan = document.getElementById('channelId');
const categorySelect = document.getElementById('categorySelect');
const newCategoryNameInput = document.getElementById('newCategoryName');
const addChannelToCategoryButton = document.getElementById('addChannelToCategory');
const viewCategoriesButton = document.getElementById('viewCategories');
const infoMessage = document.getElementById('infoMessage');
const existingCategoriesDisplay = document.getElementById('existingCategoriesDisplay');

let currentChannelData = null;

if (accordionHeader) {
    accordionHeader.addEventListener('click', () => {
        const isOpen = apiKeySection.classList.toggle('open');
        accordionHeader.setAttribute('aria-expanded', isOpen);
    });
}

toggleApiKeyVisibilityButton.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleApiKeyVisibilityButton.textContent = 'Hide';
    } else {
        apiKeyInput.type = 'password';
        toggleApiKeyVisibilityButton.textContent = 'Show';
    }
});

saveApiKeyButton.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        try {
            await browser.storage.sync.set({ apiKey: key });
            apiKeyStatus.textContent = 'API Key saved!';
            apiKeyStatus.className = 'success';
            setTimeout(() => apiKeyStatus.textContent = '', 2000);
            await loadApiKey();
            if (apiKeySection.classList.contains('open')) {
                apiKeySection.classList.remove('open');
                accordionHeader.setAttribute('aria-expanded', 'false');
            }
            await getCurrentTabInfo();
        } catch (error) {
            console.error("Error saving API key:", error);
            apiKeyStatus.textContent = 'Error saving key.';
            apiKeyStatus.className = 'error';
        }
    } else {
        apiKeyStatus.textContent = 'Please enter an API Key.';
        apiKeyStatus.className = 'error';
    }
});

async function loadApiKey() {
    try {
        const data = await browser.storage.sync.get('apiKey');
        if (data.apiKey) {
            apiKeyInput.value = data.apiKey;
            apiKeyStatus.textContent = 'API Key is set.';
            apiKeyStatus.className = 'success help-text';
            if (apiKeySection.classList.contains('open')) {
                apiKeySection.classList.remove('open');
                accordionHeader.setAttribute('aria-expanded', 'false');
            }
        } else {
            apiKeyStatus.textContent = 'API Key not set. Please add your YouTube Data API v3 key.';
            apiKeyStatus.className = 'error help-text';
            if (!apiKeySection.classList.contains('open')) {
                apiKeySection.classList.add('open');
                accordionHeader.setAttribute('aria-expanded', 'true');
            }
            channelInfoDiv.innerHTML = '<p class="error">Set API Key to fetch channel info.</p>';
        }
    } catch (error) {
        console.error("Error loading API key:", error);
        apiKeyStatus.textContent = 'Error loading key state.';
        apiKeyStatus.className = 'error';
    }
}

async function getCurrentTabInfo() {
    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab && tab.url && tab.url.includes("youtube.com/watch")) {
            const videoId = new URL(tab.url).searchParams.get("v");
            if (videoId) {
                const response = await browser.runtime.sendMessage({ type: "GET_CHANNEL_INFO", videoId: videoId });
                if (response.error) {
                    channelInfoDiv.innerHTML = `<p class="error">Error: ${response.error}</p>`;
                    channelActionsDiv.style.display = 'none';
                } else if (response.channelId && response.channelTitle) {
                    currentChannelData = {
                        id: response.channelId,
                        name: response.channelTitle,
                        imageUrl: response.channelImageUrl
                    };
                    channelNameSpan.textContent = currentChannelData.name;
                    channelIdSpan.textContent = currentChannelData.id;
                    channelInfoDiv.style.display = 'none';
                    channelActionsDiv.style.display = 'block';
                    await loadCategoriesForSelect();
                    await checkIfChannelExists(currentChannelData.id);
                } else {
                    channelInfoDiv.innerHTML = `<p class="error">Could not fetch channel info. Is API key valid?</p>`;
                }
            } else {
                channelInfoDiv.innerHTML = "<p>Not a YouTube video page (no video ID).</p>";
                channelActionsDiv.style.display = 'none';
            }
        } else {
            channelInfoDiv.innerHTML = "<p>Not on a YouTube video page.</p>";
            channelActionsDiv.style.display = 'none';
        }
    } catch (error) {
        console.error("Error getting current tab info:", error);
        channelInfoDiv.innerHTML = `<p class="error">Error: ${error.message}. Try reloading.</p>`;
        channelActionsDiv.style.display = 'none';
    }
}

async function loadCategoriesForSelect() {
    try {
        const data = await browser.storage.sync.get('categories');
        const categories = data.categories || {};
        categorySelect.innerHTML = '<option value="">-- Select Category --</option>';
        Object.keys(categories).sort().forEach(catName => {
            const option = document.createElement('option');
            option.value = catName;
            option.textContent = catName;
            categorySelect.appendChild(option);
        });
    } catch (error) { console.error("Error loading categories for select:", error); }
}

async function checkIfChannelExists(channelId) {
    existingCategoriesDisplay.innerHTML = '';
    try {
        const data = await browser.storage.sync.get('categories');
        const categories = data.categories || {};
        const foundInCategories = [];
        for (const catName in categories) {
            if (categories[catName].some(ch => ch.id === channelId)) {
                foundInCategories.push(catName);
            }
        }
        if (foundInCategories.length > 0) {
            existingCategoriesDisplay.innerHTML = `Channel already in: <strong>${foundInCategories.join(', ')}</strong>`;
        } else {
            existingCategoriesDisplay.innerHTML = `Channel not yet categorized.`;
        }
    } catch (error) { console.error("Error checking if channel exists:", error); }
}

addChannelToCategoryButton.addEventListener('click', async () => {
    if (!currentChannelData || !currentChannelData.id || !currentChannelData.name) {
        infoMessage.textContent = "No channel data loaded, or data is incomplete.";
        infoMessage.className = 'error';
        return;
    }
    const selectedCategory = categorySelect.value;
    const newCategory = newCategoryNameInput.value.trim();
    let targetCategoryName = "";
    if (newCategory) targetCategoryName = newCategory;
    else if (selectedCategory) targetCategoryName = selectedCategory;
    else {
        infoMessage.textContent = "Please select an existing category or enter a new one.";
        infoMessage.className = 'error';
        return;
    }
    infoMessage.textContent = `Adding ${currentChannelData.name} to ${targetCategoryName}...`;
    infoMessage.className = '';
    const channelDataToSend = {
        id: currentChannelData.id,
        name: currentChannelData.name,
        imageUrl: currentChannelData.imageUrl || 'icons/icon48.png'
    };
    try {
        const response = await browser.runtime.sendMessage({
            type: "ADD_CHANNEL_TO_CATEGORY",
            channel: channelDataToSend,
            categoryName: targetCategoryName
        });
        if (response.success) {
            infoMessage.textContent = `Channel added to ${targetCategoryName}!`;
            infoMessage.className = 'success';
            newCategoryNameInput.value = '';
            categorySelect.value = '';
            await loadCategoriesForSelect();
            await checkIfChannelExists(currentChannelData.id);
        } else {
            infoMessage.textContent = `Error: ${response.error || 'Could not add channel.'}`;
            infoMessage.className = 'error';
        }
    } catch (error) {
        console.error("Error adding channel to category:", error);
        infoMessage.textContent = `Error: ${error.message}`;
        infoMessage.className = 'error';
    }
    setTimeout(() => infoMessage.textContent = '', 3000);
});

viewCategoriesButton.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
});

document.addEventListener('DOMContentLoaded', async () => {
    await loadApiKey();
    await getCurrentTabInfo();
});