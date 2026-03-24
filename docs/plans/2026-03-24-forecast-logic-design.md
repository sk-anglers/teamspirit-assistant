# 月末残業予測ロジック刷新 設計書

**Goal:** 月末予測を「所定ベース」から「8h超過積み上げベース」に変更し、休日出勤の正確な反映・出勤直後の予測安定化・日跨ぎ補正を実現する。

**Architecture:** background.js のデータ取得層で休日の休憩控除を除去し、overtime-calc.js の予測ロジックを差し替え。popup.js/content.js は引数追加のみ。

**Tech Stack:** Chrome Extension (Manifest V3), JavaScript (ES6+), Chrome Storage API

---

## 背景・課題

### 現行ロジック（v3.5.5）
```
月末予測 = max(0, 平均勤務時間/日 × 全勤務日数 − 所定労働時間)
```

### 問題点
1. **過小予測**: 休日出勤が平均を薄め、所定時間で吸収される
2. **月初ゼロ問題**: 所定を超えるまで予測が0hのまま
3. **出勤直後の予測低下**: 勤務日数+1で平均が下がるが実績はまだゼロ
4. **日跨ぎの予測低下**: 前日が未確定で completedDays から消え、残り日数も減少

## 設計

### 予測式

```
月末予測 = baseDailyOvertimeMinutes + holidayWorkMinutes + todayContribution
         + (forecastRate × futureRemainingDays)
```

| 要素 | 算出方法 |
|------|---------|
| baseDailyOvertimeMinutes | 確定平日の8h超過累計（休憩控除後） |
| holidayWorkMinutes | 確定休日出勤の全勤務時間（休憩控除なし） |
| forecastRate | baseDailyOvertimeMinutes ÷ baseCompletedDays |
| todayContribution | max(todayExcess, forecastRate)。出勤前は0 |
| futureRemainingDays | 状態による（下表参照） |

### 残業計算ルール

| 区分 | 計算方法 | 休憩控除 |
|------|---------|---------|
| 平日 | max(0, (勤務時間 - 休憩) - 8h) | あり（6h以上で1h） |
| 休日 | 勤務時間そのまま | なし |

### 状態別の挙動

| 状態 | todayContribution | futureRemainingDays |
|------|------------------|-------------------|
| 出勤前 | 0 | remainingDays + 1（今日を含める） |
| 出勤中（通常） | max(todayExcess, forecastRate) | remainingDays |
| 出勤中（日跨ぎ） | max(todayExcess, forecastRate) | remainingDays + 1（前日未確定補正） |

- remainingDays: background.js で「明日以降の平日数」として算出
- 出勤判定: todayWorkingMinutes > 0
- 日跨ぎ判定: clockInTimestamp が前日（isCrossDaySession）

### 検証トレース

```
前提: 5日確定、各1h残業=累計5h、rate=1h/日、remainingDays=9

■ 出勤前
  futureRemaining = 9 + 1 = 10
  forecast = 5h + 0h + 0 + (1h × 10) = 15h

■ 出勤3h（通常日、未超過）
  futureRemaining = 9
  forecast = 5h + 0h + max(0, 1h) + (1h × 9) = 15h ✅ 下がらない

■ 出勤10h（通常日、2h超過）
  forecast = 5h + 0h + max(2h, 1h) + (1h × 9) = 16h ✅ 超過反映

■ 日跨ぎ直後（0:01、remainingDays=8）
  futureRemaining = 8 + 1 = 9
  forecast = 5h + 0h + max(0, 1h) + (1h × 9) = 15h ✅ 下がらない

■ 休日出勤実績あり（7h）
  forecast = 5h + 7h + max(0, 1h) + (1h × 9) = 22h ✅ 休日分加算
```

## 変更ファイル

### 1. background.js — 休日の休憩控除を除去

**対象**: 367-417行（completedDays/holidayWorkMinutes 計算ループ）

現在:
```javascript
// 休憩控除してから休日/平日分岐
if (workingMinutes >= 6 * 60) {
  workingMinutes -= BREAK_MINUTES;
}
if (day.isHoliday) {
  holidayWorkMinutes += workingMinutes;  // ← 控除後の値
} else { ... }
```

変更後:
```javascript
// 休日/平日を先に分岐し、平日のみ休憩控除
if (day.isHoliday) {
  holidayWorkDays++;
  holidayWorkMinutes += workingMinutes;  // 休憩控除なし
} else {
  if (workingMinutes >= 6 * 60) {
    workingMinutes -= BREAK_MINUTES;
  }
  completedDays++;
  const dailyOvertime = Math.max(0, workingMinutes - STANDARD_MINUTES_PER_DAY);
  totalDailyOvertimeMinutes += dailyOvertime;
}
```

### 2. overtime-calc.js — 予測ロジック差し替え

**対象**: 109-114行（forecastOvertime 計算）

引数に `isCrossDaySession` (boolean) を追加。

現在:
```javascript
const totalExpectedDays = realTimeCompletedDays + Math.max(0, remainingDays || 0);
const avgTotalPerDay = Math.round(totalMinutes / safeCompletedDays);
const forecastOvertime = Math.max(0, avgTotalPerDay * totalExpectedDays - scheduledMinutes);
```

変更後:
```javascript
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

### 3. popup.js / content.js — 呼び出し側の変更

`calculateOvertimeData` 呼び出し時に `isCrossDaySession` を渡す。
判定: `clockInTimestamp` が前日の日付かどうか。

## テスト手順（手動）

1. **通常日**: 出勤前→出勤直後→8h超過後で予測値が下がらないことを確認
2. **日跨ぎ**: 23:59→0:01で予測値が下がらないことを確認
3. **休日出勤**: 休日の勤務時間が全額残業として予測に反映されることを確認
4. **月初**: 確定日0日で予測が forecastRate=0 として正常動作することを確認
5. **既存機能**: 8h超過累計、月間残業、残業/日が正常に表示されることを確認
