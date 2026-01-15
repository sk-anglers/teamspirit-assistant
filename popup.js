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
  const clockOutTimeEl = document.getElementById('clockOutTime');
  const clockOutRow = document.getElementById('clockOutRow');
  const workingTimeEl = document.getElementById('workingTime');
  const targetClockOutEl = document.getElementById('targetClockOut');
  const targetRow = document.getElementById('targetRow');
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
    // Show loading status while fetching accurate status from TeamSpirit site
    showStatus('確認中...', '');

    // Always fetch from TeamSpirit site to get accurate working status
    // (based on whether clock-out time exists for today)
    await initializeTimeDisplay(false);
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
          updateSummaryRealTime(result.workSummary, workingMs, result.clockInTimestamp);
        }
      } else {
        clockInTimeEl.textContent = '--:--';
        workingTimeEl.textContent = '--:--:--';
        targetClockOutEl.textContent = '--:--';
      }
    });
  }

  // Update summary values in real-time by adding today's working time
  function updateSummaryRealTime(summary, todayWorkingMs, clockInTimestamp) {
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
    let requiredMinutesPerDay = 0;

    if (!isNaN(scheduledDays) && !isNaN(actualDays)) {
      const remainingDays = scheduledDays - actualDays;

      // Update required per day
      if (remainingDays > 0) {
        const remainingMinutes = scheduledMinutes - realTimeTotalMinutes;
        if (remainingMinutes > 0) {
          requiredMinutesPerDay = Math.ceil(remainingMinutes / remainingDays);
          requiredPerDayEl.textContent = formatMinutesToTime(requiredMinutesPerDay);
          requiredPerDayEl.classList.remove('negative', 'positive');
        } else {
          requiredPerDayEl.textContent = '達成済み';
          requiredPerDayEl.classList.add('positive');
          requiredPerDayEl.classList.remove('negative');
        }
      }
    }

    // Calculate target clock-out time
    // Formula: 出勤時刻 + 一日当たり必要時間 + 休憩1時間
    if (clockInTimestamp && requiredMinutesPerDay > 0) {
      const breakMinutes = 60; // 1 hour break
      const targetMs = clockInTimestamp + (requiredMinutesPerDay + breakMinutes) * 60 * 1000;
      const targetDate = new Date(targetMs);
      targetClockOutEl.textContent = formatTimeShort(targetDate);
    } else if (requiredMinutesPerDay === 0) {
      targetClockOutEl.textContent = '達成済み';
    } else {
      targetClockOutEl.textContent = '--:--';
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

  // Update time display for clocked-out state (final, fixed values)
  function updateTimeDisplayFinal(clockInTs, clockOutTs) {
    // Show current time (still updating)
    currentTimeEl.textContent = formatTime(new Date());

    // Show clock-in time
    const clockInDate = new Date(clockInTs);
    clockInTimeEl.textContent = formatTimeShort(clockInDate);

    // Show clock-out time and row
    const clockOutDate = new Date(clockOutTs);
    clockOutTimeEl.textContent = formatTimeShort(clockOutDate);
    clockOutRow.style.display = 'flex';

    // Hide target row (not relevant when clocked out)
    targetRow.style.display = 'none';

    // Calculate and show final working time (clock-out - clock-in)
    const workingMs = clockOutTs - clockInTs;
    workingTimeEl.textContent = formatDuration(workingMs);

    // Start interval just for current time
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
    }
    timeUpdateInterval = setInterval(() => {
      currentTimeEl.textContent = formatTime(new Date());
    }, 1000);
  }

  // Show time section (for working state)
  function showTimeSection() {
    timeSection.classList.remove('hidden');
    // Reset to working mode display
    clockOutRow.style.display = 'none';
    targetRow.style.display = 'flex';
    startTimeUpdates();
  }

  // Hide time section
  function hideTimeSection() {
    timeSection.classList.add('hidden');
    stopTimeUpdates();
    // Reset rows
    clockOutRow.style.display = 'none';
    targetRow.style.display = 'flex';
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
          const d = new Date();
          d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
          clockInTimestamp = d.getTime();
        }
      }

      if (data.clockOutTime) {
        const parts = data.clockOutTime.split(':');
        if (parts.length >= 2) {
          const d = new Date();
          d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
          clockOutTimestamp = d.getTime();
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

  // Legacy function - kept for reference but no longer used
  async function fetchClockInTimeFromSite_legacy() {
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

      // Execute script to find clock-in/out times AND summary data (search in all frames including iframes)
      const results = await chrome.scripting.executeScript({
        target: { tabId: tempTab.id, allFrames: true },
        func: (dateStr) => {
          try {
            const result = {
              success: false,
              clockInTime: null,
              clockOutTime: null,
              isWorking: false,
              summary: null,
              debug: null
            };

            // 1. Look for clock-in time with ID ttvTimeSt{date}
            const clockInId = `ttvTimeSt${dateStr}`;
            const clockInEl = document.getElementById(clockInId);

            if (clockInEl) {
              const timeText = clockInEl.textContent?.trim();
              if (timeText && timeText !== '' && timeText !== '--:--') {
                result.clockInTime = timeText;
                result.success = true;
              }
            }

            // 2. Look for clock-out time - no ID, use class "vet" (visit end)
            // ONLY search in the same row as clock-in to avoid getting wrong day's data
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

            // 3. Determine if user is currently working
            // Working = has clock-in time AND no clock-out time
            result.isWorking = !!(result.clockInTime && !result.clockOutTime);

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

        let clockInTimestamp = null;
        let clockOutTimestamp = null;
        let isWorking = false;
        let hasClockedOut = false;

        if (bestResult?.clockInTime) {
          const timeStr = bestResult.clockInTime;
          console.log('Fetched clock-in time from site:', timeStr);
          console.log('Fetched clock-out time from site:', bestResult.clockOutTime || 'none');
          console.log('Is working:', bestResult.isWorking);

          // Parse clock-in time string
          const timeParts = timeStr.split(':');
          if (timeParts.length >= 2) {
            const hours = parseInt(timeParts[0], 10);
            const minutes = parseInt(timeParts[1], 10);

            if (!isNaN(hours) && !isNaN(minutes)) {
              const clockInDate = new Date();
              clockInDate.setHours(hours, minutes, 0, 0);
              clockInTimestamp = clockInDate.getTime();
            }
          }

          // Parse clock-out time string if exists
          if (bestResult.clockOutTime) {
            const outParts = bestResult.clockOutTime.split(':');
            if (outParts.length >= 2) {
              const hours = parseInt(outParts[0], 10);
              const minutes = parseInt(outParts[1], 10);

              if (!isNaN(hours) && !isNaN(minutes)) {
                const clockOutDate = new Date();
                clockOutDate.setHours(hours, minutes, 0, 0);
                clockOutTimestamp = clockOutDate.getTime();
                hasClockedOut = true;
              }
            }
          }

          isWorking = bestResult.isWorking;

          // Save to storage
          await chrome.storage.local.set({
            clockInTimestamp: clockInTimestamp,
            clockOutTimestamp: clockOutTimestamp,
            hasClockedOut: hasClockedOut
          });
          console.log('Saved time data to storage');
        }

        // Save summary data if found
        if (bestResult?.summary) {
          console.log('Fetched summary data:', bestResult.summary);
          await chrome.storage.local.set({ workSummary: bestResult.summary });
        }

        if (clockInTimestamp || bestResult?.summary) {
          return {
            clockInTimestamp,
            clockOutTimestamp,
            summary: bestResult?.summary,
            isWorking,
            hasClockedOut
          };
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
  async function initializeTimeDisplay(isWorkingHint) {
    // First, clean up old timestamps from previous days
    const stored = await chrome.storage.local.get(['clockInTimestamp', 'clockOutTimestamp', 'hasClockedOut', 'workSummary']);

    if (stored.clockInTimestamp && !isToday(stored.clockInTimestamp)) {
      // Timestamp is from a previous day - clear it
      await clearClockInTime();
      await chrome.storage.local.remove(['workSummary', 'clockOutTimestamp', 'hasClockedOut']);
    }

    // Check if we have valid cached data for today
    const hasCachedClockIn = stored.clockInTimestamp && isToday(stored.clockInTimestamp);

    if (hasCachedClockIn) {
      // Use cached data
      if (stored.hasClockedOut && stored.clockOutTimestamp) {
        showStatus('退勤済み', 'logged-in');
        updateButtonStates(false);
        timeSection.classList.remove('hidden');
        updateTimeDisplayFinal(stored.clockInTimestamp, stored.clockOutTimestamp);
      } else {
        showStatus('出勤中', 'working');
        updateButtonStates(true);
        showTimeSection();
        updateTimeDisplay();
      }
      if (stored.workSummary) {
        displaySummary(stored.workSummary);
      }
      showMessage('', '');
      return;
    }

    // No cached data - fetch from TeamSpirit site
    showMessage('勤怠情報を取得中...', 'info');

    const fetchResult = await fetchClockInTimeFromSite();

    if (fetchResult) {
      showMessage('', ''); // Clear message

      if (fetchResult.isWorking) {
        // User is currently working (has clock-in, no clock-out)
        showStatus('出勤中', 'working');
        updateButtonStates(true);
        showTimeSection();
        updateTimeDisplay();
        if (fetchResult.summary) {
          displaySummary(fetchResult.summary);
        }
      } else if (fetchResult.hasClockedOut) {
        // User has clocked out today - show final times
        showStatus('退勤済み', 'logged-in');
        updateButtonStates(false);
        timeSection.classList.remove('hidden');
        updateTimeDisplayFinal(fetchResult.clockInTimestamp, fetchResult.clockOutTimestamp);
        if (fetchResult.summary) {
          displaySummary(fetchResult.summary);
        }
      } else {
        // User hasn't clocked in today
        showStatus('未出勤', 'logged-in');
        updateButtonStates(false);
        hideTimeSection();
        hideSummarySection();
      }
    } else {
      // Failed to fetch from site
      if (isWorkingHint) {
        showTimeSection();
        showMessage('出勤時刻の取得に失敗しました', 'error');
      } else {
        showStatus('未出勤', 'logged-in');
        updateButtonStates(false);
        hideTimeSection();
        hideSummarySection();
        showMessage('', '');
      }
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

      // Save email to persistent storage if checkbox is checked, otherwise remove it
      if (saveCredentialsCheckbox.checked) {
        await chrome.storage.local.set({ savedEmail: email });
        console.log('Email saved to storage:', email);
      } else {
        await chrome.storage.local.remove('savedEmail');
        console.log('Email removed from storage');
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
        const logInfo = result.logs ? `\n${result.logs}` : '';
        showMessage(`${actionText}打刻が完了しました${logInfo}`, 'success');

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
          // Clear clock-in timestamp and work summary
          await clearClockInTime();
          await chrome.storage.local.remove('workSummary');
          hideTimeSection();
          hideSummarySection();
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

  async function sendPunchCommand(tabId, action, location) {
    try {
      // Use chrome.scripting.executeScript with allFrames to find buttons in any frame (including iframes)
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: (action, location) => {
          const logs = [];
          logs.push(`Frame: ${window === window.top ? 'main' : 'iframe'}`);
          logs.push(`URL: ${window.location.href}`);

          // Location mapping
          const LOCATION_MAP = {
            'remote': 'リモート',
            'office': 'オフィス',
            'direct-to-office': '直行→オフィス',
            'office-to-direct': 'オフィス→直帰',
            'direct': '直行直帰'
          };

          // Find button by ID first, then by text
          function findPunchButton(text) {
            // Method 1: Search by specific TeamSpirit button IDs
            if (text === '出勤') {
              const btn = document.getElementById('btnStInput');
              if (btn) return btn;
            }
            if (text === '退勤') {
              const btn = document.getElementById('btnEtInput');
              if (btn) return btn;
            }

            // Method 2: Direct button search by value attribute
            const buttons = document.querySelectorAll('button, input[type="button"], [role="button"]');
            for (const btn of buttons) {
              const btnText = btn.textContent?.trim() || btn.value?.trim() || '';
              if (btnText === text) {
                return btn;
              }
            }
            return null;
          }

          // Select location
          function selectLocation(loc) {
            const locationText = LOCATION_MAP[loc];
            if (!locationText) return;

            const buttons = document.querySelectorAll('button, input[type="button"], [role="button"], label');
            for (const btn of buttons) {
              const text = btn.textContent?.trim() || btn.value?.trim() || '';
              if (text === locationText) {
                const isSelected = btn.classList.contains('selected') ||
                                  btn.classList.contains('active') ||
                                  btn.getAttribute('aria-pressed') === 'true';
                if (!isSelected) {
                  btn.click();
                }
                return;
              }
            }
          }

          // Simulate click with multiple methods
          function simulateClick(element) {
            logs.push(`Clicking: ${element.id || element.value}`);

            // Focus first
            element.focus();

            // Try onclick directly if exists
            if (element.onclick) {
              try {
                element.onclick();
                logs.push('onclick() called');
              } catch (e) {
                logs.push(`onclick error: ${e.message}`);
              }
            }

            // Create and dispatch mouse events
            const rect = element.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const mouseDownEvent = new MouseEvent('mousedown', {
              bubbles: true, cancelable: true, view: window,
              clientX: centerX, clientY: centerY
            });
            element.dispatchEvent(mouseDownEvent);

            const mouseUpEvent = new MouseEvent('mouseup', {
              bubbles: true, cancelable: true, view: window,
              clientX: centerX, clientY: centerY
            });
            element.dispatchEvent(mouseUpEvent);

            const clickEvent = new MouseEvent('click', {
              bubbles: true, cancelable: true, view: window,
              clientX: centerX, clientY: centerY
            });
            element.dispatchEvent(clickEvent);

            // Native click
            element.click();

            logs.push('Click events dispatched');
          }

          try {
            const buttonText = action === 'clockIn' ? '出勤' : '退勤';
            const button = findPunchButton(buttonText);

            if (!button) {
              // Button not found in this frame - not an error, just skip
              return { success: false, notFound: true, logs: logs.join('\n') };
            }

            logs.push(`Button found: ${button.id}, disabled: ${button.disabled}`);

            if (button.disabled) {
              const errorMsg = action === 'clockIn' ? '既に出勤済みです' : '出勤していないため退勤できません';
              return { success: false, error: errorMsg, logs: logs.join('\n') };
            }

            // Select location first (for clock in)
            if (action === 'clockIn' && location) {
              selectLocation(location);
            }

            // Click the button
            simulateClick(button);

            return { success: true, logs: logs.join('\n') };
          } catch (e) {
            logs.push(`Error: ${e.message}`);
            return { success: false, error: e.message, logs: logs.join('\n') };
          }
        },
        args: [action, location]
      });

      // Find the best result from all frames
      // Prioritize: success > error with button found > not found
      let bestResult = null;
      let allLogs = [];

      for (const frameResult of results) {
        if (frameResult.result) {
          allLogs.push(frameResult.result.logs || '');

          if (frameResult.result.success) {
            // Found and clicked - this is what we want
            bestResult = frameResult.result;
            break;
          } else if (!frameResult.result.notFound) {
            // Button was found but there was an error (like disabled)
            bestResult = frameResult.result;
          }
        }
      }

      if (bestResult) {
        return bestResult;
      }

      // No frame found the button
      return {
        success: false,
        error: '打刻ボタンが見つかりません。TeamSpiritページを開いてください。',
        logs: allLogs.join('\n---\n')
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});
