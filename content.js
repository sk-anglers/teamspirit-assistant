// TeamSpirit Quick Punch - Content Script
// This script interacts with both login page and TeamSpirit page

(function() {
  'use strict';

  // Location mapping
  const LOCATION_MAP = {
    'remote': 'リモート',
    'office': 'オフィス',
    'direct-to-office': '直行→オフィス',
    'office-to-direct': 'オフィス→直帰',
    'direct': '直行直帰'
  };

  // Detect current page type
  function getPageType() {
    const url = window.location.href;
    const title = document.title || '';

    // Check for login page indicators (URL-based first, more reliable)
    const isLoginPageUrl =
        url.includes('login.salesforce.com') ||
        (url.includes('my.salesforce.com') && !url.includes('lightning')) ||
        url.includes('/login') ||
        url.includes('secur/frontdoor');

    // Only check form elements if URL suggests login page
    const hasLoginForm = isLoginPageUrl && (
        document.querySelector('#username') ||
        document.querySelector('input[name="username"]')
    );

    if (isLoginPageUrl && hasLoginForm) {
      return 'login';
    }

    // Check for TeamSpirit/Salesforce main page - be more permissive
    if (url.includes('force.com') ||
        url.includes('salesforce.com') ||
        url.includes('lightning')) {
      return 'teamspirit';
    }

    return 'unknown';
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const pageType = getPageType();

    console.log('Content script received:', request.action, 'pageType:', pageType, 'url:', window.location.href);

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
      // Allow login attempt regardless of detected page type
      performLogin(request.email, request.password).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (request.action === 'clockIn') {
      // Try to punch regardless of page type - will fail with specific error if buttons not found
      performClockIn(request.location).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (request.action === 'clockOut') {
      // Try to punch regardless of page type - will fail with specific error if buttons not found
      performClockOut(request.location).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
  });

  // ==================== Login Functions ====================

  async function performLogin(email, password) {
    try {
      console.log('Attempting login on page:', window.location.href);

      // Find username/email field - try multiple selectors
      const usernameField = document.getElementById('username') ||
                           document.querySelector('input[name="username"]') ||
                           document.querySelector('input[name="email"]') ||
                           document.querySelector('input[type="email"]') ||
                           document.querySelector('input[autocomplete="username"]') ||
                           document.querySelector('input[autocomplete="email"]') ||
                           document.querySelector('input.username') ||
                           document.querySelector('[placeholder*="ユーザ"]') ||
                           document.querySelector('[placeholder*="メール"]') ||
                           document.querySelector('[placeholder*="email" i]') ||
                           document.querySelector('[placeholder*="username" i]');

      // Find password field
      const passwordField = document.getElementById('password') ||
                           document.querySelector('input[name="pw"]') ||
                           document.querySelector('input[name="password"]') ||
                           document.querySelector('input[type="password"]') ||
                           document.querySelector('input.password') ||
                           document.querySelector('[autocomplete="current-password"]');

      // Find login button - try multiple selectors
      const loginButton = document.getElementById('Login') ||
                         document.querySelector('input[name="Login"]') ||
                         document.querySelector('input[type="submit"]') ||
                         document.querySelector('button[type="submit"]') ||
                         document.querySelector('button[name="Login"]') ||
                         document.querySelector('#login-button') ||
                         document.querySelector('.login-button') ||
                         document.querySelector('button.slds-button') ||
                         document.querySelector('[value="ログイン"]') ||
                         document.querySelector('[value="Log In"]') ||
                         findButtonByText('ログイン') ||
                         findButtonByText('Log In') ||
                         findButtonByText('Login');

      console.log('Found elements:', {
        username: !!usernameField,
        password: !!passwordField,
        loginButton: !!loginButton
      });

      if (!usernameField) {
        // List available inputs for debugging
        const inputs = document.querySelectorAll('input');
        console.log('Available inputs:', Array.from(inputs).map(i => ({
          id: i.id,
          name: i.name,
          type: i.type,
          placeholder: i.placeholder
        })));
        throw new Error('メールアドレス入力欄が見つかりません');
      }

      if (!passwordField) {
        throw new Error('パスワード入力欄が見つかりません');
      }

      if (!loginButton) {
        // List available buttons for debugging
        const buttons = document.querySelectorAll('button, input[type="submit"]');
        console.log('Available buttons:', Array.from(buttons).map(b => ({
          id: b.id,
          name: b.name,
          type: b.type,
          value: b.value,
          text: b.textContent
        })));
        throw new Error('ログインボタンが見つかりません');
      }

      // Clear and fill username field
      usernameField.focus();
      usernameField.value = '';
      usernameField.value = email;
      usernameField.dispatchEvent(new Event('input', { bubbles: true }));
      usernameField.dispatchEvent(new Event('change', { bubbles: true }));

      await wait(300);

      // Clear and fill password field
      passwordField.focus();
      passwordField.value = '';
      passwordField.value = password;
      passwordField.dispatchEvent(new Event('input', { bubbles: true }));
      passwordField.dispatchEvent(new Event('change', { bubbles: true }));

      await wait(300);

      // Click login button
      console.log('Clicking login button');
      loginButton.focus();
      loginButton.click();

      // Also try submitting the form if button click doesn't work
      const form = usernameField.closest('form') || passwordField.closest('form');
      if (form) {
        await wait(500);
        // Check if we're still on the same page
        if (document.querySelector('#username') || document.querySelector('input[type="password"]')) {
          console.log('Submitting form directly');
          form.submit();
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  }

  function findButtonByText(text) {
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
    for (const btn of buttons) {
      const btnText = btn.textContent?.trim() || btn.value?.trim() || '';
      if (btnText.toLowerCase() === text.toLowerCase()) {
        return btn;
      }
    }
    return null;
  }

  // ==================== TeamSpirit Functions ====================

  function getCurrentStatus() {
    try {
      const punchArea = findPunchArea();
      if (!punchArea) {
        return { status: '打刻エリアが見つかりません', isWorking: false };
      }

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
      // First, select the location
      await selectLocation(location);
      await wait(500);

      // Find and click the clock-in button
      const clockInBtn = findPunchButtonByText('出勤');
      if (!clockInBtn) {
        throw new Error('出勤ボタンが見つかりません');
      }

      if (clockInBtn.disabled) {
        throw new Error('既に出勤済みです');
      }

      clockInBtn.click();
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

      clockOutBtn.click();
      await wait(1000);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function selectLocation(location) {
    const locationText = LOCATION_MAP[location];
    if (!locationText) {
      console.warn('Unknown location:', location);
      return;
    }

    // Find location buttons/options
    const buttons = document.querySelectorAll('button, input[type="button"], [role="button"], label');

    for (const btn of buttons) {
      const text = btn.textContent?.trim() || btn.value?.trim() || '';
      if (text === locationText) {
        const isSelected = btn.classList.contains('selected') ||
                          btn.classList.contains('active') ||
                          btn.getAttribute('aria-pressed') === 'true' ||
                          btn.querySelector('input[type="radio"]:checked');

        if (!isSelected) {
          btn.click();
          await wait(300);
        }
        return;
      }
    }

    // Try finding by inner text in nested elements
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.childElementCount === 0 && el.textContent?.trim() === locationText) {
        const clickable = el.closest('button, [role="button"], label, [onclick]');
        if (clickable) {
          clickable.click();
          await wait(300);
          return;
        }
      }
    }

    console.warn('Location button not found:', locationText);
  }

  function findPunchArea() {
    const allElements = document.querySelectorAll('div, section, article');

    for (const el of allElements) {
      const text = el.textContent || '';
      if (text.includes('出勤') && text.includes('退勤') && text.includes('リモート')) {
        return el;
      }
    }

    return null;
  }

  function findPunchButtonByText(text) {
    // Method 1: Direct button search
    const buttons = document.querySelectorAll('button, input[type="button"], [role="button"]');

    for (const btn of buttons) {
      const btnText = btn.textContent?.trim() || btn.value?.trim() || '';
      if (btnText === text) {
        return btn;
      }
    }

    // Method 2: Search in Lightning components
    const lightningButtons = document.querySelectorAll('lightning-button, lightning-button-stateful');
    for (const btn of lightningButtons) {
      if (btn.textContent?.trim() === text) {
        const actualButton = btn.querySelector('button') || btn;
        return actualButton;
      }
    }

    // Method 3: Search for elements with the text that might be clickable
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.childElementCount === 0 && el.textContent?.trim() === text) {
        const clickable = el.closest('button, [role="button"], a');
        if (clickable) {
          return clickable;
        }
      }
    }

    return null;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Log page type for debugging
  console.log('TeamSpirit Quick Punch: Content script loaded on', getPageType(), 'page, URL:', window.location.href);
})();
