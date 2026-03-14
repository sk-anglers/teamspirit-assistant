# TeamSpirit Extension バグ修正 (3件) 実装プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 休日出勤の別セクション表示、日跨ぎ残業フリーズの解消、月末残業予測ロジックの修正

**Architecture:** background.js のデータ取得層で休日出勤を分離し、日跨ぎセッション検出を追加。overtime-calc.js の予測ロジックを修正。popup.js/content.js の UI層で休憩控除と休日出勤表示を追加。

**Tech Stack:** Chrome Extension (Manifest V3), JavaScript (ES6+), Chrome Storage API

---

### Task 1: background.js — 休日出勤データの分離と日跨ぎセッション対応

**Files:**
- Modify: `background.js:328-382` (completedDays/totalDailyOvertimeMinutes 計算)
- Modify: `background.js:112-128` (日跨ぎキャッシュ無効化)
- Modify: `background.js:280-290` (todayData 生成)
- Modify: `background.js:444-455` (summary へのデータ追加)

**Step 1: 休日出勤データの分離 (background.js:328-382)**

`fetchAllAttendanceDataInternal` 内の executeScript コールバック関数で、completedDays と totalDailyOvertimeMinutes の計算ループに `isHoliday` チェックを追加し、休日出勤を別カウントする。

現在のコード（background.js:328-382）:
```javascript
// 退勤打刻済み日数と日次残業合計を計算（当日は除外）
let completedDays = 0;
let totalDailyOvertimeMinutes = 0;
// ... loop ...
if (day.clockIn && day.clockOut) {
  completedDays++;
  // ... overtime calc ...
  totalDailyOvertimeMinutes += dailyOvertime;
}
```

変更後:
```javascript
// 退勤打刻済み日数と日次残業合計を計算（当日は除外）
let completedDays = 0;
let totalDailyOvertimeMinutes = 0;
let holidayWorkDays = 0;
let holidayWorkMinutes = 0;
const STANDARD_MINUTES_PER_DAY = 8 * 60;
const BREAK_MINUTES = 60;

for (const dateStr of Object.keys(result.monthlyData)) {
  if (dateStr === todayStr) continue;
  const day = result.monthlyData[dateStr];
  if (day.clockIn && day.clockOut) {
    const parseTime = (timeStr) => {
      if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) return null;
      const parts = timeStr.split(':');
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (isNaN(hours) || isNaN(minutes)) return null;
      return hours * 60 + minutes;
    };
    const clockInMinutes = parseTime(day.clockIn);
    const clockOutMinutes = parseTime(day.clockOut);
    if (clockInMinutes === null || clockOutMinutes === null) {
      console.warn('[TS-Assistant] 時刻パース失敗:', dateStr, day.clockIn, day.clockOut);
      continue;
    }
    let workingMinutes = clockOutMinutes - clockInMinutes;
    if (workingMinutes < 0) workingMinutes += 24 * 60;
    if (workingMinutes >= 6 * 60) workingMinutes -= BREAK_MINUTES;

    if (day.isHoliday) {
      // 休日出勤: 別カウント
      holidayWorkDays++;
      holidayWorkMinutes += workingMinutes;
    } else {
      // 平日: 従来通り
      completedDays++;
      const dailyOvertime = Math.max(0, workingMinutes - STANDARD_MINUTES_PER_DAY);
      totalDailyOvertimeMinutes += dailyOvertime;
    }
  }
}
result.completedDays = completedDays;
result.totalDailyOvertimeMinutes = totalDailyOvertimeMinutes;
result.holidayWorkDays = holidayWorkDays;
result.holidayWorkMinutes = holidayWorkMinutes;
```

**Step 2: summary にデータ追加 (background.js:444-455)**

```javascript
if (data.summary) {
  data.summary.remainingWorkdays = data.remainingWorkdays;
  data.summary.completedDays = data.completedDays;
  data.summary.totalDailyOvertimeMinutes = data.totalDailyOvertimeMinutes;
  data.summary.holidayWorkDays = data.holidayWorkDays;
  data.summary.holidayWorkMinutes = data.holidayWorkMinutes;
}
if (data.todayData && data.todayData.summary) {
  data.todayData.summary.remainingWorkdays = data.remainingWorkdays;
  data.todayData.summary.completedDays = data.completedDays;
  data.todayData.summary.totalDailyOvertimeMinutes = data.totalDailyOvertimeMinutes;
  data.todayData.summary.holidayWorkDays = data.holidayWorkDays;
  data.todayData.summary.holidayWorkMinutes = data.holidayWorkMinutes;
}
```

**Step 3: 日跨ぎセッション対応 — todayData 生成の改善 (background.js:280-290)**

現在の todayData 生成後に、日跨ぎセッション検出ロジックを追加する。

executeScript のコールバック関数内（result.success 判定の後、return前）に以下を追加:

これは executeScript の**外側**（background.js の fetchAllAttendanceDataInternal 関数内、results のループ内）で行う。
background.js:402-513 付近、`for (const r of results)` ループ内で `data.todayData` が空（clockInTime なし）かつストレージに有効な clockInTimestamp がある場合に、前日のデータで補完する:

```javascript
// 日跨ぎセッション検出: 今日のデータが空で、有効な clockInTimestamp がある場合
const existingSession = await chrome.storage.local.get(['clockInTimestamp', 'hasClockedOut', 'lastPunchAction']);
if (data.todayData && !data.todayData.clockInTime && existingSession.clockInTimestamp) {
  const elapsed = Date.now() - existingSession.clockInTimestamp;
  const isValidSession = elapsed > 0 && elapsed < 24 * 60 * 60 * 1000;
  if (isValidSession && !existingSession.hasClockedOut) {
    // 前日のデータから出勤時刻を取得
    const clockInDate = new Date(existingSession.clockInTimestamp);
    const yesterdayStr = `${clockInDate.getFullYear()}-${String(clockInDate.getMonth() + 1).padStart(2, '0')}-${String(clockInDate.getDate()).padStart(2, '0')}`;
    const yesterdayData = data.monthlyData[yesterdayStr];
    if (yesterdayData && yesterdayData.clockIn) {
      console.log('[TS-Assistant] 日跨ぎセッション検出: 前日データで補完', yesterdayStr);
      data.todayData.clockInTime = yesterdayData.clockIn;
      data.todayData.isWorking = true;
      data.todayData.clockOutTime = null;
    }
  }
}
```

**Step 4: コミット**

```bash
git add background.js
git commit -m "fix: 休日出勤データ分離 + 日跨ぎセッション検出

- completedDays/totalDailyOvertimeMinutes から休日出勤を除外
- holidayWorkDays/holidayWorkMinutes を新規算出
- 深夜0時超過時に前日データで todayData を補完"
```

---

### Task 2: overtime-calc.js — 予測ロジック修正

**Files:**
- Modify: `overtime-calc.js:97-115` (月末予測計算)

**Step 1: forecastRate 計算の統一と修正**

現在のコード (overtime-calc.js:97-115):
```javascript
const futureRemainingDays = (todayWorkingMinutes > 0 && remainingDays > 0)
  ? remainingDays - 1
  : (remainingDays || 0);
let forecastRate;
if (todayExcess > 0 && realTimeCompletedDays > 0) {
  forecastRate = Math.round(realTimeDailyOvertimeMinutes / realTimeCompletedDays);
} else if (baseCompletedDays > 0) {
  forecastRate = Math.round(baseDailyOvertimeMinutes / baseCompletedDays);
} else {
  forecastRate = avgOvertimePerDay;
}
const forecastOvertime = dailyExcessTotal + (forecastRate * futureRemainingDays);
```

変更後:
```javascript
// 月末予測
// 残り勤務日数から当日を除外（当日分は dailyExcessTotal に含まれるため）
const futureRemainingDays = (todayWorkingMinutes > 0 && remainingDays > 0)
  ? remainingDays - 1
  : (remainingDays || 0);

// 予測レート: 常に確定日（当日除く）の平均残業を使用
// 出勤直後の希薄化防止: 当日分は含めない
let forecastRate;
if (baseCompletedDays > 0) {
  forecastRate = Math.round(baseDailyOvertimeMinutes / baseCompletedDays);
} else if (todayExcess > 0) {
  // 月初（確定日なし）: 当日の残業をベースに予測
  forecastRate = todayExcess;
} else {
  forecastRate = 0;
}
const forecastOvertime = dailyExcessTotal + (forecastRate * futureRemainingDays);
```

**Step 2: コミット**

```bash
git add overtime-calc.js
git commit -m "fix: 月末残業予測ロジックをシンプル化

- forecastRate を常に確定日の平均で算出（分岐を削減）
- 当日分による予測値ジャンプを解消"
```

---

### Task 3: popup.js — 休憩控除と休日出勤セクション追加

**Files:**
- Modify: `popup.html:111-157` (休日出勤セクション追加)
- Modify: `popup.css` (休日出勤スタイル追加)
- Modify: `popup.js:670-706` (displaySummary 内の todayWorkingMinutes 休憩控除)
- Modify: `popup.js:339-421` (updateSummaryRealTime 内の todayWorkingMinutes 休憩控除)
- Modify: `popup.js:793-874` (updateOvertimeSection に休日出勤表示追加)

**Step 1: popup.html に休日出勤表示行を追加**

残業警告セクション内、勤務日数の後に休日出勤行を追加。
popup.html:124-126（勤務日数行の後）に追加:

```html
          <div class="summary-row" id="holidayWorkRow" style="display: none;">
            <span class="summary-label">うち休日出勤</span>
            <span class="summary-value" id="holidayWorkInfo">--</span>
          </div>
```

**Step 2: popup.js — displaySummary 内の todayWorkingMinutes に休憩控除を追加**

popup.js:673-705 の todayWorkingMinutes 計算部分。休憩控除を追加する。

現在のコード (popup.js:678-706):
```javascript
if (clockInTimestamp && isCurrentWorkSession(clockInTimestamp)) {
  if (isWorking) {
    todayWorkingMinutes = Math.floor((Date.now() - clockInTimestamp) / 60000);
    const MAX_WORKING_MINUTES_PER_DAY = 24 * 60;
    if (todayWorkingMinutes > MAX_WORKING_MINUTES_PER_DAY) {
      todayWorkingMinutes = 0;
    }
  } else if (clockOutTimestamp) {
    todayWorkingMinutes = Math.floor((clockOutTimestamp - clockInTimestamp) / 60000);
    const MAX_WORKING_MINUTES_PER_DAY = 24 * 60;
    if (todayWorkingMinutes > MAX_WORKING_MINUTES_PER_DAY) {
      todayWorkingMinutes = 0;
    }
  }
  if (totalMinutes !== null && todayWorkingMinutes > 0) {
    totalMinutes += todayWorkingMinutes;
  }
}
```

変更後:
```javascript
if (clockInTimestamp && isCurrentWorkSession(clockInTimestamp)) {
  if (isWorking) {
    todayWorkingMinutes = Math.floor((Date.now() - clockInTimestamp) / 60000);
    const MAX_WORKING_MINUTES_PER_DAY = 24 * 60;
    if (todayWorkingMinutes > MAX_WORKING_MINUTES_PER_DAY) {
      todayWorkingMinutes = 0;
    }
  } else if (clockOutTimestamp) {
    todayWorkingMinutes = Math.floor((clockOutTimestamp - clockInTimestamp) / 60000);
    const MAX_WORKING_MINUTES_PER_DAY = 24 * 60;
    if (todayWorkingMinutes > MAX_WORKING_MINUTES_PER_DAY) {
      todayWorkingMinutes = 0;
    }
  } else if (!isWorking) {
    console.warn('[TS-Assistant] Clocked out but clockOutTimestamp is missing, relying on TeamSpirit totalHours');
  }
  if (totalMinutes !== null && todayWorkingMinutes > 0) {
    // 休憩控除: 6時間以上勤務の場合は1時間控除して totalMinutes に加算
    let todayNetMinutes = todayWorkingMinutes;
    if (todayNetMinutes >= 6 * 60) {
      todayNetMinutes -= 60;
    }
    totalMinutes += todayNetMinutes;
  }
}
```

注意: `todayWorkingMinutes` 自体は変更しない（`calculateOvertimeData` に渡す値は生の経過時間のまま。`calculateOvertimeData` 内部で休憩控除を行うため）。`totalMinutes` への加算のみ控除する。

**Step 3: popup.js — updateSummaryRealTime 内の totalMinutes 加算にも休憩控除**

popup.js:346-348 の箇所:
```javascript
const todayWorkingMinutes = Math.floor(todayWorkingMs / 60000);
const realTimeTotalMinutes = baseTotalMinutes + todayWorkingMinutes;
```

変更後:
```javascript
const todayWorkingMinutes = Math.floor(todayWorkingMs / 60000);
// 休憩控除: 6時間以上勤務の場合は1時間控除して totalMinutes に加算
let todayNetMinutes = todayWorkingMinutes;
if (todayNetMinutes >= 6 * 60) {
  todayNetMinutes -= 60;
}
const realTimeTotalMinutes = baseTotalMinutes + todayNetMinutes;
```

**Step 4: popup.js — 残業セクション内に休日出勤情報を表示**

popup.js の `updateOvertimeSection` 関数（794行付近）に休日出勤表示を追加:

```javascript
// 休日出勤表示
const holidayWorkRow = document.getElementById('holidayWorkRow');
const holidayWorkInfo = document.getElementById('holidayWorkInfo');
if (holidayWorkRow && holidayWorkInfo) {
  const hwDays = parseInt(summary.holidayWorkDays, 10);
  const hwMinutes = parseInt(summary.holidayWorkMinutes, 10);
  if (!isNaN(hwDays) && hwDays > 0) {
    holidayWorkRow.style.display = 'flex';
    holidayWorkInfo.textContent = `${hwDays}日 (${formatMinutesToTime(hwMinutes)})`;
  } else {
    holidayWorkRow.style.display = 'none';
  }
}
```

`updateOvertimeSectionRealTime`（424行付近）にも同様のロジックを追加（summaryを引数に追加するか、直接storageから読む）。

**Step 5: popup.js の要素参照に holidayWorkRow / holidayWorkInfo を追加**

popup.js:46 付近の要素参照に追加:
```javascript
const holidayWorkRow = document.getElementById('holidayWorkRow');
const holidayWorkInfoEl = document.getElementById('holidayWorkInfo');
```

**Step 6: コミット**

```bash
git add popup.html popup.js
git commit -m "fix(popup): 休憩控除追加 + 休日出勤セクション表示

- totalMinutes 加算時に6h以上で1h休憩控除
- 残業警告セクションに休日出勤行を追加"
```

---

### Task 4: content.js — 休憩控除と日跨ぎ対応

**Files:**
- Modify: `content.js:658-692` (updateDisplay 内の todayWorkingMinutes 休憩控除)
- Modify: `content.js:566-598` (updateDisplay 内の出勤中判定を storage ベースに改善)
- Modify: `content.js:755-830` (updateOvertimeSection に休日出勤表示追加)
- Modify: `content.js:438-561` (createInfoPanel に休日出勤行追加)

**Step 1: createInfoPanel に休日出勤行を追加**

content.js:513-515（勤務日数行の後）に追加:
```html
<div id="ts-holiday-work-row" style="display:none; justify-content:space-between; margin-bottom:3px; gap:10px;">
  <span style="color:#666;">うち休日出勤</span>
  <span style="font-weight:600; color:#ea8600;" id="ts-holiday-work-info">--</span>
</div>
```

**Step 2: updateDisplay 内の todayWorkingMinutes に休憩控除**

content.js:658-692 の `currentTotalMinutes += todayWorkingMinutes` 部分。

現在のコード（content.js:674-675）:
```javascript
todayWorkingMinutes = Math.floor((Date.now() - clockInDate.getTime()) / 60000);
if (todayWorkingMinutes > 0 && todayWorkingMinutes < MAX_WORKING_MINUTES) {
  currentTotalMinutes += todayWorkingMinutes;
}
```

変更後:
```javascript
todayWorkingMinutes = Math.floor((Date.now() - clockInDate.getTime()) / 60000);
if (todayWorkingMinutes > 0 && todayWorkingMinutes < MAX_WORKING_MINUTES) {
  // 休憩控除: 6時間以上勤務の場合は1時間控除して totalMinutes に加算
  let todayNetMinutes = todayWorkingMinutes;
  if (todayNetMinutes >= 6 * 60) {
    todayNetMinutes -= 60;
  }
  currentTotalMinutes += todayNetMinutes;
}
```

退勤済み（content.js:686-689）も同様:
```javascript
todayWorkingMinutes = Math.floor((clockOutDate.getTime() - clockInDate.getTime()) / 60000);
if (todayWorkingMinutes > 0 && todayWorkingMinutes < MAX_WORKING_MINUTES) {
  let todayNetMinutes = todayWorkingMinutes;
  if (todayNetMinutes >= 6 * 60) {
    todayNetMinutes -= 60;
  }
  currentTotalMinutes += todayNetMinutes;
}
```

**Step 3: updateDisplay の出勤中判定を storage ベースに改善**

content.js:593-614 の `if (data.isWorking && data.clockInTime)` 判定。

日跨ぎ時に `data.isWorking` が false になるため、ストレージの `clockInTimestamp` も確認する。

`updateDisplay` 関数の冒頭（content.js:566付近）に storage チェックを追加:

```javascript
function updateDisplay() {
  if (!infoPanel) return;

  const data = cachedData;
  // ... 既存の要素取得 ...

  // 日跨ぎ対応: ストレージの clockInTimestamp を確認
  chrome.storage.local.get(['clockInTimestamp', 'hasClockedOut'], (stored) => {
    const hasActiveSession = stored.clockInTimestamp &&
      !stored.hasClockedOut &&
      (Date.now() - stored.clockInTimestamp) > 0 &&
      (Date.now() - stored.clockInTimestamp) < 24 * 60 * 60 * 1000;

    // data.isWorking が false でも有効なセッションがあれば出勤中として扱う
    const effectiveIsWorking = (data?.isWorking && data?.clockInTime) || hasActiveSession;
    const effectiveClockInTime = data?.clockInTime || (hasActiveSession ?
      `${String(new Date(stored.clockInTimestamp).getHours()).padStart(2, '0')}:${String(new Date(stored.clockInTimestamp).getMinutes()).padStart(2, '0')}` : null);

    // 以降の表示ロジックで effectiveIsWorking / effectiveClockInTime を使用
    // ...
  });
}
```

ただし、`updateDisplay` は毎秒呼ばれるため、非同期の storage.get を毎秒呼ぶのはパフォーマンス上問題。代わに、storage.onChanged リスナー（content.js:1044-1097 付近）で `clockInTimestamp` の変更も監視し、`cachedData` を補正する方式にする:

```javascript
// ストレージ変更監視に clockInTimestamp の監視を追加
if (changes.clockInTimestamp && changes.clockInTimestamp.newValue) {
  const ts = changes.clockInTimestamp.newValue;
  if (cachedData) {
    const clockInDate = new Date(ts);
    cachedData.isWorking = true;
    cachedData.clockInTime = `${String(clockInDate.getHours()).padStart(2, '0')}:${String(clockInDate.getMinutes()).padStart(2, '0')}`;
    cachedData.clockOutTime = null;
    updateDisplay();
  }
}
```

さらに、`initPanelData` 実行時に storage の clockInTimestamp を確認して cachedData を補正:

```javascript
function initPanelData() {
  loadData().then(() => {
    // 日跨ぎ対応: 有効なセッションがあれば cachedData を補正
    chrome.storage.local.get(['clockInTimestamp', 'hasClockedOut'], (stored) => {
      if (stored.clockInTimestamp && !stored.hasClockedOut) {
        const elapsed = Date.now() - stored.clockInTimestamp;
        if (elapsed > 0 && elapsed < 24 * 60 * 60 * 1000) {
          if (cachedData && !cachedData.clockInTime) {
            const clockInDate = new Date(stored.clockInTimestamp);
            cachedData.isWorking = true;
            cachedData.clockInTime = `${String(clockInDate.getHours()).padStart(2, '0')}:${String(clockInDate.getMinutes()).padStart(2, '0')}`;
            cachedData.clockOutTime = null;
          }
        }
      }
      updateDisplay();
    });
  });
  // ...
}
```

**Step 4: updateOvertimeSection に休日出勤表示を追加**

content.js の `updateOvertimeSection`（755行付近）に追加:

```javascript
// 休日出勤表示
const holidayWorkRow = infoPanel.querySelector('#ts-holiday-work-row');
const holidayWorkInfo = infoPanel.querySelector('#ts-holiday-work-info');
if (holidayWorkRow && holidayWorkInfo) {
  const hwDays = parseInt(summary.holidayWorkDays, 10);
  const hwMinutes = parseInt(summary.holidayWorkMinutes, 10);
  if (!isNaN(hwDays) && hwDays > 0) {
    holidayWorkRow.style.display = 'flex';
    holidayWorkInfo.textContent = `${hwDays}日 (${formatMinutesToTime(hwMinutes)})`;
  } else {
    holidayWorkRow.style.display = 'none';
  }
}
```

**Step 5: コミット**

```bash
git add content.js
git commit -m "fix(content): 休憩控除 + 日跨ぎ対応 + 休日出勤表示

- currentTotalMinutes 加算時に6h以上で1h休憩控除
- 日跨ぎ時にストレージの clockInTimestamp で cachedData を補正
- 残業警告欄に休日出勤行を追加"
```

---

### Task 5: バージョンアップと最終確認

**Files:**
- Modify: `manifest.json` (バージョンを 3.3.0 → 3.4.0)
- Modify: `README.md` (変更履歴追加)

**Step 1: manifest.json のバージョン更新**

```json
"version": "3.4.0"
```

**Step 2: コミット**

```bash
git add manifest.json
git commit -m "chore: bump version to 3.4.0"
```

---

## 修正箇所サマリー

| ファイル | Bug 1 (休日出勤) | Bug 2 (日跨ぎ) | Bug 3 (予測/休憩) |
|---------|:---:|:---:|:---:|
| background.js | ✅ データ分離 | ✅ セッション検出 | — |
| overtime-calc.js | — | — | ✅ 予測ロジック |
| popup.html | ✅ UI追加 | — | — |
| popup.js | ✅ 表示ロジック | — | ✅ 休憩控除 |
| content.js | ✅ 表示ロジック | ✅ cachedData補正 | ✅ 休憩控除 |

## テスト手順（手動）

1. **休日出勤**: 土日に出勤記録がある月で、残業警告セクションに「うち休日出勤」行が表示されることを確認
2. **日跨ぎ**: 23:00頃に出勤打刻し、0:00を超えても出勤中表示が継続することを確認（Chrome DevToolsでシステム時刻変更可）
3. **予測/休憩**: 6時間以上勤務中に、月間残業と月末予測が休憩1時間分低くなることを確認
4. **通常動作**: 平日の通常勤務（9:00-18:00）で既存機能が正常動作することを確認
