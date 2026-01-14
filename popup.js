const TEAMSPIRIT_URL = 'https://teamspirit-74532.lightning.force.com/lightning/page/home';
const TEAMSPIRIT_ATTENDANCE_URL = 'https://teamspirit-74532.lightning.force.com/lightning/n/teamspirit__AtkWorkTimeTab';
const LOGIN_URL = 'https://login.salesforce.com/';
const MY_DOMAIN_LOGIN_URL = 'https://teamspirit-74532.my.salesforce.com/';

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const loginSection = document.getElementById('loginSection');
  const punchSection = document.getElementById('punchSection');
  const timeSection = document.getElementById('timeSection');
  const loginBtn = document.getElementById('loginBtn');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const saveCredentialsCheckbox = document.getElementById('saveCredentials');
  const clockInBtn = document.getElementById('clockIn');
  const clockOutBtn = document.getElementById('clockOut');
  const locationSelect = document.getElementById('location');
  const messageDiv = document.getElementById('message');
  const statusDiv = document.getElementById('status');
  const openTeamSpiritLink = document.getElementById('openTeamSpirit');
  const logoutLink = document.getElementById('logoutLink');
  const currentTimeEl = document.getElementById('currentTime');
  const clockInTimeEl = document.getElementById('clockInTime');
  const workingTimeEl = document.getElementById('workingTime');

  // Time update interval
  let timeUpdateInterval = null;

  // Load saved data
  const stored = await chrome.storage.local.get(['savedLocation', 'credentials', 'isLoggedIn']);

  if (stored.savedLocation) {
    locationSelect.value = stored.savedLocation;
  }

  if (stored.credentials) {
    emailInput.value = stored.credentials.email || '';
    passwordInput.value = stored.credentials.password || '';
  }

  // Save location preference when changed
  locationSelect.addEventListener('change', () => {
    chrome.storage.local.set({ savedLocation: locationSelect.value });
  });

  // Open TeamSpirit link
  openTeamSpiritLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: TEAMSPIRIT_URL });
  });

  // Logout link
  logoutLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await chrome.storage.local.set({ isLoggedIn: false });

    // Close TeamSpirit tab if open
    const tab = await findTeamSpiritTab();
    if (tab) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (err) {
        // Tab might already be closed
      }
    }

    showLoginSection();
    showMessage('ログアウトしました', 'info');
  });

  // Login button
  loginBtn.addEventListener('click', () => {
    performLogin();
  });

  // Enter key on password field
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performLogin();
    }
  });

  // Clock in/out buttons
  clockInBtn.addEventListener('click', () => {
    performPunch('clockIn', locationSelect.value);
  });

  clockOutBtn.addEventListener('click', () => {
    performPunch('clockOut', locationSelect.value);
  });

  // Initialize UI
  await initializeUI();

  async function initializeUI() {
    showStatus('確認中...', '');

    // First check if there's already a TeamSpirit tab open
    const existingTab = await findTeamSpiritTab();

    if (existingTab) {
      // Check if it's a login page (not logged in)
      const isLoginPage = (
        (existingTab.url && (existingTab.url.includes('my.salesforce.com') || existingTab.url.includes('/login'))) ||
        (existingTab.title && (existingTab.title.includes('ログイン') || existingTab.title.toLowerCase().includes('login')))
      );

      // Check if logged in (TeamSpirit main page, not login page)
      const isLoggedIn = !isLoginPage && (
        (existingTab.url && existingTab.url.includes('lightning.force.com')) ||
        (existingTab.url && existingTab.url.includes('lightning/page'))
      );

      if (isLoggedIn) {
        // TeamSpirit is already open and logged in
        await chrome.storage.local.set({ isLoggedIn: true });
        showPunchSection();
        checkPunchStatus();
        return;
      } else if (isLoginPage) {
        // On login page - need to login
        await chrome.storage.local.set({ isLoggedIn: false });
        showLoginSection();
        showStatus('ログインしてください', 'logged-out');
        return;
      }
    }

    // No TeamSpirit tab found - always show login section
    // Reset stored login state since we can't verify it
    await chrome.storage.local.set({ isLoggedIn: false });

    if (stored.credentials) {
      // Has credentials
      showLoginSection();
      showStatus('ログインしてください', 'logged-out');
    } else {
      // No credentials
      showLoginSection();
      showStatus('ログイン情報を入力してください', 'logged-out');
    }
  }

  function showLoginSection() {
    loginSection.classList.remove('hidden');
    punchSection.classList.add('hidden');
    logoutLink.classList.add('hidden');
  }

  function showPunchSection() {
    loginSection.classList.add('hidden');
    punchSection.classList.remove('hidden');
    logoutLink.classList.remove('hidden');
  }

  function showStatus(text, className) {
    statusDiv.querySelector('.status-text').textContent = text;
    statusDiv.className = 'status ' + className;
  }

  function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = 'message ' + type;
  }

  async function checkPunchStatus() {
    try {
      const tab = await findTeamSpiritTab();
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, async (response) => {
          if (chrome.runtime.lastError) {
            showStatus('ログイン済み', 'logged-in');
            updateButtonStates(null);
            // Check stored working state for time display
            const { clockInTimestamp } = await chrome.storage.local.get('clockInTimestamp');
            await initializeTimeDisplay(!!clockInTimestamp);
            return;
          }
          if (response && response.status) {
            showStatus(response.status, response.isWorking ? 'working' : 'logged-in');
            updateButtonStates(response.isWorking);
            // Initialize time display based on working status
            await initializeTimeDisplay(response.isWorking);
          } else {
            updateButtonStates(null);
            hideTimeSection();
          }
        });
      } else {
        showStatus('ログイン済み', 'logged-in');
        updateButtonStates(null);
        // Check stored working state for time display
        const { clockInTimestamp } = await chrome.storage.local.get('clockInTimestamp');
        await initializeTimeDisplay(!!clockInTimestamp);
      }
    } catch (error) {
      showStatus('ログイン済み', 'logged-in');
      updateButtonStates(null);
      hideTimeSection();
    }
  }

  function updateButtonStates(isWorking) {
    if (isWorking === true) {
      // Currently working - disable clock in, enable clock out
      clockInBtn.disabled = true;
      clockOutBtn.disabled = false;
    } else if (isWorking === false) {
      // Not working - enable clock in, disable clock out
      clockInBtn.disabled = false;
      clockOutBtn.disabled = true;
    } else {
      // Unknown state - enable both
      clockInBtn.disabled = false;
      clockOutBtn.disabled = false;
    }
  }

  // ==================== Time Management Functions (Separate from Status Detection) ====================

  // Format time as HH:MM:SS
  function formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // Format time as HH:MM
  function formatTimeShort(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  // Format duration as HH:MM:SS
  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Update time display
  function updateTimeDisplay() {
    // Update current time
    currentTimeEl.textContent = formatTime(new Date());

    // Update working time if clocked in
    chrome.storage.local.get(['clockInTimestamp'], (result) => {
      if (result.clockInTimestamp) {
        const clockInDate = new Date(result.clockInTimestamp);
        clockInTimeEl.textContent = formatTimeShort(clockInDate);

        const workingMs = Date.now() - result.clockInTimestamp;
        workingTimeEl.textContent = formatDuration(workingMs);
      } else {
        clockInTimeEl.textContent = '--:--';
        workingTimeEl.textContent = '--:--:--';
      }
    });
  }

  // Start time update interval
  function startTimeUpdates() {
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
    }
    updateTimeDisplay();
    timeUpdateInterval = setInterval(updateTimeDisplay, 1000);
  }

  // Stop time update interval
  function stopTimeUpdates() {
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
      timeUpdateInterval = null;
    }
  }

  // Show time section (only when working)
  function showTimeSection() {
    timeSection.classList.remove('hidden');
    startTimeUpdates();
  }

  // Hide time section
  function hideTimeSection() {
    timeSection.classList.add('hidden');
    stopTimeUpdates();
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

  // Fetch clock-in time from TeamSpirit attendance table (separate from status detection)
  async function fetchClockInTimeFromSite() {
    let tempTab = null;
    try {
      console.log('Fetching clock-in time from TeamSpirit attendance page...');

      // Open attendance page in background (NOT home page - to avoid interfering with status detection)
      tempTab = await chrome.tabs.create({ url: TEAMSPIRIT_ATTENDANCE_URL, active: false });

      // Wait for page to load
      await waitForTabLoad(tempTab.id);

      // Additional wait for dynamic content (Salesforce Lightning takes time)
      await new Promise(r => setTimeout(r, 5000));

      // Get today's date in YYYY-MM-DD format
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // Execute script to find clock-in time (search in all frames including iframes)
      const results = await chrome.scripting.executeScript({
        target: { tabId: tempTab.id, allFrames: true },
        func: (dateStr) => {
          try {
            // Collect debug info
            const debugInfo = {
              url: window.location.href,
              title: document.title,
              dateStr: dateStr,
              searchedId: `ttvTimeSt${dateStr}`,
              iframeCount: document.querySelectorAll('iframe').length,
              foundIds: [],
              pageInfo: ''
            };

            // Look for the element with ID ttvTimeSt{date} (start time)
            const elementId = `ttvTimeSt${dateStr}`;
            const element = document.getElementById(elementId);

            if (element) {
              const timeText = element.textContent?.trim();
              if (timeText && timeText !== '' && timeText !== '--:--') {
                return { success: true, time: timeText };
              }
            }

            // Search for any element with ID containing date or time keywords
            const searchPatterns = ['ttvTimeSt', 'ttvTimeEt', 'fixTime', 'TimeS', 'TimeE', dateStr];
            searchPatterns.forEach(pattern => {
              try {
                const els = document.querySelectorAll(`[id*="${pattern}"]`);
                els.forEach(el => {
                  if (!debugInfo.foundIds.find(f => f.id === el.id)) {
                    debugInfo.foundIds.push({ id: el.id, text: el.textContent?.trim()?.substring(0, 30) });
                  }
                });
              } catch(e) {}
            });

            // Check for any element with time pattern (HH:MM)
            const timePattern = /^\d{1,2}:\d{2}$/;
            const allElements = document.querySelectorAll('td, th, div, span');
            let timeElementsFound = 0;
            for (const el of allElements) {
              const text = el.textContent?.trim();
              if (text && timePattern.test(text) && timeElementsFound < 5) {
                const id = el.id || el.className?.substring(0, 30) || 'no-id';
                debugInfo.foundIds.push({ id: `[time] ${id}`, text: text });
                timeElementsFound++;
              }
            }

            // Get page structure info
            const h1 = document.querySelector('h1, h2, .title, [class*="title"]');
            debugInfo.pageInfo = h1?.textContent?.trim()?.substring(0, 50) || 'no title found';

            return { success: false, error: 'Element not found', debug: debugInfo };
          } catch (e) {
            return { success: false, error: e.message };
          }
        },
        args: [dateStr]
      });

      // Close temp tab
      try {
        await chrome.tabs.remove(tempTab.id);
      } catch (e) {}
      tempTab = null;

      // With allFrames: true, results is an array from each frame
      // Find the successful result from any frame
      if (results && results.length > 0) {
        let successResult = null;
        let debugInfo = null;

        for (const frameResult of results) {
          if (frameResult.result) {
            if (frameResult.result.success) {
              successResult = frameResult.result;
              break;
            } else if (frameResult.result.debug && frameResult.result.debug.foundIds?.length > 0) {
              // Keep debug info from frame that found something
              debugInfo = frameResult.result.debug;
            } else if (!debugInfo && frameResult.result.debug) {
              debugInfo = frameResult.result.debug;
            }
          }
        }

        if (successResult) {
          const timeStr = successResult.time;
          console.log('Fetched clock-in time from site:', timeStr);

          // Parse time string (e.g., "09:00" or "9:00") and convert to timestamp
          const timeParts = timeStr.split(':');
          if (timeParts.length >= 2) {
            const hours = parseInt(timeParts[0], 10);
            const minutes = parseInt(timeParts[1], 10);

            if (!isNaN(hours) && !isNaN(minutes)) {
              const clockInDate = new Date();
              clockInDate.setHours(hours, minutes, 0, 0);
              const timestamp = clockInDate.getTime();

              // Save to local storage for future use
              await chrome.storage.local.set({ clockInTimestamp: timestamp });
              console.log('Saved fetched clock-in time to local storage');

              return timestamp;
            }
          }
        } else {
          // Log debug info for troubleshooting
          console.log('Failed to find clock-in time. Debug info:', debugInfo);
          if (debugInfo) {
            await chrome.storage.local.set({ lastFetchDebug: debugInfo });
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error fetching clock-in time from site:', error);
      // Clean up temp tab if still open
      if (tempTab) {
        try {
          await chrome.tabs.remove(tempTab.id);
        } catch (e) {}
      }
      return null;
    }
  }

  // Check if timestamp is from today
  function isToday(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
  }

  // Check and initialize time display based on stored data
  async function initializeTimeDisplay(isWorking) {
    // First, clean up old timestamps from previous days
    const { clockInTimestamp } = await chrome.storage.local.get('clockInTimestamp');
    if (clockInTimestamp && !isToday(clockInTimestamp)) {
      // Timestamp is from a previous day - clear it
      await clearClockInTime();
    }

    if (isWorking) {
      // Check if we have a stored clock-in time for today
      const stored = await chrome.storage.local.get('clockInTimestamp');
      if (!stored.clockInTimestamp) {
        // Working but no stored time - fetch from TeamSpirit site
        showTimeSection(); // Show section immediately with placeholder
        showMessage('出勤時刻を取得中...', 'info');

        // Fetch from site in background
        const fetchedTimestamp = await fetchClockInTimeFromSite();
        if (fetchedTimestamp) {
          showMessage('', ''); // Clear message
          updateTimeDisplay(); // Update with fetched time
        } else {
          // Show debug info
          const { lastFetchDebug } = await chrome.storage.local.get('lastFetchDebug');
          if (lastFetchDebug) {
            const iframes = lastFetchDebug.iframeCount || 0;
            const foundList = lastFetchDebug.foundIds?.slice(0, 5).map(f => `${f.id}:${f.text}`).join(' | ') || 'none';
            console.log('Fetch debug:', lastFetchDebug);
            showMessage(`iframe:${iframes} Found: ${foundList}`, 'error');
          } else {
            showMessage('出勤時刻の取得に失敗しました', 'error');
          }
        }
      } else {
        showTimeSection();
      }
    } else {
      hideTimeSection();
    }
  }

  async function performLogin() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showMessage('メールアドレスとパスワードを入力してください', 'error');
      return;
    }

    try {
      loginBtn.disabled = true;
      loginBtn.classList.add('loading');
      showMessage('ログイン中...', 'info');

      // Save credentials if checkbox is checked
      if (saveCredentialsCheckbox.checked) {
        await chrome.storage.local.set({
          credentials: { email, password }
        });
      }

      // Open TeamSpirit in background and login
      const result = await performLoginProcess(email, password);

      if (result.success) {
        await chrome.storage.local.set({ isLoggedIn: true });
        showMessage('ログイン成功', 'success');
        showPunchSection();
        showStatus('ログイン済み', 'logged-in');
        checkPunchStatus();
      } else {
        showMessage(result.error || 'ログインに失敗しました', 'error');
      }
    } catch (error) {
      showMessage(error.message || 'ログインに失敗しました', 'error');
    } finally {
      loginBtn.disabled = false;
      loginBtn.classList.remove('loading');
    }
  }

  async function performLoginProcess(email, password) {
    let tab = null;
    let autoOpenedTab = false;

    try {
      // Check if TeamSpirit tab exists
      tab = await findTeamSpiritTab();

      // Refresh tab info if tab exists
      if (tab) {
        tab = await chrome.tabs.get(tab.id);
      }

      // Check if it's a login page
      const isOnLoginPage = tab && (
        (tab.url && (tab.url.includes('my.salesforce.com') || tab.url.includes('/login'))) ||
        (tab.title && (tab.title.includes('ログイン') || tab.title.toLowerCase().includes('login')))
      );

      // If tab exists and is on TeamSpirit page (not login), user is already logged in
      const isAlreadyLoggedIn = tab && !isOnLoginPage && (
        (tab.url && tab.url.includes('lightning.force.com')) ||
        (tab.url && tab.url.includes('lightning/page'))
      );

      if (isAlreadyLoggedIn) {
        showMessage('既にログイン済みです', 'success');
        return { success: true };
      }

      // If on login page, use that tab
      if (isOnLoginPage) {
        showMessage('ログインページを検出...', 'info');
      } else {
        // Open login page directly (not TeamSpirit URL)
        showMessage('ログインページを開いています...', 'info');
        tab = await chrome.tabs.create({ url: MY_DOMAIN_LOGIN_URL, active: false });
        autoOpenedTab = true;

        // Wait for the tab to load
        await waitForTabLoad(tab.id);

        // Get updated tab info
        tab = await chrome.tabs.get(tab.id);
        showMessage('ログインページ読み込み完了', 'info');
      }

      // Additional wait for login form to render
      await new Promise(r => setTimeout(r, 2000));

      // Verify we're on login page
      tab = await chrome.tabs.get(tab.id);
      const isLoginPageNow = tab.url && (
        tab.url.includes('my.salesforce.com') ||
        tab.url.includes('login.salesforce.com') ||
        tab.url.includes('/login')
      );

      if (!isLoginPageNow) {
        // Might have auto-logged in via session
        if (tab.url && tab.url.includes('lightning.force.com')) {
          return { success: true };
        }
      }

      // Fill in credentials
      showMessage('ログイン情報を入力中...', 'info');
      const loginResult = await sendLoginCommand(tab.id, email, password);

      if (!loginResult.success) {
        if (autoOpenedTab) {
          try { await chrome.tabs.remove(tab.id); } catch(e) {}
        }
        return loginResult;
      }

      // Wait for redirect after login
      showMessage('ログイン処理中...', 'info');
      await waitForLoginRedirect(tab.id);

      // Verify we're now on TeamSpirit page
      tab = await chrome.tabs.get(tab.id);
      const isLoggedInNow = tab.url && (
        tab.url.includes('lightning.force.com') ||
        tab.url.includes('lightning/page')
      );

      if (isLoggedInNow) {
        return { success: true };
      }

      // Check if still on login page (login failed)
      const stillOnLogin = tab.url && (
        tab.url.includes('my.salesforce.com') ||
        tab.url.includes('login.salesforce.com')
      );

      if (stillOnLogin) {
        return { success: false, error: 'ログインに失敗しました。認証情報を確認してください。' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function performPunch(action, location) {
    const btn = action === 'clockIn' ? clockInBtn : clockOutBtn;
    let autoOpenedTab = null;

    try {
      btn.disabled = true;
      clockInBtn.disabled = true;
      clockOutBtn.disabled = true;
      btn.classList.add('loading');
      showMessage('処理中...', 'info');

      // Get stored credentials
      const { credentials } = await chrome.storage.local.get('credentials');

      let tab = await findTeamSpiritTab();

      if (!tab) {
        // Open TeamSpirit in background
        showMessage('TeamSpiritを開いています...', 'info');
        autoOpenedTab = await chrome.tabs.create({ url: TEAMSPIRIT_URL, active: false });

        await waitForTabLoad(autoOpenedTab.id);
        showMessage('ページ読み込み完了...', 'info');

        await waitForContentScript(autoOpenedTab.id);

        // Check if login is needed
        const pageInfo = await getPageInfo(autoOpenedTab.id);

        if (pageInfo.isLoginPage && credentials) {
          showMessage('自動ログイン中...', 'info');
          const loginResult = await sendLoginCommand(autoOpenedTab.id, credentials.email, credentials.password);

          if (!loginResult.success) {
            throw new Error('自動ログインに失敗しました');
          }

          await waitForLoginRedirect(autoOpenedTab.id);
          await waitForContentScript(autoOpenedTab.id);
        } else if (pageInfo.isLoginPage) {
          throw new Error('ログインが必要です');
        }

        tab = autoOpenedTab;
      }

      // Send punch command
      showMessage('打刻中...', 'info');
      const result = await sendPunchCommand(tab.id, action, location);

      if (result.success) {
        const actionText = action === 'clockIn' ? '出勤' : '退勤';
        showMessage(`${actionText}打刻が完了しました`, 'success');

        // Update button states and time management based on action
        if (action === 'clockIn') {
          showStatus('出勤中', 'working');
          updateButtonStates(true);
          // Save clock-in timestamp locally
          await saveClockInTime();
          showTimeSection();
        } else {
          showStatus('未出勤', 'logged-in');
          updateButtonStates(false);
          // Clear clock-in timestamp
          await clearClockInTime();
          hideTimeSection();
        }

        // Close auto-opened tab
        if (autoOpenedTab) {
          setTimeout(async () => {
            try {
              await chrome.tabs.remove(autoOpenedTab.id);
            } catch (e) {}
          }, 1500);
        }
      } else {
        throw new Error(result.error || '打刻に失敗しました');
      }
    } catch (error) {
      showMessage(error.message || 'エラーが発生しました', 'error');

      // Handle session expired
      if (error.message.includes('ログイン')) {
        await chrome.storage.local.set({ isLoggedIn: false });
        showLoginSection();
      }

      if (autoOpenedTab) {
        setTimeout(async () => {
          try {
            await chrome.tabs.remove(autoOpenedTab.id);
          } catch (e) {}
        }, 2000);
      }

      // Re-enable buttons on error
      clockInBtn.disabled = false;
      clockOutBtn.disabled = false;
    } finally {
      btn.classList.remove('loading');
    }
  }

  async function findTeamSpiritTab() {
    // First try specific URL pattern
    let tabs = await chrome.tabs.query({
      url: [
        'https://teamspirit-74532.lightning.force.com/*',
        'https://teamspirit-74532.my.salesforce.com/*',
        'https://login.salesforce.com/*',
        'https://*.salesforce.com/*',
        'https://*.my.salesforce.com/*',
        'https://*.force.com/*'
      ]
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

  function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('タブの読み込みがタイムアウトしました'));
      }, 60000);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 3000);
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

  async function sendLoginCommand(tabId, email, password) {
    try {
      // Always use direct script execution for login (more reliable than content script)
      console.log('Using direct script execution for login');

      // Check if tab URL is valid
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !tab.url.startsWith('https://')) {
        return { success: false, error: 'ログインページのURLが無効です' };
      }

      // Execute login script with retry logic
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (email, password) => {
          // Helper function to wait for element
          const waitForElement = (selector, maxWait = 10000) => {
            return new Promise((resolve) => {
              const el = document.querySelector(selector);
              if (el) {
                resolve(el);
                return;
              }

              const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                  observer.disconnect();
                  resolve(el);
                }
              });

              observer.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true
              });

              setTimeout(() => {
                observer.disconnect();
                resolve(document.querySelector(selector));
              }, maxWait);
            });
          };

          try {
            console.log('Login script starting on:', window.location.href);

            // Wait for username field to appear (up to 10 seconds)
            let usernameField = await waitForElement('#username', 10000);

            // If not found by ID, try other selectors
            if (!usernameField) {
              usernameField = document.querySelector('input[name="username"]') ||
                             document.querySelector('input[type="email"]') ||
                             document.querySelector('input[autocomplete="username"]');
            }

            // Find password field
            let passwordField = document.querySelector('#password') ||
                               document.querySelector('input[name="pw"]') ||
                               document.querySelector('input[name="password"]') ||
                               document.querySelector('input[type="password"]');

            // Find login button
            let loginButton = document.querySelector('#Login') ||
                             document.querySelector('input[name="Login"]') ||
                             document.querySelector('input[type="submit"]') ||
                             document.querySelector('button[type="submit"]');

            // Debug logging
            const allInputs = Array.from(document.querySelectorAll('input'));
            console.log('Page URL:', window.location.href);
            console.log('All inputs found:', allInputs.map(i => ({
              id: i.id, name: i.name, type: i.type
            })));
            console.log('Found elements:', {
              username: usernameField ? `#${usernameField.id || usernameField.name}` : null,
              password: passwordField ? `#${passwordField.id || passwordField.name}` : null,
              loginButton: loginButton ? `#${loginButton.id || loginButton.name}` : null
            });

            if (!usernameField) {
              const inputInfo = allInputs.slice(0, 5).map(i => `${i.type || 'text'}:${i.name || i.id || 'no-name'}`).join(', ');
              return { success: false, error: `ユーザー名フィールドが見つかりません。URL: ${window.location.hostname}, 入力フィールド: ${allInputs.length}個 [${inputInfo}]` };
            }

            if (!passwordField) {
              return { success: false, error: 'パスワードフィールドが見つかりません' };
            }

            // Fill username
            usernameField.focus();
            usernameField.value = '';
            usernameField.value = email;
            usernameField.dispatchEvent(new Event('input', { bubbles: true }));
            usernameField.dispatchEvent(new Event('change', { bubbles: true }));

            // Small delay
            await new Promise(r => setTimeout(r, 300));

            // Fill password
            passwordField.focus();
            passwordField.value = '';
            passwordField.value = password;
            passwordField.dispatchEvent(new Event('input', { bubbles: true }));
            passwordField.dispatchEvent(new Event('change', { bubbles: true }));

            // Small delay
            await new Promise(r => setTimeout(r, 300));

            if (!loginButton) {
              // Try to find and submit form
              const form = document.querySelector('#theloginform') ||
                          passwordField.closest('form') ||
                          usernameField.closest('form');
              if (form) {
                console.log('Submitting form directly');
                form.submit();
                return { success: true };
              }
              return { success: false, error: 'ログインボタンが見つかりません' };
            }

            // Click login button
            console.log('Clicking login button');
            loginButton.focus();
            loginButton.click();

            return { success: true };
          } catch (e) {
            console.error('Login error:', e);
            return { success: false, error: e.message };
          }
        },
        args: [email, password]
      });

      if (results && results[0] && results[0].result) {
        return results[0].result;
      }

      return { success: false, error: 'スクリプト実行に失敗しました' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  function waitForLoginRedirect(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ログインがタイムアウトしました'));
      }, 30000);

      let checkCount = 0;
      const maxChecks = 20;

      const checkPage = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          // Check by URL or title
          const isLoggedIn = (tab.url && (tab.url.includes('lightning.force.com') || tab.url.includes('lightning/page'))) ||
                            (tab.title && tab.title.includes('Salesforce') && !tab.title.includes('Login'));
          if (isLoggedIn) {
            clearTimeout(timeout);
            // Wait a bit for page to stabilize
            await new Promise(r => setTimeout(r, 2000));
            resolve();
            return;
          }

          checkCount++;
          if (checkCount >= maxChecks) {
            clearTimeout(timeout);
            resolve(); // Proceed anyway
            return;
          }

          setTimeout(checkPage, 1500);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      setTimeout(checkPage, 2000);
    });
  }

  function sendPunchCommand(tabId, action, location) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('打刻処理がタイムアウトしました'));
      }, 30000);

      chrome.tabs.sendMessage(tabId, { action, location }, (response) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error('TeamSpiritとの通信に失敗しました'));
          return;
        }

        resolve(response || { success: false, error: '応答がありません' });
      });
    });
  }
});
