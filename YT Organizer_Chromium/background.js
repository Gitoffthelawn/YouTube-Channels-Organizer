const CACHE_CONFIG = {
    CHANNEL_DETAILS: { prefix: 'channel_detail_', durationMs: 24 * 60 * 60 * 1000 },
    RECENT_VIDEOS: { prefix: 'channel_videos_', durationMs: 2 * 60 * 60 * 1000 }
};

async function getStoredData(storageArea, key) { // Helper for local/sync
    return new Promise(resolve => {
        storageArea.get(key, result => {
            if (chrome.runtime.lastError) {
                console.error(`Error getting ${key}:`, chrome.runtime.lastError.message);
                resolve(key === null ? {} : undefined); // Mimic behavior for get(null) vs get('key')
            } else {
                resolve(key === null ? result : result[key]);
            }
        });
    });
}

async function setStoredData(storageArea, dataObject) { // Helper for local/sync
    return new Promise((resolve, reject) => {
        storageArea.set(dataObject, () => {
            if (chrome.runtime.lastError) {
                console.error("Error setting data:", chrome.runtime.lastError.message, dataObject);
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}


async function getCachedData(config, keySuffix) {
    const cacheKey = `${config.prefix}${keySuffix}`;
    const now = Date.now();
    try {
        const cachedItemContainer = await getStoredData(chrome.storage.local, cacheKey);
        const cachedItem = cachedItemContainer; // Direct value since we get single key
        if (cachedItem && (now - cachedItem.timestamp < config.durationMs)) {
            return cachedItem.data;
        }
    } catch (e) { console.error("Error reading from cache:", e); }
    return null;
}

async function setCachedData(config, keySuffix, data) {
    const cacheKey = `${config.prefix}${keySuffix}`;
    try {
        await setStoredData(chrome.storage.local, { [cacheKey]: { data: data, timestamp: Date.now() } });
    } catch (e) { console.error("Error writing to cache:", e); }
}

async function getApiKey() {
    return await getStoredData(chrome.storage.sync, 'apiKey');
}

async function fetchYouTubeAPI(endpoint, params, useCacheConfig = null, cacheKeySuffix = null) {
    if (useCacheConfig && cacheKeySuffix) {
        const cached = await getCachedData(useCacheConfig, cacheKeySuffix);
        if (cached) return cached;
    }
    const apiKey = await getApiKey();
    if (!apiKey) return { error: "API Key not set." };

    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    url.searchParams.append('key', apiKey);
    for (const key in params) url.searchParams.append(key, params[key]);

    try {
        const response = await fetch(url.toString());
        const jsonData = await response.json(); // Try to parse JSON regardless of response.ok
        if (!response.ok) {
            console.error("API Error:", endpoint, params, jsonData);
            return { error: `API Error: ${response.status} ${jsonData.error?.message || response.statusText}` };
        }
        if (useCacheConfig && cacheKeySuffix && !jsonData.error) {
            await setCachedData(useCacheConfig, cacheKeySuffix, jsonData);
        }
        return jsonData;
    } catch (error) {
        console.error("Fetch Error:", endpoint, params, error);
        return { error: `Network error: ${error.message}` };
    }
}

function iso8601DurationToSeconds(duration) {
    if (!duration || typeof duration !== 'string') return 0;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return (parseInt(match[1] || 0) * 3600) + (parseInt(match[2] || 0) * 60) + (parseInt(match[3] || 0));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        if (request.type === "GET_CHANNEL_INFO") {
            const apiKey = await getApiKey();
            if (!apiKey) { sendResponse({ error: "API Key not set." }); return; }

            const videoData = await fetchYouTubeAPI('videos', {
                part: 'snippet', id: request.videoId, fields: 'items(snippet(channelId,channelTitle))'
            });
            if (videoData.error) { sendResponse(videoData); return; }

            if (videoData.items && videoData.items.length > 0) {
                const { channelId, channelTitle } = videoData.items[0].snippet;
                const channelDetails = await fetchYouTubeAPI('channels', {
                    part: 'snippet', id: channelId, fields: 'items(id,snippet(thumbnails(default(url))))'
                }, CACHE_CONFIG.CHANNEL_DETAILS, channelId);

                let channelImageUrl = 'icons/icon48.png';
                if (channelDetails && channelDetails.items && channelDetails.items.length > 0) {
                    channelImageUrl = channelDetails.items[0].snippet.thumbnails.default.url;
                } else if (channelDetails?.error) {
                    console.warn(`Could not fetch/cache channel details for ${channelId}: ${channelDetails.error}`);
                }
                sendResponse({ channelId, channelTitle, channelImageUrl });
            } else {
                sendResponse({ error: "Video not found or no channel info." });
            }
        }
        else if (request.type === "ADD_CHANNEL_TO_CATEGORY") {
            const { channel, categoryName } = request;
            if (!channel || !channel.id || !channel.name || !categoryName) {
                sendResponse({ success: false, error: "Missing channel data or category name." }); return;
            }
            try {
                const data = await getStoredData(chrome.storage.sync, 'categories');
                let categories = data || {}; // categories key might not exist
                let isNewCategory = !categories[categoryName];
                if (!categories[categoryName]) categories[categoryName] = [];

                const existingChannelIndex = categories[categoryName].findIndex(ch => ch.id === channel.id);
                if (existingChannelIndex > -1) categories[categoryName][existingChannelIndex] = channel;
                else categories[categoryName].push(channel);

                await setStoredData(chrome.storage.sync, { categories });

                // If new category was created by this action, also update categoryOrder
                if(isNewCategory){
                    let order = await getStoredData(chrome.storage.sync, 'categoryOrder') || [];
                    if(!order.includes(categoryName)){
                        order.push(categoryName);
                        await setStoredData(chrome.storage.sync, { categoryOrder: order });
                    }
                }
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        }
        else if (request.type === "GET_RECENT_VIDEOS") {
            const apiKey = await getApiKey();
            if (!apiKey) { sendResponse({ videos: [], error: "API Key not set." }); return; }

            const allFetchedVideos = [];
            const VIDEOS_TO_FETCH_PER_CHANNEL = 15;
            const VIDEOS_TO_RETURN = 5;
            const MIN_VIDEO_DURATION_SECONDS = 70;

            for (const channelId of request.channelIds) {
                const cachedChannelVideos = await getCachedData(CACHE_CONFIG.RECENT_VIDEOS, channelId);
                if (cachedChannelVideos) {
                    allFetchedVideos.push(...cachedChannelVideos);
                    continue;
                }

                const searchData = await fetchYouTubeAPI('search', {
                    part: 'snippet', channelId: channelId, maxResults: VIDEOS_TO_FETCH_PER_CHANNEL,
                    order: 'date', type: 'video',
                    fields: 'items(id(videoId),snippet(publishedAt,channelId,title,channelTitle,thumbnails(medium(url))))'
                });
                if (searchData.error) { console.error(`Error searching videos for ${channelId}: ${searchData.error}`); continue; }

                if (searchData.items && searchData.items.length > 0) {
                    const videoIds = searchData.items.map(item => item.id.videoId).join(',');
                    const videosDetailsData = await fetchYouTubeAPI('videos', {
                        part: 'contentDetails,snippet', id: videoIds,
                        fields: 'items(id,snippet(title,channelTitle,channelId,publishedAt,thumbnails(medium(url))),contentDetails(duration))'
                    });

                    let processedChannelVideos = [];
                    if (videosDetailsData.items) {
                        const videoMap = new Map(searchData.items.map(item => [item.id.videoId, item.snippet]));
                        for (const videoDetail of videosDetailsData.items) {
                            const durationSeconds = iso8601DurationToSeconds(videoDetail.contentDetails.duration);
                            if (durationSeconds >= MIN_VIDEO_DURATION_SECONDS) {
                                const originalSnippet = videoMap.get(videoDetail.id);
                                if (originalSnippet) {
                                    processedChannelVideos.push({
                                        id: videoDetail.id, title: originalSnippet.title,
                                        thumbnail: originalSnippet.thumbnails.medium.url,
                                        channelName: originalSnippet.channelTitle,
                                        publishedAt: originalSnippet.publishedAt,
                                        channelId: originalSnippet.channelId,
                                    });
                                }
                            }
                            if (processedChannelVideos.length >= VIDEOS_TO_RETURN) break;
                        }
                    }
                    if (processedChannelVideos.length > 0) {
                        await setCachedData(CACHE_CONFIG.RECENT_VIDEOS, channelId, processedChannelVideos.slice(0, VIDEOS_TO_RETURN));
                    }
                    allFetchedVideos.push(...processedChannelVideos.slice(0, VIDEOS_TO_RETURN));
                }
            }
            allFetchedVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
            sendResponse({ videos: allFetchedVideos });
        }
    })();
    return true; // Keep message channel open for async response
});

chrome.alarms.create('cacheCleanup', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cacheCleanup') {
        try {
            const allStorage = await getStoredData(chrome.storage.local, null); // Get all local storage
            const now = Date.now();
            const keysToRemove = [];
            for (const key in allStorage) {
                if (key.startsWith(CACHE_CONFIG.CHANNEL_DETAILS.prefix) || key.startsWith(CACHE_CONFIG.RECENT_VIDEOS.prefix)) {
                    const item = allStorage[key];
                    let duration = key.startsWith(CACHE_CONFIG.CHANNEL_DETAILS.prefix) ?
                                   CACHE_CONFIG.CHANNEL_DETAILS.durationMs : CACHE_CONFIG.RECENT_VIDEOS.durationMs;
                    if (item && item.timestamp && (now - item.timestamp > duration)) {
                        keysToRemove.push(key);
                    }
                }
            }
            if (keysToRemove.length > 0) {
                await new Promise((resolve, reject) => { // Promisify remove
                    chrome.storage.local.remove(keysToRemove, () => {
                        if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
                    });
                });
            }
        } catch (e) { console.error("Error during cache cleanup:", e); }
    }
});