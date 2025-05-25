// --- DOM Elements ---
const categoryTabsContainer = document.getElementById('categoryTabsContainer');
const categoryTabsDiv = document.getElementById('categoryTabs');
const categoryDropdown = document.getElementById('categoryDropdown');
const categoryContentDiv = document.getElementById('categoryContent');
const videoPlayerArea = document.getElementById('videoPlayerArea');
const youtubePlayer = document.getElementById('youtubePlayer');
const closePlayerButton = document.getElementById('closePlayerButton');
const categoriesPageContainer = document.querySelector('.categories-page-container');

const exportCsvLink = document.getElementById('exportCsvLink');
const importCsvLink = document.getElementById('importCsvLink');
const importCsvFileHidden = document.getElementById('importCsvFileHidden');
const importStatusMessage = document.getElementById('importStatusMessage');
const undoImportToast = document.getElementById('undoImportToast');
const undoImportButton = document.getElementById('undoImportButton');

// --- Global State ---
let allCategoriesData = {};
let categoryOrder = [];
let currentViewMode = 'channels';
let currentCategoryName = null;
let previousCategoriesDataForUndo = null;
let undoTimeout = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadCategoriesAndOrder();
    window.addEventListener('resize', handleTabOverflow);

    if (exportCsvLink) exportCsvLink.addEventListener('click', handleExportCsv);
    if (importCsvLink) {
        importCsvLink.addEventListener('click', () => importCsvFileHidden.click());
    }
    if (importCsvFileHidden) {
        importCsvFileHidden.addEventListener('change', handleImportCsvFileSelect);
    }
    if (undoImportButton) undoImportButton.addEventListener('click', handleUndoImport);
});

closePlayerButton.addEventListener('click', () => {
    videoPlayerArea.style.display = 'none';
    youtubePlayer.src = '';
    categoriesPageContainer.classList.remove('video-playing');
});

// --- Storage Helpers for chrome.storage.sync ---
async function getSyncStorage(keys) {
    return new Promise(resolve => chrome.storage.sync.get(keys, result => {
        if (chrome.runtime.lastError) console.error("getSyncStorage Error:", chrome.runtime.lastError.message, "Keys:", keys);
        resolve(result);
    }));
}
async function setSyncStorage(dataObject) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set(dataObject, () => {
            if (chrome.runtime.lastError) {
                console.error("setSyncStorage Error:", chrome.runtime.lastError.message, "Data:", dataObject);
                reject(chrome.runtime.lastError);
            } else resolve();
        });
    });
}

// --- Data Loading and Order Management ---
async function loadCategoriesAndOrder() {
    try {
        const data = await getSyncStorage(['categories', 'apiKey', 'categoryOrder']);
        allCategoriesData = data.categories || {};
        const apiKey = data.apiKey;
        categoryOrder = data.categoryOrder || [];

        const categoryKeysFromData = Object.keys(allCategoriesData);
        let orderNeedsUpdate = false;

        const validCategoriesInOrder = categoryOrder.filter(catName => categoryKeysFromData.includes(catName));
        if (validCategoriesInOrder.length !== categoryOrder.length) {
            orderNeedsUpdate = true;
            categoryOrder = validCategoriesInOrder;
        }
        categoryKeysFromData.forEach(catName => {
            if (!categoryOrder.includes(catName)) {
                categoryOrder.push(catName);
                orderNeedsUpdate = true;
            }
        });
        if (categoryKeysFromData.length === 0 && categoryOrder.length > 0) {
            categoryOrder = [];
            orderNeedsUpdate = true;
        }
        if (orderNeedsUpdate) await saveCategoryOrder();

        if (!apiKey) {
            categoryTabsDiv.innerHTML = `<p class="error">API Key not set. Please set it in the extension popup.</p>`;
            categoryContentDiv.innerHTML = '';
            return;
        }
        if (categoryOrder.length === 0) {
            categoryTabsDiv.innerHTML = "<p>No categories saved yet. Add channels from YouTube video pages.</p>";
            categoryContentDiv.innerHTML = '';
            return;
        }

        renderTabs();
        let activeCategory = currentCategoryName;
        if (!activeCategory || !allCategoriesData[activeCategory] || !categoryOrder.includes(activeCategory)) {
            activeCategory = categoryOrder.length > 0 ? categoryOrder[0] : null;
        }
        if (activeCategory) {
            await setActiveCategory(activeCategory);
        } else {
            handleTabOverflow();
            categoryContentDiv.innerHTML = '';
        }
    } catch (error) {
        console.error("Error loading categories/order/API key:", error);
        categoryTabsDiv.innerHTML = `<p class="error">Error loading data: ${error.message}</p>`;
    }
}

async function saveCategoryOrder() {
    try {
        await setSyncStorage({ categoryOrder: categoryOrder });
    } catch (error) { console.error("Error saving category order:", error); }
}

// --- Tab Rendering and Reordering ---
function renderTabs() {
    categoryTabsDiv.innerHTML = '';
    categoryDropdown.innerHTML = '';

    if (categoryOrder.length === 0) {
        categoryTabsDiv.innerHTML = "<p>No categories. Add channels via the popup on YouTube.</p>";
        categoryContentDiv.innerHTML = '';
        handleTabOverflow();
        return;
    }

    categoryOrder.forEach((categoryName, index) => {
        if (!allCategoriesData[categoryName]) return;

        const tabContainer = document.createElement('div');
        tabContainer.classList.add('tab-button-container');

        // Create Move Left Button
        const moveLeftBtn = document.createElement('button');
        moveLeftBtn.classList.add('reorder-btn', 'reorder-btn-left');
        moveLeftBtn.innerHTML = '<'; // Left arrow
        moveLeftBtn.title = 'Move category left';
        moveLeftBtn.disabled = (index === 0);
        moveLeftBtn.addEventListener('click', (e) => { e.stopPropagation(); moveCategory(index, index - 1); });
        tabContainer.appendChild(moveLeftBtn);

        // Create Tab Button (Category Name)
        const tabButton = document.createElement('button');
        tabButton.classList.add('tab-button');
        tabButton.textContent = categoryName;
        tabButton.dataset.category = categoryName;
        tabButton.addEventListener('click', () => setActiveCategory(categoryName));
        tabContainer.appendChild(tabButton);

        // Create Move Right Button
        const moveRightBtn = document.createElement('button');
        moveRightBtn.classList.add('reorder-btn', 'reorder-btn-right');
        moveRightBtn.innerHTML = '>'; // Right arrow
        moveRightBtn.title = 'Move category right';
        moveRightBtn.disabled = (index === categoryOrder.length - 1);
        moveRightBtn.addEventListener('click', (e) => { e.stopPropagation(); moveCategory(index, index + 1); });
        tabContainer.appendChild(moveRightBtn);

        categoryTabsDiv.appendChild(tabContainer);

        const option = document.createElement('option');
        option.value = categoryName;
        option.textContent = categoryName;
        categoryDropdown.appendChild(option);
    });

    categoryDropdown.removeEventListener('change', handleDropdownChange);
    categoryDropdown.addEventListener('change', handleDropdownChange);
    handleTabOverflow();
    updateActiveTabHighlight(currentCategoryName);
}

async function moveCategory(oldIndex, newIndex) {
    if (newIndex < 0 || newIndex >= categoryOrder.length) return;
    const categoryToMove = categoryOrder.splice(oldIndex, 1)[0];
    categoryOrder.splice(newIndex, 0, categoryToMove);
    await saveCategoryOrder();
    renderTabs();
}

function updateActiveTabHighlight(categoryName) {
    document.querySelectorAll('.tab-button-container.active').forEach(c => c.classList.remove('active'));
    if (categoryName && categoryOrder.includes(categoryName)) {
      const tabButton = document.querySelector(`.tab-button[data-category="${CSS.escape(categoryName)}"]`);
      if (tabButton && tabButton.parentElement.classList.contains('tab-button-container')) {
          tabButton.parentElement.classList.add('active');
      }
      if (categoryDropdown.style.display !== 'none') {
          categoryDropdown.value = categoryName;
      }
    } else if (categoryOrder.length > 0 && categoryDropdown.style.display !== 'none'){
        categoryDropdown.value = categoryOrder[0];
    }
}

async function setActiveCategory(categoryName) {
    let targetCategory = categoryName;
    if (!allCategoriesData[targetCategory] || !categoryOrder.includes(targetCategory)) {
        targetCategory = categoryOrder.length > 0 ? categoryOrder[0] : null;
    }
    currentCategoryName = targetCategory;
    currentViewMode = 'channels';
    if (currentCategoryName) renderCategoryContent(currentCategoryName);
    else categoryContentDiv.innerHTML = '';
    updateActiveTabHighlight(currentCategoryName);
}

async function handleDropdownChange(e) {
    await setActiveCategory(e.target.value);
}

function handleTabOverflow() {
    const containerWidth = categoryTabsContainer.offsetWidth;
    let tabsWidth = 0;
    const tabButtonContainers = categoryTabsDiv.querySelectorAll('.tab-button-container');
    if (tabButtonContainers.length === 0) {
        categoryTabsDiv.style.display = 'block';
        categoryDropdown.style.display = 'none';
        return;
    }
    tabButtonContainers.forEach(container => {
        const prevDisplay = container.style.display; container.style.display = '';
        tabsWidth += container.offsetWidth + parseInt(getComputedStyle(container).marginLeft || 0) + parseInt(getComputedStyle(container).marginRight || 0);
        container.style.display = prevDisplay;
    });
    if (tabsWidth > containerWidth - 10 && tabButtonContainers.length > 1) {
        categoryTabsDiv.style.display = 'none'; categoryDropdown.style.display = 'block';
        if (currentCategoryName && categoryOrder.includes(currentCategoryName)) categoryDropdown.value = currentCategoryName;
        else if (categoryOrder.length > 0) categoryDropdown.value = categoryOrder[0];
    } else {
        categoryTabsDiv.style.display = 'flex'; categoryDropdown.style.display = 'none';
    }
}

function renderCategoryContent(categoryName) {
    categoryContentDiv.innerHTML = '';
    const categoryData = allCategoriesData[categoryName];
    if (!categoryData) {
        categoryContentDiv.innerHTML = `<p>Category "${categoryName}" not found or is empty.</p>`; return;
    }
    const headerContainer = document.createElement('div');
    headerContainer.classList.add('category-header-controls');
    const headerTitleDiv = document.createElement('div');
    headerTitleDiv.classList.add('category-title-group');
    const h2 = document.createElement('h2');
    h2.id = `categoryNameDisplay-${categoryName.replace(/\s+/g, '-')}`;
    h2.textContent = categoryName;
    headerTitleDiv.appendChild(h2);
    const editButton = document.createElement('button');
    editButton.classList.add('edit-category-name');
    editButton.dataset.category = categoryName;
    editButton.title = "Edit Category Name";
    editButton.innerHTML = '✏️';
    editButton.addEventListener('click', handleEditCategoryName);
    headerTitleDiv.appendChild(editButton);
    const deleteCatButton = document.createElement('button');
    deleteCatButton.classList.add('delete-category');
    deleteCatButton.dataset.category = categoryName;
    deleteCatButton.title = "Delete Category";
    deleteCatButton.innerHTML = '🗑️';
    deleteCatButton.addEventListener('click', handleDeleteCategory);
    headerTitleDiv.appendChild(deleteCatButton);
    headerContainer.appendChild(headerTitleDiv);
    const viewToggleButton = document.createElement('button');
    viewToggleButton.id = 'viewToggleButton';
    viewToggleButton.classList.add('view-toggle-button');
    viewToggleButton.addEventListener('click', () => toggleChannelVideoView(categoryName, categoryData.map(ch => ch.id)));
    headerContainer.appendChild(viewToggleButton);
    categoryContentDiv.appendChild(headerContainer);
    const contentDisplayArea = document.createElement('div');
    contentDisplayArea.id = 'contentDisplayArea';
    categoryContentDiv.appendChild(contentDisplayArea);
    if (currentViewMode === 'videos') {
        viewToggleButton.textContent = 'Show channels';
        fetchRecentVideos(categoryName, categoryData.map(ch => ch.id), contentDisplayArea);
    } else {
        viewToggleButton.textContent = 'Show videos';
        renderChannels(categoryName, categoryData, contentDisplayArea);
    }
}

async function toggleChannelVideoView(categoryName, channelIds) {
    const contentDisplayArea = document.getElementById('contentDisplayArea');
    const viewToggleButton = document.getElementById('viewToggleButton');
    if (currentViewMode === 'channels') {
        currentViewMode = 'videos';
        viewToggleButton.textContent = 'Show channels';
        await fetchRecentVideos(categoryName, channelIds, contentDisplayArea);
    } else {
        currentViewMode = 'channels';
        viewToggleButton.textContent = 'Show videos';
        renderChannels(categoryName, allCategoriesData[categoryName], contentDisplayArea);
    }
}

function renderChannels(categoryName, channels, container) {
    container.innerHTML = '';
    if (!channels || channels.length === 0) {
        container.innerHTML = "<p>No channels in this category. Add some from YouTube!</p>"; return;
    }
    const channelGrid = document.createElement('div');
    channelGrid.classList.add('channel-grid');
    channels.forEach(channel => {
        const card = document.createElement('div');
        card.classList.add('channel-card');
        card.innerHTML = `
            <img src="${channel.imageUrl || 'icons/icon48.png'}" alt="${channel.name}" class="channel-image-card">
            <div class="channel-card-name">${channel.name}</div>
            <div class="channel-card-id">ID: ${channel.id}</div>
            <button class="remove-channel" data-channel-id="${channel.id}" data-category-name="${categoryName}">Remove</button>
        `;
        card.addEventListener('click', () => {
            chrome.tabs.create({
              url: `https://www.youtube.com/channel/${channel.id}`
            });
          });

        channelGrid.appendChild(card);
    });
    container.appendChild(channelGrid);
    document.querySelectorAll('.remove-channel').forEach(button => {
        button.removeEventListener('click', handleRemoveChannel);
        button.addEventListener('click', handleRemoveChannel);
    });
}

async function fetchRecentVideos(categoryName, channelIds, container) {
    container.innerHTML = '<p class="loading-text">Fetching videos...</p>';
    const viewToggleButton = document.getElementById('viewToggleButton');
    if(viewToggleButton) viewToggleButton.disabled = true;
    if (channelIds.length === 0) {
        container.innerHTML = "<p>No channels in this category to fetch videos from.</p>";
        if(viewToggleButton) viewToggleButton.disabled = false; return;
    }
    try {
        const response = await new Promise(resolve => chrome.runtime.sendMessage({ type: "GET_RECENT_VIDEOS", channelIds: channelIds }, resolve));
        if(viewToggleButton) viewToggleButton.disabled = false;
        if (chrome.runtime.lastError || response.error) {
            const errorMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : response.error;
            container.innerHTML = `<p class="error">Error fetching videos: ${errorMsg}</p>`; return;
        }
        if (response.videos && response.videos.length > 0) {
            container.innerHTML = '';
            const videoGrid = document.createElement('div');
            videoGrid.classList.add('video-grid');
            const videosToDisplay = response.videos;
            videosToDisplay.forEach(video => {
                const card = document.createElement('div');
                card.classList.add('video-card');
                const publishedDate = new Date(video.publishedAt).toLocaleDateString();
                card.innerHTML = `
                    <img src="${video.thumbnail}" alt="${video.title}" class="video-thumbnail-card">
                    <div class="video-card-info">
                        <strong class="video-card-title">${video.title}</strong>
                        <p class="video-card-channel">${video.channelName}</p>
                        <p class="video-card-date">Uploaded: ${publishedDate}</p>
                    </div>
                `;
                card.addEventListener('click', () => playVideo(video.id));
                videoGrid.appendChild(card);
            });
            container.appendChild(videoGrid);
        } else {
            container.innerHTML = '<p>No recent non-Short videos found, or an error occurred.</p>';
        }
    } catch (error) {
        if(viewToggleButton) viewToggleButton.disabled = false;
        console.error("Error fetching recent videos from categories.js:", error);
        container.innerHTML = `<p class="error">Unexpected Error: ${error.message}</p>`;
    }
}

function playVideo(videoId) {
    categoriesPageContainer.classList.add('video-playing');
    videoPlayerArea.style.display = 'flex';
    youtubePlayer.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
}

async function handleRemoveChannel(event) {
    const channelId = event.target.dataset.channelId;
    const categoryName = event.target.dataset.categoryName;
    if (confirm(`Are you sure you want to remove channel ID ${channelId} from "${categoryName}"?`)) {
        allCategoriesData[categoryName] = allCategoriesData[categoryName].filter(ch => ch.id !== channelId);
        let activeCategoryAfterDelete = currentCategoryName;
        if (allCategoriesData[categoryName].length === 0) {
            delete allCategoriesData[categoryName];
            categoryOrder = categoryOrder.filter(cat => cat !== categoryName);
            await saveCategoryOrder();
            activeCategoryAfterDelete = categoryOrder.length > 0 ? categoryOrder[0] : null;
        }
        await saveAndUpdateAllCategories(activeCategoryAfterDelete);
    }
}

async function handleEditCategoryName(event) {
    const oldCategoryName = event.target.dataset.category;
    const newCategoryNamePrompt = prompt(`Enter new name for category "${oldCategoryName}":`, oldCategoryName);
    if (newCategoryNamePrompt && newCategoryNamePrompt.trim() !== "" && newCategoryNamePrompt.trim() !== oldCategoryName) {
        const trimmedNewName = newCategoryNamePrompt.trim();
        if (allCategoriesData[trimmedNewName]) {
            alert("A category with this name already exists."); return;
        }
        allCategoriesData[trimmedNewName] = allCategoriesData[oldCategoryName];
        delete allCategoriesData[oldCategoryName];
        const orderIndex = categoryOrder.indexOf(oldCategoryName);
        if (orderIndex > -1) categoryOrder[orderIndex] = trimmedNewName;
        else categoryOrder.push(trimmedNewName);
        await saveCategoryOrder();
        await saveAndUpdateAllCategories(trimmedNewName);
    }
}

async function handleDeleteCategory(event) {
    const categoryName = event.target.dataset.category;
    if (confirm(`Are you sure you want to delete category "${categoryName}" and all its channels?`)) {
        delete allCategoriesData[categoryName];
        categoryOrder = categoryOrder.filter(cat => cat !== categoryName);
        await saveCategoryOrder();
        const activeCategoryAfterDelete = categoryOrder.length > 0 ? categoryOrder[0] : null;
        currentViewMode = 'channels';
        await saveAndUpdateAllCategories(activeCategoryAfterDelete);
    }
}

async function saveAndUpdateAllCategories(activeCategoryKey = null) {
    try {
        await setSyncStorage({ categories: allCategoriesData });
        renderTabs();
        let categoryToDisplay = activeCategoryKey;
        if (!categoryToDisplay || !allCategoriesData[categoryToDisplay] || !categoryOrder.includes(categoryToDisplay)) {
            categoryToDisplay = categoryOrder.length > 0 ? categoryOrder[0] : null;
        }
        if (categoryToDisplay) {
            await setActiveCategory(categoryToDisplay);
        } else {
            categoryContentDiv.innerHTML = ''; currentCategoryName = null; updateActiveTabHighlight(null);
            if (categoryOrder.length === 0 && !categoryTabsDiv.innerHTML.includes("<p>No categories")) {
                 categoryTabsDiv.innerHTML = "<p>No categories saved yet.</p>";
            }
        }
    } catch (error) {
        console.error("Error in saveAndUpdateAllCategories:", error);
        alert('Error saving changes: ' + error.message);
        await loadCategoriesAndOrder();
    }
}

function handleExportCsv() {
    if (categoryOrder.length === 0) { alert("No categories to export."); return; }
    let csvContent = "Category Name,Channel ID,Channel Name,Channel Image URL\n";
    categoryOrder.forEach(categoryName => {
        if (allCategoriesData.hasOwnProperty(categoryName)) {
            const channels = allCategoriesData[categoryName];
            channels.forEach(channel => {
                const safeCategoryName = `"${categoryName.replace(/"/g, '""')}"`;
                const safeChannelId = `"${channel.id.replace(/"/g, '""')}"`;
                const safeChannelName = `"${channel.name.replace(/"/g, '""')}"`;
                const safeChannelImageUrl = `"${(channel.imageUrl || '').replace(/"/g, '""')}"`;
                csvContent += `${safeCategoryName},${safeChannelId},${safeChannelName},${safeChannelImageUrl}\n`;
            });
        }
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "youtube_categories_export.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function handleImportCsvFileSelect(event) {
    const file = event.target.files[0];
    importStatusMessage.textContent = ''; importStatusMessage.style.display = 'none'; hideUndoToast();
    if (!file) return;
    if (file.type && file.type !== "text/csv" && !file.name.toLowerCase().endsWith(".csv")) {
        importStatusMessage.textContent = "Please select a valid .csv file.";
        importStatusMessage.className = 'status-message error'; importStatusMessage.style.display = 'block';
        event.target.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvContent = e.target.result;
        try {
            previousCategoriesDataForUndo = {
                categories: JSON.parse(JSON.stringify(allCategoriesData)),
                order: [...categoryOrder]
            };
            const importedRawCategories = parseCsvContent(csvContent);
            if (Object.keys(importedRawCategories).length === 0) {
                importStatusMessage.textContent = "CSV is empty or could not be parsed.";
                importStatusMessage.className = 'status-message error'; importStatusMessage.style.display = 'block';
                previousCategoriesDataForUndo = null; return;
            }
            const csvCategoryOrder = [];
            const lines = csvContent.split(/\r\n|\n/);
            const headerLine = lines[0].toLowerCase();
            let startLine = 0;
            if (headerLine.includes("category") && headerLine.includes("channel id")) startLine = 1;
            for (let i = startLine; i < lines.length; i++) {
                const line = lines[i].trim(); if (!line) continue;
                const firstCommaIndex = line.indexOf(',');
                if (firstCommaIndex > -1) {
                    let catNameFromCsv = line.substring(0, firstCommaIndex).trim().replace(/^"|"$/g, '').replace(/""/g, '"');
                    if (catNameFromCsv && !csvCategoryOrder.includes(catNameFromCsv) && importedRawCategories[catNameFromCsv]) {
                        csvCategoryOrder.push(catNameFromCsv);
                    }
                }
            }
            const newAllCategoriesData = {}; const newCategoryOrder = [];
            csvCategoryOrder.forEach(catName => {
                if (importedRawCategories[catName]) {
                    newAllCategoriesData[catName] = importedRawCategories[catName];
                    newCategoryOrder.push(catName);
                }
            });
            if (previousCategoriesDataForUndo) {
                previousCategoriesDataForUndo.order.forEach(oldCatName => {
                    if (!newCategoryOrder.includes(oldCatName) && previousCategoriesDataForUndo.categories[oldCatName]) {
                        newCategoryOrder.push(oldCatName);
                        newAllCategoriesData[oldCatName] = previousCategoriesDataForUndo.categories[oldCatName];
                    }
                });
            }
            allCategoriesData = newAllCategoriesData; categoryOrder = newCategoryOrder;
            await saveCategoryOrder();
            await saveAndUpdateAllCategories(categoryOrder.length > 0 ? categoryOrder[0] : null);
            showUndoToast();
        } catch (error) {
            console.error("Error processing CSV:", error);
            importStatusMessage.textContent = `Error importing: ${error.message}`;
            importStatusMessage.className = 'status-message error'; importStatusMessage.style.display = 'block';
            previousCategoriesDataForUndo = null;
        } finally { event.target.value = ''; }
    };
    reader.onerror = () => {
        importStatusMessage.textContent = "Error reading the file.";
        importStatusMessage.className = 'status-message error'; importStatusMessage.style.display = 'block';
        event.target.value = ''; previousCategoriesDataForUndo = null;
    };
    reader.readAsText(file);
}

function parseCsvContent(csvText) {
    const newCategories = {};
    const lines = csvText.split(/\r\n|\n/);
    const headerLine = lines[0].toLowerCase();
    let startLine = 0;
    if (headerLine.includes("category") && headerLine.includes("channel id")) startLine = 1;
    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i].trim(); if (!line) continue;
        const values = []; let currentVal = ''; let inQuotes = false;
        for (let char of line) {
            if (char === '"' && !inQuotes && currentVal === '') inQuotes = true;
            else if (char === '"' && inQuotes && (line.indexOf(char, line.indexOf(currentVal+char) + (currentVal+char).length) === -1 || line[line.indexOf(currentVal+char) + (currentVal+char).length] === ',' )) inQuotes = false;
            else if (char === ',' && !inQuotes) {
                values.push(currentVal.trim().replace(/^"|"$/g, '').replace(/""/g, '"')); currentVal = '';
            } else currentVal += char;
        }
        values.push(currentVal.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
        if (values.length >= 3) {
            const categoryName = values[0]; const channelId = values[1];
            const channelName = values[2]; const channelImageUrl = values[3] || 'icons/icon48.png';
            if (!categoryName || !channelId || !channelName) continue;
            if (!newCategories[categoryName]) newCategories[categoryName] = [];
            if (!newCategories[categoryName].some(ch => ch.id === channelId)) {
                 newCategories[categoryName].push({ id: channelId, name: channelName, imageUrl: channelImageUrl });
            }
        }
    }
    return newCategories;
}

function showUndoToast() {
    importStatusMessage.textContent = ''; importStatusMessage.style.display = 'none';
    undoImportToast.style.display = 'flex';
    if (undoTimeout) clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => { hideUndoToast(); previousCategoriesDataForUndo = null; }, 7000);
}
function hideUndoToast() {
    undoImportToast.style.display = 'none';
    if (undoTimeout) { clearTimeout(undoTimeout); undoTimeout = null; }
}
async function handleUndoImport() {
    if (previousCategoriesDataForUndo && previousCategoriesDataForUndo.categories && previousCategoriesDataForUndo.order) {
        allCategoriesData = JSON.parse(JSON.stringify(previousCategoriesDataForUndo.categories));
        categoryOrder = [...previousCategoriesDataForUndo.order];
        await saveCategoryOrder();
        await saveAndUpdateAllCategories(categoryOrder.length > 0 ? categoryOrder[0] : null);
        importStatusMessage.textContent = "Import undone.";
        importStatusMessage.className = 'status-message success'; importStatusMessage.style.display = 'block';
        previousCategoriesDataForUndo = null; hideUndoToast();
    } else {
        importStatusMessage.textContent = "No import operation to undo or undo data expired.";
        importStatusMessage.className = 'status-message error'; importStatusMessage.style.display = 'block';
    }
}