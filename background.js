// background.js

const validationQueue = {}; // 監視中のタブを管理するオブジェクト

async function handleLoginAttempt(hostname) {
    const data = await chrome.storage.local.get(['watched', 'pending', 'ignored']);
    const watched = data.watched || {};
    let pending = data.pending || {};
    const ignored = data.ignored || {};
    if (watched[hostname] || ignored[hostname] || pending[hostname]) {
        if (watched[hostname]) {
            watched[hostname].lastLogin = Date.now();
            await chrome.storage.local.set({ watched });
            chrome.alarms.clear(`inactive_${hostname}`);
        }
        return;
    }
    if (!pending[hostname]) {
        pending[hostname] = { addedAt: Date.now() };
        await chrome.storage.local.set({ pending });
        const pendingCount = Object.keys(pending).length;
        chrome.action.setBadgeText({ text: pendingCount.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    }
    const notificationId = `ask_monitor_${hostname}`;
    chrome.notifications.create(notificationId, {
        type: 'basic', iconUrl: 'mega.png', title: '監視サイトの追加',
        message: `${hostname} を監視リストに追加しますか？`,
        buttons: [{ title: 'はい' }, { title: 'いいえ' }],
        priority: 2, requireInteraction: true
    }, (createdId) => {
        if (chrome.runtime.lastError) { console.error("通知の作成に失敗: ", chrome.runtime.lastError.message); }
    });
}

async function handleUserDecision(hostname, decision) {
    const data = await chrome.storage.local.get(['watched', 'pending', 'ignored']);
    const watched = data.watched || {};
    let pending = data.pending || {};
    const ignored = data.ignored || {};
    if (decision === 'add') {
        watched[hostname] = { lastLogin: Date.now() };
        if (ignored[hostname]) delete ignored[hostname];
        const feedbackMessage = `${hostname} を監視リストに追加しました。`;
        chrome.notifications.create({ type: 'basic', iconUrl: 'mega.png', title: '設定完了', message: feedbackMessage }, (id) => { setTimeout(() => { chrome.notifications.clear(id); }, 5000); });
    } else {
        ignored[hostname] = { ignoredAt: Date.now() };
    }
    delete pending[hostname]; 
    await chrome.storage.local.set({ watched, pending, ignored });
    const pendingCount = Object.keys(pending).length;
    chrome.action.setBadgeText({ text: pendingCount > 0 ? pendingCount.toString() : '' });
    chrome.notifications.clear(`ask_monitor_${hostname}`);
    chrome.runtime.sendMessage({ type: 'DATA_CHANGED' });
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (notificationId.startsWith('ask_monitor_')) {
        const hostname = notificationId.replace('ask_monitor_', '');
        const decision = (buttonIndex === 0) ? 'add' : 'ignore';
        await handleUserDecision(hostname, decision);
        chrome.notifications.clear(notificationId);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PASSWORD_SUBMIT') {
        handleLoginAttempt(message.hostname);
    } else if (message.type === 'USER_DECISION') {
        handleUserDecision(message.hostname, message.decision).then(() => sendResponse({status: "ok"}));
        return true;
    } else if (message.type === 'VALIDATE_URL') {
        validationQueue[message.tabId] = message.fallbackUrl;
    } else if (message.type === 'VALIDATION_RESULT') {
        const tabId = sender.tab.id;
        if (validationQueue[tabId]) {
            if (!message.success) {
                chrome.tabs.create({ url: validationQueue[tabId], active: false });
                chrome.tabs.remove(tabId);
            }
            delete validationQueue[tabId];
        }
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && validationQueue[tabId]) {
        try {
            await chrome.tabs.get(tabId);
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['validator.js']
            });
        } catch (error) {
            console.log(`Tab with ID ${tabId} was closed before validation could run.`);
            delete validationQueue[tabId];
        }
    }
});

chrome.alarms.create('daily_check', { delayInMinutes: 1, periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'daily_check') {
        const data = await chrome.storage.local.get({
            watched: {},
            settings: { inactiveDays: 90, notificationInterval: 7 }
        });
        let watched = data.watched;
        const { inactiveDays, notificationInterval } = data.settings;
        const now = Date.now();
        let needsSave = false;
        const inactiveThreshold = now - (inactiveDays * 24 * 60 * 60 * 1000);
        const notifyThreshold = now - (notificationInterval * 24 * 60 * 60 * 1000);
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
    } else if (alarm.name.startsWith('inactive_')) {
        const data = await chrome.storage.local.get({ settings: { notificationsEnabled: true } });
        if (data.settings.notificationsEnabled) {
            const domain = alarm.name.replace('inactive_', '');
            chrome.notifications.create(`notify_${domain}`, {
                type: 'basic', iconUrl: 'mega.png', title: '非アクティブなアカウント',
                message: `${domain} に長期間ログインしていません。アカウントの整理を検討しましょう。`,
                priority: 2
            });
        }
    }
});