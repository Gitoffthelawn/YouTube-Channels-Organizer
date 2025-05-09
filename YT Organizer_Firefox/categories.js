// --- DOM Elements (same as Chrome version) ---
const categoryTabsContainer = document.getElementById('categoryTabsContainer');
const categoryTabsDiv = document.getElementById('categoryTabs');
const categoryDropdown = document.getElementById('categoryDropdown');
const categoryContentDiv = document.getElementById('categoryContent');
const videoPlayerArea = document.getElementById('videoPlayerArea');
const youtubePlayer = document.getElementById('youtubePlayer');
const closePlayerButton = document.getElementById('closePlayerButton');
const categoriesPageContainer = document.querySelector('.categories-page-container');

let allCategoriesData = {};
let currentViewMode = 'channels';
let currentCategoryName = null;

// --- Event Listeners and Initialization (mostly same logic, API calls changed) ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadCategoriesAndApiKey();
    window.addEventListener('resize', handleTabOverflow);
});

closePlayerButton.addEventListener('click', () => {
    videoPlayerArea.style.display = 'none';
    youtubePlayer.src = '';
    categoriesPageContainer.classList.remove('video-playing');
});

async function loadCategoriesAndApiKey() {
    try {
        const data = await browser.storage.sync.get(['categories', 'apiKey']);
        allCategoriesData = data.categories || {};
        const apiKey = data.apiKey;

        if (!apiKey) {
            categoryTabsDiv.innerHTML = `<p class="error">API Key not set. Please set it in the extension popup.</p>`;
            categoryContentDiv.innerHTML = '';
            return;
        }
        if (Object.keys(allCategoriesData).length === 0) {
            categoryTabsDiv.innerHTML = "<p>No categories saved yet. Add channels from YouTube video pages using the extension popup.</p>";
            categoryContentDiv.innerHTML = '';
            return;
        }
        renderTabs(); // This function itself doesn't need to be async if it only manipulates DOM
        if (Object.keys(allCategoriesData).length > 0) {
            const firstCategoryName = Object.keys(allCategoriesData).sort()[0];
            await setActiveCategory(firstCategoryName); // setActiveCategory involves rendering, which might be fine synchronously
        } else {
            handleTabOverflow();
        }
    } catch (error) {
        console.error("Error loading categories/API key:", error);
        categoryTabsDiv.innerHTML = `<p class="error">Error loading data: ${error.message}</p>`;
    }
}

async function setActiveCategory(categoryName) {
    currentCategoryName = categoryName;
    currentViewMode = 'channels';
    renderCategoryContent(categoryName); // DOM manipulation
    updateActiveTabHighlight(categoryName); // DOM manipulation
}

function updateActiveTabHighlight(categoryName) { // Pure DOM
    document.querySelectorAll('.tab-button.active').forEach(b => b.classList.remove('active'));
    if (categoryName) {
      const activeTabButton = document.querySelector(`.tab-button[data-category="${CSS.escape(categoryName)}"]`);
      if (activeTabButton) {
          activeTabButton.classList.add('active');
      }
      if (categoryDropdown.style.display !== 'none') {
          categoryDropdown.value = categoryName;
      }
    }
}

function renderTabs() { // Pure DOM
    categoryTabsDiv.innerHTML = '';
    categoryDropdown.innerHTML = '';
    const sortedCategoryNames = Object.keys(allCategoriesData).sort();

    if (sortedCategoryNames.length === 0) {
        categoryTabsDiv.innerHTML = "<p>No categories. Add channels via the popup on YouTube.</p>";
        categoryContentDiv.innerHTML = '';
        handleTabOverflow();
        return;
    }

    sortedCategoryNames.forEach(categoryName => {
        const tabButton = document.createElement('button');
        tabButton.classList.add('tab-button');
        tabButton.textContent = categoryName;
        tabButton.dataset.category = categoryName;
        tabButton.addEventListener('click', () => setActiveCategory(categoryName)); // setActiveCategory can be async
        categoryTabsDiv.appendChild(tabButton);

        const option = document.createElement('option');
        option.value = categoryName;
        option.textContent = categoryName;
        categoryDropdown.appendChild(option);
    });

    categoryDropdown.removeEventListener('change', handleDropdownChange);
    categoryDropdown.addEventListener('change', handleDropdownChange);

    handleTabOverflow();
    if (currentCategoryName && allCategoriesData[currentCategoryName]) {
        updateActiveTabHighlight(currentCategoryName);
    } else if (sortedCategoryNames.length > 0) {
        setActiveCategory(sortedCategoryNames[0]); // Can be async
    }
}

async function handleDropdownChange(e) { // Make async if setActiveCategory is consistently async
    await setActiveCategory(e.target.value);
}

function handleTabOverflow() { // Pure DOM
    const containerWidth = categoryTabsContainer.offsetWidth;
    let tabsWidth = 0;
    const tabButtons = categoryTabsDiv.querySelectorAll('.tab-button');

    if (tabButtons.length === 0) {
        categoryTabsDiv.style.display = 'block';
        categoryDropdown.style.display = 'none';
        return;
    }
    tabButtons.forEach(button => {
        const prevDisplay = button.style.display;
        button.style.display = '';
        tabsWidth += button.offsetWidth + parseInt(getComputedStyle(button).marginLeft || 0) + parseInt(getComputedStyle(button).marginRight || 0);
        button.style.display = prevDisplay;
    });
    if (tabsWidth > containerWidth - 10 && tabButtons.length > 2) {
        categoryTabsDiv.style.display = 'none';
        categoryDropdown.style.display = 'block';
        if (currentCategoryName) categoryDropdown.value = currentCategoryName;
    } else {
        categoryTabsDiv.style.display = 'flex';
        categoryDropdown.style.display = 'none';
    }
}

function renderCategoryContent(categoryName) { // DOM manipulation, calls fetchRecentVideos which is async
    categoryContentDiv.innerHTML = '';
    const categoryData = allCategoriesData[categoryName];

    if (!categoryData) {
        categoryContentDiv.innerHTML = `<p>Category "${categoryName}" not found or is empty.</p>`;
        return;
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
    editButton.innerHTML = 'Edit';
    editButton.addEventListener('click', handleEditCategoryName); // handleEditCategoryName can be async
    headerTitleDiv.appendChild(editButton);
    const deleteCatButton = document.createElement('button');
    deleteCatButton.classList.add('delete-category');
    deleteCatButton.dataset.category = categoryName;
    deleteCatButton.title = "Delete Category";
    deleteCatButton.innerHTML = 'Delete';
    deleteCatButton.addEventListener('click', handleDeleteCategory); // can be async
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

async function toggleChannelVideoView(categoryName, channelIds) { // Make async due to fetchRecentVideos
    const contentDisplayArea = document.getElementById('contentDisplayArea');
    const viewToggleButton = document.getElementById('viewToggleButton');
    if (currentViewMode === 'channels') {
        currentViewMode = 'videos';
        viewToggleButton.textContent = 'Show channels';
        await fetchRecentVideos(categoryName, channelIds, contentDisplayArea);
    } else {
        currentViewMode = 'channels';
        viewToggleButton.textContent = 'Show videos';
        renderChannels(categoryName, allCategoriesData[categoryName], contentDisplayArea); // renderChannels is sync DOM
    }
}

function renderChannels(categoryName, channels, container) { // Pure DOM
    container.innerHTML = '';
    if (!channels || channels.length === 0) {
        container.innerHTML = "<p>No channels in this category. Add some from YouTube!</p>";
        return;
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
        channelGrid.appendChild(card);
    });
    container.appendChild(channelGrid);
    document.querySelectorAll('.remove-channel').forEach(button => {
        button.removeEventListener('click', handleRemoveChannel);
        button.addEventListener('click', handleRemoveChannel); // handleRemoveChannel can be async
    });
}

async function fetchRecentVideos(categoryName, channelIds, container) {
    container.innerHTML = '<p class="loading-text">Fetching videos...</p>';
    const viewToggleButton = document.getElementById('viewToggleButton');
    if(viewToggleButton) viewToggleButton.disabled = true;

    if (channelIds.length === 0) {
        container.innerHTML = "<p>No channels in this category to fetch videos from.</p>";
        if(viewToggleButton) viewToggleButton.disabled = false;
        return;
    }
    try {
        const response = await browser.runtime.sendMessage({ type: "GET_RECENT_VIDEOS", channelIds: channelIds });
        if(viewToggleButton) viewToggleButton.disabled = false;

        if (response.error) {
            container.innerHTML = `<p class="error">Error fetching videos: ${response.error}</p>`;
            return;
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
            container.innerHTML = '<p>No recent non-Short videos found for channels in this category, or an error occurred while fetching.</p>';
        }
    } catch (error) {
        if(viewToggleButton) viewToggleButton.disabled = false;
        console.error("Error fetching recent videos from categories.js:", error);
        container.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    }
}

function playVideo(videoId) { // Pure DOM
    categoriesPageContainer.classList.add('video-playing');
    videoPlayerArea.style.display = 'flex';
    youtubePlayer.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
}

async function handleRemoveChannel(event) {
    const channelId = event.target.dataset.channelId;
    const categoryName = event.target.dataset.categoryName;
    if (confirm(`Are you sure you want to remove channel with ID ${channelId} from category "${categoryName}"?`)) {
        allCategoriesData[categoryName] = allCategoriesData[categoryName].filter(ch => ch.id !== channelId);
        if (allCategoriesData[categoryName].length === 0) {
            delete allCategoriesData[categoryName];
            currentCategoryName = null;
        }
        await saveAndUpdateAllCategories(allCategoriesData[categoryName] ? categoryName : null);
    }
}

async function handleEditCategoryName(event) {
    const oldCategoryName = event.target.dataset.category;
    const newCategoryName = prompt(`Enter new name for category "${oldCategoryName}":`, oldCategoryName);
    if (newCategoryName && newCategoryName.trim() !== "" && newCategoryName.trim() !== oldCategoryName) {
        const trimmedNewName = newCategoryName.trim();
        if (allCategoriesData[trimmedNewName]) {
            alert("A category with this name already exists.");
            return;
        }
        allCategoriesData[trimmedNewName] = allCategoriesData[oldCategoryName];
        delete allCategoriesData[oldCategoryName];
        currentCategoryName = trimmedNewName;
        await saveAndUpdateAllCategories(trimmedNewName);
    }
}

async function handleDeleteCategory(event) {
    const categoryName = event.target.dataset.category;
    if (confirm(`Are you sure you want to delete the entire category "${categoryName}" and all its channels? This cannot be undone.`)) {
        delete allCategoriesData[categoryName];
        currentCategoryName = null;
        currentViewMode = 'channels';
        await saveAndUpdateAllCategories(null);
    }
}

async function saveAndUpdateAllCategories(activeCategoryAfterUpdate = null) {
    try {
        await browser.storage.sync.set({ categories: allCategoriesData });
        renderTabs();
        let categoryToDisplay = activeCategoryAfterUpdate;
        if (!categoryToDisplay || !allCategoriesData[categoryToDisplay]) {
            const sortedKeys = Object.keys(allCategoriesData).sort();
            categoryToDisplay = sortedKeys.length > 0 ? sortedKeys[0] : null;
        }
        if (categoryToDisplay) {
            await setActiveCategory(categoryToDisplay);
        } else {
            categoryTabsDiv.innerHTML = "<p>No categories saved yet. Add channels from YouTube video pages using the extension popup.</p>";
            categoryContentDiv.innerHTML = '';
            currentCategoryName = null;
            updateActiveTabHighlight(null);
        }
    } catch (error) {
        console.error("Error saving/updating categories:", error);
        alert('Error saving changes: ' + error.message);
        await loadCategoriesAndApiKey(); // Full reload on critical error
    }
}