// TeamSpirit Assistant - Background Service Worker
// Handles data fetching and message passing

const TEAMSPIRIT_URL = 'https://teamspirit-74532.lightning.force.com/lightning/page/home';
const TEAMSPIRIT_ATTENDANCE_URL = 'https://teamspirit-74532.lightning.force.com/lightning/n/teamspirit__AtkWorkTimeTab';
const HOLIDAYS_API_URL = 'https://holidays-jp.github.io/api/v1/date.json';

// ==================== 祝日API ====================

// 祝日データを取得（キャッシュ付き）
async function getHolidays() {
  try {
    // キャッシュ確認（24時間有効）
    const cached = await chrome.storage.local.get(['holidays', 'holidaysCachedAt']);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    if (cached.holidays && cached.holidaysCachedAt > oneDayAgo) {
      console.log('[TS-Assistant] 祝日データをキャッシュから取得');
      return cached.holidays;
    }

    // APIから取得
    console.log('[TS-Assistant] 祝日APIからデータ取得中...');
    const res = await fetch(HOLIDAYS_API_URL);
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }
    const holidays = await res.json();

    // キャッシュ保存
    await chrome.storage.local.set({
      holidays,
      holidaysCachedAt: Date.now()
    });

    console.log('[TS-Assistant] 祝日データ取得完了:', Object.keys(holidays).length, '件');
    return holidays;
  } catch (error) {
    console.error('[TS-Assistant] 祝日データ取得エラー:', error);
    // キャッシュがあればそれを返す
    const cached = await chrome.storage.local.get(['holidays']);
    return cached.holidays || {};
  }
}

// 勤務日かどうか判定（平日 AND 非祝日）
function isWorkingDay(dateStr, holidays) {
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  // 土日は勤務日ではない
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // 祝日は勤務日ではない
  if (holidays && holidays[dateStr]) {
    return false;
  }

  return true;
}

// 曜日を取得
function getDayOfWeekStr(dateStr) {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const date = new Date(dateStr);
  return days[date.getDay()];
}

// Get today's date string
function getTodayDateStr() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// Wait for tab to finish loading
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Fetch attendance data from TeamSpirit (uses unified fetch)
async function fetchAttendanceData() {
  // 統合フェッチを使用
  const allData = await fetchAllAttendanceData();
  return allData?.todayData || null;
}

// ==================== 統合データ取得 ====================
// 全てのデータを1つのタブで取得
let allDataCache = null;
let allDataCacheTime = 0;
const ALL_DATA_CACHE_TTL = 30 * 1000; // 30秒
let allDataFetchPromise = null;

async function fetchAllAttendanceData() {
  // キャッシュが有効な場合はそれを返す
  if (allDataCache && (Date.now() - allDataCacheTime) < ALL_DATA_CACHE_TTL) {
    console.log('[TS-Assistant] 全データをキャッシュから取得');
    return allDataCache;
  }

  // 既に取得中の場合はそのPromiseを待つ
  if (allDataFetchPromise) {
    console.log('[TS-Assistant] 既存の取得処理を待機中...');
    return allDataFetchPromise;
  }

  // 新しい取得処理を開始
  allDataFetchPromise = fetchAllAttendanceDataInternal();
  try {
    const result = await allDataFetchPromise;
    return result;
  } finally {
    allDataFetchPromise = null;
  }
}

async function fetchAllAttendanceDataInternal() {
  let tempTab = null;
  try {
    console.log('[TS-Assistant] 全データ取得開始（1タブ）');

    // Open attendance page in background
    tempTab = await chrome.tabs.create({ url: TEAMSPIRIT_ATTENDANCE_URL, active: false });
    await waitForTabLoad(tempTab.id);
    await new Promise(r => setTimeout(r, 8000));

    const iframeCheck = await chrome.scripting.executeScript({
      target: { tabId: tempTab.id },
      func: () => ({ count: document.querySelectorAll('iframe').length })
    });
    if (iframeCheck[0]?.result?.count > 0) {
      await new Promise(r => setTimeout(r, 3000));
    }

    // 当月の日付リストを生成
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const dateList = [];
    for (let day = 1; day <= today.getDate(); day++) {
      dateList.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    const todayStr = getTodayDateStr();

    // 1回のスクリプト実行で全データを取得
    const results = await chrome.scripting.executeScript({
      target: { tabId: tempTab.id, allFrames: true },
      func: (dateList, todayStr) => {
        const result = {
          success: false,
          todayData: null,
          monthlyData: {},
          summary: null
        };

        try {
          let foundAnyData = false;

          // 月間データを取得
          for (const dateStr of dateList) {
            const dayData = { date: dateStr, clockIn: null, clockOut: null, isHoliday: false };
            const clockInEl = document.getElementById(`ttvTimeSt${dateStr}`);

            if (clockInEl) {
              foundAnyData = true;
              const timeText = clockInEl.textContent?.trim();
              if (timeText && timeText !== '' && timeText !== '--:--') {
                dayData.clockIn = timeText;
              }

              const row = clockInEl.closest('tr');
              if (row) {
                const clockOutEl = row.querySelector('td.vet, td.dval.vet');
                if (clockOutEl) {
                  const outText = clockOutEl.textContent?.trim();
                  if (outText && outText !== '' && outText !== '--:--') {
                    dayData.clockOut = outText;
                  }
                }
                if ((row.className || '').includes('rowcnt')) {
                  dayData.isHoliday = true;
                }
              }
            } else {
              dayData.isHoliday = true;
            }

            result.monthlyData[dateStr] = dayData;
          }

          // 今日のデータを特別に抽出
          const todayData = result.monthlyData[todayStr];
          if (todayData) {
            result.todayData = {
              success: true,
              clockInTime: todayData.clockIn,
              clockOutTime: todayData.clockOut,
              isWorking: !!(todayData.clockIn && !todayData.clockOut),
              summary: null
            };
          }

          // サマリーデータを取得
          const summaryData = {};
          document.querySelectorAll('table').forEach(table => {
            table.querySelectorAll('tr').forEach(row => {
              const cells = row.querySelectorAll('td, th');
              if (cells.length >= 2) {
                const label = cells[0].textContent?.trim();
                const value = cells[cells.length - 1].textContent?.trim();
                if (label?.includes('所定労働時間')) summaryData.scheduledHours = value;
                if (label?.includes('総労働時間') && !label?.includes('法定')) summaryData.totalHours = value;
                if (label?.includes('過不足時間')) summaryData.overUnderHours = value;
                if (label?.includes('所定出勤日数')) summaryData.scheduledDays = value;
                if (label?.includes('実出勤日数')) summaryData.actualDays = value;
              }
            });
          });

          if (Object.keys(summaryData).length > 0) {
            result.summary = summaryData;
            if (result.todayData) result.todayData.summary = summaryData;
            foundAnyData = true;
          }

          result.success = foundAnyData;
          return result;
        } catch (e) {
          return result;
        }
      },
      args: [dateList, todayStr]
    });

    // Close temp tab
    await chrome.tabs.remove(tempTab.id);
    tempTab = null;

    // Find best result from frames
    for (const r of results) {
      if (r.result?.success) {
        console.log('[TS-Assistant] 全データ取得完了');

        const data = r.result;
        let clockInTimestamp = null;
        let clockOutTimestamp = null;

        // todayDataにtimestampを追加
        if (data.todayData?.clockInTime) {
          const parts = data.todayData.clockInTime.split(':');
          if (parts.length >= 2) {
            const d = new Date();
            d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
            clockInTimestamp = d.getTime();
          }
        }

        if (data.todayData?.clockOutTime) {
          const parts = data.todayData.clockOutTime.split(':');
          if (parts.length >= 2) {
            const d = new Date();
            d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
            clockOutTimestamp = d.getTime();
          }
        }

        // Save to unified storage
        await chrome.storage.local.set({
          attendanceData: data.todayData,
          lastFetched: Date.now(),
          clockInTimestamp: clockInTimestamp,
          clockOutTimestamp: clockOutTimestamp,
          hasClockedOut: !!data.todayData?.clockOutTime,
          workSummary: data.summary
        });

        // キャッシュに保存
        allDataCache = data;
        allDataCacheTime = Date.now();

        return data;
      }
    }

    console.log('[TS-Assistant] 有効な結果なし');
    return null;
  } catch (error) {
    console.error('[TS-Assistant] 全データ取得エラー:', error);
    if (tempTab) {
      try {
        await chrome.tabs.remove(tempTab.id);
      } catch (e) {}
    }
    return null;
  }
}

// ==================== 打刻漏れチェック ====================

// 月間の打刻データを取得（統合データを使用）
async function fetchMonthlyAttendanceData() {
  const allData = await fetchAllAttendanceData();
  return allData?.monthlyData || null;
}

// 打刻漏れを検出
async function detectMissedPunches() {
  try {
    console.log('[TS-Assistant] 打刻漏れチェック開始');

    // 祝日データを取得
    const holidays = await getHolidays();

    // 月間打刻データを取得
    const monthlyData = await fetchMonthlyAttendanceData();

    if (!monthlyData) {
      return { success: false, error: 'データ取得失敗' };
    }

    const missedPunches = [];
    const todayStr = getTodayDateStr();

    for (const [dateStr, dayData] of Object.entries(monthlyData)) {
      // 本日は判定対象外（前日分までを判定）
      if (dateStr === todayStr) {
        continue;
      }

      // 勤務日かどうか判定
      // TeamSpiritの背景色情報を優先し、なければ祝日APIとカレンダーで判定
      const isHolidayFromTS = dayData.isHoliday === true;
      const isHolidayFromCalendar = !isWorkingDay(dateStr, holidays);

      if (isHolidayFromTS || isHolidayFromCalendar) {
        continue;
      }

      const hasClockIn = !!dayData.clockIn;
      const hasClockOut = !!dayData.clockOut;

      // 両方漏れ判定（出勤も退勤もない）
      if (!hasClockIn && !hasClockOut) {
        missedPunches.push({
          date: dateStr,
          dayOfWeek: getDayOfWeekStr(dateStr),
          type: 'no-both',
          label: '出退'
        });
        continue;
      }

      // 出勤漏れ判定（出勤なし、退勤あり - 稀なケース）
      if (!hasClockIn && hasClockOut) {
        missedPunches.push({
          date: dateStr,
          dayOfWeek: getDayOfWeekStr(dateStr),
          type: 'no-clock-in',
          label: '出'
        });
        continue;
      }

      // 退勤漏れ判定（出勤あり、退勤なし）
      if (hasClockIn && !hasClockOut) {
        missedPunches.push({
          date: dateStr,
          dayOfWeek: getDayOfWeekStr(dateStr),
          type: 'no-clock-out',
          label: '退'
        });
      }
    }

    // 日付順にソート
    missedPunches.sort((a, b) => a.date.localeCompare(b.date));

    const result = {
      success: true,
      count: missedPunches.length,
      items: missedPunches
    };

    console.log('[TS-Assistant] 打刻漏れチェック完了:', missedPunches.length, '件');
    return result;
  } catch (error) {
    console.error('[TS-Assistant] 打刻漏れチェックエラー:', error);
    return { success: false, error: error.message };
  }
}

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('TeamSpirit Assistant extension installed');

  // Set default location
  chrome.storage.local.get('savedLocation', (result) => {
    if (!result.savedLocation) {
      chrome.storage.local.set({ savedLocation: 'remote' });
    }
  });
});

// Handle messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openTeamSpirit') {
    chrome.tabs.create({ url: TEAMSPIRIT_URL });
    sendResponse({ success: true });
    return true;
  }

  // Handle fetch request from content script
  if (request.type === 'FETCH_ATTENDANCE_DATA') {
    fetchAttendanceData().then(data => {
      sendResponse({ success: !!data, data });
    });
    return true; // Keep channel open for async response
  }

  // Handle missed punch check request (always fetch fresh data)
  if (request.type === 'CHECK_MISSED_PUNCHES') {
    detectMissedPunches().then(result => {
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  }

  // Handle today's working day check request
  if (request.type === 'CHECK_TODAY_WORKDAY') {
    checkTodayWorkday().then(result => {
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  }

  // Handle cache invalidation request (after punch)
  if (request.type === 'INVALIDATE_CACHE') {
    console.log('[TS-Assistant] キャッシュを無効化');
    allDataCache = null;
    allDataCacheTime = 0;
    sendResponse({ success: true });
    return true;
  }

  return true;
});

// 本日が出勤日かどうかをチェック（勤怠表データから判定）
async function checkTodayWorkday() {
  try {
    const today = getTodayDateStr();
    const dayOfWeekStr = getDayOfWeekStr(today);

    // 祝日データを取得
    const holidays = await getHolidays();
    const holidayName = holidays ? holidays[today] : null;

    // 勤怠表データを取得
    const monthlyData = await fetchMonthlyAttendanceData();

    if (monthlyData && monthlyData[today]) {
      const todayData = monthlyData[today];
      // 勤怠表データで休日判定（ttvTimeSt要素がない or rowcntクラスがある）
      return {
        success: true,
        isWorkday: !todayData.isHoliday,
        dayOfWeek: dayOfWeekStr,
        holidayName: holidayName // 祝日名（該当する場合）
      };
    }

    // データ取得失敗時は祝日APIでフォールバック
    console.log('[TS-Assistant] 勤怠表データなし、祝日APIでフォールバック');
    const isWorkday = isWorkingDay(today, holidays);

    return {
      success: true,
      isWorkday: isWorkday,
      dayOfWeek: dayOfWeekStr,
      holidayName: holidayName
    };
  } catch (error) {
    console.error('[TS-Assistant] 本日判定エラー:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

console.log('[TS-Assistant] Background script loaded');
