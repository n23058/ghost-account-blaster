
// popup.js - 拡張機能のポップアップ画面のUIとインタラクションを制御する

// HTMLの読み込み完了時に、画面の初期描画と設定モーダルの準備を行う
document.addEventListener("DOMContentLoaded", () => {
    renderAll();
    setupSettingsModal();
});

/**
 * background.jsからのメッセージを受け取るリスナー
 * ストレージのデータが変更されたときに、ポップアップの表示を更新するために使われる
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // background.jsでサイトが追加・削除されたら、リストを再描画する
    if (message.type === 'DATA_CHANGED') {
        renderAll();
    }
});

// --- DOM要素の取得 ---
const pendingList = document.getElementById("pendingList");
const siteList = document.getElementById("siteList");
const showAllBtn = document.getElementById("showAllBtn");
const msgEl = document.getElementById("noAccountsMsg");

// 「すべて表示」機能の状態を管理するフラグ
let showAll = false;

/**
 * タイムスタンプを受け取り、現在から何日経過したかを返す
 * @param {number} ts - 比較する過去のタイムスタンプ (ミリ秒)
 * @returns {number | null} - 経過日数。tsが無効な場合はnull
 */
function daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

/**
 * ホスト名からサービス名を推測して整形する
 * 例: "www.google.co.jp" -> "Google"
 * @param {string} hostname - サイトのホスト名
 * @returns {string} - 推測されたサービス名
 */
function guessServiceName(hostname) {
    hostname = hostname.replace(/^www\./, ''); // "www." を削除
    const parts = hostname.split('.');
    // ドメインの主要部分を取得 (例: google.co.jp -> google)
    let mainPart = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    // .co.jp, .ac.jp のようなセカンドレベルドメインを考慮
    if (parts.length > 2 && ['co', 'ac', 'ne', 'or', 'go'].includes(parts[parts.length - 2])) {
        mainPart = parts[parts.length - 3];
    }
    // 最初の文字を大文字にする
    return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
}

/**
 * 「監視待ち」リストを描画する
 */
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

/**
 * 「監視中」リストを描画する
 * showAllフラグに応じて、非アクティブなサイトのみか、すべてのサイトを表示するかを切り替える
 */
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

    // 「すべて表示」がオフの場合、非アクティブなサイトのみをフィルタリング
    if (!showAll) {
        const threshold = Date.now() - (inactiveDays * 24 * 60 * 60 * 1000);
        entries = entries.filter(([_, meta]) => meta.lastLogin < threshold);
        msgEl.textContent = `非アクティブ（${inactiveDays}日以上ログインなし）なアカウントはありません。`;
    } else {
        msgEl.textContent = "監視対象のサービスはありません。";
    }

    // 表示するエントリがなければメッセージを表示
    if (entries.length === 0) {
        msgEl.style.display = "block";
        return;
    }

    // 最終ログインが古い順にソート
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
                <button class="btn-change" data-service="${serviceName}">パスワード変更</button>
                <button class="btn-delete" data-service="${serviceName}">退会</button>
                <button class="btn-remove" data-domain="${domain}">監視解除</button>
            </div>
        `;
        siteList.appendChild(div);
    }
}

/**
 * 設定モーダル内の「無視リスト」を描画する
 */
function renderIgnoredInModal() {
    const ignoredList = document.getElementById("modalIgnoredList");
    const msgEl = document.getElementById("modalNoIgnoredMsg");
    ignoredList.innerHTML = '';
    msgEl.style.display = "none";

    chrome.storage.local.get({ ignored: {} }, (data) => {
        const ignored = data.ignored || {};
        const entries = Object.entries(ignored);
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

/**
 * 設定モーダルのセットアップ（イベントリスナーの設定など）
 */
function setupSettingsModal() {
    const overlay = document.getElementById('settings-modal-overlay');
    const openBtn = document.getElementById('open-settings-btn');
    const closeBtn = document.getElementById('close-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');

    // --- 設定項目のDOM要素 ---
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

    // ストレージから設定を読み込み、UIに反映させる
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

    // --- イベントリスナーの設定 ---
    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); }); // 背景クリックで閉じる

    // 「保存」ボタンの処理
    saveBtn.addEventListener('click', () => {
        const inactiveDays = parseInt(inactiveDaysInput.value, 10);
        const notificationInterval = parseInt(notificationIntervalInput.value, 10);
        
        // 入力値のバリデーション
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
            renderAll(); // 設定が変更された可能性があるのでメイン画面を再描画
        });
    });
}

/**
 * 設定に基づいてランダムなパスワードを生成する
 * @param {object} options - パスワードの生成ルール（文字数、使用する文字種）
 * @returns {string | null} - 生成されたパスワード。文字種が一つも選択されていない場合はnull
 */
function generatePassword(options) {
    const { length, useUpper, useLower, useNumbers, useSymbols } = options;
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
    
    let allChars = '';
    let password = '';
    
    // 各文字種を含めるかチェックし、最低1文字は必ず含めるようにする
    if (useUpper) { allChars += upper; password += upper[Math.floor(Math.random() * upper.length)]; }
    if (useLower) { allChars += lower; password += lower[Math.floor(Math.random() * lower.length)]; }
    if (useNumbers) { allChars += numbers; password += numbers[Math.floor(Math.random() * numbers.length)]; }
    if (useSymbols) { allChars += symbols; password += symbols[Math.floor(Math.random() * symbols.length)]; }
    
    if (allChars === '') return null; // どの文字種も選択されていない場合
    
    // 残りの文字をランダムに選択してパスワードを生成
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // パスワードの文字順をシャッフルして、予測されにくくする
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

/**
 * ポップアップ内のクリックイベントをまとめて処理する（イベント委任）
 */
document.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return; // クリックされたのがボタンでなければ何もしない

    // --- 「パスワード変更」「退会」ボタンの処理 ---
    if (target.classList.contains('btn-change') || target.classList.contains('btn-delete')) {
        const data = await chrome.storage.local.get({ settings: {} });
        const passwordOptions = data.settings;

        // パスワード生成ルールのバリデーション
        if (!passwordOptions.useUpper && !passwordOptions.useLower && !passwordOptions.useNumbers && !passwordOptions.useSymbols) {
            alert('パスワード設定で、少なくとも1種類の文字を選択してください。'); return;
        }
        if (passwordOptions.length < 12) {
            alert('パスワード設定で、文字数を12文字以上に設定してください。'); return;
        }

        const serviceName = target.getAttribute('data-service');
        const newPassword = generatePassword(passwordOptions);
        
        // Google検索用のクエリを作成（例：「Google パスワード変更」）
        const action = target.classList.contains('btn-change') ? " パスワード変更" : " 退会";
        chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(serviceName + action)}` });
        
        // 生成したパスワードを一時的にストレージに保存し、専用のポップアップを開く
        chrome.storage.local.set({ tempPassword: newPassword }, () => {
            chrome.windows.create({ url: 'password_popup.html', type: 'popup', width: 400, height: 220 });
        });
    }

    const domain = target.getAttribute('data-domain');
    const decision = target.getAttribute('data-decision');

    // --- 「監視待ち」リストの「はい」「いいえ」ボタンの処理 ---
    if (domain && decision) {
        chrome.runtime.sendMessage({ type: 'USER_DECISION', hostname: domain, decision: decision });
    }

    // --- 「監視解除」ボタンの処理 ---
    if (target.classList.contains('btn-remove') && domain) {
        if (confirm(`${guessServiceName(domain)} を監視対象から削除しますか？`)) {
            chrome.storage.local.get({ watched: {}, ignored: {} }, (data) => {
                delete data.watched[domain]; // 監視リストから削除
                data.ignored[domain] = { ignoredAt: Date.now() }; // 無視リストに追加
                chrome.storage.local.set(data, renderAll); // ストレージを更新して再描画
            });
        }
    }
    
    // --- 設定モーダル内の「監視する」ボタンの処理 ---
    if (target.classList.contains('btn-start-monitoring') && domain) {
        chrome.storage.local.get({ watched: {}, ignored: {} }, (data) => {
            delete data.ignored[domain]; // 無視リストから削除
            data.watched[domain] = { lastLogin: Date.now() }; // 監視リストに追加
            chrome.storage.local.set(data, () => {
                renderAll(); // メイン画面を再描画
                renderIgnoredInModal(); // モーダル内のリストも再描画
            });
        });
    }
});

/**
 * 「すべて表示」ボタンのクリックイベント
 */
showAllBtn.addEventListener("click", () => {
    showAll = !showAll; // フラグを反転
    showAllBtn.textContent = showAll ? "非アクティブのみ表示" : "すべて表示";
    renderWatched(); // 監視中リストを再描画
});

/**
 * ポップアップ内のすべてのリストを再描画するグローバル関数
 */
window.renderAll = function() {
    renderPending();
    renderWatched();
}

// 初期表示のために呼び出し
renderAll();
setupSettingsModal();
