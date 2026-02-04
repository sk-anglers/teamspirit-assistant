// TeamSpirit Assistant - Overtime Calculation Logic
// popup.js と content.js で共通利用する残業計算ロジック
// DOM操作は含まない。純粋な計算のみ。

// Calculate all overtime-related data
// Returns an object with all computed values for DOM rendering
// completedDays: 退勤打刻済み日数（オプショナル）
// totalDailyOvertimeMinutes: 日次残業の合計（各日の(勤務時間-8時間)を合算）
function calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes) {
  const STANDARD_HOURS_PER_DAY = CONFIG.STANDARD_HOURS_PER_DAY;
  const OVERTIME_LIMIT = CONFIG.OVERTIME_LIMIT;

  // actualDaysが0の場合は1として扱う（0除算防止、月初め対応）
  const safeActualDays = actualDays > 0 ? actualDays : 1;

  // 退勤打刻済み日数（completedDaysがない場合はactualDaysで代用）
  const safeCompletedDays = (completedDays && completedDays > 0) ? completedDays : safeActualDays;

  // 平均/日（確定分、退勤打刻済み日数で計算）
  const avgMinutesPerDay = Math.round(totalMinutes / safeCompletedDays);

  // 残業/日の計算（新方式）
  // = 日次残業の合計 ÷ 退勤打刻済み日数
  // 各日の(勤務時間 - 8時間)を合算した値を使用
  let avgOvertimePerDay;
  if (totalDailyOvertimeMinutes !== undefined &&
      totalDailyOvertimeMinutes !== null &&
      !isNaN(totalDailyOvertimeMinutes) &&
      safeCompletedDays > 0) {
    // 新方式: 日次残業合計 ÷ 勤務日数
    avgOvertimePerDay = Math.round(totalDailyOvertimeMinutes / safeCompletedDays);
  } else {
    // フォールバック: 従来方式（平均勤務時間 - 8時間）
    avgOvertimePerDay = avgMinutesPerDay - STANDARD_HOURS_PER_DAY;
  }

  // 残業/日の警告レベル
  let avgOvertimeLevel;
  if (avgOvertimePerDay >= 120) {
    avgOvertimeLevel = 'danger';     // 2時間以上
  } else if (avgOvertimePerDay >= 60) {
    avgOvertimeLevel = 'warning';    // 1-2時間
  } else if (avgOvertimePerDay > 0) {
    avgOvertimeLevel = 'caution';    // 0-1時間
  } else {
    avgOvertimeLevel = 'safe';
  }

  // 8h超過累計（健康管理指標）= 日次残業（8時間超過分）の合計
  // 各日について8時間を超えた分のみを加算、8時間未満の日は0
  const dailyExcessTotal = (totalDailyOvertimeMinutes !== undefined && totalDailyOvertimeMinutes !== null)
    ? totalDailyOvertimeMinutes
    : 0;

  // 月間残業（法的）= max(0, 総勤務時間 - 月間所定労働時間)
  // 所定未満の場合は0（マイナス表示しない）
  const legalOvertime = scheduledMinutes
    ? Math.max(0, totalMinutes - scheduledMinutes)
    : 0;

  // 月間残業（法的）の警告レベル
  let legalOvertimeLevel;
  if (legalOvertime > OVERTIME_LIMIT) {
    legalOvertimeLevel = 'danger';
  } else if (legalOvertime > OVERTIME_LIMIT * 0.8) {
    legalOvertimeLevel = 'warning';
  } else {
    legalOvertimeLevel = 'normal';
  }

  // 8h超過累計の警告レベル
  let dailyExcessLevel;
  if (dailyExcessTotal > OVERTIME_LIMIT) {
    dailyExcessLevel = 'danger';
  } else if (dailyExcessTotal > OVERTIME_LIMIT * 0.8) {
    dailyExcessLevel = 'warning';
  } else {
    dailyExcessLevel = 'normal';
  }

  // 月末予測（8h超過累計ベース）
  // 今のペースで残業を続けた場合の月末予測
  // = 8h超過累計 + (残り勤務日数 × 残業/日)
  const forecastOvertime = dailyExcessTotal + (avgOvertimePerDay * (remainingDays || 0));

  // 月末予測の警告レベル
  let forecastLevel;
  let alertText = '';
  let badgeText = '';
  const legalOvertimeHours = Math.floor(legalOvertime / 60);

  if (legalOvertime > OVERTIME_LIMIT) {
    // 既に45時間超過
    forecastLevel = 'exceeded';
    alertText = `🚨 月${legalOvertimeHours}時間超過中！`;
    badgeText = '超過中';
  } else if (forecastOvertime > OVERTIME_LIMIT) {
    // 超過見込み
    forecastLevel = 'warning';
    alertText = '⚠️ 45時間超過見込み';
    badgeText = '注意';
  } else {
    forecastLevel = 'safe';
    badgeText = '正常';
  }

  return {
    avgMinutesPerDay,
    avgOvertimePerDay,
    avgOvertimeLevel,
    // 月間残業（法的）
    legalOvertime,
    legalOvertimeLevel,
    legalOvertimeHours,
    // 8h超過累計（健康管理指標）
    dailyExcessTotal,
    dailyExcessLevel,
    // 月末予測
    forecastOvertime,
    forecastLevel,
    alertText,
    badgeText,
    // 後方互換性のため残す
    monthlyOvertime: legalOvertime,
    monthlyOvertimeLevel: legalOvertimeLevel,
    overtimeHours: legalOvertimeHours
  };
}
