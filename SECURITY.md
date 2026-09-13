# Security Policy

## Supported Versions

Only the latest released version of the Chromium and Firefox builds is supported with fixes.

| Version | Supported          |
| ------- | ------------------ |
| 3.0.x   | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

This extension only talks to `youtube.com` (RSS feeds, oEmbed, and page scraping to resolve channel info) and stores your categories/channels locally via the browser's extension storage - it does not run its own backend or collect data.

If you find a security issue (e.g. an XSS vector in rendered channel/video data, or unsafe use of extension permissions), please open an issue in this repository describing the problem and steps to reproduce. Avoid filing public issues for anything actively exploitable; mention that in the issue title and a maintainer will follow up privately.
