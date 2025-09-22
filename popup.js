// popup.js

// HTMLの読み込み完了時に実行
document.addEventListener("DOMContentLoaded", () => {
    // 全てのリストを初期描画
    renderAll();
    // 設定モーダルウィンドウのイベントリスナー等をセットアップ
    setupSettingsModal(); 
});

// background.jsからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // データが変更されたというメッセージを受け取ったら、表示を再描画する
    if (message.type === 'DATA_CHANGED') {
        renderAll();
    }
});

// HTML要素を取得
const pendingList = document.getElementById("pendingList");
const siteList = document.getElementById("siteList");
const showAllBtn = document.getElementById("showAllBtn");
const msgEl = document.getElementById("noAccountsMsg");

// 「すべて表示」機能の状態を管理するフラグ
let showAll = false;

// タイムスタンプから経過日数を計算する関数
function daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

// ホスト名からサービス名を推測する関数 (例: www.google.com -> Google)
function guessServiceName(hostname) {
    hostname = hostname.replace(/^www\./, '');
    const parts = hostname.split('.');
    let mainPart = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    if (parts.length > 2 && ['co', 'ac', 'ne', 'or', 'go'].includes(parts[parts.length - 2])) {
        mainPart = parts[parts.length - 3];
    }
    // 先頭を大文字にする
    return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
}

// 「監視待ち」リストを描画する関数
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

// 「監視中」リストを描画する非同期関数
async function renderWatched() {
    siteList.innerHTML = '';
    msgEl.style.display = "none";

    const data = await chrome.storage.local.get({
        watched: {},
        settings: { inactiveDays: 90, notificationInterval: 7 }
    });
    
    const watched = data.watched;
    const inactiveDays = data.settings.inactiveDays || 90;
    let entries = Object.entries(watched);
    
    const title = document.createElement('h3');
    title.textContent = '監視中のサイト';
    siteList.appendChild(title);

    // 「すべて表示」がオフの場合、非アクティブなサイトのみフィルタリング
    if (!showAll) {
        const threshold = Date.now() - (inactiveDays * 24 * 60 * 60 * 1000);
        entries = entries.filter(([_, meta]) => meta.lastLogin < threshold);
        msgEl.textContent = `非アクティブ（${inactiveDays}日以上ログインなし）なアカウントはありません。`;
    } else {
        msgEl.textContent = "監視対象のサービスはありません。";
    }

    // 表示するエントリがない場合はメッセージを表示して終了
    if (entries.length === 0) {
        msgEl.style.display = "block";
        return;
    }

    // 最終ログインが古い順にソート
    entries.sort((a, b) => a[1].lastLogin - b[1].lastLogin);
    // 各エントリをHTML要素として描画
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
                <button class="btn-change" data-service="${serviceName}">パスワード変更</button>
                <button class="btn-delete" data-service="${serviceName}">退会</button>
                <button class="btn-remove" data-domain="${domain}">監視解除</button>
            </div>
        `;
        siteList.appendChild(div);
    }
}

// 設定モーダル内の「無視リスト」を描画する関数
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
                </div>
            `;
            ignoredList.appendChild(div);
        }
    });
}

// 設定モーダルに関するイベントリスナーや処理をまとめた関数
function setupSettingsModal() {
    const overlay = document.getElementById('settings-modal-overlay');
    const openBtn = document.getElementById('open-settings-btn');
    const closeBtn = document.getElementById('close-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');

    // 設定項目のHTML要素を取得
    const passLength = document.getElementById('pass-length');
    const cbUpper = document.getElementById('cb-upper');
    const cbLower = document.getElementById('cb-lower');
    const cbNumbers = document.getElementById('cb-numbers');
    const cbSymbols = document.getElementById('cb-symbols');
    const cbNotifications = document.getElementById('cb-notifications');
    const inactiveDaysInput = document.getElementById('inactive-days');
    const notificationIntervalInput = document.getElementById('notification-interval');

    // デフォルト設定
    const defaultSettings = {
        length: 12, useUpper: true, useLower: true, useNumbers: true, useSymbols: false,
        notificationsEnabled: true, inactiveDays: 90, notificationInterval: 7
    };

    // ストレージから設定を読み込んでフォームに反映する関数
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

    // モーダルを開く処理
    const openModal = () => {
        loadSettings();
        renderIgnoredInModal();
        overlay.style.display = 'flex';
    };
    // モーダルを閉じる処理
    const closeModal = () => { overlay.style.display = 'none'; };

    // イベントリスナーを設定
    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); }); // 背景クリックで閉じる

    // 保存ボタンの処理
    saveBtn.addEventListener('click', () => {
        const inactiveDays = parseInt(inactiveDaysInput.value, 10);
        const notificationInterval = parseInt(notificationIntervalInput.value, 10);
        
        // 入力値バリデーション
        if (isNaN(inactiveDays) || inactiveDays < 1 || inactiveDays > 365 || isNaN(notificationInterval) || notificationInterval < 1 || notificationInterval > 365) {
            alert('日数は1から365の間で設定してください。');
            return;
        }

        // 新しい設定オブジェクトを作成
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
        // ストレージに保存
        chrome.storage.local.set({ settings: newSettings }, () => {
            alert('設定を保存しました。');
            closeModal();
            renderAll(); // 表示を更新
        });
    });
}

// 設定に基づいてランダムなパスワードを生成する関数
function generatePassword(options) {
    const { length, useUpper, useLower, useNumbers, useSymbols } = options;
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
    let allChars = '', password = '';

    // 各文字種を必ず1文字は含むようにする
    if (useUpper) { allChars += upper; password += upper[Math.floor(Math.random() * upper.length)]; }
    if (useLower) { allChars += lower; password += lower[Math.floor(Math.random() * lower.length)]; }
    if (useNumbers) { allChars += numbers; password += numbers[Math.floor(Math.random() * numbers.length)]; }
    if (useSymbols) { allChars += symbols; password += symbols[Math.floor(Math.random() * symbols.length)]; }
    if (allChars === '') return null; // どの文字種も選択されていない場合はnullを返す

    // 残りの文字をランダムに生成
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    // 文字の並びをシャッフルして返す
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

// ポップアップ内のクリックイベントをまとめて処理（イベント委任）
document.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return; // クリックされたのがボタンでなければ何もしない

    // 「パスワード変更」または「退会」ボタンが押された場合
    if (target.classList.contains('btn-change') || target.classList.contains('btn-delete')) {
        const data = await chrome.storage.local.get({
            settings: { length: 12, useUpper: true, useLower: true, useNumbers: true, useSymbols: false }
        });
        const passwordOptions = data.settings;

        // パスワード生成のバリデーション
        if (!passwordOptions.useUpper && !passwordOptions.useLower && !passwordOptions.useNumbers && !passwordOptions.useSymbols) {
            alert('パスワード設定で、少なくとも1種類の文字を選択してください。'); return;
        }
        if (passwordOptions.length < 12) {
            alert('パスワード設定で、文字数を12文字以上に設定してください。'); return;
        }

        const serviceName = target.getAttribute('data-service');
        const newPassword = generatePassword(passwordOptions);
        
        // 「パスワード変更」か「退会」かで検索クエリを分岐
        const action = target.classList.contains('btn-change') ? " パスワード変更" : " 退会";
        // Google検索ページを新しいタブで開く
        chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(serviceName + action)}` });
        
        // 生成したパスワードを一時的にストレージに保存
        chrome.storage.local.set({ tempPassword: newPassword }, () => {
            // パスワード表示用の小さなポップアップウィンドウを開く
            chrome.windows.create({ url: 'password_popup.html', type: 'popup', width: 400, height: 220 });
        });
    }

    // 「監視待ち」リストの「はい」「いいえ」ボタンが押された場合
    const domain = target.getAttribute('data-domain');
    const decision = target.getAttribute('data-decision');
    if (domain && decision) {
        // background.jsにユーザーの決定を通知
        chrome.runtime.sendMessage({ type: 'USER_DECISION', hostname: domain, decision: decision });
    }

    // 「監視解除」ボタンが押された場合
    if (target.classList.contains('btn-remove') && domain) {
        if (confirm(`${guessServiceName(domain)} を監視対象から削除しますか？`)) {
            chrome.storage.local.get({ watched: {}, ignored: {} }, (data) => {
                delete data.watched[domain]; // 監視リストから削除
                data.ignored[domain] = { ignoredAt: Date.now() }; // 無視リストに追加
                chrome.storage.local.set(data, renderAll); // ストレージを更新して再描画
            });
        }
    }
    
    // 無視リストの「監視する」ボタンが押された場合
    if (target.classList.contains('btn-start-monitoring') && domain) {
        chrome.storage.local.get({ watched: {}, ignored: {} }, (data) => {
            delete data.ignored[domain]; // 無視リストから削除
            data.watched[domain] = { lastLogin: Date.now() }; // 監視リストに追加
            chrome.storage.local.set(data, () => {
                renderAll(); // ポップアップのメイン画面を再描画
                renderIgnoredInModal(); // モーダル内の無視リストも再描画
            });
        });
    }
});

// 「すべて表示」「非アクティブのみ表示」ボタンのクリックイベント
showAllBtn.addEventListener("click", () => {
    showAll = !showAll; // フラグを反転
    showAllBtn.textContent = showAll ? "非アクティブのみ表示" : "すべて表示";
    renderWatched(); // 監視中リストを再描画
});

// 他のスクリプトから呼び出せるように、再描画関数をグローバルに公開
window.renderAll = function() {
    renderPending();
    renderWatched();
}