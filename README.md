# Video Tracker

A Chrome extension that tracks how many videos you watch and how much time you spend watching them — organized by website, with daily limits, streak gamification, and charts.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

---

## Features

- **Tabs by period** — Today, Last 7 Days, Last 30 Days, All Time
- **Charts** — bar chart (watch time) + line chart (video count) per hour (today) or per day (other tabs)
- **Per-site breakdown** — stats separated by domain (youtube.com, netflix.com, etc.)
- **CSV export** — export the current tab's data as a CSV file
- **Configurable notifications** — get reminded after X minutes of daily watch time (default: 60 min)
- **Daily limits** — set max videos/day and max watch time/day
- **Limit enforcement** — when a limit is reached, all videos are paused and an overlay asks if you want to stop or continue
- **Streak gamification** — each day you stay under your limits earns a streak day; continuing past a limit resets the streak to 0
- **Best streak record** — your highest streak is saved and displayed
- **Bilingual** — toggle between Portuguese and English (preference saved)
- **Local only** — all data stays on your machine, no accounts, no network requests

---

## How it works

```
Page (youtube.com)
  content.js        detects <video> elements, tracks play/time events
        |           listens for LIMIT_REACHED to pause videos + show overlay
        v
  background.js     receives events, accumulates stats,
        |           checks notifications, limits, and streak
        v
  chrome.storage    persists stats by date + hour + domain
        |
        v
  popup.js          reads and renders stats, charts, settings
```

The extension injects a content script into every tab. When a `<video>` element starts playing, it fires a `VIDEO_STARTED` event. While playing, `timeupdate` fires every ~250ms and accumulates real elapsed seconds. Seeking, pausing, and tab switches are handled — only actual watch time is counted.

Data is stored under multiple keys:
- `stats_YYYY-MM-DD` — daily totals per domain
- `stats_hourly_YYYY-MM-DD_H` — hourly breakdown (for today's chart)
- `stats_alltime` — cumulative totals, never resets
- `vt_*` — user settings (language, limits, notification interval, streak)

---

## Project structure

```
VideoTracker-GoogleExtension/
├── manifest.json       Extension config (permissions, scripts, icons)
├── background.js       Service worker — stats, notifications, limits, streak
├── content.js          Injected into pages — video detection, limit overlay
├── popup.html          UI with tabs, charts, settings
├── popup.js            Reads storage, renders charts (Chart.js), settings, i18n
├── lib/
│   └── chart.min.js    Chart.js v4 (bundled, no CDN)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Installation (development)

> No build step required — plain HTML, CSS, and JavaScript.

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/video-tracker.git
   cd video-tracker
   ```

2. Load in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top right toggle)
   - Click **Load unpacked** and select the project folder

3. The extension icon appears in the toolbar. Open YouTube, watch a few seconds of any video, then click the icon to see your stats.

---

## Settings

All settings are accessible from the popup, below the data table:

| Setting | Description | Default |
|---|---|---|
| Notify every | Minutes of watch time before a reminder notification | 60 min |
| Max videos/day | Daily video limit (0 = no limit) | 0 |
| Max time/day | Daily watch time limit in minutes (0 = no limit) | 0 |

Each setting has confirm/dismiss buttons. Changes are saved to local storage.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Save and read video stats and settings locally |
| `notifications` | Show reminders when watch time thresholds are reached |
| `alarms` | Reset daily notification counters at midnight |

No network requests are made. No data ever leaves your machine.

---

## Inspecting stored data

1. Go to `chrome://extensions`
2. Click **"service worker"** on the Video Tracker card
3. In DevTools, go to **Application > Storage > Extension Storage > Local**

You'll see keys like `stats_2026-04-24`, `stats_hourly_2026-04-24_14`, `stats_alltime`, and `vt_*` settings.

---

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push and open a Pull Request

---

## License

MIT — see [LICENSE](LICENSE) for details.
