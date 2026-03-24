# 月末残業予測ロジック刷新 実装プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 月末予測を「所定ベース」から「8h超過積み上げベース」に変更し、休日出勤の正確な反映・出勤直後の予測安定化・日跨ぎ補正を実現する。

**Architecture:** background.js のデータ取得層で休日の休憩控除を除去し、overtime-calc.js の予測ロジックを差し替え。popup.js/content.js は `isCrossDaySession` 引数を追加して渡す。

**Tech Stack:** Chrome Extension (Manifest V3), JavaScript (ES6+), Chrome Storage API

---

### Task 1: background.js — 休日出勤の休憩控除を除去

**Files:**
- Modify: `background.js:396-417`

**Step 1: 休憩控除と休日/平日分岐の順序を入れ替え**

`background.js:403-417` を以下に変更する。休日は休憩控除せずに `workingMinutes` をそのまま加算し、平日のみ休憩控除後に8h超過を計算する。

現在のコード:
```javascript
              if (workingMinutes >= 6 * 60) {
                workingMinutes -= BREAK_MINUTES;
              }

              // 休日出勤は別カウントに分離
              if (day.isHoliday) {
                holidayWorkDays++;
                holidayWorkMinutes += workingMinutes;
              } else {
                completedDays++;
                // 日次残業 = max(0, 勤務時間 - 8時間)
                // 8時間未満の日は0として扱う（マイナスにしない）
                const dailyOvertime = Math.max(0, workingMinutes - STANDARD_MINUTES_PER_DAY);
                totalDailyOvertimeMinutes += dailyOvertime;
              }
```

変更後:
```javascript
              // 休日出勤は別カウントに分離（休日は休憩控除なし＝全額残業）
              if (day.isHoliday) {
                holidayWorkDays++;
                holidayWorkMinutes += workingMinutes;
              } else {
                // 平日のみ休憩控除
                if (workingMinutes >= 6 * 60) {
                  workingMinutes -= BREAK_MINUTES;
                }
                completedDays++;
                // 日次残業 = max(0, 勤務時間 - 8時間)
                // 8時間未満の日は0として扱う（マイナスにしない）
                const dailyOvertime = Math.max(0, workingMinutes - STANDARD_MINUTES_PER_DAY);
                totalDailyOvertimeMinutes += dailyOvertime;
              }
```

**Step 2: コメントを更新**

`background.js:396` のコメントを変更:
```javascript
              // 実勤務時間 = 退勤 - 出勤（休憩控除は平日のみ、下の分岐内で実施）
```

**Step 3: コミット**

```bash
git add background.js
git commit -m "fix: 休日出勤の休憩控除を除去（全額残業カウント）

休日は所定労働時間がないため、勤務時間をそのまま残業として計上。
休憩控除は平日のみに限定。"
```

---

### Task 2: overtime-calc.js — 予測ロジック差し替え

**Files:**
- Modify: `overtime-calc.js:10` (関数シグネチャ)
- Modify: `overtime-calc.js:109-114` (forecastOvertime 計算)

**Step 1: 関数シグネチャに `isCrossDaySession` 引数を追加**

`overtime-calc.js:10` を変更:

現在:
```javascript
function calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes) {
```

変更後:
```javascript
function calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession) {
```

**Step 2: NaN 防御に `isCrossDaySession` を追加**

`overtime-calc.js:23` の後に追加:
```javascript
  isCrossDaySession = !!isCrossDaySession;
```

**Step 3: 予測ロジックを差し替え**

`overtime-calc.js:109-114` を以下に変更:

現在:
```javascript
  // 月末予測 = max(0, 平均勤務時間/日 × 全勤務日数 − 所定労働時間)
  // 「このペースだと月末の月間残業はこうなる」を表示
  // 短い日が長い日を相殺するフルフレックスの実態に即した予測
  const totalExpectedDays = realTimeCompletedDays + Math.max(0, remainingDays || 0);
  const avgTotalPerDay = Math.round(totalMinutes / safeCompletedDays);
  const forecastOvertime = Math.max(0, avgTotalPerDay * totalExpectedDays - scheduledMinutes);
```

変更後:
```javascript
  // 月末予測 = 8h超過積み上げベース
  // 確定分（平日8h超過累計 + 休日出勤実績）+ 当日寄与 + 将来予測
  // 当日寄与: max(todayExcess, forecastRate) で出勤直後の予測低下を防止
  // 日跨ぎ補正: 前日が未確定のため remainingDays+1 で補正
  const forecastRate = baseCompletedDays > 0
    ? baseDailyOvertimeMinutes / baseCompletedDays : 0;
  const todayContribution = todayWorkingMinutes > 0
    ? Math.max(todayExcess, forecastRate) : 0;
  const futureRemainingDays = todayWorkingMinutes > 0
    ? (isCrossDaySession ? remainingDays + 1 : remainingDays)
    : remainingDays + 1;
  const forecastOvertime = baseDailyOvertimeMinutes + holidayWorkMinutes
    + todayContribution + (forecastRate * futureRemainingDays);
```

**Step 4: コミット**

```bash
git add overtime-calc.js
git commit -m "fix: 月末予測を8h超過積み上げベースに変更

- 所定ベース（avgTotal×days-scheduled）から8h超過積み上げに変更
- max(todayExcess, forecastRate) で出勤直後の予測低下を防止
- 日跨ぎ時は remainingDays+1 で前日未確定を補正
- 休日出勤実績を全額加算（将来の休日出勤は予測しない）"
```

---

### Task 3: popup.js — `isCrossDaySession` を算出して渡す

**Files:**
- Modify: `popup.js:339` (updateSummaryRealTime 関数シグネチャ)
- Modify: `popup.js:443` (updateOvertimeSectionRealTime 呼び出し)
- Modify: `popup.js:464` (updateOvertimeSectionRealTime 関数シグネチャ)
- Modify: `popup.js:465` (calculateOvertimeData 呼び出し)
- Modify: `popup.js:838` (updateOvertimeSection 呼び出し)
- Modify: `popup.js:848` (updateOvertimeSection 関数シグネチャ)
- Modify: `popup.js:859` (calculateOvertimeData 呼び出し)

**Step 1: `updateSummaryRealTime` で日跨ぎ判定を追加**

`popup.js:339` の関数シグネチャは変更不要（既に `clockInTimestamp` を受け取っている）。

`popup.js:443` の `updateOvertimeSectionRealTime` 呼び出しの直前に日跨ぎ判定を追加し、引数に渡す:

現在 (`popup.js:442-443`):
```javascript
    if (!isNaN(scheduledDays) && !isNaN(effectiveActualDays) && (effectiveActualDays > 0 || todayWorkingMinutes > 0)) {
      updateOvertimeSectionRealTime(realTimeTotalMinutes, scheduledDays, effectiveActualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes);
```

変更後:
```javascript
    if (!isNaN(scheduledDays) && !isNaN(effectiveActualDays) && (effectiveActualDays > 0 || todayWorkingMinutes > 0)) {
      const isCrossDaySession = clockInTimestamp ? !isToday(clockInTimestamp) : false;
      updateOvertimeSectionRealTime(realTimeTotalMinutes, scheduledDays, effectiveActualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession);
```

**Step 2: `updateOvertimeSectionRealTime` に引数追加して `calculateOvertimeData` に渡す**

`popup.js:464` の関数シグネチャ:

現在:
```javascript
  function updateOvertimeSectionRealTime(totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes) {
```

変更後:
```javascript
  function updateOvertimeSectionRealTime(totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession) {
```

`popup.js:465` の `calculateOvertimeData` 呼び出し:

現在:
```javascript
    const data = calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes);
```

変更後:
```javascript
    const data = calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession);
```

**Step 3: `displaySummary` → `updateOvertimeSection` ルートにも `isCrossDaySession` を伝搬**

`popup.js:709` の `displaySummary` は `clockInTimestamp` を既に引数に持っている。

`popup.js:838` の `updateOvertimeSection` 呼び出しに `isCrossDaySession` を追加:

現在:
```javascript
    updateOvertimeSection(summary, totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes);
```

変更後:
```javascript
    const isCrossDaySession = clockInTimestamp ? !isToday(clockInTimestamp) : false;
    updateOvertimeSection(summary, totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession);
```

`popup.js:848` の `updateOvertimeSection` 関数シグネチャ:

現在:
```javascript
  function updateOvertimeSection(summary, totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes) {
```

変更後:
```javascript
  function updateOvertimeSection(summary, totalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession) {
```

`popup.js:859` の `calculateOvertimeData` 呼び出し:

現在:
```javascript
    const data = calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes);
```

変更後:
```javascript
    const data = calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession);
```

**Step 4: コミット**

```bash
git add popup.js
git commit -m "fix(popup): isCrossDaySession を算出し calculateOvertimeData に渡す

日跨ぎ判定（clockInTimestamp が前日）を updateOvertimeSection 系関数に
伝搬し、月末予測の日跨ぎ補正を有効化。"
```

---

### Task 4: content.js — `isCrossDaySession` を算出して渡す

**Files:**
- Modify: `content.js:613` (updateOvertimeSection 呼び出し)
- Modify: `content.js:623` (updateOvertimeSection 関数シグネチャ)
- Modify: `content.js:641` (calculateOvertimeData 呼び出し)

**Step 1: `updateDisplay` 内の `updateOvertimeSection` 呼び出しに `isCrossDaySession` を追加**

`content.js:613`:

現在:
```javascript
      updateOvertimeSection(summary, currentTotalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes);
```

変更後:
```javascript
      const isCrossDaySession = cachedClockInTimestamp ? !isToday(cachedClockInTimestamp) : false;
      updateOvertimeSection(summary, currentTotalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession);
```

**Step 2: `updateOvertimeSection` 関数シグネチャに `isCrossDaySession` を追加**

`content.js:623`:

現在:
```javascript
  function updateOvertimeSection(summary, currentTotalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes) {
```

変更後:
```javascript
  function updateOvertimeSection(summary, currentTotalMinutes, scheduledDays, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession) {
```

**Step 3: `calculateOvertimeData` 呼び出しに `isCrossDaySession` を追加**

`content.js:641`:

現在:
```javascript
    const data = calculateOvertimeData(currentTotalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes);
```

変更後:
```javascript
    const data = calculateOvertimeData(currentTotalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession);
```

注: content.js では `isToday` 関数が未定義の可能性がある。`tab-utils.js` で定義されているが、content script には注入されていない。インライン判定に置き換える:

```javascript
      const isCrossDaySession = cachedClockInTimestamp
        ? new Date(cachedClockInTimestamp).toDateString() !== new Date().toDateString()
        : false;
```

**Step 4: コミット**

```bash
git add content.js
git commit -m "fix(content): isCrossDaySession を算出し calculateOvertimeData に渡す

cachedClockInTimestamp から日跨ぎ判定し、月末予測の日跨ぎ補正を有効化。"
```

---

### Task 5: バージョンアップとコミット

**Files:**
- Modify: `manifest.json` (version)

**Step 1: バージョン更新**

`manifest.json` の `"version"` を `"3.5.5"` → `"3.6.0"` に更新。

**Step 2: コミット**

```bash
git add manifest.json
git commit -m "chore: bump version to 3.6.0

月末残業予測ロジック刷新:
- 8h超過積み上げベースに変更（所定ベース廃止）
- 休日出勤の休憩控除を除去（全額残業カウント）
- 出勤直後・日跨ぎ時の予測安定化"
```

---

## 修正箇所サマリー

| ファイル | 変更内容 |
|---------|---------|
| background.js | 休日の休憩控除を除去（分岐順序入替） |
| overtime-calc.js | 予測式差し替え + `isCrossDaySession` 引数追加 |
| popup.js | `isCrossDaySession` 算出・伝搬（3関数） |
| content.js | `isCrossDaySession` 算出・伝搬（1関数） |
| manifest.json | v3.5.5 → v3.6.0 |

## テスト手順（手動）

1. **通常日**: 出勤前→出勤直後→8h超過後で予測値が下がらないことを確認
2. **日跨ぎ**: 23:59→0:01で予測値が下がらないことを確認
3. **休日出勤**: 休日の勤務時間が全額残業（休憩控除なし）として予測に反映されることを確認
4. **月初**: 確定日0日で予測が forecastRate=0 として正常動作することを確認
5. **既存機能**: 8h超過累計、月間残業、残業/日が正常に表示されることを確認
