const trackedVideos = new WeakSet();
// Per-frame: once a limit is reached and shown, this blocks further tick accumulation
// until the user explicitly chooses Continue (which clears it via LIMIT_OVERRIDE).
let limitBlocked = false;

const FLUSH_MS = 500;
let pendingSeconds = 0;
let pendingVideoStarts = 0;
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  flushTimer = null;
  const domain = location.hostname;
  if (pendingVideoStarts > 0) {
    chrome.runtime.sendMessage({ type: 'VIDEO_STARTED', domain, count: pendingVideoStarts });
    pendingVideoStarts = 0;
  }
  if (pendingSeconds > 0) {
    chrome.runtime.sendMessage({ type: 'VIDEO_TICK', domain, seconds: pendingSeconds });
    pendingSeconds = 0;
  }
}

function markNewVideo() {
  pendingVideoStarts += 1;
  scheduleFlush();
}

function trackVideo(video) {
  if (trackedVideos.has(video)) return;
  trackedVideos.add(video);

  // `loadstart` fires whenever a new source loads (SPA navigations on YouTube
  // reuse the same <video> element, so `play` alone undercounts videos).
  let countedThisSource = false;
  video.addEventListener('loadstart', () => { countedThisSource = false; });

  let lastTick = null;

  video.addEventListener('play', () => {
    if (!countedThisSource) {
      countedThisSource = true;
      markNewVideo();
    }
  });

  video.addEventListener('timeupdate', () => {
    if (video.paused || video.ended || limitBlocked) {
      lastTick = null;
      return;
    }
    const now = Date.now();
    if (lastTick !== null) {
      const elapsed = (now - lastTick) / 1000;
      if (elapsed > 0 && elapsed < 2) {
        pendingSeconds += elapsed;
        scheduleFlush();
      }
    }
    lastTick = now;
  });

  const resetTick = () => { lastTick = null; };
  video.addEventListener('pause',  resetTick);
  video.addEventListener('ended',  resetTick);
  video.addEventListener('seeking', resetTick);
}

function pauseAllVideos() {
  document.querySelectorAll('video').forEach(v => {
    if (!v.paused) v.pause();
  });
}

function showLimitOverlay(reason, streakWarning, lang) {
  if (document.getElementById('vt-limit-overlay')) return;

  pauseAllVideos();
  limitBlocked = true;

  const overlay = document.createElement('div');
  overlay.id = 'vt-limit-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', system-ui, sans-serif;
  `;

  const btnStop = lang === 'pt' ? 'Parar de assistir' : 'Stop watching';
  const btnContinue = lang === 'pt' ? 'Continuar (perder streak)' : 'Continue (lose streak)';

  const card = document.createElement('div');
  card.style.cssText = `
    background: #fff; border-radius: 16px; padding: 32px;
    max-width: 400px; width: 90%; text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    animation: vtFadeIn 0.3s ease;
  `;

  const style = document.createElement('style');
  style.textContent = `@keyframes vtFadeIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }`;
  card.appendChild(style);

  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:48px; margin-bottom:12px;';
  icon.textContent = '⚠️';
  card.appendChild(icon);

  const reasonEl = document.createElement('div');
  reasonEl.style.cssText = 'font-size:18px; font-weight:700; color:#1a1a2e; margin-bottom:8px;';
  reasonEl.textContent = reason;
  card.appendChild(reasonEl);

  const warnEl = document.createElement('div');
  warnEl.style.cssText = 'font-size:13px; color:#e74c3c; font-weight:600; margin-bottom:24px;';
  warnEl.textContent = streakWarning;
  card.appendChild(warnEl);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:12px; justify-content:center; flex-wrap:wrap;';

  const stopBtn = document.createElement('button');
  stopBtn.style.cssText = `padding: 10px 24px; border-radius: 10px; border: none;
    background: linear-gradient(135deg, #667eea, #764ba2); color: #fff;
    font-size: 14px; font-weight: 700; cursor: pointer;`;
  stopBtn.textContent = btnStop;

  const continueBtn = document.createElement('button');
  continueBtn.style.cssText = `padding: 10px 24px; border-radius: 10px;
    border: 2px solid #e74c3c; background: transparent; color: #e74c3c;
    font-size: 14px; font-weight: 700; cursor: pointer;`;
  continueBtn.textContent = btnContinue;

  btnRow.appendChild(stopBtn);
  btnRow.appendChild(continueBtn);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  stopBtn.addEventListener('click', () => {
    overlay.remove();
  });

  continueBtn.addEventListener('click', () => {
    overlay.remove();
    limitBlocked = false;
    chrome.runtime.sendMessage({ type: 'LIMIT_OVERRIDE' });
    document.querySelectorAll('video').forEach(v => {
      if (v.paused && v.readyState >= 2) v.play();
    });
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LIMIT_REACHED') {
    showLimitOverlay(msg.reason, msg.streakWarning, msg.lang);
  }
});

document.querySelectorAll('video').forEach(trackVideo);

// Only re-scan when nodes are actually added, and only inspect the added subtrees.
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (!m.addedNodes || m.addedNodes.length === 0) continue;
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.tagName === 'VIDEO') {
        trackVideo(node);
      } else if (node.querySelectorAll) {
        const vids = node.querySelectorAll('video');
        if (vids.length) vids.forEach(trackVideo);
      }
    }
  }
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}

// Flush on unload so we don't lose the last few seconds.
window.addEventListener('pagehide', flush);
