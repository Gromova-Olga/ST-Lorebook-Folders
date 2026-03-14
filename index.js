import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "ST-Lorebook-Folders";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

let eventSource = null;
let event_types = null;

let openFolders = new Set();
let openChatsSections = new Set();
let openCharChats = new Set();

// ====== СЛОВАРЬ ПЕРЕВОДОВ ======
const i18n = {
    ru: {
        empty_folders: "Папок пока нет.<br>Нажми «+ Корень» чтобы создать.",
        loading: "Загрузка...",
        activated_msg: "📁 Активированы папки:",
        open_chat_warn: "Сначала открой чат!",
        bound_success: "🔗 Папка привязана к чату",
        unbound_info: "🔗 Папка отвязана от чата",
        lorebooks_label: "📖 Лорбуки",
        no_books_tip: "Перетащи лорбук сюда или нажми «+»",
        chat_bindings: "💬 Привязки к чатам",
        add_subfolder: "Создать подпапку",
        bind_chat: "Привязать к текущему чату",
        color_folder: "Цвет папки",
        add_book: "Добавить лорбук",
        rename: "Переименовать",
        delete: "Удалить",
        delete_confirm: "Удалить папку и все вложенные элементы?",
        all_assigned: "Все лорбуки уже в этой папке.",
        select_placeholder: "-- Выбери лорбук --",
        new_root: "+ Корень",
        search_placeholder: "Поиск...",
        compact_mode: "Компактный вид",
        export_btn: "Экспорт (Backup)",
        import_btn: "Импорт",
        backup_ok: "Бэкап успешно скачан!",
        import_err_data: "Файл не содержит данных папок",
        import_err_read: "Ошибка при чтении файла",
        import_ok: "Структура успешно восстановлена!",
        placeholder_new_folder: "Название папки...",
        placeholder_subfolder: "Название подпапки...",
        loop_warn: "Нельзя переместить папку внутрь самой себя!"
    },
    en: {
        empty_folders: "No folders yet.<br>Click '+ Root' to create one.",
        loading: "Loading...",
        activated_msg: "📁 Activated folders:",
        open_chat_warn: "Open a chat first!",
        bound_success: "🔗 Folder bound to chat",
        unbound_info: "🔗 Folder unbound from chat",
        lorebooks_label: "📖 Lorebooks",
        no_books_tip: "Drag lorebook here or click '+'",
        chat_bindings: "💬 Chat Bindings",
        add_subfolder: "Add Subfolder",
        bind_chat: "Bind to current chat",
        color_folder: "Folder Color",
        add_book: "Add Lorebook",
        rename: "Rename",
        delete: "Delete",
        delete_confirm: "Delete this folder and all sub-items?",
        all_assigned: "All lorebooks are already in this folder.",
        select_placeholder: "-- Select Lorebook --",
        new_root: "+ Root",
        search_placeholder: "Search...",
        compact_mode: "Compact Mode",
        export_btn: "Export (Backup)",
        import_btn: "Import",
        backup_ok: "Backup downloaded successfully!",
        import_err_data: "File contains no folder data",
        import_err_read: "Error reading file",
        import_ok: "Structure restored successfully!",
        placeholder_new_folder: "Folder name...",
        placeholder_subfolder: "Subfolder name...",
        loop_warn: "Cannot move a folder into itself!"
    }
};

function getSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    if (!s.folders)      s.folders      = [];
    if (!s.assignments)  s.assignments  = {};
    if (!s.chatBindings) s.chatBindings = {};
    if (s.isCompact === undefined) s.isCompact = false;
    if (!s.language)     s.language     = 'ru'; 
    for (const key in s.assignments) {
        if (typeof s.assignments[key] === "string") {
            s.assignments[key] = [s.assignments[key]];
        }
    }
    return s;
}

function t(key) {
    const settings = getSettings();
    const lang = settings.language || 'en';
    return i18n[lang][key] || key;
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

    if (bookVal === null) return;

    let newVals;
    if (active) {
        if (currentVals.includes(bookVal)) return;
        newVals = [...currentVals, bookVal];
    } else {
        newVals = currentVals.filter(v => v !== bookVal);
    }

    select.val(newVals).trigger("change");
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
        Object.entries(settings.assignments)
            .filter(([, folders]) => Array.isArray(folders) && folders.includes(folderId))
            .forEach(([name]) => setLorebookActive(name, true));
    });
    lastActivatedFolders = boundFolders;
    if (boundFolders.length > 0) {
        const names = boundFolders.map(fid => settings.folders.find(f => f.id === fid)?.name).filter(Boolean).join(", ");
        toastr.info(`${t('activated_msg')} ${names}`, "Lorebook Folders", { timeOut: 2000 });
    }
    renderFolderPanel();
}

function toggleChatBinding(folderId) {
    const chatId = getCurrentChatId();
    if (!chatId) { toastr.warning(t('open_chat_warn'), "Lorebook Folders"); return; }
    const settings = getSettings();
    const folder = settings.folders.find(f => f.id === folderId);
    if (!folder) return;
    settings.chatBindings[chatId] = settings.chatBindings[chatId] || [];
    const idx = settings.chatBindings[chatId].indexOf(folderId);
    if (idx === -1) {
        settings.chatBindings[chatId].push(folderId);
        toastr.success(t('bound_success'), "Lorebook Folders");
    } else {
        settings.chatBindings[chatId].splice(idx, 1);
        toastr.info(t('unbound_info'), "Lorebook Folders");
    }
    saveSettingsDebounced(); renderFolderPanel();
}

async function getAllCharacterChats() {
    const ctx = getContext();
    const scriptModule = await import("../../../../script.js");
    const getPastChats = scriptModule.getPastCharacterChats;
    const result = [];
    for (let i = 0; i < (ctx.characters || []).length; i++) {
        const c = ctx.characters[i];
        try {
            const chats = await getPastChats(i) || [];
            chats.forEach(chat => result.push({ charName: c.name, chatId: chat.file_id }));
        } catch(e) { if (c.chat) result.push({ charName: c.name, chatId: c.chat }); }
    }
    return result;
}

function deleteFolderRecursive(folderId, settings) {
    const children = settings.folders.filter(f => f.parentId === folderId);
    children.forEach(c => deleteFolderRecursive(c.id, settings));
    settings.folders = settings.folders.filter(f => f.id !== folderId);
    for (const k in settings.assignments) { 
        settings.assignments[k] = settings.assignments[k].filter(fid => fid !== folderId);
        if (settings.assignments[k].length === 0) delete settings.assignments[k];
    }
    for (const cid in settings.chatBindings) { 
        settings.chatBindings[cid] = settings.chatBindings[cid].filter(fid => fid !== folderId); 
    }
}

function isDescendant(targetId, potentialParentId, settings) {
    let current = settings.folders.find(f => f.id === targetId);
    while (current) {
        if (current.id === potentialParentId) return true;
        current = settings.folders.find(f => f.id === current.parentId);
    }
    return false;
}

function renderFolderTree(parentId, settings, allChats, boundFolders) {
    const children = settings.folders.filter(f => (f.parentId || null) === parentId);
    if (children.length === 0) return "";
    return children.map(f => {
        const books = Object.entries(settings.assignments).filter(([, folders]) => folders.includes(f.id)).map(([name]) => name);
        const isBound = boundFolders.includes(f.id);
        const booksHtml = books.length === 0 ? `<div class="lf-no-books">${t('no_books_tip')}</div>` : books.map(name => `
            <div class="lf-book-item" draggable="true" data-book-name="${name}">
                <span>📖</span><span class="lf-book-name">${name}</span>
                <i class="lf-book-remove fa-solid fa-xmark" data-book-name="${name}" data-folder-id="${f.id}"></i>
            </div>`).join("");
        const charMap = {};
        allChats.forEach(c => { if (!charMap[c.charName]) charMap[c.charName] = []; charMap[c.charName].push(c); });
        const charsHtml = Object.entries(charMap).map(([charName, chats]) => {
            const chatsHtml = chats.map(c => {
                const isChatBound = (settings.chatBindings[c.chatId] || []).includes(f.id);
                return `<div class="lf-chat-item"><span class="lf-chat-name">${c.chatId.replace(charName + ' - ', '')}</span>
                <i class="lf-btn-chat-bind fa-solid ${isChatBound ? "fa-link-slash" : "fa-link"} ${isChatBound ? "lf-active" : ""}" data-folder-id="${f.id}" data-chat-id="${c.chatId}"></i></div>`;
            }).join("");
            const isCharOpen = openCharChats.has(`${f.id}_${charName}`);
            return `<div class="lf-char-group"><div class="lf-char-header" data-folder-id="${f.id}" data-char="${charName}"><span class="lf-char-arrow">${isCharOpen ? "▼" : "▶"}</span><span class="lf-char-name">${charName}</span></div>
            <div class="lf-char-chats" ${isCharOpen ? "" : 'style="display:none;"'}>${chatsHtml}</div></div>`;
        }).join("");
        const isOpen = openFolders.has(f.id);
        const isChatsOpen = openChatsSections.has(f.id);
        return `<div class="lf-folder-item ${isBound ? "lf-bound" : ""}" draggable="true" data-folder-id="${f.id}">
            <div class="lf-folder-header"><span class="lf-folder-toggle">${isOpen ? "▼" : "▶"}</span><i class="fa-solid fa-folder lf-folder-icon" style="color: ${f.color || "#dcdcdc"};"></i><span class="lf-folder-name">${f.name}</span>
            <span class="lf-folder-actions">
                <i class="lf-btn-add-subfolder fa-solid fa-folder-plus" title="${t('add_subfolder')}" data-folder-id="${f.id}"></i>
                <i class="lf-btn-bind fa-solid fa-link${isBound ? " lf-active" : ""}" title="${t('bind_chat')}" data-folder-id="${f.id}"></i>
                <input type="color" class="lf-color-picker" data-folder-id="${f.id}" value="${f.color || '#e0e0e0'}" style="display:none;"><i class="lf-btn-color fa-solid fa-palette" title="${t('color_folder')}" data-folder-id="${f.id}"></i>
                <i class="lf-btn-add-book fa-solid fa-plus" title="${t('add_book')}" data-folder-id="${f.id}"></i><i class="lf-btn-rename fa-solid fa-pen" title="${t('rename')}" data-folder-id="${f.id}"></i><i class="lf-btn-delete fa-solid fa-trash" title="${t('delete')}" data-folder-id="${f.id}"></i>
            </span></div>
            <div class="lf-folder-contents" data-folder-id="${f.id}" ${isOpen ? "" : 'style="display:none;"'}>
                <div class="lf-subfolders-list">${renderFolderTree(f.id, settings, allChats, boundFolders)}</div><div class="lf-section-label">${t('lorebooks_label')}</div>${booksHtml}
                <div class="lf-section-label lf-chats-toggle" data-folder-id="${f.id}">${t('chat_bindings')} <span class="lf-chats-arrow">${isChatsOpen ? "▼" : "▶"}</span></div>
                <div class="lf-chats-section" data-folder-id="${f.id}" ${isChatsOpen ? "" : 'style="display:none;"'}>${charsHtml}</div>
            </div></div>`;
    }).join("");
}

async function renderFolderPanel() {
    const settings = getSettings();
    const list = $("#lf-folder-list");
    if (settings.folders.length === 0) { list.html(`<div class="lf-empty">${t('empty_folders')}</div>`); return; }
    list.html(`<div class="lf-empty">${t('loading')}</div>`);
    const allChats = await getAllCharacterChats();
    const bound = (getCurrentChatId() ? (settings.chatBindings[getCurrentChatId()] || []) : []);
    list.html(`<div class="lf-subfolders-list" style="margin-left:0; border:none; padding:0;">${renderFolderTree(null, settings, allChats, bound)}</div>`);
    setTimeout(() => bindEvents(), 50);
}

function bindEvents() {
    const settings = getSettings();
    $(".lf-folder-header").off("click").on("click", function (e) {
        if ($(e.target).closest(".lf-folder-actions, .lf-inline-input-wrapper").length) return;
        const id = $(this).closest(".lf-folder-item").data("folder-id");
        $(this).siblings(".lf-folder-contents").first().slideToggle(200, function() {
            if ($(this).is(":visible")) openFolders.add(id); else openFolders.delete(id);
            $(this).siblings(".lf-folder-header").find(".lf-folder-toggle").text($(this).is(":visible") ? "▼" : "▶");
        });
    });
    $(".lf-btn-bind").off("click").on("click", function(e) { e.stopPropagation(); toggleChatBinding($(this).data("folder-id")); });
    $(".lf-btn-color").off("click").on("click", function(e) { e.stopPropagation(); $(this).siblings(".lf-color-picker").click(); });
    $(".lf-color-picker").off("change").on("change", function() {
        const folder = settings.folders.find(f => f.id === $(this).data("folder-id"));
        if (folder) { folder.color = $(this).val(); saveSettingsDebounced(); renderFolderPanel(); }
    });
    $(".lf-btn-add-subfolder").off("click").on("click", function(e) {
        e.stopPropagation();
        const pid = $(this).data("folder-id");
        const cont = $(this).closest(".lf-folder-item").children(".lf-folder-contents");
        if (!cont.is(":visible")) $(this).closest(".lf-folder-header").trigger("click");
        const input = $(`<div class="lf-inline-input-wrapper"><input type="text" class="lf-inline-input" placeholder="${t('placeholder_subfolder')}"><i class="fa-solid fa-check" style="color:#98c379;"></i><i class="fa-solid fa-xmark" style="color:#e06c75;"></i></div>`);
        cont.children(".lf-subfolders-list").prepend(input); input.find("input").focus();
        input.find(".fa-check").on("click", () => { const n = input.find("input").val().trim(); if (n) { settings.folders.push({id:`f_${Date.now()}`, name:n, parentId:pid}); saveSettingsDebounced(); renderFolderPanel(); } });
        input.find(".fa-xmark").on("click", () => input.remove());
    });
    $(".lf-btn-add-book").off("click").on("click", function(e) {
        e.stopPropagation();
        const fid = $(this).data("folder-id");
        const un = getUnassignedLorebooks(fid);
        if (un.length === 0) { toastr.info(t('all_assigned'), "Lorebook Folders"); return; }
        const cont = $(this).closest(".lf-folder-item").children(".lf-folder-contents");
        if (!cont.is(":visible")) $(this).closest(".lf-folder-header").trigger("click");
        const add = $(`<div class="lf-inline-add"><select class="lf-add-select"><option disabled selected>${t('select_placeholder')}</option>${un.map(b=>`<option value="${b.name}">${b.name}</option>`).join("")}</select><i class="fa-solid fa-check" style="color:#98c379;"></i></div>`);
        cont.children(".lf-section-label").first().after(add);
        add.find(".fa-check").on("click", () => { const b = add.find("select").val(); if (b) { settings.assignments[b] = settings.assignments[b] || []; settings.assignments[b].push(fid); saveSettingsDebounced(); renderFolderPanel(); } });
    });
    $(".lf-btn-rename").off("click").on("click", function(e) {
        e.stopPropagation();
        const folder = settings.folders.find(f => f.id === $(this).data("folder-id"));
        const span = $(this).closest(".lf-folder-header").find(".lf-folder-name");
        span.hide();
        const input = $(`<div class="lf-inline-input-wrapper"><input type="text" class="lf-inline-input" value="${folder.name}"><i class="fa-solid fa-check"></i></div>`);
        span.after(input); input.find("input").focus();
        input.find(".fa-check").on("click", () => { const n = input.find("input").val().trim(); if (n) { folder.name = n; saveSettingsDebounced(); renderFolderPanel(); } });
    });
    $(".lf-btn-delete").off("click").on("click", function(e) { e.stopPropagation(); if (confirm(t('delete_confirm'))) { deleteFolderRecursive($(this).data("folder-id"), settings); saveSettingsDebounced(); renderFolderPanel(); } });
    $(".lf-chats-toggle").off("click").on("click", function(e) {
        e.stopPropagation(); const id = $(this).data("folder-id");
        $(this).siblings(".lf-chats-section").slideToggle(200, function() { if ($(this).is(":visible")) openChatsSections.add(id); else openChatsSections.delete(id); });
    });
    $(".lf-char-header").off("click").on("click", function(e) {
        e.stopPropagation(); const key = `${$(this).data("folder-id")}_${$(this).data("char")}`;
        $(this).siblings(".lf-char-chats").slideToggle(200, function() { if ($(this).is(":visible")) openCharChats.add(key); else openCharChats.delete(key); });
    });
    $(".lf-btn-chat-bind").off("click").on("click", function(e) { e.stopPropagation(); const fid = $(this).data("folder-id"), cid = $(this).data("chat-id"); settings.chatBindings[cid] = settings.chatBindings[cid] || []; const idx = settings.chatBindings[cid].indexOf(fid); if (idx === -1) settings.chatBindings[cid].push(fid); else settings.chatBindings[cid].splice(idx, 1); saveSettingsDebounced(); renderFolderPanel(); });
    
    $(".lf-folder-item").off("dragstart dragover drop").on("dragstart", function(e) { if ($(e.target).closest(".lf-book-item").length) return; e.stopPropagation(); e.originalEvent.dataTransfer.setData("lf-folder-id", $(this).data("folder-id")); })
    .on("dragover", function(e) { e.preventDefault(); e.stopPropagation(); $(this).addClass("lf-drag-over"); })
    .on("drop", function(e) {
        e.preventDefault(); e.stopPropagation(); $(this).removeClass("lf-drag-over");
        const tid = $(this).data("folder-id"), fid = e.originalEvent.dataTransfer.getData("lf-folder-id"), bn = e.originalEvent.dataTransfer.getData("lf-book-name");
        if (bn) { settings.assignments[bn] = settings.assignments[bn] || []; if (!settings.assignments[bn].includes(tid)) { settings.assignments[bn].push(tid); saveSettingsDebounced(); renderFolderPanel(); } }
        else if (fid && fid !== tid && !isDescendant(tid, fid, settings)) { const fidx = settings.folders.findIndex(f=>f.id===fid), tidx = settings.folders.findIndex(f=>f.id===tid); const [m] = settings.folders.splice(fidx, 1); m.parentId = settings.folders[tidx].parentId; settings.folders.splice(tidx, 0, m); saveSettingsDebounced(); renderFolderPanel(); }
    });
    $(".lf-book-item").off("dragstart").on("dragstart", function(e) { e.stopPropagation(); e.originalEvent.dataTransfer.setData("lf-book-name", $(this).data("book-name")); });
}

function handleCreateFolder() {
    const input = $(`<div class="lf-inline-input-wrapper" style="margin-bottom:8px;"><input type="text" class="lf-inline-input" placeholder="${t('placeholder_new_folder')}"><i class="fa-solid fa-check" style="color:#98c379;"></i><i class="fa-solid fa-xmark" style="color:#e06c75;"></i></div>`);
    $("#lf-folder-list").prepend(input); input.find("input").focus();
    input.find(".fa-check").on("click", () => { const n = input.find("input").val().trim(); if (n) { const s = getSettings(); s.folders.push({id:`f_${Date.now()}`, name:n, parentId:null}); saveSettingsDebounced(); renderFolderPanel(); } });
    input.find(".fa-xmark").on("click", () => input.remove());
}

function createTopBarButton() {
    const settings = getSettings();
    const btn = `<div id="lf-drawer" class="drawer">
        <div class="drawer-toggle drawer-header"><div id="lf-drawer-icon" class="drawer-icon fa-solid fa-folder-open interactable closedIcon" title="Lorebook Folders"></div></div>
        <div id="lf-drawer-content" class="drawer-content closedDrawer fillLeft"><div class="lf-drawer-inner">
            <div class="lf-panel-header"><span>📁 Lorebook Folders</span><button id="lf-create-folder" class="menu_button">${t('new_root')}</button></div>
            <div class="lf-controls-row">
                <input type="text" id="lf-search-input" placeholder="${t('search_placeholder')}">
                <i id="lf-compact-toggle" class="fa-solid fa-list ${settings.isCompact?"lf-active":""}" title="${t('compact_mode')}"></i>
                <i id="lf-export-btn" class="fa-solid fa-download" title="${t('export_btn')}"></i>
                <i id="lf-import-btn" class="fa-solid fa-upload" title="${t('import_btn')}"></i>
                <input type="file" id="lf-import-file" accept=".json" style="display:none;">
            </div>
            <div id="lf-folder-list"></div>
        </div></div></div>`;
    $('#top-settings-holder').append(btn);
    $('#lf-drawer-icon').on('click', function() {
        const content = $('#lf-drawer-content'), icon = $(this), isOpen = content.hasClass('openDrawer');
        $('.drawer-content.openDrawer').not(content).each(function() { $(this).removeClass('openDrawer').addClass('closedDrawer'); $(this).closest('.drawer').find('.drawer-icon').removeClass('openIcon').addClass('closedIcon'); });
        if (isOpen) { content.removeClass('openDrawer').addClass('closedDrawer'); icon.removeClass('openIcon').addClass('closedIcon'); }
        else { content.removeClass('closedDrawer').addClass('openDrawer'); icon.removeClass('closedIcon').addClass('openIcon'); renderFolderPanel(); }
    });
    $(document).on("input", "#lf-search-input", function() {
        const term = $(this).val().toLowerCase();
        $(".lf-folder-item").each(function() {
            const name = $(this).find(".lf-folder-name").first().text().toLowerCase();
            const hasMatch = name.includes(term) || $(this).find(".lf-book-name").filter(function() { return $(this).text().toLowerCase().includes(term); }).length > 0;
            $(this).toggle(hasMatch || !term);
        });
    });
    $(document).on("click", "#lf-compact-toggle", function() { settings.isCompact = !settings.isCompact; saveSettingsDebounced(); renderFolderPanel(); });
    $(document).on("click", "#lf-export-btn", function() {
        const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(getSettings(), null, 2));
        const link = document.createElement('a'); link.href = data; link.download = "lorebook_folders.json"; link.click();
        toastr.success(t('backup_ok'), "Lorebook Folders");
    });
    $(document).on("click", "#lf-import-btn", function() { $("#lf-import-file").click(); });
    $(document).on("change", "#lf-import-file", function(e) {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader(); r.onload = (ev) => { try { const d = JSON.parse(ev.target.result); if (d.folders) { extension_settings[extensionName] = d; saveSettingsDebounced(); renderFolderPanel(); toastr.success(t('import_ok'), "Lorebook Folders"); } } catch(err) {} }; r.readAsText(f);
    });
}

jQuery(async () => {
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
        $("#extensions_settings2").append(settingsHtml);
        const settings = getSettings();
        $("#lf-language-select").val(settings.language);
        $(document).on("change", "#lf-language-select", function() { settings.language = $(this).val(); saveSettingsDebounced(); location.reload(); });
        
        setTimeout(() => { createTopBarButton(); renderFolderPanel(); $(document).on("click", "#lf-create-folder", handleCreateFolder); }, 1000);
        const sm = await import("../../../../script.js");
        sm.eventSource.on(sm.event_types.CHAT_CHANGED, () => { setTimeout(() => applyBindingsForChat(getCurrentChatId()), 500); });
    } catch (err) { console.error(`[${extensionName}] ❌`, err); }
