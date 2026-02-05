// TeamSpirit Assistant - Tab Utilities
// タブ検索・管理ユーティリティ（popup.js から分離）

// Check if timestamp is from today
function isToday(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
         date.getMonth() === today.getMonth() &&
         date.getDate() === today.getDate();
}

// Save clock-in timestamp (called when punching in via extension)
async function saveClockInTime() {
  const now = Date.now();
  await chrome.storage.local.set({ clockInTimestamp: now });
}

// Clear clock-in timestamp (called when punching out via extension)
async function clearClockInTime() {
  await chrome.storage.local.remove('clockInTimestamp');
}

// Fetch clock-in time from TeamSpirit via background script
async function fetchClockInTimeFromSite() {
  try {
    console.log('Fetching attendance data via background script...');

    // Request data fetch from background script
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_ATTENDANCE_DATA' }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('Background fetch error:', chrome.runtime.lastError);
          resolve(null);
          return;
        }
        resolve(resp);
      });
    });

    if (!response?.success || !response?.data) {
      console.log('No data from background script');
      return null;
    }

    const data = response.data;
    console.log('Got data from background:', data);

    // Data is already saved by background.js, just return the formatted result
    let clockInTimestamp = null;
    let clockOutTimestamp = null;

    if (data.clockInTime) {
      const parts = data.clockInTime.split(':');
      if (parts.length >= 2) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        // パース失敗時のガード
        if (!isNaN(hours) && !isNaN(minutes)) {
          const d = new Date();
          d.setHours(hours, minutes, 0, 0);
          // 日跨ぎ対応: 出勤時刻が現在より未来なら前日として扱う
          // 例: 0:30に前日23:00の出勤データを取得した場合
          if (d.getTime() > Date.now()) {
            d.setDate(d.getDate() - 1);
          }
          clockInTimestamp = d.getTime();
        }
      }
    }

    if (data.clockOutTime) {
      const parts = data.clockOutTime.split(':');
      if (parts.length >= 2) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        // パース失敗時のガード
        if (!isNaN(hours) && !isNaN(minutes)) {
          const d = new Date();
          d.setHours(hours, minutes, 0, 0);
          // 日跨ぎ対応: 退勤時刻が現在より未来なら前日として扱う
          if (d.getTime() > Date.now()) {
            d.setDate(d.getDate() - 1);
          }
          clockOutTimestamp = d.getTime();
        }
      }
    }

    return {
      clockInTimestamp,
      clockOutTimestamp,
      summary: data.summary,
      isWorking: data.isWorking,
      hasClockedOut: !!data.clockOutTime
    };
  } catch (error) {
    console.error('Error fetching data:', error);
    return null;
  }
}

async function findTeamSpiritTab() {
  // First try specific URL pattern
  let tabs = await chrome.tabs.query({
    url: CONFIG.TAB_QUERY_PATTERNS
  });

  if (tabs.length > 0) {
    return tabs[0];
  }

  // Fallback: search all tabs by title or URL content
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.title && (tab.title.includes('Salesforce') || tab.title.includes('TeamSpirit'))) {
      return tab;
    }
    if (tab.url && (tab.url.includes('salesforce') || tab.url.includes('force.com'))) {
      return tab;
    }
  }

  return null;
}

// Poll for login form elements to be ready
async function waitForLoginForm(tabId, maxWaitMs = 10000, showMessageFn = null) {
  const startTime = Date.now();
  const pollInterval = 300; // Check every 300ms
  let pollCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    try {
      // Search in all frames including iframes
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          // More flexible username/email field detection
          const username = document.getElementById('username') ||
                          document.querySelector('input[name="username"]') ||
                          document.querySelector('input[name="email"]') ||
                          document.querySelector('input[type="email"]') ||
                          document.querySelector('input[autocomplete="username"]') ||
                          document.querySelector('input[autocomplete="email"]') ||
                          document.querySelector('input[placeholder*="メール"]') ||
                          document.querySelector('input[placeholder*="mail" i]') ||
                          document.querySelector('input[placeholder*="ユーザ"]');
          const password = document.getElementById('password') ||
                          document.querySelector('input[name="pw"]') ||
                          document.querySelector('input[name="password"]') ||
                          document.querySelector('input[type="password"]');
          // Return detailed info
          return {
            found: !!(username && password),
            hasUsername: !!username,
            hasPassword: !!password,
            frameCount: window.parent !== window ? 'iframe' : 'main'
          };
        }
      });

      // Check if any frame found the form
      const foundInFrame = results?.find(r => r.result?.found === true);
      if (foundInFrame) {
        console.log('Login form ready after', Date.now() - startTime, 'ms');
        return true;
      }

      // Show progress
      if (showMessageFn && pollCount % 3 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const info = results?.map(r => r.result?.frameCount + ':' + (r.result?.hasUsername ? 'U' : '-') + (r.result?.hasPassword ? 'P' : '-')).join(' ') || 'checking...';
        showMessageFn(`[${elapsed}s] フォーム検索中... ${info}`, 'info');
      }
    } catch (e) {
      // Script execution might fail if page is still loading
      if (showMessageFn && pollCount % 3 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        showMessageFn(`[${elapsed}s] ページ読み込み中...`, 'info');
      }
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  console.log('Login form wait timed out, proceeding anyway');
  return false;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('タブの読み込みがタイムアウトしました'));
    }, 60000);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Reduced from 3000ms to 500ms - will poll for elements instead
        setTimeout(resolve, 500);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForContentScript(tabId, maxRetries = 10) {
  let retries = 0;
  let injected = false;

  while (retries < maxRetries) {
    // Check if tab URL is valid (not chrome://)
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url === 'about:blank') {
        retries++;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
    } catch (e) {
      retries++;
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    try {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(resp);
          }
        });
      });

      if (response && response.ready) {
        return; // Content script is ready
      }
    } catch (e) {
      // Ignore errors
    }

    // Try to inject content script if not already tried
    if (!injected && retries >= 2) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && tab.url.startsWith('https://')) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });
          injected = true;
          console.log('Content script injected manually');
        }
      } catch (e) {
        console.log('Failed to inject content script:', e);
      }
    }

    retries++;
    await new Promise(r => setTimeout(r, 500));
  }

  // Don't throw error - we have fallbacks with direct script execution
  console.log('Content script not available, will use direct execution');
}

async function getPageInfo(tabId) {
  // First try content script
  const response = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(resp);
      }
    });
  });

  if (response) {
    return response;
  }

  // Fallback: get info directly from tab and page
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    const title = tab.title || '';

    // Check by URL and title
    const isLoginPage = url.includes('my.salesforce.com') ||
                       url.includes('/login') ||
                       title.includes('ログイン') ||
                       title.toLowerCase().includes('login');

    const isTeamSpiritPage = !isLoginPage && (
                            url.includes('lightning.force.com') ||
                            url.includes('lightning/page'));

    return {
      isLoginPage,
      isTeamSpiritPage,
      pageType: isLoginPage ? 'login' : (isTeamSpiritPage ? 'teamspirit' : 'unknown'),
      url,
      title
    };
  } catch (e) {
    return { isLoginPage: false, isTeamSpiritPage: false, pageType: 'unknown' };
  }
}
