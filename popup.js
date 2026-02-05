// TeamSpirit Assistant - Popup Main
// モジュール構成: config.js, utils.js, overtime-calc.js, crypto.js, tab-utils.js, login.js, punch.js
// popup.js は UI表示・更新ロジックのみ保持

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
  const missedPunchSection = document.getElementById('missedPunchSection');
  const missedPunchToggle = document.getElementById('missedPunchToggle');
  const missedPunchContent = document.getElementById('missedPunchContent');
  const missedPunchCount = document.getElementById('missedPunchCount');
  const missedPunchList = document.getElementById('missedPunchList');
  const overtimeSection = document.getElementById('overtimeSection');
  const overtimeToggle = document.getElementById('overtimeToggle');
  const overtimeContent = document.getElementById('overtimeContent');
  const overtimeBadge = document.getElementById('overtimeBadge');
  const overtimeAlert = document.getElementById('overtimeAlert');
  const actualDaysEl = document.getElementById('actualDays');
  const actualHoursEl = document.getElementById('actualHours');
  const avgHoursPerDayEl = document.getElementById('avgHoursPerDay');
  const avgOvertimePerDayEl = document.getElementById('avgOvertimePerDay');
  const dailyExcessTotalEl = document.getElementById('dailyExcessTotal');
  const legalOvertimeEl = document.getElementById('legalOvertime');
  const overtimeForecastEl = document.getElementById('overtimeForecast');
  const forecastRow = document.getElementById('forecastRow');
  const todaySection = document.getElementById('todaySection');
  const todayDateEl = document.getElementById('todayDate');
  const todayDayOfWeekEl = document.getElementById('todayDayOfWeek');
  const todayHolidayEl = document.getElementById('todayHoliday');
  const todayTypeEl = document.getElementById('todayType');
  const headerWarning = document.getElementById('headerWarning');

  // Time update interval
  let timeUpdateInterval = null;

  // Constants for overtime calculation (config.js で一元管理)
  const STANDARD_HOURS_PER_DAY = CONFIG.STANDARD_HOURS_PER_DAY;
  const OVERTIME_LIMIT = CONFIG.OVERTIME_LIMIT;

  // Load saved data
  const stored = await chrome.storage.local.get(['savedLocation', 'savedEmail', 'isLoggedIn', 'summaryCollapsed', 'missedPunchCollapsed', 'encryptedPassword']);

  if (stored.savedLocation) {
    locationSelect.value = stored.savedLocation;
  }

  // Load email from persistent storage
  if (stored.savedEmail) {
    emailInput.value = stored.savedEmail;
  }

  // Load password from encrypted storage
  if (stored.encryptedPassword) {
    const decrypted = await decryptPassword(stored.encryptedPassword);
    if (decrypted) {
      passwordInput.value = decrypted;
    }
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

  // Load missed punch collapsed state (default: collapsed)
  if (stored.missedPunchCollapsed !== false) {
    missedPunchToggle.classList.add('collapsed');
    missedPunchContent.classList.add('collapsed');
  }

  // Missed punch toggle event
  missedPunchToggle.addEventListener('click', () => {
    const isCollapsed = missedPunchToggle.classList.toggle('collapsed');
    missedPunchContent.classList.toggle('collapsed');
    chrome.storage.local.set({ missedPunchCollapsed: isCollapsed });
  });

  // Header warning click - expand and scroll to missed punch section
  headerWarning.addEventListener('click', () => {
    // Expand the missed punch section
    missedPunchToggle.classList.remove('collapsed');
    missedPunchContent.classList.remove('collapsed');
    chrome.storage.local.set({ missedPunchCollapsed: false });
    // Scroll to missed punch section
    missedPunchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Load overtime collapsed state (default: expanded)
  const overtimeStored = await chrome.storage.local.get('overtimeCollapsed');
  if (overtimeStored.overtimeCollapsed === true) {
    overtimeToggle.classList.add('collapsed');
    overtimeContent.classList.add('collapsed');
  }

  // Overtime toggle event
  overtimeToggle.addEventListener('click', () => {
    const isCollapsed = overtimeToggle.classList.toggle('collapsed');
    overtimeContent.classList.toggle('collapsed');
    chrome.storage.local.set({ overtimeCollapsed: isCollapsed });
  });

  // Save location preference when changed
  locationSelect.addEventListener('change', () => {
    chrome.storage.local.set({ savedLocation: locationSelect.value });
  });

  // Open TeamSpirit link
  openTeamSpiritLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: CONFIG.TEAMSPIRIT_URL });
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
    hideMissedPunchSection();
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
        loadMissedPunchData();
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
    hideTodaySection();
  }

  function showPunchSection() {
    loginSection.classList.add('hidden');
    punchSection.classList.remove('hidden');
    logoutLink.classList.remove('hidden');
    showTodaySection();
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

  // state: 'working' | 'clocked-out' | 'not-working' | 'loading' | null
  function updateButtonStates(state) {
    if (state === 'working') {
      // Currently working - disable clock in, enable clock out
      clockInBtn.disabled = true;
      clockOutBtn.disabled = false;
    } else if (state === 'clocked-out') {
      // Already clocked out - disable both
      clockInBtn.disabled = true;
      clockOutBtn.disabled = true;
    } else if (state === 'not-working') {
      // Not working - enable clock in, disable clock out
      clockInBtn.disabled = false;
      clockOutBtn.disabled = true;
    } else {
      // Unknown/loading state - disable both for safety
      clockInBtn.disabled = true;
      clockOutBtn.disabled = true;
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

  // Update time display
  function updateTimeDisplay() {
    // Update current time
    currentTimeEl.textContent = formatTime(new Date());

    // Update working time if clocked in (and not clocked out), and update summary in real-time
    chrome.storage.local.get(['clockInTimestamp', 'workSummary', 'hasClockedOut'], (result) => {
      // Fix: clockInTimestamp が今日の日付かどうかを検証（古いタイムスタンプによる異常値防止）
      if (result.clockInTimestamp && !result.hasClockedOut && isToday(result.clockInTimestamp)) {
        const clockInDate = new Date(result.clockInTimestamp);
        clockInTimeEl.textContent = formatTimeShort(clockInDate);

        const workingMs = Date.now() - result.clockInTimestamp;
        workingTimeEl.textContent = formatDuration(workingMs);

        // Update summary in real-time if we have summary data
        if (result.workSummary) {
          updateSummaryRealTime(result.workSummary, workingMs, result.clockInTimestamp);
        }
      } else if (!result.clockInTimestamp) {
        clockInTimeEl.textContent = '--:--';
        workingTimeEl.textContent = '--:--:--';
        targetClockOutEl.textContent = '--:--';
      }
      // If hasClockedOut is true, don't update - use the final values set by updateTimeDisplayFinal
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

    // Calculate remaining days (打刻がない所定出勤日をカウント)
    const scheduledDays = parseInt(summary.scheduledDays, 10);
    let actualDays = parseInt(summary.actualDays, 10);
    // 勤務日数は退勤打刻完了日のみカウント
    // この関数は出勤中のリアルタイム更新用なので、当日は含めない
    // remainingWorkdaysがあればそれを使用、なければ従来の計算
    const remainingWorkdays = parseInt(summary.remainingWorkdays, 10);
    const remainingDays = !isNaN(remainingWorkdays) ? remainingWorkdays : (scheduledDays - actualDays);

    // 退勤打刻済み日数と日次残業合計を取得（残業/日の計算に使用）
    const completedDays = parseInt(summary.completedDays, 10);
    const totalDailyOvertimeMinutes = parseInt(summary.totalDailyOvertimeMinutes, 10);

    let requiredMinutesPerDay = 0;

    if (!isNaN(remainingDays)) {
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

    // Update overtime section in real-time
    // actualDaysが0でも、今日の勤務時間があれば表示（月初めの対応）
    const effectiveActualDays = (actualDays === 0 && todayWorkingMinutes > 0) ? 1 : actualDays;
    if (!isNaN(scheduledDays) && !isNaN(effectiveActualDays) && (effectiveActualDays > 0 || todayWorkingMinutes > 0)) {
      updateOvertimeSectionRealTime(realTimeTotalMinutes, scheduledDays, effectiveActualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes);
    }
  }

  // Update overtime section in real-time (uses shared calculateOvertimeData)
  function updateOvertimeSectionRealTime(totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes) {
    const data = calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes);

    // 勤務日数（completedDays: 退勤打刻済み日数を使用）
    const displayDays = (!isNaN(completedDays) && completedDays > 0) ? completedDays : 0;
    actualDaysEl.textContent = `${displayDays}日`;

    // 勤務時間（リアルタイム）
    actualHoursEl.textContent = formatMinutesToTime(totalMinutes);

    // 平均/日
    avgHoursPerDayEl.textContent = formatMinutesToTime(data.avgMinutesPerDay);

    // 残業/日
    avgOvertimePerDayEl.textContent = data.avgOvertimePerDay >= 0
      ? `+${formatMinutesToTime(data.avgOvertimePerDay)}`
      : formatMinutesToTime(data.avgOvertimePerDay);

    // 残業/日の色分け
    avgOvertimePerDayEl.className = 'summary-value';
    avgOvertimePerDayEl.classList.add('overtime-value', data.avgOvertimeLevel);

    // 8h超過累計（健康管理指標）
    dailyExcessTotalEl.textContent = `+${formatMinutesToTime(data.dailyExcessTotal)}`;
    dailyExcessTotalEl.className = 'summary-value';
    if (data.dailyExcessLevel !== 'normal') {
      dailyExcessTotalEl.classList.add('overtime-value', data.dailyExcessLevel);
    }

    // 月間残業（法的）
    legalOvertimeEl.textContent = `+${formatMinutesToTime(data.legalOvertime)}`;
    legalOvertimeEl.className = 'summary-value';
    if (data.legalOvertimeLevel !== 'normal') {
      legalOvertimeEl.classList.add('overtime-value', data.legalOvertimeLevel);
    }

    // 月末予測
    overtimeForecastEl.textContent = data.forecastOvertime >= 0
      ? `+${formatMinutesToTime(data.forecastOvertime)}`
      : formatMinutesToTime(data.forecastOvertime);

    // 月末予測の色分けとアラート・バッジ
    overtimeForecastEl.className = 'summary-value';
    overtimeBadge.className = 'overtime-badge';
    overtimeBadge.textContent = '';

    if (data.forecastLevel === 'exceeded') {
      overtimeForecastEl.classList.add('overtime-value', 'danger');
      forecastRow.classList.add('danger');
      overtimeAlert.classList.remove('hidden', 'warning');
      overtimeAlert.textContent = data.alertText;
      overtimeBadge.classList.add('danger');
      overtimeBadge.textContent = data.badgeText;
    } else if (data.forecastLevel === 'warning') {
      overtimeForecastEl.classList.add('overtime-value', 'danger');
      forecastRow.classList.add('danger');
      overtimeAlert.classList.remove('hidden');
      overtimeAlert.classList.add('warning');
      overtimeAlert.textContent = data.alertText;
      overtimeBadge.classList.add('warning');
      overtimeBadge.textContent = data.badgeText;
    } else {
      overtimeForecastEl.classList.add('overtime-value', 'safe');
      forecastRow.classList.remove('danger');
      overtimeAlert.classList.add('hidden');
      overtimeBadge.classList.add('safe');
      overtimeBadge.textContent = data.badgeText;
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
      const isCurrentlyWorking = !(stored.hasClockedOut && stored.clockOutTimestamp);
      if (stored.hasClockedOut && stored.clockOutTimestamp) {
        showStatus('退勤済み', 'logged-in');
        updateButtonStates('clocked-out');
        timeSection.classList.remove('hidden');
        updateTimeDisplayFinal(stored.clockInTimestamp, stored.clockOutTimestamp);
      } else {
        showStatus('出勤中', 'working');
        updateButtonStates('working');
        showTimeSection();
        updateTimeDisplay();
      }
      if (stored.workSummary) {
        displaySummary(stored.workSummary, isCurrentlyWorking, stored.clockInTimestamp, stored.clockOutTimestamp);
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
        updateButtonStates('working');
        showTimeSection();
        updateTimeDisplay();
        if (fetchResult.summary) {
          displaySummary(fetchResult.summary, true, fetchResult.clockInTimestamp);
        }
      } else if (fetchResult.hasClockedOut && fetchResult.clockOutTimestamp) {
        // User has clocked out today - show final times
        // Fix: clockOutTimestamp の存在も確認（データ不整合防止）
        showStatus('退勤済み', 'logged-in');
        updateButtonStates('clocked-out');
        timeSection.classList.remove('hidden');
        updateTimeDisplayFinal(fetchResult.clockInTimestamp, fetchResult.clockOutTimestamp);
        if (fetchResult.summary) {
          displaySummary(fetchResult.summary, false, fetchResult.clockInTimestamp, fetchResult.clockOutTimestamp);
        }
      } else if (fetchResult.hasClockedOut && !fetchResult.clockOutTimestamp) {
        // Fix: hasClockedOut=true but no clockOutTimestamp - data inconsistency
        console.warn('[TS-Assistant] hasClockedOut=true but clockOutTimestamp is missing');
        showStatus('退勤済み', 'logged-in');
        updateButtonStates('clocked-out');
        hideTimeSection();
        if (fetchResult.summary) {
          // Don't add todayWorkingMinutes - rely on TeamSpirit's totalHours only
          displaySummary(fetchResult.summary, false, null, null);
        }
      } else {
        // User hasn't clocked in today
        showStatus('未出勤', 'logged-in');
        updateButtonStates('not-working');
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
        updateButtonStates('not-working');
        hideTimeSection();
        hideSummarySection();
        showMessage('', '');
      }
    }
  }

  // Display summary data
  // isWorking: true if user is currently working
  // clockInTimestamp: timestamp of clock-in (for real-time calculation)
  // clockOutTimestamp: timestamp of clock-out (for clocked-out calculation)
  function displaySummary(summary, isWorking = false, clockInTimestamp = null, clockOutTimestamp = null) {
    if (!summary) {
      hideSummarySection();
      return;
    }

    // Parse time values first
    const scheduledMinutes = parseTimeToMinutes(summary.scheduledHours);
    let totalMinutes = parseTimeToMinutes(summary.totalHours);
    let todayWorkingMinutes = 0;

    // Add today's working time
    // Fix: 条件を分離 - clockInTimestamp が今日なら todayWorkingMinutes を計算
    // totalMinutes が null でも勤務日数の補正は必要なため、条件から除外
    if (clockInTimestamp && isToday(clockInTimestamp)) {
      if (isWorking) {
        // Currently working: add time from clock-in to now
        todayWorkingMinutes = Math.floor((Date.now() - clockInTimestamp) / 60000);
        // Fix: 安全策 - 1日の最大勤務時間（24時間）を超える場合は異常値とみなす
        const MAX_WORKING_MINUTES_PER_DAY = 24 * 60;
        if (todayWorkingMinutes > MAX_WORKING_MINUTES_PER_DAY) {
          console.warn('[TS-Assistant] todayWorkingMinutes exceeds 24h, likely stale timestamp:', todayWorkingMinutes);
          todayWorkingMinutes = 0;
        }
      } else if (clockOutTimestamp) {
        // Clocked out: add time from clock-in to clock-out
        todayWorkingMinutes = Math.floor((clockOutTimestamp - clockInTimestamp) / 60000);
        // Fix: 安全策 - 1日の最大勤務時間（24時間）を超える場合は異常値とみなす
        const MAX_WORKING_MINUTES_PER_DAY = 24 * 60;
        if (todayWorkingMinutes > MAX_WORKING_MINUTES_PER_DAY) {
          console.warn('[TS-Assistant] todayWorkingMinutes exceeds 24h, likely stale timestamp:', todayWorkingMinutes);
          todayWorkingMinutes = 0;
        }
      } else if (!isWorking) {
        // Fix: 退勤済み（isWorking=false）だが clockOutTimestamp がない場合
        // TeamSpirit の totalHours に今日分が含まれている前提で、加算しない
        console.warn('[TS-Assistant] Clocked out but clockOutTimestamp is missing, relying on TeamSpirit totalHours');
      }
      // totalMinutes への加算は null でない場合のみ
      if (totalMinutes !== null && todayWorkingMinutes > 0) {
        totalMinutes += todayWorkingMinutes;
      }
    }

    // Display basic values
    scheduledHoursEl.textContent = summary.scheduledHours || '--:--';
    // Show total hours with today's working time added
    if (totalMinutes !== null) {
      totalHoursEl.textContent = formatMinutesToTime(totalMinutes);
    } else {
      totalHoursEl.textContent = summary.totalHours || '--:--';
    }

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

    // Calculate remaining days (打刻がない所定出勤日をカウント)
    const scheduledDays = parseInt(summary.scheduledDays, 10);
    const actualDays = parseInt(summary.actualDays, 10);
    // actualDaysはTeamSpiritの値をそのまま使用（加工しない）
    // 勤務日数の表示にはcompletedDays（退勤済み日数）を使用する
    // remainingWorkdaysがあればそれを使用、なければ従来の計算
    const remainingWorkdays = parseInt(summary.remainingWorkdays, 10);
    let remainingDays = !isNaN(remainingWorkdays) ? remainingWorkdays : (scheduledDays - actualDays);

    // 退勤打刻済み日数と日次残業合計を取得（残業/日の計算に使用）
    const completedDays = parseInt(summary.completedDays, 10);
    const totalDailyOvertimeMinutes = parseInt(summary.totalDailyOvertimeMinutes, 10);

    if (!isNaN(remainingDays)) {
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

    // Update overtime section
    updateOvertimeSection(summary, totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes);
  }

  // Hide summary section
  function hideSummarySection() {
    summarySection.classList.add('hidden');
    hideOvertimeSection();
  }

  // Update overtime section (uses shared calculateOvertimeData)
  function updateOvertimeSection(summary, totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes) {
    // actualDaysが0でも、今日の勤務時間があれば表示する（月初めの対応）
    if (totalMinutes === null || ((!actualDays || actualDays === 0) && todayWorkingMinutes === 0)) {
      hideOvertimeSection();
      return;
    }
    // 月初めで実出勤日数が0でも、今日の勤務があれば1日としてカウント
    if (actualDays === 0 && todayWorkingMinutes > 0) {
      actualDays = 1;
    }

    const data = calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes);

    // 勤務日数（completedDays: 退勤打刻済み日数を使用）
    const displayDays = (!isNaN(completedDays) && completedDays > 0) ? completedDays : 0;
    actualDaysEl.textContent = `${displayDays}日`;

    // 勤務時間
    actualHoursEl.textContent = formatMinutesToTime(totalMinutes);

    // 平均/日
    avgHoursPerDayEl.textContent = formatMinutesToTime(data.avgMinutesPerDay);

    // 残業/日
    avgOvertimePerDayEl.textContent = data.avgOvertimePerDay >= 0
      ? `+${formatMinutesToTime(data.avgOvertimePerDay)}`
      : formatMinutesToTime(data.avgOvertimePerDay);

    // 残業/日の色分け
    avgOvertimePerDayEl.className = 'summary-value';
    avgOvertimePerDayEl.classList.add('overtime-value', data.avgOvertimeLevel);

    // 8h超過累計（健康管理指標）
    dailyExcessTotalEl.textContent = `+${formatMinutesToTime(data.dailyExcessTotal)}`;
    dailyExcessTotalEl.className = 'summary-value';
    if (data.dailyExcessLevel !== 'normal') {
      dailyExcessTotalEl.classList.add('overtime-value', data.dailyExcessLevel);
    }

    // 月間残業（法的）
    legalOvertimeEl.textContent = `+${formatMinutesToTime(data.legalOvertime)}`;
    legalOvertimeEl.className = 'summary-value';
    if (data.legalOvertimeLevel !== 'normal') {
      legalOvertimeEl.classList.add('overtime-value', data.legalOvertimeLevel);
    }

    // 月末予測
    overtimeForecastEl.textContent = data.forecastOvertime >= 0
      ? `+${formatMinutesToTime(data.forecastOvertime)}`
      : formatMinutesToTime(data.forecastOvertime);

    // 月末予測の色分けとアラート・バッジ
    overtimeForecastEl.className = 'summary-value';
    overtimeBadge.className = 'overtime-badge';
    overtimeBadge.textContent = '';

    if (data.forecastLevel === 'exceeded') {
      overtimeForecastEl.classList.add('overtime-value', 'danger');
      forecastRow.classList.add('danger');
      overtimeAlert.classList.remove('hidden', 'warning');
      overtimeAlert.textContent = data.alertText;
      overtimeBadge.classList.add('danger');
      overtimeBadge.textContent = data.badgeText;
    } else if (data.forecastLevel === 'warning') {
      overtimeForecastEl.classList.add('overtime-value', 'danger');
      forecastRow.classList.add('danger');
      overtimeAlert.classList.remove('hidden');
      overtimeAlert.classList.add('warning');
      overtimeAlert.textContent = data.alertText;
      overtimeBadge.classList.add('warning');
      overtimeBadge.textContent = data.badgeText;
    } else {
      overtimeForecastEl.classList.add('overtime-value', 'safe');
      forecastRow.classList.remove('danger');
      overtimeAlert.classList.add('hidden');
      overtimeBadge.classList.add('safe');
      overtimeBadge.textContent = data.badgeText;
    }

    // Show overtime section
    overtimeSection.classList.remove('hidden');
  }

  // Hide overtime section
  function hideOvertimeSection() {
    overtimeSection.classList.add('hidden');
  }

  // Update missed punch section
  function updateMissedPunchSection(data) {
    if (!data) {
      missedPunchCount.textContent = '確認中...';
      missedPunchCount.className = 'missed-count';
      missedPunchList.innerHTML = '';
      headerWarning.classList.add('hidden');
      return;
    }

    if (!data.success) {
      missedPunchCount.textContent = '取得失敗';
      missedPunchCount.className = 'missed-count has-missed';
      missedPunchList.innerHTML = '';
      headerWarning.classList.add('hidden');
      return;
    }

    // Update count badge and header warning
    if (data.count === 0) {
      missedPunchCount.textContent = '漏れなし';
      missedPunchCount.className = 'missed-count no-missed';
      missedPunchList.innerHTML = '<div class="missed-punch-empty">打刻漏れはありません</div>';
      headerWarning.classList.add('hidden');
    } else {
      missedPunchCount.textContent = `${data.count}件`;
      missedPunchCount.className = 'missed-count has-missed';
      headerWarning.classList.remove('hidden');

      // Build list HTML
      let listHtml = '';
      data.items.forEach(item => {
        const dateParts = item.date.split('-');
        const month = parseInt(dateParts[1], 10);
        const day = parseInt(dateParts[2], 10);
        const dateDisplay = `${month}/${day} (${item.dayOfWeek})`;

        let labelClass = '';
        let labelText = '';
        if (item.type === 'no-both') {
          labelClass = 'type-both';
          labelText = '出退';
        } else if (item.type === 'no-clock-in') {
          labelClass = 'type-in';
          labelText = '出';
        } else if (item.type === 'no-clock-out') {
          labelClass = 'type-out';
          labelText = '退';
        }

        listHtml += `
          <div class="missed-punch-item">
            <span class="missed-punch-date">${dateDisplay}</span>
            <span class="missed-punch-label ${labelClass}">${labelText}</span>
          </div>
        `;
      });

      missedPunchList.innerHTML = listHtml;
    }

    // Show section
    missedPunchSection.classList.remove('hidden');
  }

  // Hide missed punch section
  function hideMissedPunchSection() {
    missedPunchSection.classList.add('hidden');
  }

  // Load missed punch data (always fetch fresh)
  async function loadMissedPunchData() {
    // Show loading state
    missedPunchCount.textContent = '確認中...';
    missedPunchCount.className = 'missed-count';
    missedPunchList.innerHTML = '';
    missedPunchSection.classList.remove('hidden');

    try {
      // Request fresh data from background
      chrome.runtime.sendMessage({ type: 'CHECK_MISSED_PUNCHES' }, (response) => {
        if (response) {
          updateMissedPunchSection(response);
        } else {
          updateMissedPunchSection({ success: false });
        }
      });
    } catch (e) {
      console.error('Failed to load missed punch data:', e);
      updateMissedPunchSection({ success: false });
    }
  }

  // Load today's workday status
  async function loadTodayWorkday() {
    // Set today's date and day of week immediately
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dayOfWeek = days[today.getDay()];

    todayDateEl.textContent = `${month}/${day}`;
    todayDayOfWeekEl.textContent = `(${dayOfWeek})`;
    todayHolidayEl.textContent = '';
    todayTypeEl.textContent = '確認中...';
    todayTypeEl.className = 'today-type';
    todaySection.classList.remove('hidden');

    try {
      chrome.runtime.sendMessage({ type: 'CHECK_TODAY_WORKDAY' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          todayTypeEl.textContent = '--';
          todayTypeEl.className = 'today-type';
          return;
        }

        // Update holiday name if applicable
        if (response.holidayName) {
          todayHolidayEl.textContent = response.holidayName;
        } else {
          todayHolidayEl.textContent = '';
        }

        // Update type badge (出勤日 or 休日)
        if (response.isWorkday) {
          todayTypeEl.textContent = '出勤日';
          todayTypeEl.className = 'today-type workday';
        } else {
          todayTypeEl.textContent = '休日';
          todayTypeEl.className = 'today-type holiday';
        }
      });
    } catch (e) {
      console.error('Failed to load today workday status:', e);
      todayTypeEl.textContent = '--';
      todayTypeEl.className = 'today-type';
    }
  }

  // Show today section
  function showTodaySection() {
    todaySection.classList.remove('hidden');
    loadTodayWorkday();
  }

  // Hide today section
  function hideTodaySection() {
    todaySection.classList.add('hidden');
  }

  // Expose DOMContentLoaded-scoped items for login.js / punch.js
  window._popupCtx = {
    emailInput, passwordInput, loginBtn, saveCredentialsCheckbox,
    clockInBtn, clockOutBtn,
    showMessage, showPunchSection, showLoginSection, showStatus,
    updateButtonStates, checkPunchStatus, loadMissedPunchData,
    showTimeSection, displaySummary, startTimeUpdates,
    updateTimeDisplayFinal
  };
});
