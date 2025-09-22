// background.js

// ログイン試行を処理する非同期関数
async function handleLoginAttempt(hostname) {
  // ストレージから監視対象(watched)、監視待ち(pending)、無視(ignored)のリストを取得
  const data = await chrome.storage.local.get([
    "watched",
    "pending",
    "ignored",
  ]);
  const watched = data.watched || {};
  const pending = data.pending || {};
  const ignored = data.ignored || {};

  // すでに監視対象のサイトの場合
  if (watched[hostname]) {
    // 最終ログイン日時を現在時刻で更新
    watched[hostname].lastLogin = Date.now();
    await chrome.storage.local.set({ watched });
    console.log(`${hostname} の最終ログイン日時を更新しました。`);
    // このサイトに対する非アクティブ通知アラームをクリア
    chrome.alarms.clear(`inactive_${hostname}`);
    return;
  }
  // 無視リストまたは監視待ちリストにすでにある場合は何もしない
  if (ignored[hostname] || pending[hostname]) {
    return;
  }

  // 新しいサイトの場合、監視待ちリストに追加
  pending[hostname] = { addedAt: Date.now() };
  await chrome.storage.local.set({ pending });

  // 拡張機能アイコンに監視待ちの件数をバッジとして表示
  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({ text: pendingCount.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#dc3545" });

  // ユーザーにこのサイトを監視するかどうかを尋ねる通知を作成
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

// 通知のボタンがクリックされたときのイベントリスナー
chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    // 監視確認の通知であるかを確認
    if (notificationId.startsWith("ask_monitor_")) {
      const hostname = notificationId.replace("ask_monitor_", "");
      // 0番目のボタン（"はい"）が押されたら 'add'、それ以外は 'ignore' とする
      const decision = buttonIndex === 0 ? "add" : "ignore";
      // ユーザーの決定を処理する関数を呼び出す
      await handleUserDecision(hostname, decision);
      // 通知を閉じる
      chrome.notifications.clear(notificationId);
    }
  }
);

// ユーザーの決定（監視するか無視するか）を処理する非同期関数
async function handleUserDecision(hostname, decision) {
  // ストレージから各リストを取得
  const data = await chrome.storage.local.get([
    "watched",
    "pending",
    "ignored",
  ]);
  const watched = data.watched || {};
  let pending = data.pending || {};
  const ignored = data.ignored || {};

  if (decision === "add") {
    // 「はい」の場合、監視リストに追加し、最終ログイン日時を記録
    watched[hostname] = { lastLogin: Date.now() };
    // もし無視リストにあれば削除
    if (ignored[hostname]) delete ignored[hostname];
  } else {
    // 「いいえ」の場合、無視リストに追加
    ignored[hostname] = { ignoredAt: Date.now() };
  }

  // 監視待ちリストからは削除
  delete pending[hostname];
  // 更新されたリストをストレージに保存
  await chrome.storage.local.set({ watched, pending, ignored });

  // バッジの件数を更新（0件ならバッジを消す）
  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({
    text: pendingCount > 0 ? pendingCount.toString() : "",
  });

  // 関連する通知をクリア
  chrome.notifications.clear(`ask_monitor_${hostname}`);

  // ポップアップが開いている場合に、表示を更新するようメッセージを送信
  chrome.runtime.sendMessage({ type: "DATA_CHANGED" }, (response) => {
    // ポップアップが閉じていて受信側がいない場合エラーが出るが、これは想定内なので握りつぶす
    if (chrome.runtime.lastError) {
      // 意図的に何もしない
    }
  });
}

// content scriptやpopupからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PASSWORD_SUBMIT") {
    // ログイン試行のメッセージなら、関連処理を呼び出す
    handleLoginAttempt(message.hostname);
  } else if (message.type === "USER_DECISION") {
    // ポップアップからのユーザー決定なら、関連処理を呼び出す
    handleUserDecision(message.hostname, message.decision).then(() =>
      sendResponse({ status: "ok" })
    );
    return true; // 非同期でsendResponseを呼ぶためにtrueを返す
  }
});

// 1日1回、非アクティブなサイトがないかチェックするための定期的なアラームを作成
chrome.alarms.create("daily_check", {
  delayInMinutes: 1,      // 1分後に開始
  periodInMinutes: 1440,  // 1440分 = 24時間ごとに実行
});

// アラームイベントのリスナー
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // 1日1回のチェックアラームの場合
  if (alarm.name === "daily_check") {
    const data = await chrome.storage.local.get({
      watched: {},
      settings: { inactiveDays: 90, notificationInterval: 7 }, // デフォルト設定
    });

    let watched = data.watched;
    const { inactiveDays, notificationInterval } = data.settings;
    const now = Date.now();
    let needsSave = false; // ストレージを更新する必要があるかどうかのフラグ

    // 非アクティブと判断する期間（ミリ秒）
    const inactiveThreshold = now - inactiveDays * 24 * 60 * 60 * 1000;
    // 再通知を許可する期間（ミリ秒）
    const notifyThreshold = now - notificationInterval * 24 * 60 * 60 * 1000;

    // 全ての監視対象サイトをループでチェック
    for (const domain in watched) {
      const site = watched[domain];
      const isInactive = site.lastLogin < inactiveThreshold;
      const lastNotified = site.lastNotified || 0; // 前回通知日時（なければ0）

      // サイトが非アクティブで、かつ前回の通知から指定期間が経過している場合
      if (isInactive && lastNotified < notifyThreshold) {
        // 5秒後に通知を出すための個別アラームを設定
        chrome.alarms.create(`inactive_${domain}`, { when: Date.now() + 5000 });
        // 最終通知日時を更新
        site.lastNotified = now;
        needsSave = true;
      }
    }

    // 変更があった場合のみストレージに保存
    if (needsSave) {
      await chrome.storage.local.set({ watched: watched });
    }
  } 
  // 個別の非アクティブ通知用アラームの場合
  else if (alarm.name.startsWith("inactive_")) {
    const data = await chrome.storage.local.get({
      settings: { notificationsEnabled: true },
    });
    // 設定で通知が有効になっている場合のみ通知を作成
    if (data.settings.notificationsEnabled) {
      const domain = alarm.name.replace("inactive_", "");
      chrome.notifications.create(`notify_${domain}`, {
        type: "basic",
        iconUrl: "mega.png",
        title: "非アクティブなアカウント",
        message: `${domain} に90日以上ログインしていません。アカウントの整理を検討しましょう。`,
        priority: 2,
      });
    }
  }
});