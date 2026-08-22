(() => {
  const state = {
    config: null,           // { objects: [...] } from /api/config
    currentObject: null,    // apiName of selected object, e.g. "Account"
    fields: [],              // field metadata for the current object
    records: [],
    offset: 0,
    hasMore: true,
    loading: false,
    editingId: null,        // set when the modal is in "edit" mode
    pendingDeleteId: null,
  };

  // -- DOM refs -------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const loginBtn = $("loginBtn");
  const authArea = $("authArea");
  const app = $("app");
  const loggedOutState = $("loggedOutState");
  const objectSelect = $("objectSelect");
  const newRecordBtn = $("newRecordBtn");
  const emptyNewBtn = $("emptyNewBtn");
  const recordCount = $("recordCount");
  const tableHead = $("tableHead");
  const tableBody = $("tableBody");
  const loadingRow = $("loadingRow");
  const emptyState = $("emptyState");
  const tableWrap = document.querySelector(".table-wrap");

  const modalOverlay = $("modalOverlay");
  const modalTitle = $("modalTitle");
  const recordForm = $("recordForm");
  const modalClose = $("modalClose");
  const cancelBtn = $("cancelBtn");
  const formError = $("formError");

  const deleteOverlay = $("deleteOverlay");
  const deleteMessage = $("deleteMessage");
  const deleteCancelBtn = $("deleteCancelBtn");
  const deleteConfirmBtn = $("deleteConfirmBtn");

  const toastEl = $("toast");

  // -- Toast helper -----------------------------------------------------------
  let toastTimer;
  function showToast(msg, isError = false) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", isError);
    toastEl.classList.remove("hidden");
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3200);
  }

  // -- Auth ---------------------------------------------------------------
  loginBtn.addEventListener("click", () => {
    window.location.href = "/auth/login";
  });

  async function checkAuth() {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (data.authenticated) {
      app.classList.remove("hidden");
      loggedOutState.classList.add("hidden");
      authArea.innerHTML = "";
      if (data.identity && data.identity.name) {
        const span = document.createElement("span");
        span.className = "identity";
        span.textContent = data.identity.name;
        authArea.appendChild(span);
      }
      const logoutBtn = document.createElement("button");
      logoutBtn.className = "btn btn-ghost";
      logoutBtn.textContent = "Log out";
      logoutBtn.addEventListener("click", async () => {
        await fetch("/auth/logout", { method: "POST" });
        window.location.reload();
      });
      authArea.appendChild(logoutBtn);
      await loadConfig();
    } else {
      app.classList.add("hidden");
      loggedOutState.classList.remove("hidden");
    }
  }

  // -- Config / object dropdown -------------------------------------------
  async function loadConfig() {
    const res = await fetch("/api/config");
    state.config = await res.json();
    objectSelect.innerHTML = "";
    state.config.objects.forEach((obj) => {
      const opt = document.createElement("option");
      opt.value = obj.apiName;
      opt.textContent = obj.label;
      objectSelect.appendChild(opt);
    });
    selectObject(state.config.objects[0].apiName);
  }

  objectSelect.addEventListener("change", (e) => selectObject(e.target.value));

  function selectObject(apiName) {
    state.currentObject = apiName;
    state.fields = state.config.objects.find((o) => o.apiName === apiName).fields;
    state.records = [];
    state.offset = 0;
    state.hasMore = true;
    objectSelect.value = apiName;
    renderTableHead();
    tableBody.innerHTML = "";
    emptyState.classList.add("hidden");
    loadNextPage();
  }

  function renderTableHead() {
    tableHead.innerHTML = "";
    state.fields.forEach((f) => {
      const th = document.createElement("th");
      th.textContent = f.label;
      tableHead.appendChild(th);
    });
    const actionsTh = document.createElement("th");
    actionsTh.textContent = "Actions";
    tableHead.appendChild(actionsTh);
  }

  // -- Pagination (20 at a time, load more on scroll-to-bottom) -----------
  async function loadNextPage() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    loadingRow.classList.remove("hidden");

    try {
      const res = await fetch(
        `/api/records/${state.currentObject}?offset=${state.offset}`
      );
      if (!res.ok) throw await res.json();
      const data = await res.json();

      state.records = state.records.concat(data.records);
      state.hasMore = data.hasMore;
      state.offset = data.nextOffset;
      recordCount.textContent = `${state.records.length} of ${data.totalSize} loaded`;

      appendRows(data.records);
      emptyState.classList.toggle("hidden", state.records.length !== 0);
    } catch (err) {
      console.error(err);
      showToast(describeError(err), true);
    } finally {
      state.loading = false;
      loadingRow.classList.add("hidden");
    }
  }

  function appendRows(records) {
    records.forEach((rec) => {
      const tr = document.createElement("tr");
      state.fields.forEach((f) => {
        const td = document.createElement("td");
        td.textContent = rec[f.name] ?? "";
        tr.appendChild(td);
      });
      const actionsTd = document.createElement("td");
      actionsTd.className = "row-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-ghost btn-small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openModal("edit", rec));

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-small";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => openDeleteConfirm(rec));

      actionsTd.append(editBtn, delBtn);
      tr.appendChild(actionsTd);
      tableBody.appendChild(tr);
    });
  }

  // infinite scroll: load next page when scrolled near the bottom
  window.addEventListener("scroll", () => {
    if (app.classList.contains("hidden")) return;
    const nearBottom =
      window.innerHeight + window.scrollY >= document.body.offsetHeight - 300;
    if (nearBottom) loadNextPage();
  });

  // -- Create / Edit modal --------------------------------------------------
  newRecordBtn.addEventListener("click", () => openModal("create"));
  emptyNewBtn.addEventListener("click", () => openModal("create"));
  modalClose.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  function openModal(mode, record = null) {
    formError.classList.add("hidden");
    recordForm.innerHTML = "";
    state.editingId = mode === "edit" ? record.Id : null;
    modalTitle.textContent =
      mode === "edit"
        ? `Edit ${state.currentObject}`
        : `New ${state.currentObject}`;

    state.fields.forEach((f) => {
      const group = document.createElement("div");
      group.className = "field-group";

      const label = document.createElement("label");
      label.textContent = f.label + (f.required ? " *" : "");
      label.setAttribute("for", `field_${f.name}`);

      let input;
      if (f.type === "textarea") {
        input = document.createElement("textarea");
      } else {
        input = document.createElement("input");
        input.type = f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text";
      }
      input.id = `field_${f.name}`;
      input.name = f.name;
      if (f.required) input.required = true;
      if (record && record[f.name] != null) input.value = record[f.name];

      group.append(label, input);
      recordForm.appendChild(group);
    });

    modalOverlay.classList.remove("hidden");
  }

  function closeModal() {
    modalOverlay.classList.add("hidden");
    state.editingId = null;
  }

  recordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.classList.add("hidden");

    const payload = {};
    state.fields.forEach((f) => {
      const val = recordForm.elements[f.name].value;
      if (val !== "") payload[f.name] = f.type === "number" ? Number(val) : val;
    });

    try {
      let res;
      if (state.editingId) {
        res = await fetch(`/api/records/${state.currentObject}/${state.editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/records/${state.currentObject}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) throw await res.json();

      closeModal();
      showToast(state.editingId ? "Record updated" : "Record created");
      selectObject(state.currentObject); // refresh from the top
    } catch (err) {
      formError.textContent = describeError(err);
      formError.classList.remove("hidden");
    }
  });

  // -- Delete confirmation ---------------------------------------------------
  function openDeleteConfirm(record) {
    state.pendingDeleteId = record.Id;
    const nameField = state.config.objects.find(
      (o) => o.apiName === state.currentObject
    );
    const label =
      record[state.fields[0].name] || record.Id;
    deleteMessage.textContent = `This will permanently delete "${label}" from Salesforce.`;
    deleteOverlay.classList.remove("hidden");
  }

  deleteCancelBtn.addEventListener("click", () => {
    state.pendingDeleteId = null;
    deleteOverlay.classList.add("hidden");
  });

  deleteConfirmBtn.addEventListener("click", async () => {
    if (!state.pendingDeleteId) return;
    try {
      const res = await fetch(
        `/api/records/${state.currentObject}/${state.pendingDeleteId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw await res.json();
      showToast("Record deleted");
      deleteOverlay.classList.add("hidden");
      state.pendingDeleteId = null;
      selectObject(state.currentObject); // refresh
    } catch (err) {
      showToast(describeError(err), true);
    }
  });

  // -- Error formatting -----------------------------------------------------
  function describeError(err) {
    if (Array.isArray(err) && err[0] && err[0].message) return err[0].message;
    if (err && err.error) return typeof err.error === "string" ? err.error : JSON.stringify(err.error);
    if (err && err.message) return err.message;
    return "Something went wrong. Check the console for details.";
  }

  checkAuth();
})();
