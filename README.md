![YT Organizer](https://github.com/user-attachments/assets/215bb2a1-5748-43a2-b2ba-3add74f17d31)

# YouTube Channels Organizer
A simple extension for Chromium and Firefox-based browsers to organize your favorite channels into the categories you prefer. 
I created this extension because I wanted to view view latest videos of my fav creators in one place without having to go to each's profile or subscribe them. 

#### Notes and features:
- It fetches the latest 5 videos of each creator and shows them.
- It uses your YT API for fetching videos and due to a daily limit, the more you fetch the faster you will hit the limit. I've tried implementing cache and other steps to limit the token usage.
- You can edit/delete categories you created or remove the channels from the category. 


> Disclaimer: You'll need YouTube Data API V3 for this extension to work due to various limitations set by YT. This extension was created with the help of AI.


## Get a YouTube Data API v3 Key:
1. Go to the Google Cloud Console.
2. Create a new project (or select an existing one).
3. Go to "APIs & Services" > "Library".
4. Search for "YouTube Data API v3" and enable it.
5. Go to "APIs & Services" > "Credentials".
6. Click "+ CREATE CREDENTIALS" > "API key".

Google provides 10k daily queries. The queries include fetching channel names, channel IDs, and videos. You can view your limits [in this page](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas).

## Installation guidelines

### Chromium-based browsers
1. Go to the Extension page `chrome:extensions`
2. Enable "Developer mode"
3. Click on "Load unpacked" and upload the downloaded folder

### Firefox-based browsers
1. Type `about:config` in the address bar and press Enter. Click on "Accept Risk and continue".
2. Search for `xpinstall.signatures.required` and set it to "False" by dounle-clicking on the row
3. Open Add-ons Manager page `about:addons`
4. From gear icon, select "Install add-on from file" and select the downloaded xpi file.

