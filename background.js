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

// ── Per-key write queue: prevents read-modify-write races ──
const writeQueues = new Map();

function queueUpdate(key, mutator) {
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.then(() => new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      const updated = mutator(result[key]);
      chrome.storage.local.set({ [key]: updated }, resolve);
    });
  }));
  writeQueues.set(key, next.finally(() => {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }));
  return next;
}

function applyEvent(stats, domain, msg) {
  const s = stats || {};
  const site = s[domain] || { videos: 0, seconds: 0 };
  if (msg.type === 'VIDEO_STARTED') site.videos += (msg.count || 1);
  if (msg.type === 'VIDEO_TICK')    site.seconds += msg.seconds;
  s[domain] = site;
  return s;
}

function updateStats(key, domain, msg) {
  return queueUpdate(key, (cur) => applyEvent(cur, domain, msg));
}

// ── Notification check ──
function checkNotification() {
  const todayKey = getTodayKey();
  const stepKey = 'lastNotifiedStep_' + getTodayDate();
  chrome.storage.local.get([todayKey, stepKey, 'vt_notify_interval', 'vt_lang'], (result) => {
    const stats = result[todayKey] || {};
    let totalSeconds = 0;
    for (const domain in stats) {
      totalSeconds += stats[domain].seconds;
    }

    const intervalMinutes = result.vt_notify_interval ?? 60;
    if (intervalMinutes <= 0) return;
    const intervalSeconds = intervalMinutes * 60;
    const stepsReached = Math.floor(totalSeconds / intervalSeconds);
    const lastNotified = result[stepKey] || 0;

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

      chrome.notifications.create(`notify_${getTodayDate()}_${stepsReached}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Video Tracker',
        message: messages[lang] || messages.pt
      });

      chrome.storage.local.set({ [stepKey]: stepsReached });
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

    if (overridden) return;
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
// Rule: streak breaks only on an explicit override. Rest days (no activity) preserve the streak.
function updateStreak() {
  const today = getTodayDate();
  chrome.storage.local.get(['vt_streak', 'vt_streak_best', 'vt_streak_last_date'], (result) => {
    let streak = result.vt_streak || 0;
    let best = result.vt_streak_best || 0;
    const lastDate = result.vt_streak_last_date;

    if (lastDate === today) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDateStr(yesterday);

    chrome.storage.local.get(['vt_limit_override_' + yesterdayStr], (yResult) => {
      const hadOverride = yResult['vt_limit_override_' + yesterdayStr];

      if (hadOverride) {
        streak = 0;
      } else {
        // No override yesterday → credit a streak day (whether or not anything was watched).
        streak += 1;
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

function handleLimitOverride() {
  const today = getTodayDate();
  chrome.storage.local.set({
    ['vt_limit_override_' + today]: true,
    vt_streak: 0
  });
}

// ── Daily reset alarm: fires once at next local midnight, then every 24h ──
function scheduleMidnightAlarm() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 5, 0); // 5s past midnight to avoid race with date roll
  chrome.alarms.create('resetDaily', { when: next.getTime(), periodInMinutes: 60 * 24 });
}
scheduleMidnightAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'resetDaily') {
    updateStreak();
    // lastNotifiedStep is now date-keyed; old keys get cleaned up opportunistically below.
    cleanupOldNotifySteps();
  }
});

function cleanupOldNotifySteps() {
  chrome.storage.local.get(null, (all) => {
    const today = getTodayDate();
    const toRemove = [];
    for (const k of Object.keys(all)) {
      if (k.startsWith('lastNotifiedStep_') && k !== 'lastNotifiedStep_' + today) {
        toRemove.push(k);
      }
      if (k === 'lastNotifiedStep') toRemove.push(k); // legacy
    }
    if (toRemove.length) chrome.storage.local.remove(toRemove);
  });
}

updateStreak();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'LIMIT_OVERRIDE') {
    handleLimitOverride();
    return;
  }

  if (msg.type !== 'VIDEO_STARTED' && msg.type !== 'VIDEO_TICK') return;

  const tabId = sender.tab ? sender.tab.id : null;

  updateStats(getTodayKey(), msg.domain, msg).then(() => {
    if (msg.type === 'VIDEO_TICK') {
      checkNotification();
      checkLimits(tabId);
    }
    if (msg.type === 'VIDEO_STARTED') {
      checkLimits(tabId);
    }
  });

  updateStats(getHourKey(), msg.domain, msg);
  updateStats('stats_alltime', msg.domain, msg);
});
