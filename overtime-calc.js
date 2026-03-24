// TeamSpirit Assistant - Overtime Calculation Logic
// popup.js と content.js で共通利用する残業計算ロジック
// DOM操作は含まない。純粋な計算のみ。

// Calculate all overtime-related data
// Returns an object with all computed values for DOM rendering
// completedDays: 退勤打刻済み日数（当日除く）
// totalDailyOvertimeMinutes: 日次残業の合計（各日の(勤務時間-8時間)を合算、当日除く）
// holidayWorkMinutes: 休日出勤時間（分）。法的残業・過不足から除外するために使用
function calculateOvertimeData(totalMinutes, actualDays, scheduledMinutes, todayWorkingMinutes, remainingDays, completedDays, totalDailyOvertimeMinutes, holidayWorkMinutes, isCrossDaySession) {
  const STANDARD_HOURS_PER_DAY = CONFIG.STANDARD_HOURS_PER_DAY;
  const OVERTIME_LIMIT = CONFIG.OVERTIME_LIMIT;
  const BREAK_MINUTES = CONFIG.BREAK_MINUTES;

  // 入力値の NaN 防御（NaN は全比較が false になり「安全」と誤判定されるため）
  totalMinutes = (isNaN(totalMinutes) || totalMinutes === null) ? 0 : totalMinutes;
  actualDays = (isNaN(actualDays) || actualDays === null) ? 0 : actualDays;
  scheduledMinutes = (isNaN(scheduledMinutes) || scheduledMinutes === null) ? 0 : scheduledMinutes;
  todayWorkingMinutes = (isNaN(todayWorkingMinutes) || todayWorkingMinutes === null) ? 0 : todayWorkingMinutes;
  remainingDays = (isNaN(remainingDays) || remainingDays === null) ? 0 : remainingDays;
  completedDays = (isNaN(completedDays) || completedDays === null) ? 0 : completedDays;
  totalDailyOvertimeMinutes = (isNaN(totalDailyOvertimeMinutes) || totalDailyOvertimeMinutes === null) ? 0 : totalDailyOvertimeMinutes;
  holidayWorkMinutes = (isNaN(holidayWorkMinutes) || holidayWorkMinutes === null) ? 0 : holidayWorkMinutes;
  isCrossDaySession = !!isCrossDaySession;

  // 休日出勤を除外した平日勤務時間（法的計算用）
  const workdayTotalMinutes = totalMinutes - holidayWorkMinutes;

  // actualDaysが0の場合は1として扱う（0除算防止、月初め対応）
  const safeActualDays = actualDays > 0 ? actualDays : 1;

  // 当日の8h超過分をリアルタイム算出
  // todayWorkingMinutes は出勤時刻からの経過時間（休憩未控除）
  // 6時間以上勤務なら1時間の休憩を控除して実勤務時間を算出
  let todayNetWorkingMinutes = todayWorkingMinutes || 0;
  if (todayNetWorkingMinutes >= 6 * 60) {
    todayNetWorkingMinutes -= BREAK_MINUTES;
  }
  const todayExcess = Math.max(0, todayNetWorkingMinutes - STANDARD_HOURS_PER_DAY);

  // 当日分を含めた8h超過累計（リアルタイム）
  const baseDailyOvertimeMinutes = totalDailyOvertimeMinutes;
  const realTimeDailyOvertimeMinutes = baseDailyOvertimeMinutes + todayExcess;

  // 当日を含めた勤務日数（出勤中 or 当日勤務実績がある場合 +1）
  const baseCompletedDays = (completedDays && completedDays > 0) ? completedDays : 0;
  const realTimeCompletedDays = (todayWorkingMinutes > 0)
    ? baseCompletedDays + 1
    : baseCompletedDays;

  // 退勤打刻済み日数（当日含む、0除算防止）
  const safeCompletedDays = realTimeCompletedDays > 0 ? realTimeCompletedDays : safeActualDays;

  // 平均/日（休日出勤を除外した平日勤務時間 ÷ 勤務日数）
  const avgMinutesPerDay = Math.round(workdayTotalMinutes / safeCompletedDays);

  // 残業/日の計算（当日分を含むリアルタイム計算）
  // = 日次残業の合計（当日含む） ÷ 勤務日数（当日含む）
  let avgOvertimePerDay;
  if (safeCompletedDays > 0) {
    avgOvertimePerDay = Math.round(realTimeDailyOvertimeMinutes / safeCompletedDays);
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

  // 8h超過累計（健康管理指標）= 日次残業（8時間超過分）の合計 + 当日超過分
  // 各日について8時間を超えた分のみを加算、8時間未満の日は0
  // リアルタイム: 当日の超過分（todayExcess）を含む
  const dailyExcessTotal = realTimeDailyOvertimeMinutes;

  // 月間残業 = max(0, 総労働時間 - 所定労働時間)
  // フルフレックスでは休日出勤（所定休日）も含めた全労働時間で算出
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
    // 月間残業（法的）- 休日出勤除外
    legalOvertime,
    legalOvertimeLevel,
    legalOvertimeHours,
    // 8h超過累計（健康管理指標、当日分含むリアルタイム値）
    dailyExcessTotal,
    dailyExcessLevel,
    // 月末予測（リアルタイム）
    forecastOvertime,
    forecastLevel,
    alertText,
    badgeText,
    // 勤務日数（当日含むリアルタイム値）
    realTimeCompletedDays,
    // 平日勤務時間（休日出勤除外）
    workdayTotalMinutes
  };
}
