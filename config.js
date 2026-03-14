// TeamSpirit Assistant - Configuration
// 組織固有の設定と定数を一元管理する
// ※ manifest.json の host_permissions / content_scripts.matches でも同じドメインを使用

const CONFIG = {
  // 組織ID
  TS_ORG_ID: 'teamspirit-74532',

  // URL定数
  TEAMSPIRIT_URL: 'https://teamspirit-74532.lightning.force.com/lightning/page/home',
  TEAMSPIRIT_ATTENDANCE_URL: 'https://teamspirit-74532.lightning.force.com/lightning/n/teamspirit__AtkWorkTimeTab',
  LOGIN_URL: 'https://login.salesforce.com/',
  MY_DOMAIN_LOGIN_URL: 'https://teamspirit-74532.my.salesforce.com/',
  HOLIDAYS_API_URL: 'https://holidays-jp.github.io/api/v1/date.json',

  // タブ検索用URLパターン（manifest.json の host_permissions と同期すること）
  TAB_QUERY_PATTERNS: [
    'https://teamspirit-74532.lightning.force.com/*',
    'https://teamspirit-74532.my.salesforce.com/*',
    'https://login.salesforce.com/*',
    'https://*.salesforce.com/*',
    'https://*.my.salesforce.com/*',
    'https://*.force.com/*'
  ],

  // 暗号化キー（セキュリティ改善タスクで別途対応予定）
  ENCRYPTION_KEY: 'ts-assistant-v3-2026',

  // 作業時間定数
  STANDARD_HOURS_PER_DAY: 8 * 60, // 8時間 = 480分
  BREAK_MINUTES: 60,               // 休憩1時間
  OVERTIME_LIMIT: 45 * 60,         // 45時間 = 2700分
  MAX_WORKING_MINUTES_PER_DAY: 24 * 60, // 24時間 = 1440分（異常値検出用）

  // タイミング定数
  HALF_DAY_MS: 12 * 60 * 60 * 1000,       // 12時間（日跨ぎ判定閾値）
  TWENTY_FOUR_HOURS_MS: 24 * 60 * 60 * 1000, // 24時間
  RECENT_PUNCH_THRESHOLD_MS: 60 * 1000,    // 60秒（打刻保護期間）
  CACHE_TTL_MS: 30 * 1000,                 // 30秒（キャッシュ有効期間）
  TAB_LOAD_TIMEOUT_MS: 60 * 1000,          // 60秒（タブ読み込みタイムアウト）
  POLL_INTERVAL_MS: 500                     // 500ms（ポーリング間隔）
};
