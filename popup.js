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
        showStatus('ログイン済み', 'logged-in');
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

      if (!tab) {
        // Open TeamSpirit - it will redirect to login if not authenticated
        showMessage('TeamSpiritを開いています...', 'info');
        tab = await chrome.tabs.create({ url: TEAMSPIRIT_URL, active: false });
        autoOpenedTab = true;

        // Wait for the tab to load
        await waitForTabLoad(tab.id);

        // Get updated tab info after redirect
        tab = await chrome.tabs.get(tab.id);
        showMessage('ページ読み込み完了: ' + (tab.url || '').substring(0, 50), 'info');
      }

      // Check if now on login page after redirect
      const isNowOnLoginPage = tab && (
        (tab.url && tab.url.includes('my.salesforce.com')) ||
        (tab.title && tab.title.includes('ログイン'))
      );

      // Wait for content script to be ready
      showMessage('準備中...', 'info');
      await waitForContentScript(tab.id);

      // Check if we're on login page or already logged in
      const pageInfo = await getPageInfo(tab.id);
      showMessage('ページ検出: ' + (pageInfo.pageType || 'unknown'), 'info');

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
      // First try content script message
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'login', email, password }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(resp);
          }
        });
      });

      if (response && response.success !== undefined) {
        return response;
      }

      // Fallback: execute script directly
      console.log('Using direct script execution for login');

      // Check if tab URL is valid
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !tab.url.startsWith('https://')) {
        return { success: false, error: 'ログインページのURLが無効です' };
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (email, password) => {
          try {
            // Find username field
            const usernameField = document.getElementById('username') ||
                                 document.querySelector('input[name="username"]') ||
                                 document.querySelector('input[type="email"]') ||
                                 document.querySelector('input[autocomplete="username"]');

            // Find password field
            const passwordField = document.getElementById('password') ||
                                 document.querySelector('input[name="pw"]') ||
                                 document.querySelector('input[type="password"]');

            // Find login button
            const loginButton = document.getElementById('Login') ||
                               document.querySelector('input[name="Login"]') ||
                               document.querySelector('input[type="submit"]') ||
                               document.querySelector('button[type="submit"]');

            if (!usernameField) {
              return { success: false, error: 'ユーザー名フィールドが見つかりません' };
            }
            if (!passwordField) {
              return { success: false, error: 'パスワードフィールドが見つかりません' };
            }
            if (!loginButton) {
              return { success: false, error: 'ログインボタンが見つかりません' };
            }

            // Fill in credentials
            usernameField.value = email;
            usernameField.dispatchEvent(new Event('input', { bubbles: true }));

            passwordField.value = password;
            passwordField.dispatchEvent(new Event('input', { bubbles: true }));

            // Click login button
            loginButton.click();

            return { success: true };
          } catch (e) {
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
