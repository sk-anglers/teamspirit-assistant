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

    if (url.includes('login.salesforce.com') || url.includes('/login')) {
      return 'login';
    } else if (url.includes('lightning.force.com')) {
      return 'teamspirit';
    }

    return 'unknown';
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const pageType = getPageType();

    if (request.action === 'ping') {
      sendResponse({ ready: true, pageType });
      return;
    }

    if (request.action === 'getPageInfo') {
      sendResponse({
        isLoginPage: pageType === 'login',
        isTeamSpiritPage: pageType === 'teamspirit',
        url: window.location.href
      });
      return;
    }

    if (request.action === 'getStatus') {
      const status = getCurrentStatus();
      sendResponse(status);
      return;
    }

    if (request.action === 'login') {
      if (pageType !== 'login') {
        sendResponse({ success: false, error: 'ログインページではありません' });
        return;
      }
      performLogin(request.email, request.password).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (request.action === 'clockIn') {
      if (pageType !== 'teamspirit') {
        sendResponse({ success: false, error: 'TeamSpiritページではありません' });
        return;
      }
      performClockIn(request.location).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (request.action === 'clockOut') {
      if (pageType !== 'teamspirit') {
        sendResponse({ success: false, error: 'TeamSpiritページではありません' });
        return;
      }
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
      // Find username/email field
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
        throw new Error('メールアドレス入力欄が見つかりません');
      }

      if (!passwordField) {
        throw new Error('パスワード入力欄が見つかりません');
      }

      if (!loginButton) {
        throw new Error('ログインボタンが見つかりません');
      }

      // Fill in credentials
      usernameField.value = email;
      usernameField.dispatchEvent(new Event('input', { bubbles: true }));

      await wait(200);

      passwordField.value = password;
      passwordField.dispatchEvent(new Event('input', { bubbles: true }));

      await wait(200);

      // Click login button
      loginButton.click();

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== TeamSpirit Functions ====================

  function getCurrentStatus() {
    try {
      const punchArea = findPunchArea();
      if (!punchArea) {
        return { status: '打刻エリアが見つかりません', isWorking: false };
      }

      const clockOutBtn = findButtonByText('退勤');
      const clockInBtn = findButtonByText('出勤');

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
      const clockInBtn = findButtonByText('出勤');
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
      const clockOutBtn = findButtonByText('退勤');
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

  function findButtonByText(text) {
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
  console.log('TeamSpirit Quick Punch: Content script loaded on', getPageType(), 'page');
})();
