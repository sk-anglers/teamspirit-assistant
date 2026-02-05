// TeamSpirit Assistant - Background Service Worker
// Handles data fetching and message passing

// URL定数は config.js の CONFIG オブジェクトで一元管理
importScripts('config.js');

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
    const res = await fetch(CONFIG.HOLIDAYS_API_URL);
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
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
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
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
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
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      console.log('[TS-Assistant] waitForTabLoad タイムアウト（60秒）');
      resolve();
    }, 60000);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
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
    tempTab = await chrome.tabs.create({ url: CONFIG.TEAMSPIRIT_ATTENDANCE_URL, active: false });
    await waitForTabLoad(tempTab.id);

    // 認証エラー検出: ログインページにリダイレクトされた場合
    try {
      const tab = await chrome.tabs.get(tempTab.id);
      if (tab.url && (tab.url.includes('login') || tab.url.includes('Login') || tab.url.includes('/secur/'))) {
        console.log('[TS-Assistant] セッション切れを検出:', tab.url);
        await chrome.tabs.remove(tempTab.id);
        return { success: false, error: 'SESSION_EXPIRED', message: 'セッションが切れました。再ログインしてください' };
      }
    } catch (e) {
      console.warn('[TS-Assistant] タブURL確認エラー:', e);
    }

    // ポーリング方式: DOM要素の出現を500ms間隔で確認（最大60秒）
    const pollStartTime = Date.now();
    const POLL_INTERVAL = 500;
    const POLL_TIMEOUT = 60000;
    let dataReady = false;

    while (Date.now() - pollStartTime < POLL_TIMEOUT) {
      try {
        const check = await chrome.scripting.executeScript({
          target: { tabId: tempTab.id, allFrames: true },
          func: () => {
            // ttvTimeSt で始まるIDの要素（勤怠データの日付行）があるか確認
            const el = document.querySelector('[id^="ttvTimeSt"]');
            return { ready: !!el };
          }
        });
        if (check.some(r => r.result?.ready)) {
          dataReady = true;
          break;
        }
      } catch (e) {
        // タブがまだ読み込み中の場合は無視
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    if (dataReady) {
      console.log('[TS-Assistant] データ準備完了（' + (Date.now() - pollStartTime) + 'ms）');
    } else {
      console.log('[TS-Assistant] ポーリングタイムアウト（60秒）、フォールバック処理に移行');
    }

    // タブがまだ存在するか確認
    try {
      await chrome.tabs.get(tempTab.id);
    } catch (e) {
      console.log('[TS-Assistant] タブが閉じられました。処理を中断します。');
      tempTab = null;
      return null;
    }

    // 当月の日付リストを生成（月末まで）
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate(); // 月末日を取得
    const dateList = [];
    for (let day = 1; day <= lastDay; day++) {
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

          // 月間データを取得（IDで要素を探す）
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
                // 退勤時刻セレクタ（フォールバック付き）
                const clockOutEl = row.querySelector('td.vet, td.dval.vet, td[data-field="endTime"], td.endTime');
                if (!clockOutEl) {
                  console.warn('[TS-Assistant] 退勤時刻セレクタが見つかりません:', dateStr);
                }
                if (clockOutEl) {
                  const outText = clockOutEl.textContent?.trim();
                  if (outText && outText !== '' && outText !== '--:--') {
                    dayData.clockOut = outText;
                  }
                }
                // 行のクラスで休日判定（土日・祝日）
                if ((row.className || '').includes('rowcnt')) {
                  dayData.isHoliday = true;
                }
              }
            } else {
              // 要素が見つからない = 勤怠入力欄がない = 休日
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

          // 残り勤務日数を計算（今日以降の所定出勤日をカウント）
          let remainingWorkdays = 0;
          const todayDate = new Date(todayStr);
          for (const dateStr of Object.keys(result.monthlyData)) {
            const day = result.monthlyData[dateStr];
            const dayDate = new Date(dateStr);
            // 今日以降の所定出勤日をカウント（今日を含む）
            if (dayDate >= todayDate && !day.isHoliday) {
              remainingWorkdays++;
            }
          }
          result.remainingWorkdays = remainingWorkdays;

          // 退勤打刻済み日数と日次残業合計を計算（当日は除外）
          let completedDays = 0;
          let totalDailyOvertimeMinutes = 0;
          const STANDARD_MINUTES_PER_DAY = 8 * 60; // 8時間 = 480分
          const BREAK_MINUTES = 60; // 休憩1時間

          for (const dateStr of Object.keys(result.monthlyData)) {
            // 当日は除外（勤務時間が確定していないため）
            if (dateStr === todayStr) {
              continue;
            }

            const day = result.monthlyData[dateStr];
            // 退勤打刻がある日のみカウント（確定した勤務日）
            if (day.clockIn && day.clockOut) {
              completedDays++;

              // 勤務時間を計算（clockOut - clockIn - 休憩）
              const parseTime = (timeStr) => {
                // 入力検証: 空文字・null・不正形式をチェック
                if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) return null;
                const parts = timeStr.split(':');
                const hours = parseInt(parts[0], 10);
                const minutes = parseInt(parts[1], 10);
                if (isNaN(hours) || isNaN(minutes)) return null;
                return hours * 60 + minutes;
              };
              const clockInMinutes = parseTime(day.clockIn);
              const clockOutMinutes = parseTime(day.clockOut);

              // パース失敗時はこの日をスキップ
              if (clockInMinutes === null || clockOutMinutes === null) {
                console.warn('[TS-Assistant] 時刻パース失敗:', dateStr, day.clockIn, day.clockOut);
                continue;
              }

              // 実勤務時間 = 退勤 - 出勤 - 休憩（6時間以上の場合）
              let workingMinutes = clockOutMinutes - clockInMinutes;
              // 日跨ぎ対応: 退勤時刻が出勤時刻より小さい場合は翌日として扱う
              // 例: 22:00出勤→翌02:00退勤
              if (workingMinutes < 0) {
                workingMinutes += 24 * 60; // 1440分を加算
              }
              if (workingMinutes >= 6 * 60) {
                workingMinutes -= BREAK_MINUTES;
              }

              // 日次残業 = max(0, 勤務時間 - 8時間)
              // 8時間未満の日は0として扱う（マイナスにしない）
              const dailyOvertime = Math.max(0, workingMinutes - STANDARD_MINUTES_PER_DAY);
              totalDailyOvertimeMinutes += dailyOvertime;
            }
          }
          result.completedDays = completedDays;
          result.totalDailyOvertimeMinutes = totalDailyOvertimeMinutes;

          result.success = foundAnyData;
          return result;
        } catch (e) {
          return result;
        }
      },
      args: [dateList, todayStr]
    });

    // Close temp tab
    try {
      await chrome.tabs.remove(tempTab.id);
    } catch (e) {
      // タブが既に閉じられている場合は無視
    }
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

        // remainingWorkdays, completedDays, totalDailyOvertimeMinutesをsummaryに追加
        if (data.summary) {
          data.summary.remainingWorkdays = data.remainingWorkdays;
          data.summary.completedDays = data.completedDays;
          data.summary.totalDailyOvertimeMinutes = data.totalDailyOvertimeMinutes;
        }
        // todayData.summaryにも追加（content.jsで使用）
        if (data.todayData && data.todayData.summary) {
          data.todayData.summary.remainingWorkdays = data.remainingWorkdays;
          data.todayData.summary.completedDays = data.completedDays;
          data.todayData.summary.totalDailyOvertimeMinutes = data.totalDailyOvertimeMinutes;
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
      // 今日以降は判定対象外（前日分までを判定）
      if (dateStr >= todayStr) {
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
    chrome.tabs.create({ url: CONFIG.TEAMSPIRIT_URL });
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
