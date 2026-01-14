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
  const summarySection = document.getElementById('summarySection');
  const summaryToggle = document.getElementById('summaryToggle');
  const summaryContent = document.getElementById('summaryContent');
  const scheduledHoursEl = document.getElementById('scheduledHours');
  const totalHoursEl = document.getElementById('totalHours');
  const overUnderHoursEl = document.getElementById('overUnderHours');
  const remainingDaysEl = document.getElementById('remainingDays');
  const requiredPerDayEl = document.getElementById('requiredPerDay');

  // Time update interval
  let timeUpdateInterval = null;

  // Load saved data
  const stored = await chrome.storage.local.get(['savedLocation', 'savedEmail', 'isLoggedIn', 'summaryCollapsed']);
  const sessionData = await chrome.storage.session.get(['sessionPassword']);

  if (stored.savedLocation) {
    locationSelect.value = stored.savedLocation;
  }

  // Load email from persistent storage
  if (stored.savedEmail) {
    emailInput.value = stored.savedEmail;
  }

  // Load password from session storage (browser session only)
  if (sessionData.sessionPassword) {
    passwordInput.value = sessionData.sessionPassword;
  }

  // Load summary collapsed state (default: collapsed)
  if (stored.summaryCollapsed !== false) {
    summaryToggle.classList.add('collapsed');
    summaryContent.classList.add('collapsed');
  }

  // Summary toggle event
  summaryToggle.addEventListener('click', () => {
    const isCollapsed = summaryToggle.classList.toggle('collapsed');
    summaryContent.classList.toggle('collapsed');
    chrome.storage.local.set({ summaryCollapsed: isCollapsed });
  });

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
    hideTimeSection();
    hideSummarySection();
    showStatus('ログアウトしました', 'logged-out');
    showMessage('', '');
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

    if (stored.savedEmail) {
      // Has saved email
      showLoginSection();
      showStatus('ログインしてください', 'logged-out');
    } else {
      // No saved email
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

  async function checkPunchStatus(retryCount = 0) {
    const maxRetries = 5;
    const retryDelay = 1000;

    try {
      const tab = await findTeamSpiritTab();
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, async (response) => {
          if (chrome.runtime.lastError) {
            showStatus('ログイン済み', 'logged-in');
            updateButtonStates(null);
            const { clockInTimestamp } = await chrome.storage.local.get('clockInTimestamp');
            await initializeTimeDisplay(!!clockInTimestamp);
            return;
          }

          // If punch area not found and we have retries left, wait and retry
          if (response && response.status === '打刻エリアが見つかりません' && retryCount < maxRetries) {
            showStatus('読み込み中...', '');
            setTimeout(() => checkPunchStatus(retryCount + 1), retryDelay);
            return;
          }

          if (response && response.status) {
            showStatus(response.status, response.isWorking ? 'working' : 'logged-in');
            updateButtonStates(response.isWorking);
            await initializeTimeDisplay(response.isWorking);
          } else {
            updateButtonStates(null);
            hideTimeSection();
          }
        });
      } else {
        showStatus('ログイン済み', 'logged-in');
        updateButtonStates(null);
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

    // Update working time if clocked in, and update summary in real-time
    chrome.storage.local.get(['clockInTimestamp', 'workSummary'], (result) => {
      if (result.clockInTimestamp) {
        const clockInDate = new Date(result.clockInTimestamp);
        clockInTimeEl.textContent = formatTimeShort(clockInDate);

        const workingMs = Date.now() - result.clockInTimestamp;
        workingTimeEl.textContent = formatDuration(workingMs);

        // Update summary in real-time if we have summary data
        if (result.workSummary) {
          updateSummaryRealTime(result.workSummary, workingMs);
        }
      } else {
        clockInTimeEl.textContent = '--:--';
        workingTimeEl.textContent = '--:--:--';
      }
    });
  }

  // Update summary values in real-time by adding today's working time
  function updateSummaryRealTime(summary, todayWorkingMs) {
    const scheduledMinutes = parseTimeToMinutes(summary.scheduledHours);
    const baseTotalMinutes = parseTimeToMinutes(summary.totalHours);

    if (scheduledMinutes === null || baseTotalMinutes === null) return;

    // Add today's working time to base total
    const todayWorkingMinutes = Math.floor(todayWorkingMs / 60000);
    const realTimeTotalMinutes = baseTotalMinutes + todayWorkingMinutes;

    // Update total hours display
    totalHoursEl.textContent = formatMinutesToTime(realTimeTotalMinutes);

    // Calculate and update over/under hours
    const overUnderMinutes = realTimeTotalMinutes - scheduledMinutes;
    const overUnderStr = formatMinutesToTime(overUnderMinutes);
    overUnderHoursEl.textContent = overUnderMinutes >= 0 ? `+${overUnderStr}` : overUnderStr;

    // Style over/under hours
    if (overUnderMinutes < 0) {
      overUnderHoursEl.classList.add('negative');
      overUnderHoursEl.classList.remove('positive');
    } else if (overUnderMinutes > 0) {
      overUnderHoursEl.classList.add('positive');
      overUnderHoursEl.classList.remove('negative');
    } else {
      overUnderHoursEl.classList.remove('negative', 'positive');
    }

    // Calculate remaining days
    const scheduledDays = parseInt(summary.scheduledDays, 10);
    const actualDays = parseInt(summary.actualDays, 10);

    if (!isNaN(scheduledDays) && !isNaN(actualDays)) {
      const remainingDays = scheduledDays - actualDays;

      // Update required per day
      if (remainingDays > 0) {
        const remainingMinutes = scheduledMinutes - realTimeTotalMinutes;
        if (remainingMinutes > 0) {
          const requiredMinutesPerDay = Math.ceil(remainingMinutes / remainingDays);
          requiredPerDayEl.textContent = formatMinutesToTime(requiredMinutesPerDay);
          requiredPerDayEl.classList.remove('negative', 'positive');
        } else {
          requiredPerDayEl.textContent = '達成済み';
          requiredPerDayEl.classList.add('positive');
          requiredPerDayEl.classList.remove('negative');
        }
      }
    }
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

      // Execute script to find clock-in time AND summary data (search in all frames including iframes)
      const results = await chrome.scripting.executeScript({
        target: { tabId: tempTab.id, allFrames: true },
        func: (dateStr) => {
          try {
            const result = {
              success: false,
              clockInTime: null,
              summary: null,
              debug: null
            };

            // 1. Look for clock-in time with ID ttvTimeSt{date}
            const elementId = `ttvTimeSt${dateStr}`;
            const element = document.getElementById(elementId);

            if (element) {
              const timeText = element.textContent?.trim();
              if (timeText && timeText !== '' && timeText !== '--:--') {
                result.clockInTime = timeText;
                result.success = true;
              }
            }

            // 2. Look for summary data by searching for text labels
            const summaryData = {};

            // Helper function to find value next to label
            const findValueByLabel = (labelText) => {
              const allElements = document.querySelectorAll('td, th, div, span');
              for (const el of allElements) {
                const text = el.textContent?.trim();
                if (text === labelText) {
                  // Look for next sibling or parent's next sibling
                  let valueEl = el.nextElementSibling;
                  if (!valueEl && el.parentElement) {
                    valueEl = el.parentElement.nextElementSibling;
                  }
                  if (!valueEl && el.parentElement) {
                    // Try finding in same row
                    const row = el.closest('tr, .row, [class*="row"]');
                    if (row) {
                      const cells = row.querySelectorAll('td, div, span');
                      for (let i = 0; i < cells.length; i++) {
                        if (cells[i].textContent?.trim() === labelText && cells[i + 1]) {
                          return cells[i + 1].textContent?.trim();
                        }
                      }
                    }
                  }
                  if (valueEl) {
                    return valueEl.textContent?.trim();
                  }
                }
              }
              return null;
            };

            // Search for summary values using text patterns
            const searchTexts = [
              { key: 'scheduledHours', labels: ['所定労働時間'] },
              { key: 'totalHours', labels: ['総労働時間', '総労働時間（有休を含む）'] },
              { key: 'overUnderHours', labels: ['過不足時間'] },
              { key: 'scheduledDays', labels: ['所定出勤日数'] },
              { key: 'actualDays', labels: ['実出勤日数'] }
            ];

            // Alternative: search all text nodes for patterns
            const allText = document.body?.innerText || '';

            // Pattern matching for time values like "152:00" or "-89:17"
            const timeValuePattern = /-?\d{1,3}:\d{2}/g;

            // Search for specific patterns in table structure
            const tables = document.querySelectorAll('table');
            tables.forEach(table => {
              const rows = table.querySelectorAll('tr');
              rows.forEach(row => {
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

            // Also try div-based layout
            const divs = document.querySelectorAll('div');
            divs.forEach(div => {
              const text = div.textContent?.trim();
              if (!text) return;

              // Check for label:value patterns
              if (text.includes('所定労働時間') && !summaryData.scheduledHours) {
                const match = text.match(/所定労働時間[:\s]*(\d{1,3}:\d{2})/);
                if (match) summaryData.scheduledHours = match[1];
              }
              if (text.includes('総労働時間') && !text.includes('法定') && !summaryData.totalHours) {
                const match = text.match(/総労働時間[^法]*?(\d{1,3}:\d{2})/);
                if (match) summaryData.totalHours = match[1];
              }
              if (text.includes('過不足時間') && !summaryData.overUnderHours) {
                const match = text.match(/過不足時間[:\s]*(-?\d{1,3}:\d{2})/);
                if (match) summaryData.overUnderHours = match[1];
              }
              if (text.includes('所定出勤日数') && !summaryData.scheduledDays) {
                const match = text.match(/所定出勤日数[:\s]*(\d+)/);
                if (match) summaryData.scheduledDays = match[1];
              }
              if (text.includes('実出勤日数') && !summaryData.actualDays) {
                const match = text.match(/実出勤日数[:\s]*(\d+)/);
                if (match) summaryData.actualDays = match[1];
              }
            });

            if (Object.keys(summaryData).length > 0) {
              result.summary = summaryData;
            }

            // Debug info
            result.debug = {
              url: window.location.href,
              foundClockIn: !!result.clockInTime,
              summaryKeys: Object.keys(summaryData)
            };

            return result;
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
      // Find the best result from any frame
      if (results && results.length > 0) {
        let bestResult = null;
        let debugInfo = null;

        for (const frameResult of results) {
          if (frameResult.result) {
            // Prefer result with clock-in time or summary data
            if (frameResult.result.clockInTime || frameResult.result.summary) {
              if (!bestResult || (frameResult.result.clockInTime && !bestResult.clockInTime)) {
                bestResult = frameResult.result;
              }
              // Merge summary data if found in different frames
              if (frameResult.result.summary && bestResult) {
                bestResult.summary = { ...bestResult.summary, ...frameResult.result.summary };
              }
            }
            if (frameResult.result.debug) {
              debugInfo = frameResult.result.debug;
            }
          }
        }

        let timestamp = null;

        if (bestResult?.clockInTime) {
          const timeStr = bestResult.clockInTime;
          console.log('Fetched clock-in time from site:', timeStr);

          // Parse time string (e.g., "09:00" or "9:00") and convert to timestamp
          const timeParts = timeStr.split(':');
          if (timeParts.length >= 2) {
            const hours = parseInt(timeParts[0], 10);
            const minutes = parseInt(timeParts[1], 10);

            if (!isNaN(hours) && !isNaN(minutes)) {
              const clockInDate = new Date();
              clockInDate.setHours(hours, minutes, 0, 0);
              timestamp = clockInDate.getTime();

              // Save to local storage for future use
              await chrome.storage.local.set({ clockInTimestamp: timestamp });
              console.log('Saved fetched clock-in time to local storage');
            }
          }
        }

        // Save summary data if found
        if (bestResult?.summary) {
          console.log('Fetched summary data:', bestResult.summary);
          await chrome.storage.local.set({ workSummary: bestResult.summary });
        }

        if (timestamp || bestResult?.summary) {
          return { timestamp, summary: bestResult?.summary };
        }

        // Log debug info for troubleshooting
        console.log('Failed to find data. Debug info:', debugInfo);
        if (debugInfo) {
          await chrome.storage.local.set({ lastFetchDebug: debugInfo });
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

        // Fetch from site in background (returns { timestamp, summary })
        const fetchResult = await fetchClockInTimeFromSite();
        if (fetchResult) {
          showMessage('', ''); // Clear message
          updateTimeDisplay(); // Update with fetched time
          // Display summary if available
          if (fetchResult.summary) {
            displaySummary(fetchResult.summary);
          }
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
        // Try to load cached summary data
        const { workSummary } = await chrome.storage.local.get('workSummary');
        if (workSummary) {
          displaySummary(workSummary);
        } else {
          // No cached summary - fetch it in background
          showMessage('サマリーを取得中...', 'info');
          const fetchResult = await fetchClockInTimeFromSite();
          if (fetchResult?.summary) {
            displaySummary(fetchResult.summary);
            showMessage('', '');
          } else {
            showMessage('', '');
          }
        }
      }
    } else {
      hideTimeSection();
      hideSummarySection();
    }
  }

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
    const totalMinutes = hours * 60 + minutes;
    return isNegative ? -totalMinutes : totalMinutes;
  }

  // Format minutes to time string like "8:00" or "-1:30"
  function formatMinutesToTime(totalMinutes) {
    if (totalMinutes === null) return '--:--';
    const isNegative = totalMinutes < 0;
    const absMinutes = Math.abs(totalMinutes);
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;
    const timeStr = `${hours}:${String(minutes).padStart(2, '0')}`;
    return isNegative ? `-${timeStr}` : timeStr;
  }

  // Display summary data
  function displaySummary(summary) {
    if (!summary) {
      hideSummarySection();
      return;
    }

    // Parse time values first
    const scheduledMinutes = parseTimeToMinutes(summary.scheduledHours);
    const totalMinutes = parseTimeToMinutes(summary.totalHours);

    // Display basic values
    scheduledHoursEl.textContent = summary.scheduledHours || '--:--';
    totalHoursEl.textContent = summary.totalHours || '--:--';

    // Calculate and display over/under hours (総労働時間 - 所定労働時間)
    if (scheduledMinutes !== null && totalMinutes !== null) {
      const overUnderMinutes = totalMinutes - scheduledMinutes;
      const overUnderStr = formatMinutesToTime(overUnderMinutes);
      overUnderHoursEl.textContent = overUnderMinutes >= 0 ? `+${overUnderStr}` : overUnderStr;

      // Style over/under hours (negative = red, positive = green)
      if (overUnderMinutes < 0) {
        overUnderHoursEl.classList.add('negative');
        overUnderHoursEl.classList.remove('positive');
      } else if (overUnderMinutes > 0) {
        overUnderHoursEl.classList.add('positive');
        overUnderHoursEl.classList.remove('negative');
      } else {
        overUnderHoursEl.classList.remove('negative', 'positive');
      }
    } else {
      overUnderHoursEl.textContent = '--:--';
      overUnderHoursEl.classList.remove('negative', 'positive');
    }

    // Calculate remaining days
    const scheduledDays = parseInt(summary.scheduledDays, 10);
    const actualDays = parseInt(summary.actualDays, 10);
    let remainingDays = null;

    if (!isNaN(scheduledDays) && !isNaN(actualDays)) {
      remainingDays = scheduledDays - actualDays;
      remainingDaysEl.textContent = `${remainingDays}日`;
    } else {
      remainingDaysEl.textContent = '--日';
    }

    // Calculate required hours per day based on (所定労働時間 - 総労働時間) / 残り日数

    if (scheduledMinutes !== null && totalMinutes !== null && remainingDays !== null && remainingDays > 0) {
      const remainingMinutes = scheduledMinutes - totalMinutes;
      if (remainingMinutes > 0) {
        // Still need to work more hours
        const requiredMinutesPerDay = Math.ceil(remainingMinutes / remainingDays);
        requiredPerDayEl.textContent = formatMinutesToTime(requiredMinutesPerDay);
        requiredPerDayEl.classList.remove('negative', 'positive');
      } else {
        // Already met or exceeded scheduled hours
        requiredPerDayEl.textContent = '達成済み';
        requiredPerDayEl.classList.add('positive');
        requiredPerDayEl.classList.remove('negative');
      }
    } else {
      requiredPerDayEl.textContent = '--:--';
      requiredPerDayEl.classList.remove('negative', 'positive');
    }

    // Show summary section
    summarySection.classList.remove('hidden');
  }

  // Hide summary section
  function hideSummarySection() {
    summarySection.classList.add('hidden');
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

      // Save email to persistent storage if checkbox is checked
      if (saveCredentialsCheckbox.checked) {
        await chrome.storage.local.set({ savedEmail: email });
      }
      // Always save password to session storage (cleared when browser closes)
      await chrome.storage.session.set({ sessionPassword: password });

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
      const startTime = Date.now();
      const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(1) + 's';

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
        showMessage(`[${elapsed()}] ログインページを検出...`, 'info');
      } else {
        // Open login page directly (not TeamSpirit URL)
        showMessage(`[${elapsed()}] ページを開いています...`, 'info');
        tab = await chrome.tabs.create({ url: MY_DOMAIN_LOGIN_URL, active: false });
        autoOpenedTab = true;

        // Wait for the tab to load
        await waitForTabLoad(tab.id);

        // Get updated tab info
        tab = await chrome.tabs.get(tab.id);
        showMessage(`[${elapsed()}] タブ読み込み完了`, 'info');
      }

      // Verify we're on login page or auto-logged in
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

      // Skip waitForLoginForm - sendLoginCommand has its own element waiting logic
      // This saves several seconds of redundant waiting
      showMessage(`[${elapsed()}] 認証情報入力中...`, 'info');
      const loginResult = await sendLoginCommand(tab.id, email, password);

      if (!loginResult.success) {
        if (autoOpenedTab) {
          try { await chrome.tabs.remove(tab.id); } catch(e) {}
        }
        return loginResult;
      }

      // Wait for redirect after login
      showMessage(`[${elapsed()}] リダイレクト待機中...`, 'info');
      await waitForLoginRedirect(tab.id);

      // Wait for TeamSpirit page to fully load after redirect
      showMessage(`[${elapsed()}] ページ読み込み中...`, 'info');
      await waitForTabLoad(tab.id);
      await waitForContentScript(tab.id);
      showMessage(`[${elapsed()}] 完了`, 'info');

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

      // Get stored credentials (email from local, password from session)
      const { savedEmail } = await chrome.storage.local.get('savedEmail');
      const { sessionPassword } = await chrome.storage.session.get('sessionPassword');

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

        if (pageInfo.isLoginPage && savedEmail && sessionPassword) {
          showMessage('自動ログイン中...', 'info');
          const loginResult = await sendLoginCommand(autoOpenedTab.id, savedEmail, sessionPassword);

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
      const maxChecks = 60; // More checks with shorter interval

      const checkPage = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          // Check by URL or title
          const isLoggedIn = (tab.url && (tab.url.includes('lightning.force.com') || tab.url.includes('lightning/page'))) ||
                            (tab.title && tab.title.includes('Salesforce') && !tab.title.includes('Login'));
          if (isLoggedIn) {
            clearTimeout(timeout);
            // Reduced stabilization wait from 2000ms to 500ms
            await new Promise(r => setTimeout(r, 500));
            resolve();
            return;
          }

          checkCount++;
          if (checkCount >= maxChecks) {
            clearTimeout(timeout);
            resolve(); // Proceed anyway
            return;
          }

          // Poll every 500ms instead of 1500ms
          setTimeout(checkPage, 500);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      // Start checking immediately instead of waiting 2000ms
      setTimeout(checkPage, 500);
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
