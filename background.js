// background.js

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
    // decision === 'ignore'
    ignored[hostname] = { ignoredAt: Date.now() };
  }

  delete pending[hostname];
  await chrome.storage.local.set({ watched, pending, ignored });

  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({
    text: pendingCount > 0 ? pendingCount.toString() : "",
  });

  chrome.notifications.clear(`ask_monitor_${hostname}`);

  // ポップアップが開いている場合に、表示を更新するよう通知する
  chrome.runtime.sendMessage({ type: "DATA_CHANGED" }, (response) => {
    // ポップアップが閉じていて受信側がいない場合、chrome.runtime.lastErrorが設定される。
    // このエラーは想定内の動作なので、コンソールに表示させないようにここで消す。
    if (chrome.runtime.lastError) {
      // 意図的に何もしない
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PASSWORD_SUBMIT") {
    handleLoginAttempt(message.hostname);
  } else if (message.type === "USER_DECISION") {
    handleUserDecision(message.hostname, message.decision).then(() =>
      sendResponse({ status: "ok" })
    );
    return true;
  }
});

chrome.alarms.create("daily_check", {
  delayInMinutes: 1,
  periodInMinutes: 1440,
});

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
