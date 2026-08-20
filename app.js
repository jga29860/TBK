(function () {
    "use strict";

    let currentPage = "home";

    const $ = (s) => document.querySelector(s);

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function showMessage(message, type = "success") {
        const box = $("#message");

        if (!box) return;

        box.textContent = message;
        box.className = type;

        setTimeout(() => {
            box.textContent = "";
            box.className = "";
        }, 5000);
    }

    function activatePage(id) {
        document
            .querySelectorAll(".page")
            .forEach((p) => p.classList.remove("active"));

        $("#" + id)?.classList.add("active");
    }

    function renderLogin() {
        activatePage("login");

        $("#nav").hidden = true;

        $("#login").innerHTML = `
            <div class="login">
                <h2>Connexion</h2>

                <label>Nom de connexion</label>
                <input id="email" type="text">

                <label>Mot de passe</label>
                <input id="password" type="password">

                <button id="connect">
                    Se connecter
                </button>
            </div>
        `;

        $("#connect").onclick = async () => {
            try {
                await TBK_AUTH.login(
                    $("#email").value,
                    $("#password").value
                );

                await render();
            } catch (e) {
                showMessage(
                    e.message,
                    "error"
                );
            }
        };
    }

    function renderHome() {

        const profile = TBK_AUTH.profile();

        $("#home").innerHTML = `
            <div class="hero">
                <h2>
                    Bienvenue ${escapeHtml(
                        profile?.display_name || ""
                    )}
                </h2>

                <p>
                    TBK V126
                </p>
            </div>
        `;
    }

    function euro(value) {
        return Number(value || 0)
            .toLocaleString("fr-FR", {
                style: "currency",
                currency: "EUR"
            });
    }

    async function renderRegistrations() {

        await TBK_REG.load();

        const rows = TBK_REG.rows();
        const cols = TBK_REG.columns();
        const stats = TBK_REG.stats();

        const admin = TBK_AUTH.canAdmin();

        $("#registrations").innerHTML = `
            <div class="card">
                <h2>Inscriptions</h2>

                <div class="stats-line">
                    <div class="kpi">
                        <span>Total</span>
                        <strong>${stats.total}</strong>
                    </div>

                    <div class="kpi">
                        <span>Montant encaissé</span>
                        <strong>${euro(stats.paid)}</strong>
                    </div>
                </div>

                <button id="addRegistration">
                    Ajouter une inscription
                </button>
            </div>

            ${
                admin
                    ? renderColumnAdministration(cols)
                    : ""
            }
        `;

        $("#addRegistration").onclick = () => {

            showMessage(
                "Création inscription",
                "success"
            );
        };

        bindColumnAdministration();
    }

    function renderColumnAdministration(columns) {

        return `
            <div class="card column-admin">

                <h3>
                    Paramétrage des colonnes
                </h3>

                <table class="column-config-table">

                    <thead>
                        <tr>
                            <th style="width: 80px;">Ordre</th>
                            <th style="width: 120px;">Clé</th>
                            <th style="width: 150px;">Nom</th>
                            <th style="width: 100px;">Largeur</th>
                            <th>Actions</th>
                        </tr>
                    </thead>

                    <tbody>

                    ${columns.map(c => `
                        <tr data-column-key="${c.column_key}">

                            <td>
                                ${c.sort_order}
                            </td>

                            <td>
                                ${escapeHtml(c.column_key)}
                            </td>

                            <td>
                                ${escapeHtml(c.label)}
                            </td>

                            <td>
                                <input 
                                    type="number" 
                                    class="column-width-input" 
                                    value="${c.column_width || 150}"
                                    min="50"
                                    max="500"
                                    data-column-key="${c.column_key}"
                                > px
                            </td>

                            <td>

                                <button
                                    data-cup="${c.column_key}">
                                    ⬆️
                                </button>

                                <button
                                    data-cdown="${c.column_key}">
                                    ⬇️
                                </button>

                                <button
                                    data-csave="${c.column_key}">
                                    💾
                                </button>

                                ${
                                    c.built_in
                                    ? ""
                                    : `
                                    <button
                                        class="danger"
                                        data-cdelete="${c.column_key}">
                                        🗑️
                                    </button>
                                    `
                                }

                            </td>
                        </tr>
                    `).join("")}

                    </tbody>

                </table>

            </div>
        `;
    }

    function bindColumnAdministration() {

        // Suppression de colonne
        document
            .querySelectorAll("[data-cdelete]")
            .forEach(btn => {

                btn.onclick = async () => {

                    const key =
                        btn.dataset.cdelete;

                    if (
                        !confirm(
                            `Supprimer la colonne "${key}" ?`
                        )
                    ) {
                        return;
                    }

                    try {

                        await TBK_REG.deleteColumn(
                            key
                        );

                        await renderRegistrations();

                        showMessage(
                            "Colonne supprimée",
                            "success"
                        );

                    } catch (e) {

                        showMessage(
                            e.message,
                            "error"
                        );
                    }
                };
            });

        // Changement de largeur via input
        document
            .querySelectorAll(".column-width-input")
            .forEach(input => {

                input.onchange = async () => {

                    const key = input.dataset.columnKey;
                    const width = parseInt(input.value, 10);

                    if (isNaN(width) || width < 50 || width > 500) {
                        showMessage(
                            "Largeur invalide (50-500 px)",
                            "error"
                        );
                        return;
                    }

                    try {

                        await TBK_REG.saveColumnWidth(key, width);

                        showMessage(
                            `Largeur de "${key}" mise à jour`,
                            "success"
                        );

                    } catch (e) {

                        showMessage(
                            e.message,
                            "error"
                        );
                    }
                };
            });

        // Redimensionnement drag&drop des colonnes
        setupColumnResizers();
    }

    function setupColumnResizers() {
        const table = $(".column-config-table");
        if (!table) return;

        const rows = table.querySelectorAll("tbody tr");
        
        rows.forEach(row => {
            const columnKey = row.dataset.columnKey;
            if (!columnKey) return;

            // Créer un handle de redimensionnement
            const handle = document.createElement("div");
            handle.className = "column-resize-handle";
            handle.title = "Cliquer et faire glisser pour redimensionner";
            
            // Insérer après la colonne "Largeur"
            const cells = row.querySelectorAll("td");
            if (cells.length >= 4) {
                cells[3].appendChild(handle);
            }

            handle.onmousedown = startResize(columnKey, handle);
        });
    }

    function startResize(columnKey, handle) {
        return (e) => {
            e.preventDefault();
            
            const input = handle.closest("tr").querySelector(".column-width-input");
            if (!input) return;

            const startX = e.clientX;
            const startWidth = parseInt(input.value, 10);

            function onMouseMove(moveEvent) {
                const deltaX = moveEvent.clientX - startX;
                const newWidth = Math.max(50, Math.min(500, startWidth + deltaX));
                input.value = newWidth;
            }

            function onMouseUp() {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                
                // Sauvegarder la largeur
                const newWidth = parseInt(input.value, 10);
                TBK_REG.saveColumnWidth(columnKey, newWidth)
                    .then(() => {
                        showMessage(
                            `Largeur de "${columnKey}" mise à jour`,
                            "success"
                        );
                    })
                    .catch(err => {
                        showMessage(
                            err.message,
                            "error"
                        );
                    });
            }

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        };
    }

    async function navigate(page) {

        currentPage = page;

        activatePage(page);

        try {

            switch (page) {

                case "home":
                    renderHome();
                    break;

                case "registrations":
                    await renderRegistrations();
                    break;

                case "admin":
                    if (!TBK_AUTH.canAdmin()) {
                        currentPage = "home";
                        renderHome();
                        return;
                    }
                    break;

                case "docs":
                    break;
            }

        } catch (e) {

            console.error(e);

            showMessage(
                e.message,
                "error"
            );
        }
    }

    async function render() {

        const session =
            TBK_AUTH.session();

        if (!session) {

            renderLogin();

            $("#user-zone").innerHTML = "";

            return;
        }

        $("#nav").hidden = false;

        const profile =
            TBK_AUTH.profile();

        $("#user-zone").innerHTML =
            `
            ${escapeHtml(
                profile?.display_name ||
                session.user.email
            )}

            ·

            ${escapeHtml(
                profile?.profile_code || ""
            )}
            `;

        document
            .querySelectorAll("[data-page]")
            .forEach(btn => {

                btn.hidden =
                    !TBK_AUTH.canView(
                        btn.dataset.page
                    );
            });

        await navigate(currentPage);
    }

    window.TBK_APP = {
        render,
        navigate
    };

    window.TBK_UI = {
        message: showMessage
    };

    document
        .querySelectorAll("[data-page]")
        .forEach(btn => {

            btn.onclick = () =>
                navigate(
                    btn.dataset.page
                );
        });

    TBK_AUTH.init()
        .then(render)
        .catch(err => {

            console.error(err);

            renderLogin();

            showMessage(
                err.message,
                "error"
            );
        });

})();
