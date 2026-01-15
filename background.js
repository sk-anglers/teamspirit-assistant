// TeamSpirit Assistant - Background Service Worker
// Handles data fetching and message passing

const TEAMSPIRIT_URL = 'https://teamspirit-74532.lightning.force.com/lightning/page/home';
const TEAMSPIRIT_ATTENDANCE_URL = 'https://teamspirit-74532.lightning.force.com/lightning/n/teamspirit__AtkWorkTimeTab';

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

// Fetch attendance data from TeamSpirit
async function fetchAttendanceData() {
  let tempTab = null;
  try {
    console.log('[TS-Assistant] データ取得開始');

    // Open attendance page in background
    tempTab = await chrome.tabs.create({ url: TEAMSPIRIT_ATTENDANCE_URL, active: false });

    // Wait for page to load
    await waitForTabLoad(tempTab.id);

    // Additional wait for dynamic content - Salesforce Lightning needs more time
    await new Promise(r => setTimeout(r, 8000));

    // Check for iframes
    const iframeCheck = await chrome.scripting.executeScript({
      target: { tabId: tempTab.id },
      func: () => {
        const iframes = document.querySelectorAll('iframe');
        return { count: iframes.length };
      }
    });

    if (iframeCheck[0]?.result?.count > 0) {
      await new Promise(r => setTimeout(r, 3000));
    }

    const dateStr = getTodayDateStr();

    // Execute script to find data
    const results = await chrome.scripting.executeScript({
      target: { tabId: tempTab.id, allFrames: true },
      func: (dateStr) => {
        const result = {
          success: false,
          clockInTime: null,
          clockOutTime: null,
          isWorking: false,
          summary: null
        };

        try {
          // 1. Look for clock-in time
          const clockInId = `ttvTimeSt${dateStr}`;
          const clockInEl = document.getElementById(clockInId);

          if (clockInEl) {
            const timeText = clockInEl.textContent?.trim();
            if (timeText && timeText !== '' && timeText !== '--:--') {
              result.clockInTime = timeText;
              result.success = true;
            }
          }

          // 2. Look for clock-out time in same row
          if (clockInEl) {
            const row = clockInEl.closest('tr');
            if (row) {
              const clockOutEl = row.querySelector('td.vet, td.dval.vet');
              if (clockOutEl) {
                const timeText = clockOutEl.textContent?.trim();
                if (timeText && timeText !== '' && timeText !== '--:--') {
                  result.clockOutTime = timeText;
                }
              }
            }
          }

          // 3. Determine working status
          result.isWorking = !!(result.clockInTime && !result.clockOutTime);

          // 4. Look for summary data
          const summaryData = {};
          const tables = document.querySelectorAll('table');

          tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
              const cells = row.querySelectorAll('td, th');
              if (cells.length >= 2) {
                const label = cells[0].textContent?.trim();
                const value = cells[cells.length - 1].textContent?.trim();

                if (label?.includes('所定労働時間')) {
                  summaryData.scheduledHours = value;
                }
                if (label?.includes('総労働時間') && !label?.includes('法定')) {
                  summaryData.totalHours = value;
                }
                if (label?.includes('過不足時間')) {
                  summaryData.overUnderHours = value;
                }
                if (label?.includes('所定出勤日数')) {
                  summaryData.scheduledDays = value;
                }
                if (label?.includes('実出勤日数')) {
                  summaryData.actualDays = value;
                }
              }
            });
          });

          if (Object.keys(summaryData).length > 0) {
            result.summary = summaryData;
            result.success = true;
          }

          return result;
        } catch (e) {
          return result;
        }
      },
      args: [dateStr]
    });

    // Close temp tab
    await chrome.tabs.remove(tempTab.id);
    tempTab = null;

    // Find best result
    let bestResult = null;
    for (const r of results) {
      if (r.result?.success) {
        if (!bestResult || (r.result.clockInTime && !bestResult.clockInTime)) {
          bestResult = r.result;
        }
        // Merge summary data
        if (r.result.summary && bestResult) {
          bestResult.summary = { ...bestResult.summary, ...r.result.summary };
        }
      }
    }

    if (bestResult) {
      // Convert clockInTime string to timestamp for compatibility
      let clockInTimestamp = null;
      let clockOutTimestamp = null;

      if (bestResult.clockInTime) {
        const parts = bestResult.clockInTime.split(':');
        if (parts.length >= 2) {
          const d = new Date();
          d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
          clockInTimestamp = d.getTime();
        }
      }

      if (bestResult.clockOutTime) {
        const parts = bestResult.clockOutTime.split(':');
        if (parts.length >= 2) {
          const d = new Date();
          d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
          clockOutTimestamp = d.getTime();
        }
      }

      // Save to unified storage (used by both popup and content script)
      await chrome.storage.local.set({
        // For content script (Info Display format)
        attendanceData: bestResult,
        lastFetched: Date.now(),
        // For popup.js (Quick Punch format)
        clockInTimestamp: clockInTimestamp,
        clockOutTimestamp: clockOutTimestamp,
        hasClockedOut: !!bestResult.clockOutTime,
        workSummary: bestResult.summary
      });

      console.log('[TS-Assistant] データ取得完了', bestResult);
      return bestResult;
    }

    console.log('[TS-Assistant] 有効な結果なし');
    return null;
  } catch (error) {
    console.error('[TS-Assistant] エラー:', error);
    if (tempTab) {
      try {
        await chrome.tabs.remove(tempTab.id);
      } catch (e) {}
    }
    return null;
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

  return true;
});

console.log('[TS-Assistant] Background script loaded');
