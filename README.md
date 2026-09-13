# YouTube Channels Organizer
A simple extension for Chromium and Firefox-based browsers to organize your favorite channels into the categories you prefer.
I created this extension because I wanted to view the latest videos of my fav creators in one place without having to go to each's profile or subscribe to them.

#### Notes and features:
- It fetches each creator's latest videos via YT's RSS feed and shows them, automatically filtering out YouTube Shorts.
- It uses YT RSS to fetch the videos so might be slow and not fully up to date.
- Since YouTube restricts embedding on many videos (creators can whitelist only specific domains), videos open in a new tab instead of playing inline.
- The Library page has a folder-style sidebar of categories with inline rename, delete, and drag-to-reorder - no separate management page needed.
- View a category's videos as one flat feed ("All videos") or grouped by creator ("By creator"), with a one-click way to remove a creator from a category right from the grouped view.
- Each category surfaces "featured channels" that your saved creators themselves cross-promote, as suggestions you can save with one click.
- Save a creator from a video's watch page or from the creator's own channel page, using a small floating "Save creator" button - pick an existing category or create a new one on the spot.
- You can also import and export your categories as JSON.


> Disclaimer: Due to per-video/per-channel embedding restrictions on YouTube's side, videos play by opening in a new tab instead of inline.


## Installation guidelines

### Chromium-based browsers
> Install the extenstion from the [Chrome Web Store](https://chromewebstore.google.com/detail/youtube-organizer-rss/jhcemfdejnfmocheecgbbanhoocbcjkg).

### Firefox-based browsers
> Install from [Addons Page](https://addons.mozilla.org/en-US/firefox/addon/youtube-channels-organizer).
