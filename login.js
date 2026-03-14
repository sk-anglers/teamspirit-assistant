// TeamSpirit Assistant - Login Module
// ログインフロー関連（popup.js から分離）

function waitForLoginRedirect(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('ログインがタイムアウトしました'));
    }, 30000);

    let checkCount = 0;
    const maxChecks = 60;
    let settled = false;

    const checkPage = async () => {
      if (settled) return;
      try {
        const tab = await chrome.tabs.get(tabId);
        const isLoggedIn = (tab.url && (tab.url.includes('lightning.force.com') || tab.url.includes('lightning/page'))) ||
                          (tab.title && tab.title.includes('Salesforce') && !tab.title.includes('Login'));
        if (isLoggedIn) {
          settled = true;
          clearTimeout(timeout);
          await new Promise(r => setTimeout(r, 500));
          resolve();
          return;
        }

        checkCount++;
        if (checkCount >= maxChecks) {
          settled = true;
          clearTimeout(timeout);
          resolve();
          return;
        }

        setTimeout(checkPage, 500);
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    };

    setTimeout(checkPage, 500);
  });
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

async function performLoginProcess(email, password) {
  const { showMessage } = window._popupCtx;
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
      tab = await chrome.tabs.create({ url: CONFIG.MY_DOMAIN_LOGIN_URL, active: false });
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

async function performLogin() {
  const { emailInput, passwordInput, loginBtn, saveCredentialsCheckbox,
          showMessage, showPunchSection, showStatus, checkPunchStatus,
          loadMissedPunchData } = window._popupCtx;
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
      await chrome.storage.local.set({ savedEmail: email });
      // Encrypt and save password
      const encrypted = await encryptPassword(password);
      if (encrypted) {
        await chrome.storage.local.set({ encryptedPassword: encrypted });
        console.log('Credentials saved (encrypted)');
      }
    } else {
      await chrome.storage.local.remove(['savedEmail', 'encryptedPassword']);
      console.log('Credentials removed from storage');
    }

    // Open TeamSpirit in background and login
    const result = await performLoginProcess(email, password);

    if (result.success) {
      await chrome.storage.local.set({ isLoggedIn: true });
      showMessage('ログイン成功', 'success');
      showPunchSection();
      showStatus('ログイン済み', 'logged-in');
      checkPunchStatus();
      loadMissedPunchData();
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
