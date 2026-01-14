const TEAMSPIRIT_URL = 'https://teamspirit-74532.lightning.force.com/lightning/page/home';
const LOGIN_URL = 'https://login.salesforce.com/';

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const loginSection = document.getElementById('loginSection');
  const punchSection = document.getElementById('punchSection');
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
    if (existingTab && existingTab.url && existingTab.url.includes('lightning.force.com')) {
      // TeamSpirit is already open, user is likely logged in
      await chrome.storage.local.set({ isLoggedIn: true });
      showPunchSection();
      showStatus('ログイン済み', 'logged-in');
      return;
    }

    // Check if we have saved credentials and logged in state
    if (stored.isLoggedIn && stored.credentials) {
      showPunchSection();
      showStatus('ログイン済み', 'logged-in');
    } else if (stored.credentials) {
      // Has credentials but not logged in
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
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus('ログイン済み', 'logged-in');
            return;
          }
          if (response && response.status) {
            showStatus(response.status, response.isWorking ? 'working' : 'logged-in');
          }
        });
      } else {
        showStatus('ログイン済み', 'logged-in');
      }
    } catch (error) {
      showStatus('ログイン済み', 'logged-in');
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

      if (!tab) {
        // Open TeamSpirit - it will redirect to login if not authenticated
        showMessage('TeamSpiritを開いています...', 'info');
        tab = await chrome.tabs.create({ url: TEAMSPIRIT_URL, active: false });
        autoOpenedTab = true;

        // Wait for the tab to load
        await waitForTabLoad(tab.id);
      }

      // Wait for content script
      await waitForContentScript(tab.id);

      // Check if we're on login page or already logged in
      const pageInfo = await getPageInfo(tab.id);

      if (pageInfo.isLoginPage) {
        // We're on login page, fill in credentials
        showMessage('ログイン情報を入力中...', 'info');
        const loginResult = await sendLoginCommand(tab.id, email, password);

        if (!loginResult.success) {
          if (autoOpenedTab) {
            await chrome.tabs.remove(tab.id);
          }
          return loginResult;
        }

        // Wait for redirect after login
        showMessage('ログイン処理中...', 'info');
        await waitForLoginRedirect(tab.id);

        // Verify we're now on TeamSpirit page
        const newPageInfo = await getPageInfo(tab.id);
        if (newPageInfo.isTeamSpiritPage) {
          return { success: true };
        } else if (newPageInfo.isLoginPage) {
          return { success: false, error: 'ログインに失敗しました。認証情報を確認してください。' };
        }
      } else if (pageInfo.isTeamSpiritPage) {
        // Already logged in
        return { success: true };
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

        // Close auto-opened tab
        if (autoOpenedTab) {
          setTimeout(async () => {
            try {
              await chrome.tabs.remove(autoOpenedTab.id);
            } catch (e) {}
          }, 1500);
        }

        checkPunchStatus();
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
    } finally {
      btn.disabled = false;
      clockInBtn.disabled = false;
      clockOutBtn.disabled = false;
      btn.classList.remove('loading');
    }
  }

  async function findTeamSpiritTab() {
    const tabs = await chrome.tabs.query({
      url: [
        'https://teamspirit-74532.lightning.force.com/*',
        'https://login.salesforce.com/*',
        'https://*.salesforce.com/*'
      ]
    });
    return tabs[0] || null;
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

  async function waitForContentScript(tabId, maxRetries = 20) {
    let retries = 0;
    let injected = false;

    while (retries < maxRetries) {
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
      if (!injected && retries >= 3) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });
          injected = true;
          console.log('Content script injected manually');
        } catch (e) {
          console.log('Failed to inject content script:', e);
        }
      }

      retries++;
      await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error('ページの読み込みに失敗しました');
  }

  function getPageInfo(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ isLoginPage: false, isTeamSpiritPage: false });
        } else {
          resolve(response);
        }
      });
    });
  }

  function sendLoginCommand(tabId, email, password) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'login', email, password }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: 'ログインページとの通信に失敗しました' });
        } else {
          resolve(response || { success: false, error: '応答がありません' });
        }
      });
    });
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
          if (tab.url && tab.url.includes('lightning.force.com')) {
            clearTimeout(timeout);
            // Wait for page to fully load
            await waitForTabLoad(tabId);
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
