# 月末予測の退勤後収束 設計書

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 退勤後は月末予測に実績値を使い、予測精度を向上させる。

**Architecture:** overtime-calc.js に `hasClockedOut` 引数を追加。退勤済みなら `todayExcess` をそのまま使用。popup.js/content.js から伝搬。

**Tech Stack:** Chrome Extension (Manifest V3), JavaScript (ES6+)

---

## 変更内容

### overtime-calc.js

引数に `hasClockedOut` (boolean) を追加。todayContribution の判定を変更：

```javascript
const todayContribution = todayWorkingMinutes > 0
  ? (remainingDays === 0 || hasClockedOut
      ? todayExcess
      : Math.max(todayExcess, forecastRate))
  : 0;
```

| 状態 | todayContribution | 理由 |
|------|------------------|------|
| 出勤中 | max(todayExcess, forecastRate) | 予測安定化 |
| 退勤済み | todayExcess | 実績確定、即座に収束 |
| 最終日 | todayExcess | 完全収束（既存） |

### popup.js

- `updateOvertimeSectionRealTime`: `hasClockedOut` を引数追加、`calculateOvertimeData` に渡す
- `updateOvertimeSection` (displaySummary経由): 同上
- 判定: `isWorking` の否定 or storage の `hasClockedOut`

### content.js

- `updateOvertimeSection`: `hasClockedOut` を引数追加、`calculateOvertimeData` に渡す
- 判定: storage の `hasClockedOut` (既に `cachedData` 経由で利用可能)
