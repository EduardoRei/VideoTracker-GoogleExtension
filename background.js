function localDateStr(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayKey() {
  return 'stats_' + localDateStr();
}

function getTodayDate() {
  return localDateStr();
}

function getHourKey() {
  const now = new Date();
  return `stats_hourly_${localDateStr(now)}_${now.getHours()}`;
}

function updateStats(key, domain, msg, callback) {
  chrome.storage.local.get([key], (result) => {
    const stats = result[key] || {};
    const site = stats[domain] || { videos: 0, seconds: 0 };

    if (msg.type === 'VIDEO_STARTED') site.videos += 1;
    if (msg.type === 'VIDEO_TICK')    site.seconds += msg.seconds;

    stats[domain] = site;
    chrome.storage.local.set({ [key]: stats }, () => {
      if (callback) callback();
    });
  });
}

// ── Notification check ──
function checkNotification() {
  const todayKey = getTodayKey();
  chrome.storage.local.get([todayKey, 'lastNotifiedStep', 'vt_notify_interval', 'vt_lang'], (result) => {
    const stats = result[todayKey] || {};
    let totalSeconds = 0;
    for (const domain in stats) {
      totalSeconds += stats[domain].seconds;
    }

    const intervalMinutes = result.vt_notify_interval || 60;
    const intervalSeconds = intervalMinutes * 60;
    const stepsReached = Math.floor(totalSeconds / intervalSeconds);
    const lastNotified = result.lastNotifiedStep || 0;

    if (stepsReached > 0 && stepsReached > lastNotified) {
      const lang = result.vt_lang || 'pt';
      const totalMin = stepsReached * intervalMinutes;
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;

      let timeStr;
      if (lang === 'pt') {
        timeStr = h > 0
          ? (m > 0 ? `${h}h${m}min` : `${h} hora${h > 1 ? 's' : ''}`)
          : `${m} minuto${m > 1 ? 's' : ''}`;
      } else {
        timeStr = h > 0
          ? (m > 0 ? `${h}h${m}min` : `${h} hour${h > 1 ? 's' : ''}`)
          : `${m} minute${m > 1 ? 's' : ''}`;
      }

      const messages = {
        pt: `Voce ja assistiu por ${timeStr} hoje. Talvez seja melhor dar uma descansada!`,
        en: `You've watched for ${timeStr} today. Maybe it's time to take a break!`
      };

      chrome.notifications.create(`notify_${stepsReached}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Video Tracker',
        message: messages[lang] || messages.pt
      });

      chrome.storage.local.set({ lastNotifiedStep: stepsReached });
    }
  });
}

// ── Limit check ──
function getTodayTotals(callback) {
  const todayKey = getTodayKey();
  chrome.storage.local.get([todayKey], (result) => {
    const stats = result[todayKey] || {};
    let totalVideos = 0;
    let totalSeconds = 0;
    for (const domain in stats) {
      totalVideos += stats[domain].videos;
      totalSeconds += stats[domain].seconds;
    }
    callback(totalVideos, totalSeconds);
  });
}

function checkLimits(senderTabId) {
  chrome.storage.local.get(['vt_max_videos', 'vt_max_time', 'vt_limit_override_' + getTodayDate(), 'vt_lang'], (settings) => {
    const maxVideos = settings.vt_max_videos || 0;
    const maxTimeMin = settings.vt_max_time || 0;
    const overridden = settings['vt_limit_override_' + getTodayDate()];
    const lang = settings.vt_lang || 'pt';

    // If user already chose to override today, don't check again
    if (overridden) return;
    // If no limits set, skip
    if (maxVideos === 0 && maxTimeMin === 0) return;

    getTodayTotals((totalVideos, totalSeconds) => {
      const totalMin = totalSeconds / 60;
      let limitHit = false;
      let reason = '';

      if (maxVideos > 0 && totalVideos >= maxVideos) {
        limitHit = true;
        reason = lang === 'pt'
          ? `Voce atingiu o limite de ${maxVideos} video${maxVideos > 1 ? 's' : ''} por dia!`
          : `You've reached the limit of ${maxVideos} video${maxVideos > 1 ? 's' : ''} per day!`;
      }

      if (maxTimeMin > 0 && totalMin >= maxTimeMin) {
        limitHit = true;
        reason = lang === 'pt'
          ? `Voce atingiu o limite de ${maxTimeMin} minutos por dia!`
          : `You've reached the limit of ${maxTimeMin} minutes per day!`;
      }

      if (limitHit && senderTabId) {
        const streakWarning = lang === 'pt'
          ? 'Se continuar, voce perdera todo o seu progresso de streak!'
          : 'If you continue, you will lose all your streak progress!';

        chrome.tabs.sendMessage(senderTabId, {
          type: 'LIMIT_REACHED',
          reason,
          streakWarning,
          lang
        });
      }
    });
  });
}

// ── Streak management ──
function updateStreak() {
  const today = getTodayDate();
  chrome.storage.local.get(['vt_streak', 'vt_streak_best', 'vt_streak_last_date'], (result) => {
    let streak = result.vt_streak || 0;
    let best = result.vt_streak_best || 0;
    const lastDate = result.vt_streak_last_date;

    if (lastDate === today) return; // Already updated today

    // Check if yesterday had an override
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDateStr(yesterday);

    chrome.storage.local.get(['vt_limit_override_' + yesterdayStr, 'stats_' + yesterdayStr], (yResult) => {
      const hadOverride = yResult['vt_limit_override_' + yesterdayStr];
      const hadActivity = yResult['stats_' + yesterdayStr];

      if (hadOverride) {
        // Override yesterday = reset streak
        streak = 0;
      } else if (hadActivity || lastDate === yesterdayStr) {
        // Had activity and didn't override = streak continues
        streak += 1;
      }
      // If no activity yesterday and last date wasn't yesterday, streak resets
      else if (lastDate && lastDate !== yesterdayStr) {
        streak = 0;
      }

      if (streak > best) best = streak;

      chrome.storage.local.set({
        vt_streak: streak,
        vt_streak_best: best,
        vt_streak_last_date: today
      });
    });
  });
}

// ── Handle override response from content script ──
function handleLimitOverride() {
  const today = getTodayDate();
  chrome.storage.local.set({
    ['vt_limit_override_' + today]: true,
    vt_streak: 0
  });
}

// ── Reset daily counters at midnight ──
chrome.alarms.create('resetDaily', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'resetDaily') {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      chrome.storage.local.set({ lastNotifiedStep: 0 });
      updateStreak();
    }
  }
});

// Update streak on extension start
updateStreak();

// ── Message handler ──
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'LIMIT_OVERRIDE') {
    handleLimitOverride();
    return;
  }

  if (msg.type !== 'VIDEO_STARTED' && msg.type !== 'VIDEO_TICK') return;

  const tabId = sender.tab ? sender.tab.id : null;

  // Update daily stats first, then check notifications/limits after write completes
  updateStats(getTodayKey(), msg.domain, msg, () => {
    if (msg.type === 'VIDEO_TICK') {
      checkNotification();
      checkLimits(tabId);
    }
    if (msg.type === 'VIDEO_STARTED') {
      checkLimits(tabId);
    }
  });

  // Hourly and alltime can run in parallel, no dependency
  updateStats(getHourKey(), msg.domain, msg);
  updateStats('stats_alltime', msg.domain, msg);
});
