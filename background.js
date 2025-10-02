const validationQueue = {};
const pendingLoginCheck = {};
const webRequestListeners = new Map();

async function handleSuccessfulLogin(hostname) {
  const data = await chrome.storage.local.get([
    "watched",
    "pending",
    "ignored",
  ]);
  const watched = data.watched || {};
  let pending = data.pending || {};
  const ignored = data.ignored || {};
  if (watched[hostname]) {
    watched[hostname].lastLogin = Date.now();
    await chrome.storage.local.set({ watched });
    return;
  }
  if (ignored[hostname] || pending[hostname]) return;
  pending[hostname] = { addedAt: Date.now() };
  await chrome.storage.local.set({ pending });
  const pendingCount = Object.keys(pending).length;
  chrome.action.setBadgeText({ text: pendingCount.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#dc3545" });
  chrome.notifications.create(`ask_monitor_${hostname}`, {
    type: "basic",
    iconUrl: "icon.png",
    title: "監視サイトの追加",
    message: `${hostname} を監視リストに追加しますか？`,
    buttons: [{ title: "はい" }, { title: "いいえ" }],
    priority: 2,
    requireInteraction: true,
  });
}

function checkForErrorMessages() {
  const errorMessages = [
    "パスワードが間違っている",
    "アカウントが停止されています",
    "パスワードが正しくありません",
    "Incorrect username or password",
    "ログインできませんでした",
    "パスワードが一致しません",
    "password is incorrect",
    "パスワードが違います",
    "password does not match",
    "アカウントがロックされています",
    "account is locked",
    "アカウントが無効です",
    "account is disabled",
    "password incorrect",
    "invalid password",
    "invalid username or password",
  ];
  const lowerCasePageText = document.body.innerText.toLowerCase();
  const hasError = errorMessages.some((msg) =>
    lowerCasePageText.includes(msg.toLowerCase())
  );
  return { success: !hasError };
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    pendingLoginCheck[tabId] &&
    !pendingLoginCheck[tabId].alertTriggered &&
    changeInfo.status === "complete" &&
    tab.url?.startsWith("http")
  ) {
    if (pendingLoginCheck[tabId].isChecking) return;
    pendingLoginCheck[tabId].isChecking = true;
    chrome.scripting.executeScript(
      { target: { tabId }, func: checkForErrorMessages },
      (injectionResults) => {
        if (chrome.runtime.lastError || !injectionResults?.[0]) {
          delete pendingLoginCheck[tabId];
          return;
        }
        const result = injectionResults[0].result;
        if (result?.success) handleSuccessfulLogin(new URL(tab.url).hostname);
        delete pendingLoginCheck[tabId];
      }
    );
  }
  if (
    changeInfo.status === "complete" &&
    validationQueue[tabId]?.isSecondaryCheck
  ) {
    setTimeout(() => {
      if (validationQueue[tabId]) {
        chrome.scripting
          .executeScript({ target: { tabId }, files: ["validator.js"] })
          .catch((err) => {
            delete validationQueue[tabId];
          });
      }
    }, 500);
  }
});

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
  chrome.runtime.sendMessage({ type: "DATA_CHANGED" }).catch((e) => {});
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

function handleValidationFailure(tabId, url) {
  if (!validationQueue[tabId]) return;
  const { fallbackUrl } = validationQueue[tabId];
  chrome.tabs.create({ url: fallbackUrl, active: true });
  chrome.tabs.remove(tabId);
  delete validationQueue[tabId];
}

function handleValidationSuccess(tabId, url) {}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (message.type === "LOGIN_ATTEMPT") {
    if (!tabId) return;
    pendingLoginCheck[tabId] = { isChecking: false, alertTriggered: false };
    setTimeout(() => {
      if (pendingLoginCheck[tabId]?.alertTriggered)
        delete pendingLoginCheck[tabId];
    }, 500);
    return;
  }
  if (message.type === "ALERT_TRIGGERED") {
    if (tabId && pendingLoginCheck[tabId])
      pendingLoginCheck[tabId].alertTriggered = true;
    return;
  }
  if (message.type === "USER_DECISION") {
    handleUserDecision(message.hostname, message.decision).then(() =>
      sendResponse({ status: "ok" })
    );
    return true;
  }
  if (message.type === "VALIDATE_URL") {
    const { tabId, fallbackUrl } = message;
    validationQueue[tabId] = { fallbackUrl, isSecondaryCheck: false };
    const listener = (details) => {
      if (details.tabId === tabId && details.type === "main_frame") {
        if (details.statusCode >= 400) {
          handleValidationFailure(tabId, details.url);
        } else {
          validationQueue[tabId].isSecondaryCheck = true;
        }
        chrome.webRequest.onCompleted.removeListener(listener);
        webRequestListeners.delete(tabId);
      }
    };
    chrome.webRequest.onCompleted.addListener(listener, {
      urls: ["<all_urls>"],
      tabId: tabId,
    });
    webRequestListeners.set(tabId, listener);
    return;
  }
  if (message.type === "VALIDATION_RESULT") {
    if (validationQueue[tabId]) {
      if (message.success) handleValidationSuccess(tabId, sender.tab.url);
      else handleValidationFailure(tabId, sender.tab.url);
      delete validationQueue[tabId];
    }
  }
  if (message.type === "SETTINGS_SAVED") {
    setupPeriodicCheckAlarm();
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (validationQueue[tabId]) delete validationQueue[tabId];
  if (webRequestListeners.has(tabId)) {
    chrome.webRequest.onCompleted.removeListener(
      webRequestListeners.get(tabId)
    );
    webRequestListeners.delete(tabId);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.transitionType === "reload" && pendingLoginCheck[details.tabId]) {
    delete pendingLoginCheck[details.tabId];
  }
});

async function setupPeriodicCheckAlarm() {
  chrome.alarms.create("periodic_check", {
    delayInMinutes: 1,
    periodInMinutes: 1440,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupPeriodicCheckAlarm();
});

function sendInactiveNotification(domain, inactiveDays) {
  const notificationId = `notify_inactive_${domain}_${Date.now()}`;
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icon.png",
    title: "非アクティブなアカウント",
    message: `${domain} に${inactiveDays}日以上ログインしていません。`,
    priority: 2,
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "periodic_check") {
    const data = await chrome.storage.local.get({
      watched: {},
      settings: {
        notificationsEnabled: true,
        inactiveDays: 90,
        notificationInterval: 7,
      },
    });

    if (!data.settings.notificationsEnabled) {
      return;
    }

    const watched = data.watched;
    const { inactiveDays, notificationInterval } = data.settings;
    const now = Date.now();
    const inactiveThreshold = now - inactiveDays * 24 * 60 * 60 * 1000;
    let needsSave = false;

    for (const domain in watched) {
      const site = watched[domain];
      const isInactive = site.lastLogin < inactiveThreshold;
      const lastNotified = site.lastNotified || 0;

      if (isInactive && site.lastLogin > lastNotified) {
        sendInactiveNotification(domain, inactiveDays);
        site.lastNotified = now;
        needsSave = true;
      } else if (isInactive && site.lastLogin <= lastNotified) {
        const intervalMillis = notificationInterval * 24 * 60 * 60 * 1000;
        if (now - lastNotified >= intervalMillis) {
          sendInactiveNotification(domain, inactiveDays);
          site.lastNotified = now;
          needsSave = true;
        }
      }
    }

    if (needsSave) {
      await chrome.storage.local.set({ watched: watched });
    }
  }
});
