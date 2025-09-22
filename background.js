// background.js - 拡張機能のコアロジックを担うサービスワーカー

/**
 * ログイン試行を処理する関数
 * content.jsからログインイベントを受け取ると呼び出される
 * @param {string} hostname - ログインが検知されたサイトのホスト名
 */
async function handleLoginAttempt(hostname) {
  // ストレージから現在の監視状況（監視中、監視待ち、無視）を読み込む
  const data = await chrome.storage.local.get([
    "watched",
    "pending",
    "ignored",
  ]);
  const watched = data.watched || {};
  const pending = data.pending || {};
  const ignored = data.ignored || {};

  // 1. 既に監視中のサイトの場合
  if (watched[hostname]) {
    // 最終ログイン日時を現在時刻に更新
    watched[hostname].lastLogin = Date.now();
    await chrome.storage.local.set({ watched });
    console.log(`${hostname} の最終ログイン日時を更新しました。`);
    // このサイトに関する非アクティブ通知アラームがもしあれば、それを解除する
    chrome.alarms.clear(`inactive_${hostname}`);
    return;
  }

  // 2. 無視リストにあるか、既に監視待ちのサイトの場合は何もしない
  if (ignored[hostname] || pending[hostname]) {
    return;
  }

  // 3. 全く新しいサイトの場合
  // 監視待ちリストに追加
  pending[hostname] = { addedAt: Date.now() };
  await chrome.storage.local.set({ pending });

  // 拡張機能アイコンに監視待ち件数をバッジとして表示
  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({ text: pendingCount.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#dc3545" });

  // ユーザーにこのサイトを監視するかどうかを尋ねる通知を表示
  const notificationId = `ask_monitor_${hostname}`;
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "mega.png",
    title: "監視サイトの追加",
    message: `${hostname} を監視リストに追加しますか？`,
    buttons: [{ title: "はい" }, { title: "いいえ" }],
    priority: 2,
    requireInteraction: true, // ユーザーが操作するまで通知を閉じない
  });
}

/**
 * 通知のボタンがクリックされたときのイベントリスナー
 */
chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    // 監視確認の通知(ask_monitor_*)に対する操作かチェック
    if (notificationId.startsWith("ask_monitor_")) {
      const hostname = notificationId.replace("ask_monitor_", "");
      // "はい"ボタンは0, "いいえ"ボタンは1
      const decision = buttonIndex === 0 ? "add" : "ignore";
      // ユーザーの決定を処理する
      await handleUserDecision(hostname, decision);
      chrome.notifications.clear(notificationId);
    }
  }
);

/**
 * ユーザーの決定（監視するか無視するか）を処理する
 * @param {string} hostname - 対象のホスト名
 * @param {string} decision - "add" (追加) または "ignore" (無視)
 */
async function handleUserDecision(hostname, decision) {
  const data = await chrome.storage.local.get([
    "watched",
    "pending",
    "ignored",
  ]);
  const watched = data.watched || {};
  let pending = data.pending || {};
  const ignored = data.ignored || {};

  if (decision === "add") {
    // 「はい」の場合：監視リストに追加
    watched[hostname] = { lastLogin: Date.now() };
    // もし過去に無視リストに入れていたなら、そこからは削除
    if (ignored[hostname]) delete ignored[hostname];
  } else {
    // 「いいえ」の場合：無視リストに追加
    ignored[hostname] = { ignoredAt: Date.now() };
  }

  // どちらの場合でも、監視待ちリストからは削除
  delete pending[hostname];
  await chrome.storage.local.set({ watched, pending, ignored });

  // 監視待ち件数バッジを更新（0件ならバッジを消す）
  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({
    text: pendingCount > 0 ? pendingCount.toString() : "",
  });

  // ポップアップが開いている場合にUIを更新するようメッセージを送信
  chrome.runtime.sendMessage({ type: "DATA_CHANGED" }, (response) => {
    // ポップアップが閉じていて受信側がいない場合、エラーが発生するが、
    // これは正常な動作なので、コンソールにエラーを表示しないように握りつぶす
    if (chrome.runtime.lastError) {
      /* no-op */
    }
  });
}

/**
 * 他のスクリプト（content.jsやpopup.js）からのメッセージを受け取るリスナー
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // content.jsからのログイン検知メッセージ
  if (message.type === "PASSWORD_SUBMIT") {
    handleLoginAttempt(message.hostname);
  }
  // popup.jsからのユーザー操作（監視待ちリストへの返答など）
  else if (message.type === "USER_DECISION") {
    handleUserDecision(message.hostname, message.decision).then(() =>
      sendResponse({ status: "ok" })
    );
    // 非同期でsendResponseを呼ぶためにtrueを返す
    return true;
  }
});

/**
 * 定期的な処理を実行するためのアラームを設定
 * daily_check: 1日ごとに非アクティブなサイトがないかチェックする
 */
chrome.alarms.create("daily_check", {
  delayInMinutes: 1, // 起動後1分で初回実行
  periodInMinutes: 1440, // 1440分 = 24時間
});

/**
 * アラームイベントのリスナー
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // 1日ごとの定期チェック
  if (alarm.name === "daily_check") {
    const data = await chrome.storage.local.get({
      watched: {},
      settings: { inactiveDays: 90, notificationInterval: 7 }, // 設定値のデフォルト
    });

    const watched = data.watched;
    const { inactiveDays, notificationInterval } = data.settings;
    const now = Date.now();
    let needsSave = false; // watchedオブジェクトに変更があったか

    // 非アクティブと判断する期間（ミリ秒）
    const inactiveThreshold = now - inactiveDays * 24 * 60 * 60 * 1000;
    // 次の通知までの最低間隔（ミリ秒）
    const notifyThreshold = now - notificationInterval * 24 * 60 * 60 * 1000;

    for (const domain in watched) {
      const site = watched[domain];
      const isInactive = site.lastLogin < inactiveThreshold;
      const lastNotified = site.lastNotified || 0; // 未通知の場合は0

      // 条件：非アクティブであり、かつ前回の通知から指定期間が経過している
      if (isInactive && lastNotified < notifyThreshold) {
        // すぐに通知を出すための個別アラームを設定
        chrome.alarms.create(`inactive_${domain}`, { when: Date.now() + 5000 });
        // 最終通知日時を更新
        site.lastNotified = now;
        needsSave = true;
      }
    }

    // 最終通知日時を更新した場合、ストレージに保存
    if (needsSave) {
      await chrome.storage.local.set({ watched: watched });
    }
  }
  // 個別の非アクティブ通知用アラーム
  else if (alarm.name.startsWith("inactive_")) {
    const data = await chrome.storage.local.get({
      settings: { notificationsEnabled: true },
    });
    // 設定で通知が有効になっている場合のみ通知を表示
    if (data.settings.notificationsEnabled) {
      const domain = alarm.name.replace("inactive_", "");
      chrome.notifications.create(`notify_${domain}`, {
        type: "basic",
        iconUrl: "mega.png",
        title: "非アクティブなアカウント",
        message: `${domain} に${data.settings.inactiveDays || 90}日以上ログインしていません。アカウントの整理を検討しましょう。`,
        priority: 2,
      });
    }
  }
});