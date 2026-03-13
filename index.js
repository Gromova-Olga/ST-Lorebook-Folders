import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "ST-Lorebook-Folders";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

let eventSource = null;
let event_types = null;

let openFolders = new Set();
let openChatsSections = new Set();
let openCharChats = new Set();

function getSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    if (!s.folders)      s.folders      = [];
    if (!s.assignments)  s.assignments  = {};
    if (!s.chatBindings) s.chatBindings = {};
    if (s.isCompact === undefined) s.isCompact = false;
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
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;
        Object.entries(settings.assignments)
            .filter(([, folders]) => Array.isArray(folders) && folders.includes(folderId))
            .forEach(([name]) => setLorebookActive(name, true));
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
                result.push({ charName: c.name, charIndex: i, chatId: chat.file_id, chatName: chat.file_id });
            });
        } catch(e) {
            if (c.chat) result.push({ charName: c.name, charIndex: i, chatId: c.chat, chatName: c.chat });
        }
    }
    return result;
}

// Удаление папки и всех её детей
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

// Проверка от зацикливания при перетаскивании
function isDescendant(targetId, potentialParentId, settings) {
    let current = settings.folders.find(f => f.id === targetId);
    while (current) {
        if (current.id === potentialParentId) return true;
        current = settings.folders.find(f => f.id === current.parentId);
    }
    return false;
}

// Рекурсивный рендер дерева папок
function renderFolderTree(parentId, settings, allChats, boundFolders) {
    const children = settings.folders.filter(f => (f.parentId || null) === parentId);
    if (children.length === 0) return "";

    const html = children.map(f => {
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
        
        const folderColor = f.color || "#dcdcdc";
        const subfoldersHtml = renderFolderTree(f.id, settings, allChats, boundFolders);

        return `
            <div class="lf-folder-item ${isBound ? "lf-bound" : ""}" draggable="true" data-folder-id="${f.id}">
                <div class="lf-folder-header">
                    <span class="lf-folder-toggle">${toggleIcon}</span>
                    <i class="fa-solid fa-folder lf-folder-icon" style="color: ${folderColor};"></i>
                    <span class="lf-folder-name" data-original-name="${f.name}">${f.name}</span>
                    <span class="lf-book-count">${books.length}</span>
                    ${isBound ? `<span class="lf-bound-badge">🔗</span>` : ""}
                    <span class="lf-folder-actions">
                        <i class="lf-btn-add-subfolder fa-solid fa-folder-plus" title="Создать подпапку" data-folder-id="${f.id}"></i>
                        <i class="lf-btn-bind fa-solid fa-link${isBound ? " lf-active" : ""}" title="Привязать к чату" data-folder-id="${f.id}"></i>
                        <input type="color" class="lf-color-picker" data-folder-id="${f.id}" value="${f.color || '#e0e0e0'}" style="display:none;">
                        <i class="lf-btn-color fa-solid fa-palette" title="Цвет папки" data-folder-id="${f.id}"></i>
                        <i class="lf-btn-add-book fa-solid fa-plus" title="Добавить лорбук" data-folder-id="${f.id}"></i>
                        <i class="lf-btn-rename fa-solid fa-pen" title="Переименовать" data-folder-id="${f.id}"></i>
                        <i class="lf-btn-delete fa-solid fa-trash" title="Удалить" data-folder-id="${f.id}"></i>
                    </span>
                </div>
                <div class="lf-folder-contents" data-folder-id="${f.id}" ${displayStyle}>
                    <div class="lf-subfolders-list">
                        ${subfoldersHtml}
                    </div>
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

    return html;
}

async function renderFolderPanel() {
    const settings = getSettings();
    const list = $("#lf-folder-list");
    const chatId = getCurrentChatId();
    const boundFolders = chatId ? (settings.chatBindings[chatId] || []) : [];

    const container = $("#lf-drawer-content");
    if (settings.isCompact) { container.addClass("lf-compact-mode"); } 
    else { container.removeClass("lf-compact-mode"); }

    if (settings.folders.length === 0) {
        list.html(`<div class="lf-empty">Папок пока нет.<br>Нажми «+ Папка» чтобы создать.</div>`);
        return;
    }

    list.html(`<div class="lf-empty">Загрузка...</div>`);

    const allChats = await getAllCharacterChats();
    const finalHtml = renderFolderTree(null, settings, allChats, boundFolders);
    
    list.html(`<div class="lf-subfolders-list" style="margin-left:0; border:none; padding:0;">${finalHtml}</div>`);
    setTimeout(() => bindEvents(), 50);
}

function bindEvents() {
    const settings = getSettings();

    $(".lf-folder-header").off("click").on("click", function (e) {
        if ($(e.target).closest(".lf-folder-actions, .lf-inline-input-wrapper").length) return;
        const folderId = $(this).closest(".lf-folder-item").data("folder-id");
        // Используем siblings().first() чтобы открывать только содержимое текущей папки, а не детей
        const contents = $(this).siblings(".lf-folder-contents").first();
        const toggle = $(this).find(".lf-folder-toggle").first();
        
        contents.slideToggle(200, function() {
            const isVisible = contents.is(":visible");
            toggle.text(isVisible ? "▼" : "▶");
            if (isVisible) openFolders.add(folderId); else openFolders.delete(folderId);
        });
    });

    $(".lf-btn-bind").off("click").on("click", function (e) {
        e.stopPropagation();
        toggleChatBinding($(this).data("folder-id"));
    });

    $(".lf-btn-color").off("click").on("click", function(e) {
        e.stopPropagation();
        $(this).siblings(".lf-color-picker").click();
    });
    
    $(".lf-color-picker").off("click change").on("click", function(e) { e.stopPropagation(); })
    .on("change", function(e) {
        const folderId = $(this).data("folder-id");
        const folder = settings.folders.find(f => f.id === folderId);
        if (folder) {
            folder.color = $(this).val();
            saveSettingsDebounced();
            renderFolderPanel();
        }
    });

    // Создание подпапки (Вариант А)
    $(".lf-btn-add-subfolder").off("click").on("click", function(e) {
        e.stopPropagation();
        const parentId = $(this).data("folder-id");
        const folderEl = $(this).closest(".lf-folder-item");
        const contentsEl = folderEl.children(".lf-folder-contents");
        
        if (!contentsEl.is(":visible")) {
            folderEl.children(".lf-folder-header").trigger("click");
        }
        
        if (contentsEl.find("> .lf-subfolders-list > .lf-inline-input-wrapper").length > 0) return;
        
        const inputBlock = $(`
            <div class="lf-inline-input-wrapper" style="margin-bottom: 6px;">
                <input type="text" class="lf-inline-input" placeholder="Название подпапки..." />
                <i class="lf-confirm-create-sub fa-solid fa-check" style="color:#98c379; cursor:pointer;"></i>
                <i class="lf-cancel-create-sub fa-solid fa-xmark" style="color:#e06c75; cursor:pointer;"></i>
            </div>
        `);
        
        contentsEl.children(".lf-subfolders-list").prepend(inputBlock);
        inputBlock.hide().slideDown(200);
        inputBlock.find("input").focus();
        
        const finishCreate = () => {
            const name = inputBlock.find("input").val().trim();
            if (name) {
                settings.folders.push({ id: `folder_${Date.now()}`, name: name, parentId: parentId });
                saveSettingsDebounced();
                renderFolderPanel();
            } else {
                inputBlock.slideUp(200, () => inputBlock.remove());
            }
        };
        
        inputBlock.find(".lf-confirm-create-sub").on("click", finishCreate);
        inputBlock.find(".lf-cancel-create-sub").on("click", () => inputBlock.slideUp(200, () => inputBlock.remove()));
        inputBlock.find("input").on("keydown", (e) => { 
            if (e.key === "Enter") finishCreate(); 
            if (e.key === "Escape") inputBlock.find(".lf-cancel-create-sub").trigger("click"); 
        });
    });

    $(".lf-btn-add-book").off("click").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;

        const unassigned = getUnassignedLorebooks(folderId);
        if (unassigned.length === 0) { toastr.info("Все лорбуки уже в этой папке.", "Lorebook Folders"); return; }

        const folderEl = $(this).closest(".lf-folder-item");
        const contentsEl = folderEl.children(".lf-folder-contents");

        if (!contentsEl.is(":visible")) { folderEl.children(".lf-folder-header").trigger("click"); }

        if (contentsEl.children(".lf-inline-add").length > 0) { contentsEl.children(".lf-inline-add").remove(); return; }
        $(".lf-inline-add").remove();

        const options = unassigned.map(b => `<option value="${b.name}">${b.name}</option>`).join("");
        const addBlock = $(`
            <div class="lf-inline-add">
                <select class="lf-add-select">
                    <option value="" disabled selected>-- Выбери лорбук --</option>
                    ${options}
                </select>
                <i class="lf-confirm-add fa-solid fa-check" style="color:#98c379;" title="Добавить"></i>
                <i class="lf-cancel-add fa-solid fa-xmark" style="color:#e06c75;" title="Отмена"></i>
            </div>
        `);

        // Вставляем после списка подпапок
        contentsEl.children(".lf-section-label").first().after(addBlock);

        addBlock.find(".lf-confirm-add").on("click", function(e) {
            e.stopPropagation();
            const bookName = addBlock.find(".lf-add-select").val();
            if (!bookName) return;

            settings.assignments[bookName] = settings.assignments[bookName] || [];
            if (!settings.assignments[bookName].includes(folderId)) settings.assignments[bookName].push(folderId);
            
            saveSettingsDebounced();
            renderFolderPanel();
            toastr.success(`«${bookName}» → «${folder.name}»`, "Lorebook Folders");
        });

        addBlock.find(".lf-add-select").on("change", function() { addBlock.find(".lf-confirm-add").trigger("click"); });
        addBlock.find(".lf-cancel-add").on("click", function(e) { e.stopPropagation(); addBlock.remove(); });
    });

    $(".lf-btn-rename").off("click").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;

        const header = $(this).closest(".lf-folder-header");
        const nameSpan = header.find(".lf-folder-name").first();
        
        if (header.find(".lf-inline-input-wrapper").length > 0) return;

        const oldName = nameSpan.text();
        nameSpan.hide();

        const inputBlock = $(`
            <div class="lf-inline-input-wrapper">
                <input type="text" class="lf-inline-input" value="${oldName}" />
                <i class="lf-confirm-rename fa-solid fa-check" style="color:#98c379;"></i>
                <i class="lf-cancel-rename fa-solid fa-xmark" style="color:#e06c75;"></i>
            </div>
        `);

        nameSpan.after(inputBlock);
        inputBlock.find("input").focus();

        const finishRename = () => {
            const newName = inputBlock.find("input").val().trim();
            if (newName && newName !== oldName) {
                folder.name = newName;
                saveSettingsDebounced();
                renderFolderPanel();
            } else {
                inputBlock.remove();
                nameSpan.show();
            }
        };

        inputBlock.find(".lf-confirm-rename").on("click", finishRename);
        inputBlock.find(".lf-cancel-rename").on("click", (e) => { e.stopPropagation(); inputBlock.remove(); nameSpan.show(); });
        inputBlock.find("input").on("keydown", (e) => { if (e.key === "Enter") finishRename(); if (e.key === "Escape") inputBlock.find(".lf-cancel-rename").trigger("click"); });
    });

    $(".lf-btn-delete").off("click").on("click", function (e) {
        e.stopPropagation();
        const id = $(this).data("folder-id");
        const folder = settings.folders.find(f => f.id === id);
        if (!folder) return;
        if (!confirm(`Удалить «${folder.name}» и все вложенные папки?`)) return;
        
        deleteFolderRecursive(id, settings);
        saveSettingsDebounced();
        renderFolderPanel();
    });

    $(".lf-chats-toggle").off("click").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const section = $(this).siblings(`.lf-chats-section[data-folder-id="${folderId}"]`).first();
        const arrow = $(this).find(".lf-chats-arrow");
        
        section.slideToggle(200, function() {
            const isVisible = section.is(":visible");
            arrow.text(isVisible ? "▼" : "▶");
            if (isVisible) openChatsSections.add(folderId); else openChatsSections.delete(folderId);
        });
    });

    $(".lf-char-header").off("click").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const charName = $(this).data("char");
        const charGroupId = `${folderId}_${charName}`;
        const chats = $(this).siblings(".lf-char-chats").first();
        const arrow = $(this).find(".lf-char-arrow");
        
        chats.slideToggle(200, function() {
            const isVisible = chats.is(":visible");
            arrow.text(isVisible ? "▼" : "▶");
            if (isVisible) openCharChats.add(charGroupId); else openCharChats.delete(charGroupId);
        });
    });

    $(".lf-btn-chat-bind").off("click").on("click", function (e) {
        e.stopPropagation();
        const folderId = $(this).data("folder-id");
        const cChatId = $(this).data("chat-id");
        const folder = settings.folders.find(f => f.id === folderId);
        if (!folder) return;

        settings.chatBindings[cChatId] = settings.chatBindings[cChatId] || [];
        const bindings = settings.chatBindings[cChatId];
        const idx = bindings.indexOf(folderId);

        if (idx === -1) { bindings.push(folderId); toastr.success(`🔗 «${folder.name}» привязана к чату`, "Lorebook Folders"); } 
        else { bindings.splice(idx, 1); toastr.info(`«${folder.name}» отвязана от чата`, "Lorebook Folders"); }

        saveSettingsDebounced();
        renderFolderPanel();
    });

    $(".lf-folder-item").off("dragstart dragend dragover dragleave drop")
    .on("dragstart", function (e) {
        if ($(e.target).closest(".lf-book-item").length) return; 
        e.stopPropagation();
        e.originalEvent.dataTransfer.setData("lf-folder-id", $(this).data("folder-id"));
        e.originalEvent.dataTransfer.effectAllowed = "move";
        $(this).addClass("lf-drag-source");
    }).on("dragend", function(e) {
        $(this).removeClass("lf-drag-source");
    }).on("dragover", function (e) {
        e.preventDefault(); 
        e.stopPropagation();
        $(this).addClass("lf-drag-over");
    }).on("dragleave", function (e) {
        e.stopPropagation();
        if (!$(this).is($(e.relatedTarget).closest(".lf-folder-item"))) $(this).removeClass("lf-drag-over");
    }).on("drop", function (e) {
        e.preventDefault();
        e.stopPropagation(); 
        $(this).removeClass("lf-drag-over");

        const targetFolderId = $(this).data("folder-id");
        const dragBookName = e.originalEvent.dataTransfer.getData("lf-book-name");
        const dragFolderId = e.originalEvent.dataTransfer.getData("lf-folder-id");

        if (dragBookName) {
            const folder = settings.folders.find(f => f.id === targetFolderId);
            if (!folder) return;
            settings.assignments[dragBookName] = settings.assignments[dragBookName] || [];
            if (!settings.assignments[dragBookName].includes(targetFolderId)) { 
                settings.assignments[dragBookName].push(targetFolderId); 
                saveSettingsDebounced(); renderFolderPanel();
                toastr.success(`«${dragBookName}» → «${folder.name}»`, "Lorebook Folders");
            } else { toastr.info(`«${dragBookName}» уже в этой папке.`, "Lorebook Folders"); }
            
        } else if (dragFolderId && dragFolderId !== targetFolderId) {
            if (isDescendant(targetFolderId, dragFolderId, settings)) {
                toastr.warning("Нельзя переместить папку внутрь самой себя!", "Lorebook Folders");
                return;
            }
            
            const folders = settings.folders;
            const fromIdx = folders.findIndex(f => f.id === dragFolderId);
            const toIdx = folders.findIndex(f => f.id === targetFolderId);
            
            if (fromIdx > -1 && toIdx > -1) {
                const movedFolder = folders[fromIdx];
                const targetFolder = folders[toIdx];
                
                // Наследуем родителя от папки, на которую сбросили (чтобы встать с ней в один ряд)
                movedFolder.parentId = targetFolder.parentId;
                
                folders.splice(fromIdx, 1);
                folders.splice(toIdx, 0, movedFolder);
                saveSettingsDebounced();
                renderFolderPanel();
            }
        }
    });

    $(".lf-book-item").off("dragstart").on("dragstart", function (e) { 
        e.stopPropagation();
        e.originalEvent.dataTransfer.setData("lf-book-name", $(this).data("book-name")); 
    });

    $(".lf-book-remove").off("click").on("click", function (e) {
        e.stopPropagation();
        const bookName = $(this).data("book-name");
        const folderId = $(this).data("folder-id");
        if (!settings.assignments[bookName]) return;
        settings.assignments[bookName] = settings.assignments[bookName].filter(f => f !== folderId);
        if (settings.assignments[bookName].length === 0) delete settings.assignments[bookName];
        saveSettingsDebounced(); renderFolderPanel();
    });
}

function handleCreateFolder() {
    if ($("#lf-new-folder-input").length > 0) return;

    const inputBlock = $(`
        <div id="lf-new-folder-input" class="lf-inline-input-wrapper" style="margin-bottom: 8px;">
            <input type="text" class="lf-inline-input" placeholder="Название новой корневой папки..." />
            <i class="lf-confirm-create fa-solid fa-check" style="color:#98c379; cursor:pointer;"></i>
            <i class="lf-cancel-create fa-solid fa-xmark" style="color:#e06c75; cursor:pointer;"></i>
        </div>
    `);

    $("#lf-folder-list").prepend(inputBlock);
    inputBlock.hide().slideDown(200);
    inputBlock.find("input").focus();

    const finishCreate = () => {
        const name = inputBlock.find("input").val().trim();
        if (name) {
            const settings = getSettings();
            // Корневые папки создаются без parentId
            settings.folders.push({ id: `folder_${Date.now()}`, name: name, parentId: null });
            saveSettingsDebounced();
            renderFolderPanel();
            toastr.success(`Папка «${name}» создана!`, "Lorebook Folders");
        } else {
            inputBlock.slideUp(200, () => inputBlock.remove());
        }
    };

    inputBlock.find(".lf-confirm-create").on("click", finishCreate);
    inputBlock.find(".lf-cancel-create").on("click", () => inputBlock.slideUp(200, () => inputBlock.remove()));
    inputBlock.find("input").on("keydown", (e) => { 
        if (e.key === "Enter") finishCreate(); 
        if (e.key === "Escape") inputBlock.find(".lf-cancel-create").trigger("click"); 
    });
}

function createTopBarButton() {
    const settings = getSettings();
    const compactClass = settings.isCompact ? "lf-active" : "";

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
                        <button id="lf-create-folder" class="menu_button">+ Корень</button>
                    </div>
                    <div class="lf-controls-row">
                        <input type="text" id="lf-search-input" placeholder="Поиск..." />
                        <i id="lf-compact-toggle" class="fa-solid fa-list ${compactClass}" title="Компактный вид"></i>
                        <i id="lf-export-btn" class="fa-solid fa-download" title="Экспорт структуры (Backup)"></i>
                        <i id="lf-import-btn" class="fa-solid fa-upload" title="Импорт структуры"></i>
                        <input type="file" id="lf-import-file" accept=".json" style="display:none;" />
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
            $(this).closest('.drawer').find('.drawer-icon').removeClass('openIcon').addClass('closedIcon');
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

    $(document).on("input", "#lf-search-input", function() {
        const term = $(this).val().toLowerCase();
        
        if (!term) {
            $(".lf-folder-item").show();
            $(".lf-book-item").show();
            return;
        }

        $(".lf-folder-item").each(function() {
            const folderName = $(this).find(".lf-folder-name").first().text().toLowerCase();
            let hasMatch = folderName.includes(term);

            $(this).find("> .lf-folder-contents > .lf-book-item").each(function() {
                const bookName = $(this).find(".lf-book-name").text().toLowerCase();
                if (bookName.includes(term)) {
                    $(this).show();
                    hasMatch = true;
                } else {
                    $(this).hide();
                }
            });

            if (hasMatch) {
                $(this).show();
                const contents = $(this).children(".lf-folder-contents");
                if (!contents.is(":visible")) {
                    contents.show();
                    $(this).find("> .lf-folder-header > .lf-folder-toggle").text("▼");
                }
                $(this).parents(".lf-folder-item").show().children(".lf-folder-contents").show();
                $(this).parents(".lf-folder-item").find("> .lf-folder-header > .lf-folder-toggle").text("▼");
            } else {
                $(this).hide();
            }
        });
    });

    $(document).on("click", "#lf-compact-toggle", function() {
        const settings = getSettings();
        settings.isCompact = !settings.isCompact;
        saveSettingsDebounced();
        
        $(this).toggleClass("lf-active", settings.isCompact);
        renderFolderPanel(); 
    });

    $(document).on("click", "#lf-export-btn", function() {
        const settings = getSettings();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "lorebook_folders_backup.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        toastr.success("Бэкап папок успешно скачан!", "Lorebook Folders");
    });

    $(document).on("click", "#lf-import-btn", function() {
        $("#lf-import-file").click(); 
    });

    $(document).on("change", "#lf-import-file", function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                if (importedData && importedData.folders) {
                    extension_settings[extensionName] = importedData;
                    saveSettingsDebounced();
                    renderFolderPanel();
                    toastr.success("Структура папок успешно восстановлена!", "Lorebook Folders");
                } else {
                    toastr.error("Файл не содержит данных папок", "Lorebook Folders");
                }
            } catch (err) {
                toastr.error("Ошибка при чтении файла", "Lorebook Folders");
            }
        };
        reader.readAsText(file);
        $(this).val(''); 
    });

    console.log(`[${extensionName}] Top bar button created`);
}

jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
        $("#extensions_settings2").append(settingsHtml);

        setTimeout(() => {
            createTopBarButton();
            renderFolderPanel();
            $(document).off("click", "#lf-create-folder").on("click", "#lf-create-folder", handleCreateFolder);
        }, 1000);

        const scriptModule = await import("../../../../script.js");
        eventSource = scriptModule.eventSource;
        event_types = scriptModule.event_types;

        eventSource.on(event_types.CHAT_CHANGED, () => {
            const chatId = getCurrentChatId();
            setTimeout(() => applyBindingsForChat(chatId), 500);
        });

        console.log(`[${extensionName}] ✅ Loaded`);
    } catch (err) {
        console.error(`[${extensionName}] ❌`, err);
    }
});
