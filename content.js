// TeamSpirit Assistant - Content Script
// Handles both punch operations and info display panel

(function() {
  'use strict';

  const isMainFrame = (window === window.top);

  // 勤怠ページでは実行しない（無限ループ防止）
  if (window.location.href.includes('AtkWorkTimeTab')) {
    return;
  }

  // 二重実行防止
  if (window.tsAssistantInitialized) {
    return;
  }
  window.tsAssistantInitialized = true;

  // ==================== Configuration ====================
  const CHECK_INTERVAL = 1000;
  const MAX_RETRIES = 60;

  // ==================== State ====================
  let infoPanel = null;
  let retryCount = 0;
  let cachedData = null;
  let updateIntervalId = null;

  // Utility functions and LOCATION_MAP are now in utils.js (loaded before content.js)

  // ==================== Page Detection (for punch) ====================

  function getPageType() {
    const url = window.location.href;
    const isLoginPageUrl =
        url.includes('login.salesforce.com') ||
        (url.includes('my.salesforce.com') && !url.includes('lightning')) ||
        url.includes('/login') ||
        url.includes('secur/frontdoor');

    const hasLoginForm = isLoginPageUrl && (
        document.querySelector('#username') ||
        document.querySelector('input[name="username"]')
    );

    if (isLoginPageUrl && hasLoginForm) {
      return 'login';
    }

    if (url.includes('force.com') || url.includes('salesforce.com') || url.includes('lightning')) {
      return 'teamspirit';
    }

    return 'unknown';
  }

  // ==================== Punch Functions ====================

  function getCurrentStatus() {
    try {
      const clockOutBtn = findPunchButtonByText('退勤');
      const clockInBtn = findPunchButtonByText('出勤');

      if (clockOutBtn && !clockOutBtn.disabled) {
        return { status: '出勤中', isWorking: true };
      } else if (clockInBtn && !clockInBtn.disabled) {
        return { status: '未出勤', isWorking: false };
      }

      return { status: '接続済み', isWorking: false };
    } catch (error) {
      return { status: '状態を取得できません', isWorking: false };
    }
  }

  async function performClockIn(location) {
    try {
      await selectLocation(location);
      await wait(500);

      const clockInBtn = findPunchButtonByText('出勤');
      if (!clockInBtn) {
        throw new Error('出勤ボタンが見つかりません');
      }

      if (clockInBtn.disabled) {
        throw new Error('既に出勤済みです');
      }

      simulateClick(clockInBtn);
      await wait(1000);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function performClockOut(location) {
    try {
      const clockOutBtn = findPunchButtonByText('退勤');
      if (!clockOutBtn) {
        throw new Error('退勤ボタンが見つかりません');
      }

      if (clockOutBtn.disabled) {
        throw new Error('出勤していないため退勤できません');
      }

      simulateClick(clockOutBtn);
      await wait(1000);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function selectLocation(location) {
    const locationText = LOCATION_MAP[location];
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
          await wait(300);
        }
        return;
      }
    }
  }

  function findPunchButtonByText(text) {
    if (text === '出勤') {
      const btn = document.getElementById('btnStInput');
      if (btn) return btn;
    }
    if (text === '退勤') {
      const btn = document.getElementById('btnEtInput');
      if (btn) return btn;
    }

    const buttons = document.querySelectorAll('button, input[type="button"], [role="button"]');
    for (const btn of buttons) {
      const btnText = btn.textContent?.trim() || btn.value?.trim() || '';
      if (btnText === text) {
        return btn;
      }
    }

    return null;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function simulateClick(element) {
    element.focus();

    if (element.onclick) {
      element.onclick();
    }

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    ['mousedown', 'mouseup', 'click'].forEach(eventType => {
      element.dispatchEvent(new MouseEvent(eventType, {
        bubbles: true, cancelable: true, view: window,
        clientX: centerX, clientY: centerY
      }));
    });

    element.click();
  }

  // ==================== Login Functions ====================

  async function performLogin(email, password) {
    try {
      const usernameField = document.getElementById('username') ||
                           document.querySelector('input[name="username"]') ||
                           document.querySelector('input[type="email"]');

      const passwordField = document.getElementById('password') ||
                           document.querySelector('input[name="pw"]') ||
                           document.querySelector('input[type="password"]');

      const loginButton = document.getElementById('Login') ||
                         document.querySelector('input[name="Login"]') ||
                         document.querySelector('input[type="submit"]') ||
                         document.querySelector('button[type="submit"]');

      if (!usernameField) throw new Error('メールアドレス入力欄が見つかりません');
      if (!passwordField) throw new Error('パスワード入力欄が見つかりません');
      if (!loginButton) throw new Error('ログインボタンが見つかりません');

      usernameField.focus();
      usernameField.value = email;
      usernameField.dispatchEvent(new Event('input', { bubbles: true }));

      await wait(300);

      passwordField.focus();
      passwordField.value = password;
      passwordField.dispatchEvent(new Event('input', { bubbles: true }));

      await wait(300);

      loginButton.click();

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== Data Loading ====================

  async function loadDataFromStorage() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve(null);
          return;
        }
        chrome.storage.local.get(['attendanceData', 'lastFetched'], (result) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(result.attendanceData || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function requestDataFetch() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve(null);
          return;
        }
        chrome.runtime.sendMessage({ type: 'FETCH_ATTENDANCE_DATA' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response?.data || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function loadData() {
    let data = await loadDataFromStorage();
    if (!data) {
      data = await requestDataFetch();
    }
    cachedData = data;
    return data;
  }

  // ==================== 打刻漏れデータ ====================

  function updateMissedPunchDisplay(data) {
    if (!infoPanel) return;

    const missedSection = infoPanel.querySelector('#ts-missed-section');
    const missedCountEl = infoPanel.querySelector('#ts-missed-count');
    const missedListEl = infoPanel.querySelector('#ts-missed-list');

    if (!missedSection || !missedCountEl || !missedListEl) return;

    // セクションを表示
    missedSection.style.display = 'block';

    if (!data) {
      missedCountEl.textContent = '確認中...';
      missedCountEl.style.color = '#666';
      missedListEl.innerHTML = '';
      return;
    }

    if (!data.success) {
      missedCountEl.textContent = '取得失敗';
      missedCountEl.style.color = '#d93025';
      missedListEl.innerHTML = '';
      return;
    }

    if (data.count === 0) {
      missedCountEl.textContent = '漏れなし';
      missedCountEl.style.color = '#0d904f';
      missedListEl.innerHTML = '';
      return;
    }

    // 件数表示
    missedCountEl.textContent = `${data.count}件`;
    missedCountEl.style.color = '#d93025';

    // リスト表示（最大5件）
    const maxDisplay = 5;
    const items = data.items.slice(0, maxDisplay);
    let listHtml = '';

    items.forEach(item => {
      // 日付フォーマット: M/D (曜)
      const dateParts = item.date.split('-');
      const month = parseInt(dateParts[1], 10);
      const day = parseInt(dateParts[2], 10);
      const dateDisplay = `${month}/${day} (${item.dayOfWeek})`;

      // ラベルの色分け
      let labelHtml = '';
      if (item.label) {
        let labelColor = '#ea8600'; // デフォルト（オレンジ）
        if (item.type === 'no-both') {
          labelColor = '#d93025'; // 両方漏れは赤
        } else if (item.type === 'no-clock-in') {
          labelColor = '#1a73e8'; // 出勤漏れは青
        } else if (item.type === 'no-clock-out') {
          labelColor = '#ea8600'; // 退勤漏れはオレンジ
        }
        labelHtml = ` <span style="color:${labelColor}; font-weight:600;">${item.label}</span>`;
      }
      listHtml += `<div style="margin-bottom:2px;">${dateDisplay}${labelHtml}</div>`;
    });

    if (data.count > maxDisplay) {
      listHtml += `<div style="color:#999;">他${data.count - maxDisplay}件</div>`;
    }

    missedListEl.innerHTML = listHtml;
  }

  // 打刻漏れデータを直接取得（キャッシュなし）
  async function loadMissedPunchData() {
    // 初期表示
    updateMissedPunchDisplay(null);

    try {
      if (!chrome.runtime?.id) return;

      chrome.runtime.sendMessage({ type: 'CHECK_MISSED_PUNCHES' }, (response) => {
        if (chrome.runtime.lastError) {
          updateMissedPunchDisplay({ success: false });
          return;
        }
        updateMissedPunchDisplay(response);
      });
    } catch (e) {
      updateMissedPunchDisplay({ success: false });
    }
  }

  // ==================== 本日情報表示 ====================

  function updateTodayDisplay(data) {
    if (!infoPanel) return;

    const todayDateEl = infoPanel.querySelector('#ts-today-date');
    const todayHolidayEl = infoPanel.querySelector('#ts-today-holiday');
    const todayTypeEl = infoPanel.querySelector('#ts-today-type');

    if (!todayDateEl || !todayTypeEl) return;

    // 日付と曜日を即座に設定
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dayOfWeek = days[today.getDay()];
    todayDateEl.textContent = `${month}/${day} (${dayOfWeek})`;

    if (!data || !data.success) {
      todayTypeEl.textContent = '--';
      todayTypeEl.style.background = '#f5f5f5';
      todayTypeEl.style.color = '#666';
      if (todayHolidayEl) todayHolidayEl.textContent = '';
      return;
    }

    // 祝日名を表示
    if (todayHolidayEl) {
      todayHolidayEl.textContent = data.holidayName || '';
    }

    // 出勤日/休日バッジ
    if (data.isWorkday) {
      todayTypeEl.textContent = '出勤日';
      todayTypeEl.style.background = '#e8f0fe';
      todayTypeEl.style.color = '#1a73e8';
    } else {
      todayTypeEl.textContent = '休日';
      todayTypeEl.style.background = '#f5f5f5';
      todayTypeEl.style.color = '#666';
    }
  }

  // 本日情報を取得
  async function loadTodayWorkday() {
    // 初期表示（日付と曜日だけ）
    updateTodayDisplay(null);

    try {
      if (!chrome.runtime?.id) return;

      chrome.runtime.sendMessage({ type: 'CHECK_TODAY_WORKDAY' }, (response) => {
        if (chrome.runtime.lastError) {
          updateTodayDisplay(null);
          return;
        }
        updateTodayDisplay(response);
      });
    } catch (e) {
      updateTodayDisplay(null);
    }
  }

  // ==================== Info Panel UI ====================

  function createInfoPanel() {
    const panel = document.createElement('div');
    panel.id = 'ts-info-display';
    panel.innerHTML = `
      <div style="display:flex; gap:20px; font-size:12px; font-family:sans-serif;">
        <!-- 勤怠情報欄 -->
        <div style="min-width:100px;">
          <div style="font-weight:bold; color:#1a73e8; border-bottom:2px solid #1a73e8; padding-bottom:3px; margin-bottom:6px;">勤怠情報</div>
          <div id="ts-today-row" style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px;">
            <span id="ts-today-date" style="font-weight:600;">--/-- (-)</span>
            <span id="ts-today-holiday" style="font-size:10px; color:#d93025;"></span>
            <span id="ts-today-type" style="font-size:10px; padding:2px 6px; border-radius:8px; background:#e8f0fe; color:#1a73e8;">--</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <span style="color:#666;">状態</span>
            <span class="status-badge not-started" id="ts-status-badge">読込中</span>
          </div>
        </div>

        <!-- 時刻欄 -->
        <div id="ts-time-section" style="min-width:130px; display:none;">
          <div style="font-weight:bold; color:#1a73e8; border-bottom:2px solid #1a73e8; padding-bottom:3px; margin-bottom:6px;">時刻</div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">現在</span>
            <span style="font-weight:600;" id="ts-current-time">--:--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">出勤</span>
            <span style="font-weight:600;" id="ts-clock-in">--:--</span>
          </div>
          <div id="ts-clock-out-row" style="display:none; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">退勤</span>
            <span style="font-weight:600;" id="ts-clock-out">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">勤務時間</span>
            <span style="font-weight:600; color:#1a73e8;" id="ts-working-time">--:--:--</span>
          </div>
          <div id="ts-target-row" style="display:flex; justify-content:space-between; gap:10px;">
            <span style="color:#666;">目標退勤</span>
            <span style="font-weight:600; color:#ea8600;" id="ts-target-time">--:--</span>
          </div>
        </div>

        <!-- 月間サマリー欄 -->
        <div id="ts-summary-section" style="min-width:170px; display:none;">
          <div style="font-weight:bold; color:#1a73e8; border-bottom:2px solid #1a73e8; padding-bottom:3px; margin-bottom:6px;">月間サマリー</div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">所定労働時間</span>
            <span style="font-weight:600;" id="ts-scheduled-hours">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">総労働時間</span>
            <span style="font-weight:600;" id="ts-total-hours">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">過不足時間</span>
            <span style="font-weight:600;" id="ts-over-under">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">残り勤務日数</span>
            <span style="font-weight:600;" id="ts-remaining-days">--日</span>
          </div>
          <div style="display:flex; justify-content:space-between; gap:10px;">
            <span style="color:#666;">一日当たり必要</span>
            <span style="font-weight:600; color:#ea8600;" id="ts-required-per-day">--:--</span>
          </div>
        </div>

        <!-- 残業警告欄 -->
        <div id="ts-overtime-section" style="min-width:150px; display:none;">
          <div style="font-weight:bold; color:#1a73e8; border-bottom:2px solid #1a73e8; padding-bottom:3px; margin-bottom:6px;">残業警告</div>
          <div id="ts-overtime-alert" style="display:none; background:#d93025; color:#fff; padding:4px 8px; border-radius:4px; margin-bottom:6px; font-size:11px; font-weight:600; text-align:center;">
            <!-- 45時間超過アラート -->
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">勤務日数</span>
            <span style="font-weight:600;" id="ts-actual-days">--日</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">勤務時間</span>
            <span style="font-weight:600;" id="ts-actual-hours">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">平均/日</span>
            <span style="font-weight:600;" id="ts-avg-hours-per-day">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">残業/日</span>
            <span style="font-weight:600;" id="ts-avg-overtime-per-day">--:--</span>
          </div>
          <div style="border-top:1px solid #e0e0e0; margin:6px 0;"></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">8h超過累計</span>
            <span style="font-weight:600;" id="ts-daily-excess-total">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">月間残業</span>
            <span style="font-weight:600;" id="ts-legal-overtime">--:--</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:3px; gap:10px;">
            <span style="color:#666;">残業上限</span>
            <span style="font-weight:600; color:#666;">45:00</span>
          </div>
          <div style="display:flex; justify-content:space-between; gap:10px;">
            <span style="color:#666;">月末予測</span>
            <span style="font-weight:600;" id="ts-overtime-forecast">--:--</span>
          </div>
        </div>

        <!-- 打刻漏れ欄 -->
        <div id="ts-missed-section" style="min-width:120px; display:none;">
          <div style="font-weight:bold; color:#1a73e8; border-bottom:2px solid #1a73e8; padding-bottom:3px; margin-bottom:6px;">打刻漏れ</div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; gap:10px;">
            <span style="color:#666;">件数</span>
            <span style="font-weight:600;" id="ts-missed-count">確認中...</span>
          </div>
          <div id="ts-missed-list" style="font-size:11px; color:#666;">
            <!-- 漏れリストがここに入る -->
          </div>
        </div>
      </div>
    `;
    return panel;
  }

  // ==================== Display Update ====================

  function updateDisplay() {
    if (!infoPanel) return;

    const data = cachedData;
    const statusBadge = infoPanel.querySelector('#ts-status-badge');
    const timeSection = infoPanel.querySelector('#ts-time-section');
    const currentTimeEl = infoPanel.querySelector('#ts-current-time');
    const clockInEl = infoPanel.querySelector('#ts-clock-in');
    const clockOutRow = infoPanel.querySelector('#ts-clock-out-row');
    const clockOutEl = infoPanel.querySelector('#ts-clock-out');
    const workingTimeEl = infoPanel.querySelector('#ts-working-time');
    const targetRow = infoPanel.querySelector('#ts-target-row');
    const targetTimeEl = infoPanel.querySelector('#ts-target-time');
    const summarySection = infoPanel.querySelector('#ts-summary-section');

    // 現在時刻を常に更新
    if (currentTimeEl) {
      const now = new Date();
      currentTimeEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    }

    if (!data) {
      statusBadge.textContent = '読込中';
      statusBadge.className = 'status-badge not-started';
      return;
    }

    if (data.isWorking && data.clockInTime) {
      statusBadge.textContent = '出勤中';
      statusBadge.className = 'status-badge working';
      timeSection.style.display = 'block';
      clockOutRow.style.display = 'none';
      targetRow.style.display = 'flex';
      clockInEl.textContent = data.clockInTime;

      const clockInDate = parseTimeToDate(data.clockInTime);
      if (clockInDate) {
        // 日跨ぎ対応: 出勤時刻が現在時刻より後なら前日として扱う
        const now = new Date();
        if (clockInDate > now) {
          clockInDate.setDate(clockInDate.getDate() - 1);
        }
        const workingMs = Date.now() - clockInDate.getTime();
        // 異常値チェック: マイナスまたは24時間超過は表示しない
        if (workingMs > 0 && workingMs < 24 * 60 * 60 * 1000) {
          workingTimeEl.textContent = formatDuration(workingMs);
        } else {
          workingTimeEl.textContent = '--:--:--';
        }
      }
    } else if (data.clockOutTime && data.clockInTime) {
      statusBadge.textContent = '退勤済';
      statusBadge.className = 'status-badge finished';
      timeSection.style.display = 'block';
      clockOutRow.style.display = 'flex';
      targetRow.style.display = 'none';
      clockInEl.textContent = data.clockInTime;
      clockOutEl.textContent = data.clockOutTime;

      const clockInDate = parseTimeToDate(data.clockInTime);
      const clockOutDate = parseTimeToDate(data.clockOutTime);
      if (clockInDate && clockOutDate) {
        // 日跨ぎ対応: 退勤時刻が出勤時刻より前なら退勤は翌日として扱う
        if (clockOutDate < clockInDate) {
          clockOutDate.setDate(clockOutDate.getDate() + 1);
        }
        const workingMs = clockOutDate.getTime() - clockInDate.getTime();
        // 異常値チェック: マイナスまたは24時間超過は表示しない
        if (workingMs > 0 && workingMs < 24 * 60 * 60 * 1000) {
          workingTimeEl.textContent = formatDuration(workingMs);
        } else {
          workingTimeEl.textContent = '--:--:--';
        }
      }
    } else {
      statusBadge.textContent = '未出勤';
      statusBadge.className = 'status-badge not-started';
      timeSection.style.display = 'none';
    }

    // サマリー更新
    const summary = data.summary;
    if (summary) {
      summarySection.style.display = 'block';

      infoPanel.querySelector('#ts-scheduled-hours').textContent = summary.scheduledHours || '--:--';

      const scheduledMinutes = parseTimeToMinutes(summary.scheduledHours);
      const totalMinutes = parseTimeToMinutes(summary.totalHours);
      const overUnderEl = infoPanel.querySelector('#ts-over-under');
      const totalHoursEl = infoPanel.querySelector('#ts-total-hours');

      let currentTotalMinutes = totalMinutes || 0;
      let todayWorkingMinutes = 0;
      // 本日分勤務時間の加算
      // TeamSpiritのtotalHoursは前日までの累計（本日分を含まない）前提
      // 出勤中の場合のみ、リアルタイムで本日分を加算する
      // 退勤済みの場合、TeamSpiritの値に既に本日分が含まれている可能性があるため加算しない
      if (data.clockInTime && totalMinutes !== null && data.isWorking) {
        const clockInDate = parseTimeToDate(data.clockInTime);
        if (clockInDate) {
          // 日跨ぎ対応: 出勤時刻が現在時刻より後なら前日として扱う
          const now = new Date();
          if (clockInDate > now) {
            clockInDate.setDate(clockInDate.getDate() - 1);
          }
          // Currently working: add time from clock-in to now
          todayWorkingMinutes = Math.floor((Date.now() - clockInDate.getTime()) / 60000);
          // 異常値チェック（24時間超過は異常）
          const MAX_WORKING_MINUTES = 24 * 60;
          if (todayWorkingMinutes > 0 && todayWorkingMinutes < MAX_WORKING_MINUTES) {
            currentTotalMinutes += todayWorkingMinutes;
          }
        }
      }

      if (totalMinutes !== null) {
        totalHoursEl.textContent = formatMinutesToTime(currentTotalMinutes);
      } else {
        totalHoursEl.textContent = summary.totalHours || '--:--';
      }

      if (scheduledMinutes !== null && totalMinutes !== null) {
        const overUnderMinutes = currentTotalMinutes - scheduledMinutes;
        overUnderEl.textContent = overUnderMinutes >= 0 ? `+${formatMinutesToTime(overUnderMinutes)}` : formatMinutesToTime(overUnderMinutes);
        overUnderEl.style.color = overUnderMinutes >= 0 ? '#0d904f' : '#d93025';
      }

      const scheduledDays = parseInt(summary.scheduledDays, 10);
      const actualDays = parseInt(summary.actualDays, 10);
      // Note: actualDaysへの+1加工は削除。勤務日数表示にはcompletedDaysを使用する
      // remainingWorkdaysがあればそれを使用、なければ従来の計算
      const remainingWorkdays = parseInt(summary.remainingWorkdays, 10);
      const remainingDays = !isNaN(remainingWorkdays) ? remainingWorkdays : (scheduledDays - actualDays);

      // 退勤打刻済み日数と日次残業合計を取得（残業/日の計算に使用）
      // NaNチェック: parseIntが失敗した場合は0として扱う
      const completedDaysRaw = parseInt(summary.completedDays, 10);
      const completedDays = isNaN(completedDaysRaw) ? 0 : completedDaysRaw;
      const totalDailyOvertimeRaw = parseInt(summary.totalDailyOvertimeMinutes, 10);
      const totalDailyOvertimeMinutes = isNaN(totalDailyOvertimeRaw) ? 0 : totalDailyOvertimeRaw;

      if (!isNaN(remainingDays)) {
        infoPanel.querySelector('#ts-remaining-days').textContent = `${remainingDays}日`;

        if (remainingDays > 0 && scheduledMinutes !== null) {
          const remainingMinutes = scheduledMinutes - currentTotalMinutes;
          if (remainingMinutes > 0) {
            const requiredMinutesPerDay = Math.ceil(remainingMinutes / remainingDays);
            infoPanel.querySelector('#ts-required-per-day').textContent = formatMinutesToTime(requiredMinutesPerDay);

            if (data.isWorking && data.clockInTime) {
              const clockInDate = parseTimeToDate(data.clockInTime);
              if (clockInDate) {
                const targetMs = clockInDate.getTime() + (requiredMinutesPerDay + 60) * 60 * 1000;
                targetTimeEl.textContent = formatTimeShort(new Date(targetMs));
              }
            }
          } else {
            infoPanel.querySelector('#ts-required-per-day').textContent = '達成';
            infoPanel.querySelector('#ts-required-per-day').style.color = '#0d904f';
            targetTimeEl.textContent = '達成';
          }
        }
      }

      // 残業警告セクション更新
      updateOvertimeSection(summary, currentTotalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes);
    } else {
      summarySection.style.display = 'none';
      // サマリーがない場合は残業セクションも非表示
      const overtimeSection = infoPanel.querySelector('#ts-overtime-section');
      if (overtimeSection) overtimeSection.style.display = 'none';
    }
  }

  // 残業警告セクションの更新 (uses shared calculateOvertimeData)
  function updateOvertimeSection(summary, currentTotalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes) {
    if (!infoPanel) return;

    const overtimeSection = infoPanel.querySelector('#ts-overtime-section');
    if (!overtimeSection) return;

    // actualDaysが0でも、今日の勤務時間があれば表示する（月初めの対応）
    if ((!actualDays || actualDays === 0) && todayWorkingMinutes === 0) {
      overtimeSection.style.display = 'none';
      return;
    }
    // Note: actualDays の補正は呼び出し元（665-670行）で実施済み

    overtimeSection.style.display = 'block';

    const data = calculateOvertimeData(currentTotalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes);

    // 各要素を取得
    const actualDaysEl = infoPanel.querySelector('#ts-actual-days');
    const actualHoursEl = infoPanel.querySelector('#ts-actual-hours');
    const avgHoursPerDayEl = infoPanel.querySelector('#ts-avg-hours-per-day');
    const avgOvertimePerDayEl = infoPanel.querySelector('#ts-avg-overtime-per-day');
    const dailyExcessTotalEl = infoPanel.querySelector('#ts-daily-excess-total');
    const legalOvertimeEl = infoPanel.querySelector('#ts-legal-overtime');
    const overtimeForecastEl = infoPanel.querySelector('#ts-overtime-forecast');
    const overtimeAlertEl = infoPanel.querySelector('#ts-overtime-alert');

    // 勤務日数（completedDays = 退勤打刻済み日数を使用）
    actualDaysEl.textContent = `${completedDays}日`;

    // 勤務時間（リアルタイム）
    actualHoursEl.textContent = formatMinutesToTime(currentTotalMinutes);

    // 平均/日
    avgHoursPerDayEl.textContent = formatMinutesToTime(data.avgMinutesPerDay);

    // 残業/日
    avgOvertimePerDayEl.textContent = data.avgOvertimePerDay >= 0
      ? `+${formatMinutesToTime(data.avgOvertimePerDay)}`
      : formatMinutesToTime(data.avgOvertimePerDay);

    // 残業/日の色分け（inline style for content script）
    const avgOvertimeColors = { danger: '#d93025', warning: '#ea8600', caution: '#f9ab00', safe: '#0d904f' };
    avgOvertimePerDayEl.style.color = avgOvertimeColors[data.avgOvertimeLevel];

    // 8h超過累計（健康管理指標）
    dailyExcessTotalEl.textContent = `+${formatMinutesToTime(data.dailyExcessTotal)}`;
    const dailyExcessColors = { danger: '#d93025', warning: '#ea8600', normal: '#666' };
    dailyExcessTotalEl.style.color = dailyExcessColors[data.dailyExcessLevel];

    // 月間残業（法的）
    legalOvertimeEl.textContent = `+${formatMinutesToTime(data.legalOvertime)}`;
    const legalColors = { danger: '#d93025', warning: '#ea8600', normal: '#666' };
    legalOvertimeEl.style.color = legalColors[data.legalOvertimeLevel];

    // 月末予測
    overtimeForecastEl.textContent = data.forecastOvertime >= 0
      ? `+${formatMinutesToTime(data.forecastOvertime)}`
      : formatMinutesToTime(data.forecastOvertime);

    // 月末予測の色分けとアラート
    if (data.forecastLevel === 'exceeded') {
      overtimeForecastEl.style.color = '#d93025';
      overtimeAlertEl.style.display = 'block';
      overtimeAlertEl.style.background = '#d93025';
      overtimeAlertEl.textContent = data.alertText;
    } else if (data.forecastLevel === 'warning') {
      overtimeForecastEl.style.color = '#d93025';
      overtimeAlertEl.style.display = 'block';
      overtimeAlertEl.style.background = '#ea8600';
      overtimeAlertEl.textContent = data.alertText;
    } else {
      overtimeForecastEl.style.color = '#0d904f';
      overtimeAlertEl.style.display = 'none';
    }
  }

  // ==================== Panel Common ====================

  // パネル初期化後の共通処理（データ読み込み・タイマー開始）
  function initPanelData() {
    loadData().then(() => updateDisplay());
    loadTodayWorkday();
    loadMissedPunchData();

    // 既存のタイマーをクリアしてから新規作成
    if (updateIntervalId) {
      clearInterval(updateIntervalId);
    }
    updateIntervalId = setInterval(updateDisplay, 1000);
  }

  // 既存のパネルをクリーンアップ
  function cleanupPanel() {
    if (updateIntervalId) {
      clearInterval(updateIntervalId);
      updateIntervalId = null;
    }
    infoPanel = null;
    const existingDisplay = document.getElementById('ts-info-display');
    if (existingDisplay) existingDisplay.remove();
    const existingContainer = document.getElementById('ts-info-container');
    if (existingContainer) existingContainer.remove();
  }

  // ==================== Panel Injection ====================

  function findAndInjectPanelInMainFrame() {
    if (document.getElementById('ts-info-display')) {
      return;
    }

    // TeamSpiritのVisualforceページコンポーネントを探す
    const tsSection = document.querySelector('[data-component-id="flexipage_visualforcePage"]') ||
                      document.querySelector('.flexipageComponent[data-component-id*="visualforce"]');

    if (!tsSection) {
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        setTimeout(findAndInjectPanelInMainFrame, CHECK_INTERVAL);
      } else {
        // リトライ上限到達 → フォールバック（固定位置表示）
        console.log('[TS-Assistant] リトライ上限到達、フォールバック表示');
        showFixedPanel();
      }
      return;
    }

    console.log('[TS-Assistant] TeamSpiritセクション発見！パネル挿入開始');

    // 独立したセクションとしてパネルを作成
    const panelContainer = document.createElement('div');
    panelContainer.id = 'ts-info-container';
    panelContainer.style.cssText = `
      background: #fff;
      border: 1px solid #d8dde6;
      border-radius: 0.25rem;
      margin: 12px 0;
      padding: 15px 20px;
      box-shadow: 0 2px 2px 0 rgba(0,0,0,0.1);
    `;

    infoPanel = createInfoPanel();
    infoPanel.style.padding = '0';
    infoPanel.style.border = 'none';

    panelContainer.appendChild(infoPanel);

    // TeamSpiritセクションの後ろに挿入
    tsSection.parentNode.insertBefore(panelContainer, tsSection.nextSibling);

    try {
      if (chrome.runtime?.id) {
        chrome.storage.local.set({ panelEmbedded: true });
      }
    } catch (e) {}

    console.log('[TS-Assistant] パネル埋め込み完了');
    initPanelData();
  }

  // ==================== Fallback Panel (Main Frame) ====================

  function showFixedPanel() {
    if (document.getElementById('ts-info-display')) return;

    console.log('[TS-Assistant] フォールバック: 固定位置で表示');
    infoPanel = createInfoPanel();
    infoPanel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 10000;
      background: #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,0.15);
      border-radius: 8px;
      padding: 15px;
      border: 1px solid #e0e0e0;
      min-width: 200px;
    `;
    document.body.appendChild(infoPanel);
    initPanelData();
  }

  // ==================== Message Listener (for punch operations) ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const pageType = getPageType();

    if (request.action === 'ping') {
      sendResponse({ ready: true, pageType, url: window.location.href });
      return;
    }

    if (request.action === 'getPageInfo') {
      sendResponse({
        isLoginPage: pageType === 'login',
        isTeamSpiritPage: pageType === 'teamspirit',
        pageType: pageType,
        url: window.location.href,
        title: document.title
      });
      return;
    }

    if (request.action === 'getStatus') {
      const status = getCurrentStatus();
      sendResponse(status);
      return;
    }

    if (request.action === 'login') {
      performLogin(request.email, request.password).then(result => {
        sendResponse(result);
      });
      return true;
    }

    if (request.action === 'clockIn') {
      performClockIn(request.location).then(result => {
        sendResponse(result);
      });
      return true;
    }

    if (request.action === 'clockOut') {
      performClockOut(request.location).then(result => {
        sendResponse(result);
      });
      return true;
    }
  });

  // ==================== Initialization ====================

  // 拡張機能コンテキストが有効かチェック
  function isExtensionContextValid() {
    return !!(chrome.runtime?.id);
  }

  if (isMainFrame) {
    console.log('[TS-Assistant] メインフレーム初期化');

    // パネル挿入を試みる関数
    function tryInjectPanel() {
      if (!isExtensionContextValid()) return;

      // 既存のパネルをクリーンアップ（タイマー・DOM要素・状態変数）
      cleanupPanel();

      retryCount = 0;
      findAndInjectPanelInMainFrame();
    }

    // 初回挿入（2秒後）
    setTimeout(tryInjectPanel, 2000);

    // URL変更を監視（SPA対応）
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[TS-Assistant] URL変更検出:', location.href);

        // ホーム以外に移動した場合、パネルをクリーンアップ
        if (!location.href.includes('/lightning/page/home')) {
          cleanupPanel();
        }

        // ホーム画面に戻った場合、パネルを再挿入
        if (location.href.includes('/lightning/page/home')) {
          setTimeout(tryInjectPanel, 2000);
        }
      }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('beforeunload', () => {
      try {
        if (isExtensionContextValid()) {
          chrome.storage.local.remove(['panelEmbedded']);
        }
      } catch (e) {}
    });
  }
  // iframeでは何もしない（メインフレームで処理）

  // ストレージ変更監視
  try {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (!isExtensionContextValid()) return;
      if (namespace === 'local') {
        if (changes.attendanceData) {
          cachedData = changes.attendanceData.newValue;
          updateDisplay();
        }
        // 退勤状態の変更を監視（ポップアップからの退勤打刻を即時反映）
        if (changes.hasClockedOut && changes.hasClockedOut.newValue === true) {
          chrome.storage.local.get(['clockInTimestamp', 'clockOutTimestamp'], (result) => {
            if (cachedData && result.clockInTimestamp && result.clockOutTimestamp) {
              cachedData.isWorking = false;
              const clockOutDate = new Date(result.clockOutTimestamp);
              cachedData.clockOutTime = `${String(clockOutDate.getHours()).padStart(2, '0')}:${String(clockOutDate.getMinutes()).padStart(2, '0')}`;
              updateDisplay();
            }
          });
        }
      }
    });
  } catch (e) {}

  console.log('[TS-Assistant] Content script loaded on', getPageType(), 'page');
})();
