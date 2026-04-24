const trackedVideos = new Set();
let limitBlocked = false;

function trackVideo(video) {
  if (trackedVideos.has(video)) return;
  trackedVideos.add(video);

  const domain = location.hostname;

  video.addEventListener('play', () => {
    chrome.runtime.sendMessage({ type: 'VIDEO_STARTED', domain });
  }, { once: true });

  let lastTick = null;

  video.addEventListener('timeupdate', () => {
    if (video.paused || video.ended || limitBlocked) {
      lastTick = null;
      return;
    }

    const now = Date.now();

    if (lastTick !== null) {
      const elapsed = (now - lastTick) / 1000;

      if (elapsed < 2) {
        chrome.runtime.sendMessage({ type: 'VIDEO_TICK', domain, seconds: elapsed });
      }
    }

    lastTick = now;
  });

  video.addEventListener('pause',  () => { lastTick = null; });
  video.addEventListener('ended',  () => { lastTick = null; });
  video.addEventListener('seeking', () => { lastTick = null; });
}

function pauseAllVideos() {
  document.querySelectorAll('video').forEach(v => {
    if (!v.paused) v.pause();
  });
}

function showLimitOverlay(reason, streakWarning, lang) {
  // Don't show multiple overlays
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

  card.innerHTML = `
    <style>
      @keyframes vtFadeIn {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
      }
    </style>
    <div style="font-size:48px; margin-bottom:12px;">&#9888;&#65039;</div>
    <div style="font-size:18px; font-weight:700; color:#1a1a2e; margin-bottom:8px;">
      ${reason}
    </div>
    <div style="font-size:13px; color:#e74c3c; font-weight:600; margin-bottom:24px;">
      ${streakWarning}
    </div>
    <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
      <button id="vt-btn-stop" style="
        padding: 10px 24px; border-radius: 10px; border: none;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff; font-size: 14px; font-weight: 700;
        cursor: pointer; transition: opacity 0.2s;
      ">${btnStop}</button>
      <button id="vt-btn-continue" style="
        padding: 10px 24px; border-radius: 10px;
        border: 2px solid #e74c3c; background: transparent;
        color: #e74c3c; font-size: 14px; font-weight: 700;
        cursor: pointer; transition: all 0.2s;
      ">${btnContinue}</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  document.getElementById('vt-btn-stop').addEventListener('click', () => {
    overlay.remove();
    // Keep videos paused, keep blocked
  });

  document.getElementById('vt-btn-continue').addEventListener('click', () => {
    overlay.remove();
    limitBlocked = false;
    // Notify background to override limits and reset streak
    chrome.runtime.sendMessage({ type: 'LIMIT_OVERRIDE' });
    // Resume videos
    document.querySelectorAll('video').forEach(v => {
      if (v.paused && v.readyState >= 2) v.play();
    });
  });
}

// Listen for limit messages from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LIMIT_REACHED') {
    showLimitOverlay(msg.reason, msg.streakWarning, msg.lang);
  }
});

// Track existing videos
document.querySelectorAll('video').forEach(trackVideo);

// Track dynamically added videos
const observer = new MutationObserver(() => {
  document.querySelectorAll('video').forEach(trackVideo);
});

observer.observe(document.body, { childList: true, subtree: true });
