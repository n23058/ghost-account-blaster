document.addEventListener("DOMContentLoaded", () => {
    renderAll();
    setupSettingsModal();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DATA_CHANGED') {
        renderAll();
    }
});

const pendingList = document.getElementById("pendingList");
const siteList = document.getElementById("siteList");
const showAllBtn = document.getElementById("showAllBtn");
const msgEl = document.getElementById("noAccountsMsg");

let showAll = false;

function daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function guessServiceName(hostname) {
    hostname = hostname.replace(/^www\./, '');
    const parts = hostname.split('.');
    let mainPart = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    if (parts.length > 2 && ['co', 'ac', 'ne', 'or', 'go'].includes(parts[parts.length - 2])) {
        mainPart = parts[parts.length - 3];
    }
    return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
}

function renderPending() {
    pendingList.innerHTML = '';
    chrome.storage.local.get({ pending: {} }, (data) => {
        const pending = data.pending || {};
        const domains = Object.keys(pending);
        if (domains.length > 0) {
            const title = document.createElement('h3');
            title.textContent = '監視待ちのサイト';
            pendingList.appendChild(title);
        }
        domains.forEach(domain => {
            const div = document.createElement('div');
            div.className = 'card pending-card';
            const serviceName = guessServiceName(domain);
            div.innerHTML = `
                <div class="site-info">
                    <span class="site-name">${serviceName}</span>
                    <span class="pending-text">このサイトを監視しますか？</span>
                </div>
                <div class="actions">
                    <button class="btn-yes" data-domain="${domain}" data-decision="add">はい</button>
                    <button class="btn-no" data-domain="${domain}" data-decision="ignore">いいえ</button>
                </div>
            `;
            pendingList.appendChild(div);
        });
    });
}

async function renderWatched() {
    siteList.innerHTML = '';
    msgEl.style.display = "none";
    const data = await chrome.storage.local.get({
        watched: {},
        settings: { inactiveDays: 90 }
    });
    const watched = data.watched;
    const inactiveDays = data.settings.inactiveDays || 90;
    let entries = Object.entries(watched);
    const title = document.createElement('h3');
    title.textContent = '監視中のサイト';
    siteList.appendChild(title);
    if (!showAll) {
        const threshold = Date.now() - (inactiveDays * 24 * 60 * 60 * 1000);
        entries = entries.filter(([_, meta]) => meta.lastLogin < threshold);
        msgEl.textContent = `非アクティブ（${inactiveDays}日以上ログインなし）なアカウントはありません。`;
    } else {
        msgEl.textContent = "監視対象のサービスはありません。";
    }
    if (entries.length === 0) {
        msgEl.style.display = "block";
        return;
    }
    entries.sort((a, b) => a[1].lastLogin - b[1].lastLogin);
    for (const [domain, meta] of entries) {
        const d = daysSince(meta.lastLogin);
        const div = document.createElement('div');
        div.className = 'card';
        const serviceName = guessServiceName(domain);
        div.innerHTML = `
            <div class="site-info">
                <span class="site-name">${serviceName}</span>
                <span class="last-login">${d !== null ? d + '日前' : '未記録'}</span>
            </div>
            <div class="actions">
                <button class="btn-change" data-service="${serviceName}" data-domain="${domain}">パスワード変更</button>
                <button class="btn-delete" data-service="${serviceName}" data-domain="${domain}">退会</button>
                <button class="btn-remove" data-domain="${domain}">監視解除</button>
            </div>
        `;
        siteList.appendChild(div);
    }
}

function renderIgnoredInModal() {
    const ignoredList = document.getElementById("modalIgnoredList");
    const msgEl = document.getElementById("modalNoIgnoredMsg");
    ignoredList.innerHTML = '';
    msgEl.style.display = "none";
    chrome.storage.local.get({ ignored: {} }, (data) => {
        const ignored = data.ignored || {};
        let entries = Object.entries(ignored);
        if (entries.length === 0) {
            msgEl.textContent = "無視中のサイトはありません。";
            msgEl.style.display = "block";
            return;
        }
        for (const [domain, meta] of entries) {
            const div = document.createElement('div');
            div.className = 'card';
            const serviceName = guessServiceName(domain);
            div.innerHTML = `
                <div class="site-info">
                    <span class="site-name">${serviceName}</span>
                </div>
                <div class="actions">
                    <button class="btn-start-monitoring" data-domain="${domain}">監視する</button>
                    <button class="btn-delete-ignored" data-domain="${domain}">削除</button>
                </div>
            `;
            ignoredList.appendChild(div);
        }
    });
}

function setupSettingsModal() {
    const overlay = document.getElementById('settings-modal-overlay');
    const openBtn = document.getElementById('open-settings-btn');
    const closeBtn = document.getElementById('close-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');
    const passLength = document.getElementById('pass-length');
    const cbUpper = document.getElementById('cb-upper');
    const cbLower = document.getElementById('cb-lower');
    const cbNumbers = document.getElementById('cb-numbers');
    const cbSymbols = document.getElementById('cb-symbols');
    const cbNotifications = document.getElementById('cb-notifications');
    const inactiveDaysInput = document.getElementById('inactive-days');
    const notificationIntervalInput = document.getElementById('notification-interval');
    const defaultSettings = {
        length: 12, useUpper: true, useLower: true, useNumbers: true, useSymbols: false,
        notificationsEnabled: true, inactiveDays: 90, notificationInterval: 7
    };
    const loadSettings = () => {
        chrome.storage.local.get({ settings: defaultSettings }, (data) => {
            const s = data.settings;
            passLength.value = s.length;
            cbUpper.checked = s.useUpper;
            cbLower.checked = s.useLower;
            cbNumbers.checked = s.useNumbers;
            cbSymbols.checked = s.useSymbols;
            cbNotifications.checked = s.notificationsEnabled;
            inactiveDaysInput.value = s.inactiveDays;
            notificationIntervalInput.value = s.notificationInterval;
        });
    };
    const openModal = () => {
        loadSettings();
        renderIgnoredInModal();
        overlay.style.display = 'flex';
    };
    const closeModal = () => { overlay.style.display = 'none'; };
    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    saveBtn.addEventListener('click', () => {
        const inactiveDays = parseInt(inactiveDaysInput.value, 10);
        const notificationInterval = parseInt(notificationIntervalInput.value, 10);
        if (isNaN(inactiveDays) || inactiveDays < 1 || inactiveDays > 365 || isNaN(notificationInterval) || notificationInterval < 1 || notificationInterval > 365) {
            alert('日数は1から365の間で設定してください。');
            return;
        }
        const newSettings = {
            length: parseInt(passLength.value, 10),
            useUpper: cbUpper.checked,
            useLower: cbLower.checked,
            useNumbers: cbNumbers.checked,
            useSymbols: cbSymbols.checked,
            notificationsEnabled: cbNotifications.checked,
            inactiveDays: inactiveDays,
            notificationInterval: notificationInterval
        };
        chrome.storage.local.set({ settings: newSettings }, () => {
            alert('設定を保存しました。');
            closeModal();
            renderAll();
            chrome.runtime.sendMessage({ type: 'SETTINGS_SAVED' });
        });
    });
}

function generatePassword(options) {
    const { length, useUpper, useLower, useNumbers, useSymbols } = options;
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
    let allChars = '', password = '';
    if (useUpper) { allChars += upper; password += upper[Math.floor(Math.random() * upper.length)]; }
    if (useLower) { allChars += lower; password += lower[Math.floor(Math.random() * lower.length)]; }
    if (useNumbers) { allChars += numbers; password += numbers[Math.floor(Math.random() * numbers.length)]; }
    if (useSymbols) { allChars += symbols; password += symbols[Math.floor(Math.random() * symbols.length)]; }
    if (allChars === '') return null;
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

function showConfirmation(title, body, options) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-modal-overlay');
        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-body').innerHTML = body;
        const btnYes = document.getElementById('confirm-btn-yes');
        const btnNo = document.getElementById('confirm-btn-no');
        const btnOk = document.getElementById('confirm-btn-ok');
        btnYes.style.display = options.showYesNo ? 'inline-block' : 'none';
        btnNo.style.display = options.showYesNo ? 'inline-block' : 'none';
        btnOk.style.display = options.showOk ? 'inline-block' : 'none';
        overlay.style.display = 'flex';
        const close = (result) => {
            overlay.style.display = 'none';
            btnYes.replaceWith(btnYes.cloneNode(true));
            btnNo.replaceWith(btnNo.cloneNode(true));
            btnOk.replaceWith(btnOk.cloneNode(true));
            resolve(result);
        };
        document.getElementById('confirm-btn-yes').onclick = () => close(true);
        document.getElementById('confirm-btn-no').onclick = () => close(false);
        document.getElementById('confirm-btn-ok').onclick = () => close(true);
    });
}

document.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const domain = target.getAttribute('data-domain');
    const serviceName = target.getAttribute('data-service');
    if (target.classList.contains('btn-change') && serviceName && domain) {
        const data = await chrome.storage.local.get({
            settings: { length: 12, useUpper: true, useLower: true, useNumbers: true, useSymbols: false }
        });
        const passwordOptions = data.settings;
        if (!passwordOptions.useUpper && !passwordOptions.useLower && !passwordOptions.useNumbers && !passwordOptions.useSymbols) {
            alert('パスワード設定で、少なくとも1種類の文字を選択してください。'); return;
        }
        if (passwordOptions.length < 12) {
            alert('パスワード設定で、文字数を12文字以上に設定してください。'); return;
        }
        const directUrl = `https://${domain}/account`;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(domain + " パスワード変更")}`;
        const newPassword = generatePassword(passwordOptions);
        await chrome.storage.local.set({ tempPassword: newPassword });
        await chrome.windows.create({
            url: 'password_popup.html', type: 'popup', width: 400, height: 220, focused: true
        });
        chrome.tabs.create({ url: directUrl, active: false }, (tab) => {
            chrome.runtime.sendMessage({ type: 'VALIDATE_URL', tabId: tab.id, fallbackUrl: searchUrl });
        });
    }
    if (target.classList.contains('btn-delete') && serviceName && domain) {
        const infoData = await chrome.storage.local.get('unsubscribeInfoShown');
        if (!infoData.unsubscribeInfoShown) {
            await showConfirmation(
                `${serviceName} の退会`,
                `<p>このサイトを監視リストから<strong>無視リスト</strong>に移動します。</p><p>無視リストは「設定」画面からいつでも確認・変更できます。</p>`,
                { showOk: true }
            );
            await chrome.storage.local.set({ unsubscribeInfoShown: true });
        }
        const changePassword = await showConfirmation(
            'パスワードの変更',
            '<p>退会手続きの前に、パスワードを変更しますか？</p>',
            { showYesNo: true }
        );
        if (changePassword) {
            const data = await chrome.storage.local.get({
                settings: { length: 12, useUpper: true, useLower: true, useNumbers: true, useSymbols: false }
            });
            const passwordOptions = data.settings;
            if (!passwordOptions.useUpper && !passwordOptions.useLower && !passwordOptions.useNumbers && !passwordOptions.useSymbols) {
                alert('パスワード設定で、少なくとも1種類の文字を選択してください。'); return;
            }
            if (passwordOptions.length < 12) {
                alert('パスワード設定で、文字数を12文字以上に設定してください。'); return;
            }
            const newPassword = generatePassword(passwordOptions);
            await chrome.storage.local.set({ tempPassword: newPassword });
            await chrome.windows.create({
                url: 'password_popup.html', type: 'popup', width: 400, height: 220, focused: true
            });
        }
        const directUrl = `https://${domain}/account`;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(domain + " 退会")}`;
        chrome.tabs.create({ url: directUrl, active: false }, (tab) => {
            chrome.runtime.sendMessage({ type: 'VALIDATE_URL', tabId: tab.id, fallbackUrl: searchUrl });
        });
        const listData = await chrome.storage.local.get({ watched: {}, ignored: {} });
        delete listData.watched[domain];
        listData.ignored[domain] = { ignoredAt: Date.now() };
        await chrome.storage.local.set(listData);
        renderAll();
    }
    const decision = target.getAttribute('data-decision');
    if (domain && decision) {
        chrome.runtime.sendMessage({ type: 'USER_DECISION', hostname: domain, decision: decision });
    }
    if (target.classList.contains('btn-remove') && domain) {
        if (confirm(`${guessServiceName(domain)} を監視対象から外し、無視リストに移動しますか？`)) {
            const data = await chrome.storage.local.get({ watched: {}, ignored: {} });
            delete data.watched[domain];
            data.ignored[domain] = { ignoredAt: Date.now() };
            await chrome.storage.local.set(data);
            renderAll();
        }
    }
    if (target.classList.contains('btn-start-monitoring') && domain) {
        const data = await chrome.storage.local.get({ watched: {}, ignored: {} });
        delete data.ignored[domain];
        data.watched[domain] = { lastLogin: Date.now() };
        await chrome.storage.local.set(data);
        renderAll();
        renderIgnoredInModal();
    }
    if (target.classList.contains('btn-delete-ignored') && domain) {
        if (confirm(`${guessServiceName(domain)} を無視リストから完全に削除しますか？この操作は元に戻せません。`)) {
            const data = await chrome.storage.local.get({ ignored: {} });
            delete data.ignored[domain];
            await chrome.storage.local.set(data);
            renderIgnoredInModal();
        }
    }
});

showAllBtn.addEventListener("click", () => {
    showAll = !showAll;
    showAllBtn.textContent = showAll ? "非アクティブのみ表示" : "すべて表示";
    renderWatched();
});

window.renderAll = function() {
    renderPending();
    renderWatched();
}