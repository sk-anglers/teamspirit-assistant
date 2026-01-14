const TEAMSPIRIT_URL = 'https://teamspirit-74532.lightning.force.com/lightning/page/home';

document.addEventListener('DOMContentLoaded', async () => {
  const clockInBtn = document.getElementById('clockIn');
  const clockOutBtn = document.getElementById('clockOut');
  const locationSelect = document.getElementById('location');
  const messageDiv = document.getElementById('message');
  const statusDiv = document.getElementById('status');
  const openTeamSpiritLink = document.getElementById('openTeamSpirit');

  // Load saved location preference
  const { savedLocation } = await chrome.storage.local.get('savedLocation');
  if (savedLocation) {
    locationSelect.value = savedLocation;
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

  // Check current status
  checkStatus();

  // Clock in button
  clockInBtn.addEventListener('click', () => {
    performPunch('clockIn', locationSelect.value);
  });

  // Clock out button
  clockOutBtn.addEventListener('click', () => {
    performPunch('clockOut', locationSelect.value);
  });

  async function checkStatus() {
    try {
      const tab = await findTeamSpiritTab();
      if (tab) {
        statusDiv.querySelector('.status-text').textContent = 'TeamSpiritに接続中';
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus('準備完了', 'not-working');
            return;
          }
          if (response && response.status) {
            showStatus(response.status, response.isWorking ? 'working' : 'not-working');
          }
        });
      } else {
        showStatus('準備完了', 'not-working');
      }
    } catch (error) {
      showStatus('準備完了', 'not-working');
    }
  }

  function showStatus(text, className) {
    statusDiv.querySelector('.status-text').textContent = text;
    statusDiv.className = 'status ' + className;
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

      let tab = await findTeamSpiritTab();

      if (!tab) {
        // Open TeamSpirit in background
        showMessage('TeamSpiritを開いています...', 'info');
        autoOpenedTab = await chrome.tabs.create({ url: TEAMSPIRIT_URL, active: false });

        // Wait for the tab to load completely
        await waitForTabLoad(autoOpenedTab.id);
        showMessage('ページ読み込み完了、打刻中...', 'info');

        // Wait for content script to be ready
        await waitForContentScript(autoOpenedTab.id);

        tab = autoOpenedTab;
      }

      // Send punch command
      const result = await sendPunchCommand(tab.id, action, location);

      if (result.success) {
        const actionText = action === 'clockIn' ? '出勤' : '退勤';
        showMessage(`${actionText}打刻が完了しました`, 'success');

        // Close the auto-opened tab after successful punch
        if (autoOpenedTab) {
          setTimeout(async () => {
            try {
              await chrome.tabs.remove(autoOpenedTab.id);
            } catch (e) {
              // Tab might already be closed
            }
          }, 1500);
        }

        checkStatus();
      } else {
        throw new Error(result.error || '打刻に失敗しました');
      }
    } catch (error) {
      showMessage(error.message || 'エラーが発生しました', 'error');

      // Close auto-opened tab on error too
      if (autoOpenedTab) {
        setTimeout(async () => {
          try {
            await chrome.tabs.remove(autoOpenedTab.id);
          } catch (e) {
            // Tab might already be closed
          }
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
    const tabs = await chrome.tabs.query({ url: 'https://teamspirit-74532.lightning.force.com/*' });
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
          // Wait for the page to fully render (TeamSpirit/Salesforce takes time)
          setTimeout(resolve, 5000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  function waitForContentScript(tabId, maxRetries = 10) {
    return new Promise((resolve, reject) => {
      let retries = 0;

      const tryConnect = () => {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            retries++;
            if (retries >= maxRetries) {
              reject(new Error('Content scriptの読み込みに失敗しました'));
              return;
            }
            setTimeout(tryConnect, 1000);
          } else {
            resolve();
          }
        });
      };

      tryConnect();
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

  function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = 'message ' + type;
  }
});
