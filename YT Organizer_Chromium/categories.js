const categoryTabsContainer = document.getElementById('categoryTabsContainer');
const categoryTabsDiv = document.getElementById('categoryTabs');
const categoryDropdown = document.getElementById('categoryDropdown');
const categoryContentDiv = document.getElementById('categoryContent');
const videoPlayerArea = document.getElementById('videoPlayerArea');
const youtubePlayer = document.getElementById('youtubePlayer');
const closePlayerButton = document.getElementById('closePlayerButton');
const categoriesPageContainer = document.querySelector('.categories-page-container');

let allCategoriesData = {};
let currentViewMode = 'channels'; // 'channels' or 'videos'
let currentCategoryName = null;

document.addEventListener('DOMContentLoaded', () => {
    loadCategoriesAndApiKey();
    window.addEventListener('resize', handleTabOverflow); // Re-check on resize
});

closePlayerButton.addEventListener('click', () => {
    videoPlayerArea.style.display = 'none';
    youtubePlayer.src = ''; // Stop video
    categoriesPageContainer.classList.remove('video-playing');
});

function loadCategoriesAndApiKey() {
    chrome.storage.sync.get(['categories', 'apiKey'], (data) => {
        allCategoriesData = data.categories || {};
        const apiKey = data.apiKey;

        if (!apiKey) {
            categoryTabsDiv.innerHTML = `<p class="error">API Key not set. Please set it in the extension popup.</p>`;
            categoryContentDiv.innerHTML = ''; // Clear content area too
            return;
        }
        if (Object.keys(allCategoriesData).length === 0) {
            categoryTabsDiv.innerHTML = "<p>No categories saved yet. Add channels from YouTube video pages using the extension popup.</p>";
            categoryContentDiv.innerHTML = ''; // Clear content area
            return;
        }
        renderTabs();
        if (Object.keys(allCategoriesData).length > 0) {
            const firstCategoryName = Object.keys(allCategoriesData).sort()[0];
            setActiveCategory(firstCategoryName);
        } else {
            handleTabOverflow(); // Ensure correct display even if no categories initially
        }
    });
}

function setActiveCategory(categoryName) {
    currentCategoryName = categoryName;
    currentViewMode = 'channels'; // Reset to channels view when changing category
    renderCategoryContent(categoryName);
    updateActiveTabHighlight(categoryName);
}

function updateActiveTabHighlight(categoryName) {
    document.querySelectorAll('.tab-button.active').forEach(b => b.classList.remove('active'));
    if (categoryName) { // Ensure categoryName is not null/undefined
      const activeTabButton = document.querySelector(`.tab-button[data-category="${CSS.escape(categoryName)}"]`);
      if (activeTabButton) {
          activeTabButton.classList.add('active');
      }
      if (categoryDropdown.style.display !== 'none') {
          categoryDropdown.value = categoryName;
      }
    }
}

function renderTabs() {
    categoryTabsDiv.innerHTML = '';
    categoryDropdown.innerHTML = ''; // Clear dropdown options
    const sortedCategoryNames = Object.keys(allCategoriesData).sort();

    if (sortedCategoryNames.length === 0) {
        categoryTabsDiv.innerHTML = "<p>No categories. Add channels via the popup on YouTube.</p>";
        categoryContentDiv.innerHTML = '';
        handleTabOverflow(); // Update display (likely show "No categories")
        return;
    }

    sortedCategoryNames.forEach(categoryName => {
        const tabButton = document.createElement('button');
        tabButton.classList.add('tab-button');
        tabButton.textContent = categoryName;
        tabButton.dataset.category = categoryName;
        tabButton.addEventListener('click', () => setActiveCategory(categoryName));
        categoryTabsDiv.appendChild(tabButton);

        const option = document.createElement('option');
        option.value = categoryName;
        option.textContent = categoryName;
        categoryDropdown.appendChild(option);
    });

    categoryDropdown.removeEventListener('change', handleDropdownChange); // Remove old listener
    categoryDropdown.addEventListener('change', handleDropdownChange); // Add new one

    handleTabOverflow();
    if (currentCategoryName && allCategoriesData[currentCategoryName]) {
        updateActiveTabHighlight(currentCategoryName);
    } else if (sortedCategoryNames.length > 0) {
        // If currentCategoryName is no longer valid, select the first one
        setActiveCategory(sortedCategoryNames[0]);
    }
}

function handleDropdownChange(e) {
    setActiveCategory(e.target.value);
}

function handleTabOverflow() {
    const containerWidth = categoryTabsContainer.offsetWidth;
    let tabsWidth = 0;
    const tabButtons = categoryTabsDiv.querySelectorAll('.tab-button');

    if (tabButtons.length === 0) { // No tabs to display
        categoryTabsDiv.style.display = 'block'; // Show the "No categories" message if it's there
        categoryDropdown.style.display = 'none';
        return;
    }

    tabButtons.forEach(button => {
        // Ensure button is visible to get offsetWidth correctly
        const prevDisplay = button.style.display;
        button.style.display = ''; // Temporarily make it default display
        tabsWidth += button.offsetWidth + parseInt(getComputedStyle(button).marginLeft || 0) + parseInt(getComputedStyle(button).marginRight || 0);
        button.style.display = prevDisplay; // Restore
    });

    // Heuristic: If total width of tabs exceeds container, or many tabs.
    // Add a small buffer to prevent toggling due to minor pixel differences.
    if (tabsWidth > containerWidth - 10 && tabButtons.length > 2) {
        categoryTabsDiv.style.display = 'none';
        categoryDropdown.style.display = 'block';
        if (currentCategoryName) categoryDropdown.value = currentCategoryName;
    } else {
        categoryTabsDiv.style.display = 'flex';
        categoryDropdown.style.display = 'none';
    }
}

function renderCategoryContent(categoryName) {
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
    editButton.innerHTML = 'Edit'; //Pencil emoji
    editButton.addEventListener('click', handleEditCategoryName);
    headerTitleDiv.appendChild(editButton);

    const deleteCatButton = document.createElement('button');
    deleteCatButton.classList.add('delete-category');
    deleteCatButton.dataset.category = categoryName;
    deleteCatButton.title = "Delete Category";
    deleteCatButton.innerHTML = 'Delete'; // Trash can emoji
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

    // Set button text and render content based on currentViewMode
    if (currentViewMode === 'videos') {
        viewToggleButton.textContent = 'Show channels';
        fetchRecentVideos(categoryName, categoryData.map(ch => ch.id), contentDisplayArea);
    } else {
        viewToggleButton.textContent = 'Show videos';
        renderChannels(categoryName, categoryData, contentDisplayArea);
    }
}


function toggleChannelVideoView(categoryName, channelIds) {
    const contentDisplayArea = document.getElementById('contentDisplayArea');
    const viewToggleButton = document.getElementById('viewToggleButton');
    if (currentViewMode === 'channels') {
        currentViewMode = 'videos';
        viewToggleButton.textContent = 'Show channels';
        fetchRecentVideos(categoryName, channelIds, contentDisplayArea);
    } else {
        currentViewMode = 'channels';
        viewToggleButton.textContent = 'Show videos';
        renderChannels(categoryName, allCategoriesData[categoryName], contentDisplayArea);
    }
}

function renderChannels(categoryName, channels, container) {
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
        card.addEventListener('click', () => {
            chrome.tabs.create({
              url: `https://www.youtube.com/channel/${channel.id}`
            });
          });
      
        channelGrid.appendChild(card);
    });
    container.appendChild(channelGrid);
    document.querySelectorAll('.remove-channel').forEach(button => {
        button.removeEventListener('click', handleRemoveChannel); // Prevent multiple listeners
        button.addEventListener('click', handleRemoveChannel);
    });
}

function fetchRecentVideos(categoryName, channelIds, container) {
    container.innerHTML = '<p class="loading-text">Fetching videos...</p>';
    const viewToggleButton = document.getElementById('viewToggleButton');
    if(viewToggleButton) viewToggleButton.disabled = true;

    if (channelIds.length === 0) {
        container.innerHTML = "<p>No channels in this category to fetch videos from.</p>";
        if(viewToggleButton) viewToggleButton.disabled = false;
        return;
    }

    chrome.runtime.sendMessage({ type: "GET_RECENT_VIDEOS", channelIds: channelIds }, (response) => {
        if(viewToggleButton) viewToggleButton.disabled = false;
        if (chrome.runtime.lastError) {
            container.innerHTML = `<p class="error">Error fetching videos: ${chrome.runtime.lastError.message}</p>`;
            return;
        }
        if (response.error) {
            container.innerHTML = `<p class="error">Error fetching videos: ${response.error}</p>`;
            return;
        }
        if (response.videos && response.videos.length > 0) {
            container.innerHTML = '';
            const videoGrid = document.createElement('div');
            videoGrid.classList.add('video-grid');
            // The videos from background.js should already be sorted by publishedAt (newest first overall)
            // and limited per channel.
            // If you want to ensure a strict limit of 5 total videos for the category view:
            // const videosToDisplay = response.videos.slice(0, 5);
            const videosToDisplay = response.videos; // Show all non-short videos up to 5 per channel

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
    });
}

function playVideo(videoId) {
    categoriesPageContainer.classList.add('video-playing');
    videoPlayerArea.style.display = 'flex'; // Use flex as defined in CSS
    youtubePlayer.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`; // Added rel=0
}

function handleRemoveChannel(event) {
    const channelId = event.target.dataset.channelId;
    const categoryName = event.target.dataset.categoryName;

    if (confirm(`Are you sure you want to remove channel with ID ${channelId} from category "${categoryName}"?`)) {
        allCategoriesData[categoryName] = allCategoriesData[categoryName].filter(ch => ch.id !== channelId);
        if (allCategoriesData[categoryName].length === 0) {
            delete allCategoriesData[categoryName]; // Remove category if empty
            currentCategoryName = null; // Force selection of new category
        }
        saveAndUpdateAllCategories(allCategoriesData[categoryName] ? categoryName : null);
    }
}

function handleEditCategoryName(event) {
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
        currentCategoryName = trimmedNewName; // Update currentCategoryName
        saveAndUpdateAllCategories(trimmedNewName);
    }
}

function handleDeleteCategory(event) {
    const categoryName = event.target.dataset.category;
    if (confirm(`Are you sure you want to delete the entire category "${categoryName}" and all its channels? This cannot be undone.`)) {
        delete allCategoriesData[categoryName];
        currentCategoryName = null; // Force selection of new category or empty state
        currentViewMode = 'channels'; // Reset view mode
        saveAndUpdateAllCategories(null);
    }
}

function saveAndUpdateAllCategories(activeCategoryAfterUpdate = null) {
    chrome.storage.sync.set({ categories: allCategoriesData }, () => {
        if (chrome.runtime.lastError) {
            alert('Error saving changes: ' + chrome.runtime.lastError.message);
            loadCategoriesAndApiKey(); // Full reload on critical error
        } else {
            renderTabs(); // This will also call handleTabOverflow

            let categoryToDisplay = activeCategoryAfterUpdate;
            if (!categoryToDisplay || !allCategoriesData[categoryToDisplay]) {
                // If the active category was deleted or not specified, pick the first one
                const sortedKeys = Object.keys(allCategoriesData).sort();
                categoryToDisplay = sortedKeys.length > 0 ? sortedKeys[0] : null;
            }

            if (categoryToDisplay) {
                setActiveCategory(categoryToDisplay); // This calls renderCategoryContent and updateActiveTabHighlight
            } else {
                // No categories left
                categoryTabsDiv.innerHTML = "<p>No categories saved yet. Add channels from YouTube video pages using the extension popup.</p>";
                categoryContentDiv.innerHTML = '';
                currentCategoryName = null;
                 updateActiveTabHighlight(null); // Clear any active highlight
            }
        }
    });
}