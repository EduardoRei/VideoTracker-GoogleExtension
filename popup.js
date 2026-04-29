// ── i18n ──
const i18n = {
  pt: {
    tab_today: 'Hoje',
    tab_7days: '7 Dias',
    tab_30days: '30 Dias',
    tab_alltime: 'Tudo',
    videos: 'videos',
    watched: 'assistidos',
    chart_title: 'Tempo por periodo',
    chart_title_today: 'Tempo por hora',
    chart_title_days: 'Tempo por dia',
    site: 'Site',
    time: 'Tempo',
    empty: 'Nenhum video ainda',
    notify_label: 'Notificar a cada',
    max_videos_label: 'Max videos/dia',
    max_time_label: 'Max tempo/dia',
    unit_videos: 'vid',
    limits_hint: '0 = sem limite',
    settings_title: 'Configuracoes',
    streak_days: 'dias de streak',
    streak_best: 'Recorde:',
    saved: 'Salvo!',
    toggle: 'EN'
  },
  en: {
    tab_today: 'Today',
    tab_7days: '7 Days',
    tab_30days: '30 Days',
    tab_alltime: 'All Time',
    videos: 'videos',
    watched: 'watched',
    chart_title: 'Time per period',
    chart_title_today: 'Time per hour',
    chart_title_days: 'Time per day',
    site: 'Site',
    time: 'Time',
    empty: 'No videos yet',
    notify_label: 'Notify every',
    max_videos_label: 'Max videos/day',
    max_time_label: 'Max time/day',
    unit_videos: 'vid',
    limits_hint: '0 = no limit',
    settings_title: 'Settings',
    streak_days: 'day streak',
    streak_best: 'Best:',
    saved: 'Saved!',
    toggle: 'PT'
  }
};

let currentLang = 'pt';
let currentTab = 'today';
let chartInstance = null;

function t(key) {
  return i18n[currentLang][key] || key;
}

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.getElementById('lang-toggle').textContent = t('toggle');
}

// ── Helpers ──
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}h`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function secondsToHours(seconds) {
  return Math.round((seconds / 3600) * 100) / 100;
}

function formatChartHours(val) {
  const h = Math.floor(val);
  const m = Math.round((val - h) * 60);
  if (h > 0) return m > 0 ? `${h}:${m.toString().padStart(2, '0')}h` : `${h}h`;
  return `${m}m`;
}

function localDateStr(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

function flashSaved(id) {
  const el = document.getElementById(id);
  el.textContent = t('saved');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

// ── Setting confirm/dismiss helper ──
function setupSetting(inputId, confirmId, dismissId, savedId, storageKey, extraOnSave) {
  const input = document.getElementById(inputId);
  let originalValue = input.value;

  // Store original on focus
  input.addEventListener('focus', () => { originalValue = input.value; });

  document.getElementById(confirmId).addEventListener('click', () => {
    const val = parseInt(input.value, 10);
    if (isNaN(val) || val < 0) {
      input.value = originalValue;
      return;
    }
    const data = { [storageKey]: val };
    if (extraOnSave) Object.assign(data, extraOnSave);
    chrome.storage.local.set(data);
    originalValue = input.value;
    flashSaved(savedId);
  });

  document.getElementById(dismissId).addEventListener('click', () => {
    input.value = originalValue;
  });
}

// ── Data fetching ──
function loadTab(tab) {
  currentTab = tab;
  const todayStr = localDateStr();

  if (tab === 'today') {
    // Load daily key for totals + hourly keys for chart
    const dailyKey = 'stats_' + todayStr;
    const hourlyKeys = [];
    for (let h = 0; h < 24; h++) {
      hourlyKeys.push(`stats_hourly_${todayStr}_${h}`);
    }
    const allKeys = [dailyKey, ...hourlyKeys];

    chrome.storage.local.get(allKeys, (result) => {
      // Totals and table from daily key
      const dailyStats = result[dailyKey] || {};
      const mergedSites = {};
      let totalVideos = 0;
      let totalSeconds = 0;
      for (const [domain, data] of Object.entries(dailyStats)) {
        mergedSites[domain] = { videos: data.videos, seconds: data.seconds };
        totalVideos += data.videos;
        totalSeconds += data.seconds;
      }

      document.getElementById('total-videos').textContent = totalVideos;
      document.getElementById('total-time').textContent = formatTime(totalSeconds);
      renderTable(mergedSites);
      renderChart('hourly', hourlyKeys, result);

      document.querySelector('.chart-title').textContent = t('chart_title_today');
    });
    return;
  }

  if (tab === 'alltime') {
    chrome.storage.local.get(['stats_alltime'], (result) => {
      const stats = result['stats_alltime'] || {};
      const mergedSites = {};
      let totalVideos = 0;
      let totalSeconds = 0;
      for (const [domain, data] of Object.entries(stats)) {
        mergedSites[domain] = { videos: data.videos, seconds: data.seconds };
        totalVideos += data.videos;
        totalSeconds += data.seconds;
      }

      document.getElementById('total-videos').textContent = totalVideos;
      document.getElementById('total-time').textContent = formatTime(totalSeconds);
      renderTable(mergedSites);
      renderChart('alltime', ['stats_alltime'], result);

      document.querySelector('.chart-title').textContent = t('chart_title');
    });
    return;
  }

  // 7 days or 30 days
  const days = tab === '7days' ? 7 : 30;
  const keys = [];
  for (let i = 0; i < days; i++) {
    keys.push('stats_' + getDaysAgo(i));
  }

  chrome.storage.local.get(keys, (result) => {
    const mergedSites = {};
    let totalVideos = 0;
    let totalSeconds = 0;
    for (const key of keys) {
      const stats = result[key] || {};
      for (const [domain, data] of Object.entries(stats)) {
        if (!mergedSites[domain]) mergedSites[domain] = { videos: 0, seconds: 0 };
        mergedSites[domain].videos += data.videos;
        mergedSites[domain].seconds += data.seconds;
        totalVideos += data.videos;
        totalSeconds += data.seconds;
      }
    }

    document.getElementById('total-videos').textContent = totalVideos;
    document.getElementById('total-time').textContent = formatTime(totalSeconds);
    renderTable(mergedSites);
    renderChart('daily', keys, result);

    document.querySelector('.chart-title').textContent = t('chart_title_days');
  });
}

function renderTable(sites) {
  const body = document.getElementById('data-body');
  const entries = Object.entries(sites);

  if (entries.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="empty">${t('empty')}</td></tr>`;
    return;
  }

  entries.sort((a, b) => b[1].seconds - a[1].seconds);
  body.innerHTML = entries.map(([domain, data]) => `
    <tr>
      <td class="domain">${domain}</td>
      <td>${data.videos}</td>
      <td>${formatTime(data.seconds)}</td>
    </tr>
  `).join('');
}

function renderChart(type, keys, result) {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // Replace canvas to prevent Chart.js resize accumulation
  const wrapper = document.querySelector('.chart-wrapper');
  wrapper.innerHTML = '<canvas id="chart"></canvas>';
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');

  const labels = [];
  const timeData = [];
  const videoData = [];

  if (type === 'hourly') {
    for (let h = 0; h < 24; h++) {
      labels.push(`${h.toString().padStart(2, '0')}h`);
      const stats = result[keys[h]] || {};
      let secs = 0, vids = 0;
      for (const d of Object.values(stats)) {
        secs += d.seconds;
        vids += d.videos;
      }
      timeData.push(secondsToHours(secs));
      videoData.push(vids);
    }
  } else if (type === 'daily') {
    for (let i = keys.length - 1; i >= 0; i--) {
      const dateStr = keys[i].replace('stats_', '');
      const parts = dateStr.split('-');
      labels.push(`${parts[2]}/${parts[1]}`);
      const stats = result[keys[i]] || {};
      let secs = 0, vids = 0;
      for (const d of Object.values(stats)) {
        secs += d.seconds;
        vids += d.videos;
      }
      timeData.push(secondsToHours(secs));
      videoData.push(vids);
    }
  } else {
    labels.push('Total');
    const stats = result['stats_alltime'] || {};
    let secs = 0, vids = 0;
    for (const d of Object.values(stats)) {
      secs += d.seconds;
      vids += d.videos;
    }
    timeData.push(secondsToHours(secs));
    videoData.push(vids);
  }

  const labelTime = currentLang === 'pt' ? 'Tempo' : 'Time';
  const labelVid = currentLang === 'pt' ? 'Videos' : 'Videos';

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: labelTime,
          data: timeData,
          backgroundColor: 'rgba(102, 126, 234, 0.6)',
          borderColor: 'rgba(102, 126, 234, 1)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'yTime',
          order: 2
        },
        {
          label: labelVid,
          data: videoData,
          type: 'line',
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.1)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#e74c3c',
          fill: false,
          yAxisID: 'yVideos',
          order: 1
        }
      ]
    },
    options: {
      responsive: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { font: { size: 10 }, boxWidth: 12, padding: 8 }
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              if (item.datasetIndex === 0) return formatChartHours(item.parsed.y);
              return `${item.parsed.y} ${labelVid.toLowerCase()}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 9 },
            maxRotation: type === 'daily' && keys.length > 10 ? 45 : 0
          }
        },
        yTime: {
          position: 'left',
          beginAtZero: true,
          grid: { color: '#f0f0f5' },
          ticks: {
            font: { size: 10 },
            callback: (v) => formatChartHours(v)
          }
        },
        yVideos: {
          position: 'right',
          beginAtZero: true,
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            stepSize: 1,
            callback: (v) => Number.isInteger(v) ? v : ''
          }
        }
      }
    }
  });
}

// ── CSV Export ──
function getExportKeys() {
  const todayStr = localDateStr();
  if (currentTab === 'today') {
    const keys = [];
    for (let h = 0; h < 24; h++) keys.push(`stats_hourly_${todayStr}_${h}`);
    return { keys, type: 'hourly' };
  }
  if (currentTab === 'alltime') {
    return { keys: ['stats_alltime'], type: 'alltime' };
  }
  const days = currentTab === '7days' ? 7 : 30;
  const keys = [];
  for (let i = 0; i < days; i++) keys.push('stats_' + getDaysAgo(i));
  return { keys, type: 'daily' };
}

function csvEscape(v) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(arr) { return arr.map(csvEscape).join(','); }

function exportCSV() {
  const { keys, type } = getExportKeys();
  chrome.storage.local.get(keys, (result) => {
    const rows = [csvRow(['Date', 'Site', 'Videos', 'Seconds'])];

    if (type === 'alltime') {
      const stats = result['stats_alltime'] || {};
      for (const [domain, data] of Object.entries(stats)) {
        rows.push(csvRow(['all_time', domain, data.videos, Math.round(data.seconds)]));
      }
    } else if (type === 'hourly') {
      for (let h = 0; h < 24; h++) {
        const stats = result[keys[h]] || {};
        const dateStr = keys[h].replace('stats_hourly_', '').replace(/_\d+$/, '');
        const hourLabel = `${dateStr} ${h.toString().padStart(2, '0')}:00`;
        for (const [domain, data] of Object.entries(stats)) {
          rows.push(csvRow([hourLabel, domain, data.videos, Math.round(data.seconds)]));
        }
      }
    } else {
      for (const key of keys) {
        const dateStr = key.replace('stats_', '');
        const stats = result[key] || {};
        for (const [domain, data] of Object.entries(stats)) {
          rows.push(csvRow([dateStr, domain, data.videos, Math.round(data.seconds)]));
        }
      }
    }

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video-tracker-${currentTab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ── Streak display ──
function loadStreak() {
  chrome.storage.local.get(['vt_streak', 'vt_streak_best'], (result) => {
    const streak = result.vt_streak || 0;
    const best = result.vt_streak_best || 0;
    document.getElementById('streak-count').textContent = streak;
    document.getElementById('streak-best').textContent = `${t('streak_best')} ${best}`;
  });
}

// ── Init ──
const today = new Date();
document.getElementById('date-label').textContent = localDateStr(today);

// Load saved settings
chrome.storage.local.get(['vt_lang', 'vt_notify_interval', 'vt_max_videos', 'vt_max_time'], (result) => {
  const browserLang = (navigator.language || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en';
  currentLang = result.vt_lang || browserLang;
  document.getElementById('notify-interval').value = result.vt_notify_interval || 60;
  document.getElementById('max-videos').value = result.vt_max_videos || 0;
  document.getElementById('max-time').value = result.vt_max_time || 0;
  applyLang();
  loadTab('today');
  loadStreak();
});

// Tab clicks
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadTab(tab.dataset.tab);
  });
});

// Language toggle
document.getElementById('lang-toggle').addEventListener('click', () => {
  currentLang = currentLang === 'pt' ? 'en' : 'pt';
  chrome.storage.local.set({ vt_lang: currentLang });
  applyLang();
  loadTab(currentTab);
  loadStreak();
});

// Export CSV
document.getElementById('btn-export').addEventListener('click', exportCSV);

// Settings: confirm/dismiss for each field
setupSetting('notify-interval', 'notify-confirm', 'notify-dismiss', 'notify-saved',
  'vt_notify_interval', { lastNotifiedStep: 0 });

setupSetting('max-videos', 'maxvid-confirm', 'maxvid-dismiss', 'maxvid-saved',
  'vt_max_videos');

setupSetting('max-time', 'maxtime-confirm', 'maxtime-dismiss', 'maxtime-saved',
  'vt_max_time');
