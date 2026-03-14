// TeamSpirit Assistant - Shared Utility Functions
// popup.js と content.js で共通利用するユーティリティ関数群

// ==================== Location Mapping ====================
// ※ popup.js の sendPunchCommand 内にも同一定義があるが、
//    chrome.scripting.executeScript 内のためグローバル参照不可。そちらは維持。
const LOCATION_MAP = {
  'remote': 'リモート',
  'office': 'オフィス',
  'direct-to-office': '直行→オフィス',
  'office-to-direct': 'オフィス→直帰',
  'direct': '直行直帰'
};

// ==================== Time Formatting ====================

// Format duration (ms) as HH:MM:SS
function formatDuration(ms) {
  if (!ms || ms < 0) return '--:--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Format Date object as HH:MM
function formatTimeShort(date) {
  if (!date) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ==================== Time Parsing ====================

// Parse time string like "152:00" or "-89:17" to minutes
function parseTimeToMinutes(timeStr) {
  if (!timeStr || timeStr === '--:--') return null;
  const isNegative = timeStr.startsWith('-');
  const cleanTime = timeStr.replace('-', '');
  const parts = cleanTime.split(':');
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return isNegative ? -(hours * 60 + minutes) : (hours * 60 + minutes);
}

// Format minutes to time string like "8:00" or "-1:30"
function formatMinutesToTime(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined) return '--:--';
  const isNegative = totalMinutes < 0;
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return isNegative ? `-${hours}:${String(minutes).padStart(2, '0')}` : `${hours}:${String(minutes).padStart(2, '0')}`;
}

// Parse time string "HH:MM" to Date object (today's date with given time)
function parseTimeToDate(timeStr) {
  if (!timeStr || timeStr === '--:--') return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

// 時刻文字列 "HH:MM" → タイムスタンプ（日跨ぎ補正付き）
// 12時間以上未来の時刻は前日として補正
function parseTimeToTimestamp(timeStr) {
  if (!timeStr || timeStr === '--:--') return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  if (d.getTime() - Date.now() > CONFIG.HALF_DAY_MS) {
    d.setDate(d.getDate() - 1);
  }
  return d.getTime();
}
