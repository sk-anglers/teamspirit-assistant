// TeamSpirit Quick Punch - Content Script
// This script interacts with the TeamSpirit page

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

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      // Respond to ping to confirm content script is ready
      sendResponse({ ready: true });
      return;
    } else if (request.action === 'getStatus') {
      const status = getCurrentStatus();
      sendResponse(status);
    } else if (request.action === 'clockIn') {
      performClockIn(request.location).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true; // Keep message channel open for async response
    } else if (request.action === 'clockOut') {
      performClockOut(request.location).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
  });

  function getCurrentStatus() {
    try {
      // Try to find the punch area
      const punchArea = findPunchArea();
      if (!punchArea) {
        return { status: '打刻エリアが見つかりません', isWorking: false };
      }

      // Check if there's a clock-out button enabled (meaning user has clocked in)
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

      // Wait a moment for the UI to update
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

      // Wait for the action to complete
      await wait(1000);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function performClockOut(location) {
    try {
      // Find and click the clock-out button
      const clockOutBtn = findButtonByText('退勤');
      if (!clockOutBtn) {
        throw new Error('退勤ボタンが見つかりません');
      }

      if (clockOutBtn.disabled) {
        throw new Error('出勤していないため退勤できません');
      }

      clockOutBtn.click();

      // Wait for the action to complete
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
        // Check if it's already selected
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
    // Try to find the punch area by looking for common patterns
    // TeamSpirit's punch area typically contains date/time and punch buttons

    // Look for elements containing both 出勤 and 退勤
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

    // Method 2: Search in Lightning components (Salesforce specific)
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

  // Notify that content script is ready
  console.log('TeamSpirit Quick Punch: Content script loaded');
})();
