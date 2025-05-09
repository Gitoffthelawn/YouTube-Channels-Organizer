// --- Cache Configuration ---
const CACHE_CONFIG = {
    CHANNEL_DETAILS: {
        prefix: 'channel_detail_',
        durationMs: 24 * 60 * 60 * 1000, // 24 hours
    },
    RECENT_VIDEOS: {
        prefix: 'channel_videos_',
        durationMs: 2 * 60 * 60 * 1000, // 2 hours
    }
};

// --- Helper Functions for Caching ---
async function getCachedData(config, keySuffix) {
    const cacheKey = `${config.prefix}${keySuffix}`;
    const now = Date.now();
    try {
        const cachedItem = await chrome.storage.local.get(cacheKey);
        if (cachedItem[cacheKey] && (now - cachedItem[cacheKey].timestamp < config.durationMs)) {
            // console.log(`Cache HIT for ${cacheKey}`);
            return cachedItem[cacheKey].data;
        }
        // console.log(`Cache MISS or STALE for ${cacheKey}`);
    } catch (e) {
        console.error("Error reading from cache:", e);
    }
    return null;
}

async function setCachedData(config, keySuffix, data) {
    const cacheKey = `${config.prefix}${keySuffix}`;
    try {
        await chrome.storage.local.set({
            [cacheKey]: { data: data, timestamp: Date.now() }
        });
        // console.log(`Cache SET for ${cacheKey}`);
    } catch (e) {
        console.error("Error writing to cache:", e);
    }
}

async function getApiKey() {
    const data = await chrome.storage.sync.get('apiKey');
    return data.apiKey;
}

async function fetchYouTubeAPI(endpoint, params, useCacheConfig = null, cacheKeySuffix = null) {
    if (useCacheConfig && cacheKeySuffix) {
        const cached = await getCachedData(useCacheConfig, cacheKeySuffix);
        if (cached) return cached;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
        return { error: "API Key not set." };
    }

    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    url.searchParams.append('key', apiKey);
    for (const key in params) {
        url.searchParams.append(key, params[key]);
    }

    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            const errorData = await response.json();
            console.error("API Error:", endpoint, params, errorData);
            return { error: `API Error: ${response.status} ${errorData.error?.message || response.statusText}` };
        }
        const jsonData = await response.json();
        if (useCacheConfig && cacheKeySuffix && !jsonData.error) {
            await setCachedData(useCacheConfig, cacheKeySuffix, jsonData);
        }
        return jsonData;
    } catch (error) {
        console.error("Fetch Error:", endpoint, params, error);
        return { error: `Network error: ${error.message}` };
    }
}

// --- ISO 8601 Duration to Seconds ---
function iso8601DurationToSeconds(duration) {
    if (!duration || typeof duration !== 'string') return 0;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_CHANNEL_INFO") {
        (async () => {
            const apiKey = await getApiKey();
            if (!apiKey) {
                sendResponse({ error: "API Key not set in extension settings." });
                return;
            }

            // 1. Fetch video details to get channelId and channelTitle
            const videoData = await fetchYouTubeAPI('videos', {
                part: 'snippet',
                id: request.videoId,
                fields: 'items(snippet(channelId,channelTitle))'
            }); // No caching for this specific video's details usually needed here

            if (videoData.error) {
                sendResponse(videoData);
                return;
            }

            if (videoData.items && videoData.items.length > 0) {
                const snippet = videoData.items[0].snippet;
                const channelId = snippet.channelId;
                const channelTitle = snippet.channelTitle;

                // 2. Fetch channel details for image URL (with caching)
                const channelDetails = await fetchYouTubeAPI('channels', {
                    part: 'snippet',
                    id: channelId,
                    fields: 'items(id,snippet(thumbnails(default(url))))'
                }, CACHE_CONFIG.CHANNEL_DETAILS, channelId);

                let channelImageUrl = 'icons/icon48.png'; // Fallback
                if (channelDetails && channelDetails.items && channelDetails.items.length > 0) {
                    channelImageUrl = channelDetails.items[0].snippet.thumbnails.default.url;
                } else if (channelDetails && channelDetails.error) {
                    console.warn(`Could not fetch/cache channel details for ${channelId}: ${channelDetails.error}`);
                }

                sendResponse({ channelId, channelTitle, channelImageUrl });
            } else {
                sendResponse({ error: "Video not found or no channel info from video." });
            }
        })();
        return true;
    }
    else if (request.type === "ADD_CHANNEL_TO_CATEGORY") {
        (async () => {
            const { channel, categoryName } = request;
            // channel object should already have id, name, imageUrl from popup.js
            if (!channel || !channel.id || !channel.name || !categoryName) {
                sendResponse({ success: false, error: "Missing channel data or category name." });
                return;
            }

            // Optional: Re-validate/refresh channel image from cache or API if not passed or old.
            // For now, we trust the imageUrl passed from popup.js which itself got it from a (potentially cached) API call.
            // This saves an API call here.
            // If channel.imageUrl is missing, popup.js should provide a default.

            chrome.storage.sync.get('categories', (data) => {
                let categories = data.categories || {};
                if (!categories[categoryName]) {
                    categories[categoryName] = [];
                }

                const existingChannelIndex = categories[categoryName].findIndex(ch => ch.id === channel.id);
                if (existingChannelIndex > -1) {
                    categories[categoryName][existingChannelIndex] = channel; // Update if exists
                } else {
                    categories[categoryName].push(channel);
                }

                chrome.storage.sync.set({ categories }, () => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            });
        })();
        return true;
    }
    else if (request.type === "GET_RECENT_VIDEOS") {
        (async () => {
            const apiKey = await getApiKey();
            if (!apiKey) {
                sendResponse({ videos: [], error: "API Key not set." });
                return;
            }

            const allFetchedVideos = [];
            const VIDEOS_TO_FETCH_PER_CHANNEL = 15; // Fetch more to filter out Shorts
            const VIDEOS_TO_RETURN = 5;
            const MIN_VIDEO_DURATION_SECONDS = 70; // Videos shorter than this are likely Shorts or very short clips

            for (const channelId of request.channelIds) {
                // Check cache first for this channel's recent videos
                const cachedChannelVideos = await getCachedData(CACHE_CONFIG.RECENT_VIDEOS, channelId);
                if (cachedChannelVideos) {
                    allFetchedVideos.push(...cachedChannelVideos);
                    continue; // Move to next channel if cache hit
                }

                // Cache miss, fetch from API
                const searchData = await fetchYouTubeAPI('search', {
                    part: 'snippet',
                    channelId: channelId,
                    maxResults: VIDEOS_TO_FETCH_PER_CHANNEL,
                    order: 'date',
                    type: 'video',
                    fields: 'items(id(videoId),snippet(publishedAt,channelId,title,channelTitle,thumbnails(medium(url))))'
                });

                if (searchData.error) {
                    console.error(`Error fetching videos for ${channelId}: ${searchData.error}`);
                    continue;
                }

                if (searchData.items && searchData.items.length > 0) {
                    const videoIds = searchData.items.map(item => item.id.videoId).join(',');

                    // Get video durations to filter shorts
                    const videosDetailsData = await fetchYouTubeAPI('videos', {
                        part: 'contentDetails,snippet', // Snippet needed to map back if order changes
                        id: videoIds,
                        fields: 'items(id,snippet(title,channelTitle,channelId,publishedAt,thumbnails(medium(url))),contentDetails(duration))'
                    });

                    let processedChannelVideos = [];
                    if (videosDetailsData.items) {
                        const videoMap = new Map(searchData.items.map(item => [item.id.videoId, item.snippet]));

                        for (const videoDetail of videosDetailsData.items) {
                            const durationSeconds = iso8601DurationToSeconds(videoDetail.contentDetails.duration);
                            if (durationSeconds >= MIN_VIDEO_DURATION_SECONDS) {
                                const originalSnippet = videoMap.get(videoDetail.id);
                                if (originalSnippet) { // Ensure we have original snippet info
                                    processedChannelVideos.push({
                                        id: videoDetail.id,
                                        title: originalSnippet.title, // Prefer title from search as it's sometimes more concise
                                        thumbnail: originalSnippet.thumbnails.medium.url,
                                        channelName: originalSnippet.channelTitle,
                                        publishedAt: originalSnippet.publishedAt,
                                        channelId: originalSnippet.channelId,
                                        // duration: durationSeconds // Optional: if you want to display duration
                                    });
                                }
                            }
                            if (processedChannelVideos.length >= VIDEOS_TO_RETURN) break; // Got enough non-Shorts
                        }
                    }
                    // Cache the processed (non-Short, limited count) videos for this channel
                    if(processedChannelVideos.length > 0) {
                        await setCachedData(CACHE_CONFIG.RECENT_VIDEOS, channelId, processedChannelVideos.slice(0, VIDEOS_TO_RETURN));
                    }
                    allFetchedVideos.push(...processedChannelVideos.slice(0, VIDEOS_TO_RETURN));
                }
            }

            // Sort all collected videos by date and take the newest ones (if combining from multiple channels not pre-sorted)
            // Since we process per channel and cache per channel, this outer sort is mainly if categories display combined list
            allFetchedVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
            sendResponse({ videos: allFetchedVideos }); // Send all collected, front-end can limit if needed
        })();
        return true;
    }
    return false;
});

// Optional: Clear old cache entries periodically (e.g., on browser startup)
chrome.alarms.create('cacheCleanup', { periodInMinutes: 1440 }); // Once a day

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cacheCleanup') {
        // console.log("Running daily cache cleanup...");
        try {
            const allStorage = await chrome.storage.local.get(null);
            const now = Date.now();
            const keysToRemove = [];

            for (const key in allStorage) {
                if (key.startsWith(CACHE_CONFIG.CHANNEL_DETAILS.prefix) || key.startsWith(CACHE_CONFIG.RECENT_VIDEOS.prefix)) {
                    const item = allStorage[key];
                    let duration = 0;
                    if (key.startsWith(CACHE_CONFIG.CHANNEL_DETAILS.prefix)) duration = CACHE_CONFIG.CHANNEL_DETAILS.durationMs;
                    if (key.startsWith(CACHE_CONFIG.RECENT_VIDEOS.prefix)) duration = CACHE_CONFIG.RECENT_VIDEOS.durationMs;

                    if (item && item.timestamp && (now - item.timestamp > duration)) {
                        keysToRemove.push(key);
                    }
                }
            }
            if (keysToRemove.length > 0) {
                await chrome.storage.local.remove(keysToRemove);
                // console.log("Cache cleanup: Removed", keysToRemove.length, "stale items.");
            }
        } catch (e) {
            console.error("Error during cache cleanup:", e);
        }
    }
});