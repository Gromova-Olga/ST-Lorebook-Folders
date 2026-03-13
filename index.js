import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "lorebook-folders";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

let eventSource = null;
let event_types = null;

// Память для открытых папок и списков
let openFolders = new Set();
let openChatsSections = new Set();
let openCharChats = new Set();

function getSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    if (!s.folders)      s.folders      = [];
    if (!s.assignments)  s.assignments  = {};
    if (!s.chatBindings) s.chatBindings = {};
    for (const key in s.assignments) {
        if (typeof s.assignments[key] === "string") {
            s.assignments[key] = [s.assignments[key]];
        }
    }
    return s;
}

function getCurrentChatId() {
    try {
        const ctx = getContext();
        return ctx.chatId ?? ctx.getCurrentChatId?.() ?? null;
    } catch(e) { return null; }
}

function getAllLorebooks() {
    const books = [];
    $("#world_info option").each(function () {
        const val = $(this).val();
        const name = $(this).text().trim();
        if (val && name && name !== "---") books.push({ value: val, name });
    });
    return books;
}

function getUnassignedLorebooks(folderId) {
    const settings = getSettings();
    return getAllLorebooks().filter(b => {
        const folders = settings.assignments[b.name] || [];
        return !folders.includes(folderId);
    });
}

function setLorebookActive(bookName, active) {
    const select = $("select#world_info");
    let currentVals = select.val() || [];
    if (!Array.isArray(currentVals)) currentVals = [currentVals];

    let bookVal = null;
    select.find("option").each(function () {
        if ($(this).text().trim() === bookName) {
            bookVal = $(this).val();
        }
    });

    if (bookVal === null) {
        console.warn(`[${extensionName}] Лорбук не найден: ${bookName}`);
        return;
    }

    let newVals;
    if (active) {
        if (currentVals.includes(bookVal)) return;
        newVals = [...currentVals, bookVal];
    } else {
        newVals = currentVals.filter(v => v !== bookVal);
    }

    select.val(newVals).trigger("change");
    console.log(`[${extensionName}] ${active ? "✅ Activated" : "❌ Deactivated"}: ${bookName} (val=${bookVal})`);
}

let lastActivatedFolders = [];

function applyBindingsForChat(chatId) {
    const settings = getSettings();

    lastActivatedFolders.forEach(folderId => {
        Object.entries(settings.assignments)
            .filter(([, folders]) => Array.isArray(folders) && folders.includes(folderId))
            .forEach(([name]) => setLorebookActive(name, false));
    });

    if (!chatId) { lastActivatedFolders = []; renderFolderPanel(); return; }

    const boundFolders = settings.chatBindings[chatId] || [];

    boundFolders.forEach(folderId => {
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;
        Object.entries(settings.assignments)
            .filter(([, folders]) => Array.isArray(folders) && folders.includes(folderId))
            .forEach(([name]) => setLorebookActive(name, true));
        console.log(`[${extensionName}] Activated folder: ${folder.name}`);
    });

    lastActivatedFolders = boundFolders;

    if (boundFolders.length > 0) {
        const names = boundFolders
            .map(fid => settings.folders.find(f => f.id === fid)?.name)
            .filter(Boolean).join(", ");
        toastr.info(`📁 Активированы папки: ${names}`, "Lorebook Folders", { timeOut: 2000 });
    }

    renderFolderPanel();
}

function toggleChatBinding(folderId) {
    const chatId = getCurrentChatId();
    if (!chatId) {
        toastr.warning("Сначала открой чат!", "Lorebook Folders");
        return;
    }

    const settings = getSettings();
    const folder = settings.folders.find(f => f.id === folderId);
    if (!folder) return;

    settings.chatBindings[chatId] = settings.chatBindings[chatId] || [];
    const bindings = settings.chatBindings[chatId];
    const idx = bindings.indexOf(folderId);

    if (idx === -1) {
        bindings.push(folderId);
        toastr.success(`🔗 «${folder.name}» привязана к чату`, "Lorebook Folders");
    } else {
        bindings.splice(idx, 1);
        toastr.info(`🔗 «${folder.name}» отвязана от чата`, "Lorebook Folders");
    }

    saveSettingsDebounced();
    renderFolderPanel();
}

// ── Получить все чаты всех персонажей ────────────────────────────────────────
async function getAllCharacterChats() {
    const ctx = getContext();
    const characters = ctx.characters || [];
    const scriptModule = await import("../../../../script.js");
    const getPastChats = scriptModule.getPastCharacterChats;

    const result = [];
    for (let i = 0; i < characters.length; i++) {
        const c = characters[i];
        try {
            const chats = await getPastChats(i) || [];
            chats.forEach(chat => {
                result.push({
                    charName: c.name,
                    charIndex: i,
                    chatId: chat.file_id,
                    chatName: chat.file_id
                });
            });
        } catch(e) {
            if (c.chat) result.push({
                charName: c.name,
                charIndex: i,
                chatId: c.chat,
                chatName: c.chat
            });
        }
    }
    return result;
}

// ── Рендер ────────────────────────────────────────────────────────────────────
async function renderFolderPanel() {
    const settings = getSettings();
    const list = $("#lf-folder-list");
    const chatId = getCurrentChatId();
    const boundFolders = chatId ? (settings.chatBindings[chatId] || []) : [];

    if (settings.folders.length === 0) {
        list.html(`<div class="lf-empty">Папок пока нет.<br>Нажми «+ Папка» чтобы создать.</div>`);
        return;
    }

    list.html(`<div class="lf-empty">Загрузка...</div>`);

    const allChats = await getAllCharacterChats();

    const html = settings.folders.map(f => {
        const books = Object.entries(settings.assignments)
            .filter(([, folders]) => Array.isArray(folders) && folders.includes(f.id))
            .map(([name]) => name);
        const isBound = boundFolders.includes(f.id);

        const booksHtml = books.length === 0
            ? `<div class="lf-no-books">Перетащи лорбук сюда или нажми «+»</div>`
            : books.map(name => `
                <div class="lf-book-item" draggable="true" data-book-name="${name}">
                    <span>📖</span>
                    <span class="lf-book-name">${name}</span>
                    <i class="lf-book-remove fa-solid fa-xmark" data-book-name="${name}" data-folder-id="${f.id}"></i>
                </div>`).join("");

        const charMap = {};
        allChats.forEach(c => {
            if (!charMap[c.charName]) charMap[c.charName] = [];
            charMap[c.charName].push(c);
        });

        const charsHtml = Object.entries(charMap).map(([charName, chats]) => {
            const chatsHtml = chats.map(c => {
                const isChatBound = (settings.chatBindings[c.chatId] || []).includes(f.id);
                const shortName = c.chatId.replace(charName + ' - ', '');
                return `
                    <div class="lf-chat-item">
                        <span class="lf-chat-name" title="${c.chatId}">${shortName}</span>
                        <i class="lf-btn-chat-bind fa-solid ${isChatBound ? "fa-link-slash" : "fa-link"} ${isChatBound ? "lf-active" : ""}"
                           title="${isChatBound ? "Отвязать" : "Привязать"}"
                           data-folder-id="${f.id}"
                           data-chat-id="${c.chatId}"></i>
                    </div>`;
            }).join("");

            const anyBound = chats.some(c => (settings.chatBindings[c.chatId] || []).includes(f.id));

            // Проверяем память для конкретного персонажа в этой папке
            const charGroupId = `${f.id}_${charName}`;
            const isCharOpen = openCharChats.has(charGroupId);
            const charToggleIcon = isCharOpen ? "▼" : "▶";
            const charDisplayStyle = isCharOpen ? "" : 'style="display:none;"';

            return `
                <div class="lf-char-group">
                    <div class="lf-char-header" data-folder-id="${f.id}" data-char="${charName}">
                        <span class="lf-char-arrow">${charToggleIcon}</span>
                        <span class="lf-char-name">${charName}</span>
                        <span class="lf-char-count">${chats.length}</span>
                        ${anyBound ? `<span class="lf-bound-dot" title="Есть привязки">🔗</span>` : ""}
                    </div>
                    <div class="lf-char-chats" ${charDisplayStyle}>
                        ${chatsHtml}
                    </div>
                </div>`;
        }).join("");

        const isOpen = openFolders.has(f.id);
        const toggleIcon = isOpen ? "▼" : "▶";
        const displayStyle = isOpen ? "" : 'style="display:none;"';
        
        const isChatsSectionOpen = openChatsSections.has(f.id);
        const chatsToggleIcon = isChatsSectionOpen ? "▼" : "▶";
        const chatsDisplayStyle = isChatsSectionOpen ? "" : 'style="display:none;"';

        return `
            <div class="lf-folder-item ${isBound ? "lf-bound" : ""}" data-folder-id="${f.id}">
                <div class="lf-folder-header">
                    <span class="lf-folder-toggle">${toggleIcon}</span>
                    <span>📁</span>
                    <span class="lf-folder-name">${f.name}</span>
                    <span class="lf-book-count">${books.length}</span>
                    ${isBound ? `<span class="lf-bound-badge">🔗</span>` : ""}
                    <span class="lf-folder-actions">
                        <i class="lf-btn-bind fa-solid fa-link${isBound ? " lf-active" : ""}"
                           title="${isBound ? "Отвязать от текущего чата" : "Привязать к текущему чату"}"
                           data-folder-id="${f.id}"></i>
                        <i class="lf-btn-add-book fa-solid fa-plus" title="Добавить лорбук" data-folder-id="${f.id}"></i>
                        <i class="lf-btn-rename fa-solid fa-pen" title="Переименовать" data-folder-id="${f.id}"></i>
                        <i class="lf-btn-delete fa-solid fa-trash" title="Удалить" data-folder-id="${f.id}"></i>
                    </span>
                </div>
                <div class="lf-folder-contents" data-folder-id="${f.id}" ${displayStyle}>
                    <div class="lf-section-label">📖 Лорбуки</div>
                    ${booksHtml}
                    <div class="lf-section-label lf-chats-toggle" data-folder-id="${f.id}">
                        💬 Привязки к чатам <span class="lf-chats-arrow">${chatsToggleIcon}</span>
                    </div>
                    <div class="lf-chats-section" data-folder-id="${f.id}" ${chatsDisplayStyle}>
                        ${charsHtml}
                    </div>
                </div>
            </div>`;
    }).join("");

    list.html(html);
    setTimeout(() => bindEvents(), 50);
}

// ── События ───────────────────────────────────────────────────────────────────
function bindEvents() {
    const settings = getSettings();

    $(".lf-folder-header").on("click", function (e) {
        if ($(e.target).closest(".lf-folder-actions").length) return;
        const folderId = $(this).closest(".lf-folder-item").data("folder-id");
        const contents = $(this).siblings(".lf-folder-contents");
        const toggle = $(this).find(".lf-folder-toggle");
        
        contents.toggle();
        const isVisible = contents.is(":visible");
        toggle.text(isVisible ? "▼" : "▶");

        if (isVisible) {
            openFolders.add(folderId);
        } else {
            openFolders.delete(folderId);
        }
    });

    $(".lf-btn-bind").on("click", function (e) {
        e.stopPropagation();
        toggleChatBinding($(this).data("folder-id"));
    });

    $(".lf-folder-item").on("dragover", function (e) {
        e.preventDefault();
        $(this).addClass("lf-drag-over");
    }).on("dragleave", function (e) {
        if (!$(this).is($(e.relatedTarget).closest(".lf-folder-item"))) {
            $(this).removeClass("lf-drag-over");
        }
    }).on("drop", function (e) {
        e.preventDefault();
        $(this).removeClass("lf-drag-over");
        const bookName = e.originalEvent.dataTransfer.getData("lf-book-name");
        const folderId = $(this).data("folder-id");
        if (!bookName || !folderId) return;
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;
        settings.assignments[bookName] = settings.assignments[bookName] || [];
        if (!settings.assignments[bookName].includes(folderId)) {
            settings.assignments[bookName].push(folderId);
        } else {
            toastr.info(`«${bookName}» уже в этой папке.`, "Lorebook Folders");
            return;
        }
        saveSettingsDebounced();
        renderFolderPanel();
        toastr.success(`«${bookName}» → «${folder.name}»`, "Lorebook Folders");
    });

    $(".lf-book-item").on("dragstart", function (e) {
        e.originalEvent.dataTransfer.setData("lf-book-name", $(this).data("book-name"));
    });

    $(".lf-book-remove").on("click", function (e) {
        e.stopPropagation();
        const bookName = $(this).data("book-name");
        const folderId = $(this).data("folder-id");
        const settings = getSettings();
        if (!settings.assignments[bookName]) return;
        settings.assignments[bookName] = settings.assignments[bookName].filter(f => f !== folderId);
        if (settings.assignments[bookName].length === 0) {
            delete settings.assignments[bookName];
        }
        saveSettingsDebounced();
        renderFolderPanel();
    });

    $(".lf-btn-add-book").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;
        const unassigned = getUnassignedLorebooks(folderId);
        if (unassigned.length === 0) {
            toastr.info("Все лорбуки уже в этой папке.", "Lorebook Folders");
            return;
        }
        const input = prompt(
            `Выбери номер для «${folder.name}»:\n\n` +
            unassigned.map((b, i) => `${i + 1}. ${b.name}`).join("\n")
        );
        if (!input) return;
        const idx = parseInt(input.trim()) - 1;
        if (isNaN(idx) || idx < 0 || idx >= unassigned.length) {
            toastr.error("Неверный номер.", "Lorebook Folders"); return;
        }
        const bookName = unassigned[idx].name;
        settings.assignments[bookName] = settings.assignments[bookName] || [];
        if (!settings.assignments[bookName].includes(folderId)) {
            settings.assignments[bookName].push(folderId);
        }
        saveSettingsDebounced();
        renderFolderPanel();
        toastr.success(`«${bookName}» → «${folder.name}»`, "Lorebook Folders");
    });

    $(".lf-btn-rename").on("click", function (e) {
        e.stopPropagation();
        const id = $(this).data("folder-id");
        const folder = settings.folders.find(f => f.id === id);
        if (!folder) return;
        const newName = prompt("Новое название:", folder.name);
        if (!newName?.trim()) return;
        folder.name = newName.trim();
        saveSettingsDebounced();
        renderFolderPanel();
    });

    $(".lf-btn-delete").on("click", function (e) {
        e.stopPropagation();
        const id = $(this).data("folder-id");
        const folder = settings.folders.find(f => f.id === id);
        if (!folder) return;
        if (!confirm(`Удалить «${folder.name}»?`)) return;
        settings.folders = settings.folders.filter(f => f.id !== id);
        for (const k in settings.assignments) {
            if (settings.assignments[k] === id) delete settings.assignments[k];
        }
        for (const cid in settings.chatBindings) {
            settings.chatBindings[cid] = settings.chatBindings[cid].filter(fid => fid !== id);
        }
        saveSettingsDebounced();
        renderFolderPanel();
    });

    // Раскрыть/свернуть список чатов папки
    $(".lf-chats-toggle").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const section = $(`.lf-chats-section[data-folder-id="${folderId}"]`);
        const arrow = $(this).find(".lf-chats-arrow");
        
        section.toggle();
        const isVisible = section.is(":visible");
        arrow.text(isVisible ? "▼" : "▶");

        if (isVisible) {
            openChatsSections.add(folderId);
        } else {
            openChatsSections.delete(folderId);
        }
    });

    // Раскрыть/свернуть чаты персонажа
    $(".lf-char-header").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const charName = $(this).data("char");
        const charGroupId = `${folderId}_${charName}`;
        
        const chats = $(this).siblings(".lf-char-chats");
        const arrow = $(this).find(".lf-char-arrow");
        
        chats.toggle();
        const isVisible = chats.is(":visible");
        arrow.text(isVisible ? "▼" : "▶");

        if (isVisible) {
            openCharChats.add(charGroupId);
        } else {
            openCharChats.delete(charGroupId);
        }
    });

    // Привязать/отвязать папку к конкретному чату
    $(".lf-btn-chat-bind").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const cChatId = $(this).data("chat-id");
        const settings = getSettings();
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;

        settings.chatBindings[cChatId] = settings.chatBindings[cChatId] || [];
        const bindings = settings.chatBindings[cChatId];
        const idx = bindings.indexOf(folderId);

        if (idx === -1) {
            bindings.push(folderId);
            toastr.success(`🔗 «${folder.name}» привязана к чату`, "Lorebook Folders");
        } else {
            bindings.splice(idx, 1);
            toastr.info(`«${folder.name}» отвязана от чата`, "Lorebook Folders");
        }

        saveSettingsDebounced();
        renderFolderPanel();
    });
}

function createFolder() {
    const name = prompt("Название новой папки:");
    if (!name?.trim()) return;
    const settings = getSettings();
    settings.folders.push({ id: `folder_${Date.now()}`, name: name.trim() });
    saveSettingsDebounced();
    renderFolderPanel();
    toastr.success(`Папка «${name.trim()}» создана!`, "Lorebook Folders");
}

// ── Создать кнопку на верхней панели ─────────────────────────────────────────
function createTopBarButton() {
    const btn = `
        <div id="lf-drawer" class="drawer">
            <div class="drawer-toggle drawer-header">
                <div id="lf-drawer-icon"
                     class="drawer-icon fa-solid fa-folder-open interactable closedIcon"
                     tabindex="0" role="button"
                     title="Lorebook Folders"></div>
            </div>
            <div id="lf-drawer-content" class="drawer-content closedDrawer fillLeft">
                <div class="lf-drawer-inner">
                    <div class="lf-panel-header">
                        <span>📁 Lorebook Folders</span>
                        <button id="lf-create-folder" class="menu_button">+ Папка</button>
                    </div>
                    <div id="lf-folder-list"></div>
                </div>
            </div>
        </div>`;

    $('#top-settings-holder').append(btn);

    $('#lf-drawer-icon').on('click', function () {
        const content = $('#lf-drawer-content');
        const icon = $(this);
        const isOpen = content.hasClass('openDrawer');

        $('.drawer-content.openDrawer').not(content).each(function () {
            $(this).removeClass('openDrawer').addClass('closedDrawer');
            $(this).closest('.drawer').find('.drawer-icon')
                .removeClass('openIcon').addClass('closedIcon');
        });

        if (isOpen) {
            content.removeClass('openDrawer').addClass('closedDrawer');
            icon.removeClass('openIcon').addClass('closedIcon');
        } else {
            content.removeClass('closedDrawer').addClass('openDrawer');
            icon.removeClass('closedIcon').addClass('openIcon');
            renderFolderPanel();
        }
    });

    console.log(`[${extensionName}] Top bar button created`);
}

// ── Инициализация ─────────────────────────────────────────────────────────────
jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
        $("#extensions_settings2").append(settingsHtml);

        setTimeout(() => {
            createTopBarButton();
            renderFolderPanel();
            $("#lf-create-folder").on("click", createFolder);
        }, 1000);

        const scriptModule = await import("../../../../script.js");
        eventSource = scriptModule.eventSource;
        event_types = scriptModule.event_types;

        eventSource.on(event_types.CHAT_CHANGED, () => {
            const chatId = getCurrentChatId();
            console.log(`[${extensionName}] Chat changed → ${chatId}`);
            setTimeout(() => applyBindingsForChat(chatId), 500);
        });

        console.log(`[${extensionName}] ✅ Loaded`);
    } catch (err) {
        console.error(`[${extensionName}] ❌`, err);
    }
});