// background.js

// ログイン試行のチェックが保留中のタブを管理するオブジェクト
const pendingLoginCheck = {}; // { tabId: { isChecking: boolean, alertTriggered: boolean } }

// ログイン成功が確定した後に呼び出される関数
async function handleLoginAttempt(hostname) {
  const data = await chrome.storage.local.get([
    "watched",
    "pending",
    "ignored",
  ]);
  const watched = data.watched || {};
  const pending = data.pending || {};
  const ignored = data.ignored || {};

  if (watched[hostname]) {
    watched[hostname].lastLogin = Date.now();
    await chrome.storage.local.set({ watched });
    console.log(`${hostname} の最終ログイン日時を更新しました。`);
    chrome.alarms.clear(`inactive_${hostname}`);
    return;
  }

  if (ignored[hostname] || pending[hostname]) {
    return;
  }

  pending[hostname] = { addedAt: Date.now() };
  await chrome.storage.local.set({ pending });

  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({ text: pendingCount.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#dc3545" });

  const notificationId = `ask_monitor_${hostname}`;
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "mega.png",
    title: "監視サイトの追加",
    message: `${hostname} を監視リストに追加しますか？`,
    buttons: [{ title: "はい" }, { title: "いいえ" }],
    priority: 2,
    requireInteraction: true,
  });
}

// content scriptから注入され、ページ内のエラーメッセージを確認する関数
function checkForErrorMessages() {
  const errorMessages = [
    "パスワードが間違っている",
    "アカウントが停止されています",
    "パスワードが正しくありません",
    "Incorrect username or password",
    "ログインできませんでした",
    "ID番号とパスワードが一致しません",
  ];
  const pageText = document.body.innerText;
  // 大文字・小文字を区別せずに比較するため、両方を小文字に変換
  const lowerCasePageText = pageText.toLowerCase();
  const hasError = errorMessages.some((msg) =>
    lowerCasePageText.includes(msg.toLowerCase())
  );
  return { success: !hasError };
}

// タブの状態が更新されたときのリスナー
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // チェック保留中のタブで、alertが出ておらず、ページの読み込みが完了したら
  if (
    pendingLoginCheck[tabId] &&
    !pendingLoginCheck[tabId].alertTriggered &&
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.startsWith("http")
  ) {
    if (pendingLoginCheck[tabId].isChecking) {
      return;
    }
    pendingLoginCheck[tabId].isChecking = true;

    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        func: checkForErrorMessages,
      },
      (injectionResults) => {
        if (chrome.runtime.lastError || !injectionResults || !injectionResults[0]) {
          console.error(
            "Script injection failed: ",
            chrome.runtime.lastError?.message || "No results returned"
          );
          delete pendingLoginCheck[tabId];
          return;
        }

        const result = injectionResults[0].result;
        const hostname = new URL(tab.url).hostname;

        if (result && result.success) {
          console.log(`Login success detected on ${hostname}`);
          handleLoginAttempt(hostname);
        } else {
          console.log(`Login failure detected on ${hostname}`);
        }

        delete pendingLoginCheck[tabId];
      }
    );
  }
});

// 通知ボタンのクリックリスナー
chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    if (notificationId.startsWith("ask_monitor_")) {
      const hostname = notificationId.replace("ask_monitor_", "");
      const decision = buttonIndex === 0 ? "add" : "ignore";
      await handleUserDecision(hostname, decision);
      chrome.notifications.clear(notificationId);
    }
  }
);

// ユーザーの決定を処理する関数
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
    watched[hostname] = { lastLogin: Date.now() };
    if (ignored[hostname]) delete ignored[hostname];
  } else {
    ignored[hostname] = { ignoredAt: Date.now() };
  }

  delete pending[hostname];
  await chrome.storage.local.set({ watched, pending, ignored });

  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({
    text: pendingCount > 0 ? pendingCount.toString() : "",
  });

  chrome.notifications.clear(`ask_monitor_${hostname}`);

  chrome.runtime.sendMessage({ type: "DATA_CHANGED" }, (response) => {
    if (chrome.runtime.lastError) {
      /* ポップアップが閉じていればエラーになるが、これは正常な動作 */
    }
  });
}

// content scriptやpopupからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (message.type === "LOGIN_ATTEMPT") {
    pendingLoginCheck[tabId] = { isChecking: false, alertTriggered: false };

    // 短い時間待って、alertによる即時失敗を判定する
    setTimeout(() => {
      if (pendingLoginCheck[tabId] && pendingLoginCheck[tabId].alertTriggered) {
        console.log("Login failure detected by alert for tab:", tabId);
        delete pendingLoginCheck[tabId];
      }
    }, 500);

    // ページ遷移が全く起こらない場合のためのタイムアウト
    setTimeout(() => {
      if (pendingLoginCheck[tabId]) {
        delete pendingLoginCheck[tabId];
      }
    }, 10000);
    
  } else if (message.type === "ALERT_TRIGGERED") {
    if (pendingLoginCheck[tabId]) {
      pendingLoginCheck[tabId].alertTriggered = true;
    }

  } else if (message.type === "USER_DECISION") {
    handleUserDecision(message.hostname, message.decision).then(() =>
      sendResponse({ status: "ok" })
    );
    return true; // 非同期でsendResponseを呼ぶためにtrueを返す
  }
});

// 1日1回、非アクティブなサイトがないかチェックするための定期的なアラームを作成
chrome.alarms.create("daily_check", {
  delayInMinutes: 1,
  periodInMinutes: 1440,
});

// アラームイベントのリスナー
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "daily_check") {
    const data = await chrome.storage.local.get({
      watched: {},
      settings: { inactiveDays: 90, notificationInterval: 7 },
    });

    let watched = data.watched;
    const { inactiveDays, notificationInterval } = data.settings;
    const now = Date.now();
    let needsSave = false;

    const inactiveThreshold = now - inactiveDays * 24 * 60 * 60 * 1000;
    const notifyThreshold = now - notificationInterval * 24 * 60 * 60 * 1000;

    for (const domain in watched) {
      const site = watched[domain];
      const isInactive = site.lastLogin < inactiveThreshold;
      const lastNotified = site.lastNotified || 0;

      if (isInactive && lastNotified < notifyThreshold) {
        chrome.alarms.create(`inactive_${domain}`, { when: Date.now() + 5000 });
        site.lastNotified = now;
        needsSave = true;
      }
    }

    if (needsSave) {
      await chrome.storage.local.set({ watched: watched });
    }
  } else if (alarm.name.startsWith("inactive_")) {
    const data = await chrome.storage.local.get({
      settings: { notificationsEnabled: true },
    });
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

// リロードを検知してログイン試行をリセットするリスナー
chrome.webNavigation.onCommitted.addListener((details) => {
  // リロード操作によってコミットされた場合
  if (details.transitionType === 'reload') {
    const tabId = details.tabId;
    // そのタブがログイン判定中であれば、リセットする
    if (pendingLoginCheck[tabId]) {
      console.log(`Reload detected on tab ${tabId}. Resetting login check.`);
      delete pendingLoginCheck[tabId];
    }
  }
});