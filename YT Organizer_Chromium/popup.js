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

saveApiKeyButton.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        chrome.storage.sync.set({ apiKey: key }, () => {
            if (chrome.runtime.lastError) {
                apiKeyStatus.textContent = `Error saving key: ${chrome.runtime.lastError.message}`;
                apiKeyStatus.className = 'error';
                return;
            }
            apiKeyStatus.textContent = 'API Key saved!';
            apiKeyStatus.className = 'success';
            setTimeout(() => apiKeyStatus.textContent = '', 2000);
            loadApiKey();
            if (apiKeySection.classList.contains('open')) {
                apiKeySection.classList.remove('open');
                accordionHeader.setAttribute('aria-expanded', 'false');
            }
            getCurrentTabInfo();
        });
    } else {
        apiKeyStatus.textContent = 'Please enter an API Key.';
        apiKeyStatus.className = 'error';
    }
});

function loadApiKey() {
    chrome.storage.sync.get('apiKey', (data) => {
        if (chrome.runtime.lastError) {
            apiKeyStatus.textContent = `Error loading key: ${chrome.runtime.lastError.message}`;
            apiKeyStatus.className = 'error help-text';
            return;
        }
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
    });
}

async function getCurrentTabInfo() {
    try {
        const [tab] = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
        if (tab && tab.url && tab.url.includes("youtube.com/watch")) {
            const videoId = new URL(tab.url).searchParams.get("v");
            if (videoId) {
                chrome.runtime.sendMessage({ type: "GET_CHANNEL_INFO", videoId: videoId }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error sending message to background:", chrome.runtime.lastError.message);
                        channelInfoDiv.innerHTML = `<p class="error">Error: ${chrome.runtime.lastError.message}. Try reloading.</p>`;
                        channelActionsDiv.style.display = 'none';
                        return;
                    }
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
                        loadCategoriesForSelect();
                        checkIfChannelExists(currentChannelData.id);
                    } else {
                        channelInfoDiv.innerHTML = `<p class="error">Could not fetch channel info. Is API key valid?</p>`;
                    }
                });
            } else {
                channelInfoDiv.innerHTML = "<p>Not a YouTube video page (no video ID).</p>";
                channelActionsDiv.style.display = 'none';
            }
        } else {
            channelInfoDiv.innerHTML = "<p>Not on a YouTube video page.</p>";
            channelActionsDiv.style.display = 'none';
        }
    } catch (error) { // This catch is for the chrome.tabs.query promise, though unlikely to fail
        console.error("Error querying tabs:", error);
        channelInfoDiv.innerHTML = `<p class="error">Could not get tab information.</p>`;
    }
}

function loadCategoriesForSelect() {
    chrome.storage.sync.get('categories', (data) => {
        if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return; }
        const categories = data.categories || {};
        categorySelect.innerHTML = '<option value="">-- Select Category --</option>';
        Object.keys(categories).sort().forEach(catName => {
            const option = document.createElement('option');
            option.value = catName;
            option.textContent = catName;
            categorySelect.appendChild(option);
        });
    });
}

function checkIfChannelExists(channelId) {
    existingCategoriesDisplay.innerHTML = '';
    chrome.storage.sync.get('categories', (data) => {
        if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return; }
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
    });
}

addChannelToCategoryButton.addEventListener('click', () => {
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
    chrome.runtime.sendMessage({
        type: "ADD_CHANNEL_TO_CATEGORY",
        channel: channelDataToSend,
        categoryName: targetCategoryName
    }, (response) => {
        if (chrome.runtime.lastError) {
             infoMessage.textContent = `Error: ${chrome.runtime.lastError.message}`;
             infoMessage.className = 'error';
             return;
        }
        if (response.success) {
            infoMessage.textContent = `Channel added to ${targetCategoryName}!`;
            infoMessage.className = 'success';
            newCategoryNameInput.value = '';
            categorySelect.value = '';
            loadCategoriesForSelect();
            checkIfChannelExists(currentChannelData.id);
        } else {
            infoMessage.textContent = `Error: ${response.error || 'Could not add channel.'}`;
            infoMessage.className = 'error';
        }
        setTimeout(() => infoMessage.textContent = '', 3000);
    });
});

viewCategoriesButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

document.addEventListener('DOMContentLoaded', () => {
    loadApiKey();
    getCurrentTabInfo();
});