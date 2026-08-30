/* ==========================================================================
   Wells Safety — Dispatch Book
   A single-file invoice ledger. Everything lives in localStorage: no server,
   no account, nothing leaves the browser. Money is held as integer cents so
   totals never drift the way floating point dollars do.
   ========================================================================== */

(function () {
  "use strict";

  var KEY = "wellssafety.dispatchbook.v1";

  /* ------------------------------------------------------------ helpers -- */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  // Dollars (string or number) -> integer cents.
  function toCents(v) {
    var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : Math.round(n * 100);
  }

  function money(cents) {
    return (cents / 100).toLocaleString("en-US", {
      style: "currency", currency: "USD"
    });
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function today() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // "2026-08-30" -> local Date at midnight (avoids the UTC off-by-one that
  // new Date("2026-08-30") gives you).
  function parseDate(iso) {
    if (!iso) return null;
    var p = String(iso).split("-");
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  function isoDate(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function fmtDate(iso) {
    var d = parseDate(iso);
    return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
  }

  function addDays(d, n) {
    var out = new Date(d.getTime());
    out.setDate(out.getDate() + n);
    return out;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var toastTimer;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* -------------------------------------------------------------- state -- */

  var RATE_DEFS = [
    { key: "lead",      label: "Lead escort",        unit: "mile", rate: 2.10 },
    { key: "chase",     label: "Chase escort",       unit: "mile", rate: 2.10 },
    { key: "highPole",  label: "High pole",          unit: "mile", rate: 2.75 },
    { key: "steer",     label: "Steer car",          unit: "mile", rate: 3.00 },
    { key: "survey",    label: "Route survey",       unit: "mile", rate: 1.85 },
    { key: "dayMin",    label: "Day rate / minimum", unit: "day",  rate: 550.00 },
    { key: "deadhead",  label: "Deadhead miles",     unit: "mile", rate: 1.25 },
    { key: "wait",      label: "Wait / detention",   unit: "hour", rate: 65.00 },
    { key: "perDiem",   label: "Hotel / per diem",   unit: "night", rate: 175.00 },
    { key: "fuel",      label: "Fuel surcharge",     unit: "mile", rate: 0.35 }
  ];

  function blankState() {
    var rates = {};
    RATE_DEFS.forEach(function (r) { rates[r.key] = r.rate; });
    return {
      version: 1,
      settings: {
        bizName: "Wells Safety LLC",
        bizAddress: "Martinsville, IN",
        bizPhone: "(765) 684-1909",
        bizEmail: "",
        prefix: "WS-",
        nextNumber: 1001,
        termsDays: 30,
        remit: "",
        rates: rates
      },
      clients: [],
      invoices: []
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blankState();
      var data = JSON.parse(raw);
      var base = blankState();
      // Merge so a state saved by an older build still opens.
      data.settings = Object.assign(base.settings, data.settings || {});
      data.settings.rates = Object.assign(base.settings.rates, data.settings.rates || {});
      data.clients = data.clients || [];
      data.invoices = data.invoices || [];
      return data;
    } catch (e) {
      console.error("Could not read saved data", e);
      return blankState();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast("Could not save — browser storage may be full or blocked.");
      console.error(e);
    }
  }

  /* ------------------------------------------------------ derived data -- */

  function invoiceTotal(inv) {
    var sub = (inv.items || []).reduce(function (sum, it) {
      return sum + Math.round(num(it.qty) * toCents(it.rate));
    }, 0);
    return { subtotal: sub, total: sub + toCents(inv.adjustment) };
  }

  // "paid" | "overdue" | "unpaid" | "draft"
  function statusOf(inv) {
    if (inv.status === "paid") return "paid";
    if (inv.status === "draft") return "draft";
    var due = parseDate(inv.due);
    if (due && due < today()) return "overdue";
    return "unpaid";
  }

  function clientById(id) {
    return state.clients.filter(function (c) { return c.id === id; })[0] || null;
  }

  function clientName(id) {
    var c = clientById(id);
    return c ? c.name : "—";
  }

  function openInvoices() {
    return state.invoices.filter(function (i) {
      var s = statusOf(i);
      return s === "unpaid" || s === "overdue";
    });
  }

  /* ------------------------------------------------------------- views -- */

  function showView(name) {
    $$(".ad-view").forEach(function (v) { v.hidden = v.id !== "view-" + name; });
    $$(".ad-tab").forEach(function (t) {
      if (t.dataset.view === name) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    if (name === "dashboard") renderDashboard();
    if (name === "invoices") renderInvoices();
    if (name === "clients") renderClients();
    if (name === "settings") renderSettings();
  }

  /* --------------------------------------------------------- dashboard -- */

  function renderDashboard() {
    var open = openInvoices();
    var openCents = open.reduce(function (s, i) { return s + invoiceTotal(i).total; }, 0);
    var overdue = open.filter(function (i) { return statusOf(i) === "overdue"; });
    var overdueCents = overdue.reduce(function (s, i) { return s + invoiceTotal(i).total; }, 0);

    $("#kpi-outstanding").textContent = money(openCents);
    $("#kpi-outstanding-sub").textContent =
      open.length + (open.length === 1 ? " open invoice" : " open invoices");

    $("#kpi-overdue").textContent = money(overdueCents);
    $("#kpi-overdue-sub").textContent = overdue.length
      ? overdue.length + (overdue.length === 1 ? " invoice past due" : " invoices past due")
      : "Nothing past due";

    var cutoff = addDays(today(), -30);
    var paid30 = state.invoices.filter(function (i) {
      var d = parseDate(i.paidDate);
      return i.status === "paid" && d && d >= cutoff;
    });
    $("#kpi-paid30").textContent =
      money(paid30.reduce(function (s, i) { return s + invoiceTotal(i).total; }, 0));
    $("#kpi-paid30-sub").textContent =
      paid30.length + (paid30.length === 1 ? " payment" : " payments");

    var year = new Date().getFullYear();
    var ytd = state.invoices.filter(function (i) {
      var d = parseDate(i.issued);
      return i.status !== "draft" && d && d.getFullYear() === year;
    });
    $("#kpi-ytd").textContent =
      money(ytd.reduce(function (s, i) { return s + invoiceTotal(i).total; }, 0));
    $("#kpi-ytd-sub").textContent = ytd.length + " invoices in " + year;

    renderAging(open);
    renderDebtors(open);
    renderAttention(open);
  }

  var BUCKETS = [
    { label: "Not due yet", min: -1e9, max: 0 },
    { label: "1 – 30 days", min: 1, max: 30 },
    { label: "31 – 60 days", min: 31, max: 60 },
    { label: "61 – 90 days", min: 61, max: 90 },
    { label: "90+ days", min: 91, max: 1e9 }
  ];

  function daysOverdue(inv) {
    var due = parseDate(inv.due);
    return due ? daysBetween(due, today()) : 0;
  }

  function renderAging(open) {
    var rows = BUCKETS.map(function (b) {
      var hits = open.filter(function (i) {
        var d = daysOverdue(i);
        return d >= b.min && d <= b.max;
      });
      var cents = hits.reduce(function (s, i) { return s + invoiceTotal(i).total; }, 0);
      var danger = b.min >= 31 && cents > 0;
      return "<tr>" +
        "<td>" + esc(b.label) + "</td>" +
        '<td class="num">' + hits.length + "</td>" +
        '<td class="num"' + (danger ? ' style="color:var(--danger);font-weight:700"' : "") + ">" +
          money(cents) + "</td></tr>";
    });
    $("#aging-body").innerHTML = rows.join("") ||
      '<tr><td colspan="3" class="muted">Nothing outstanding.</td></tr>';
  }

  function renderDebtors(open) {
    var by = {};
    open.forEach(function (i) {
      var k = i.clientId || "none";
      if (!by[k]) by[k] = { cents: 0, oldest: 0 };
      by[k].cents += invoiceTotal(i).total;
      by[k].oldest = Math.max(by[k].oldest, daysOverdue(i));
    });
    var rows = Object.keys(by)
      .map(function (k) { return { id: k, cents: by[k].cents, oldest: by[k].oldest }; })
      .sort(function (a, b) { return b.cents - a.cents; })
      .slice(0, 8)
      .map(function (r) {
        return "<tr><td>" + esc(clientName(r.id)) + "</td>" +
          '<td class="num">' + money(r.cents) + "</td>" +
          '<td class="num">' + (r.oldest > 0 ? r.oldest + "d late" : "current") + "</td></tr>";
      });
    $("#debtors-body").innerHTML = rows.join("") ||
      '<tr><td colspan="3" class="muted">Nobody owes you a thing.</td></tr>';
  }

  function renderAttention(open) {
    var sorted = open.slice().sort(function (a, b) {
      return daysOverdue(b) - daysOverdue(a);
    }).slice(0, 10);
    $("#attention-body").innerHTML = sorted.map(rowForInvoice).join("") ||
      '<tr><td colspan="7" class="muted">All clear — nothing waiting on payment.</td></tr>';
  }

  /* ---------------------------------------------------------- invoices -- */

  function pill(status) {
    var label = status === "overdue" ? "Overdue"
      : status === "unpaid" ? "Unpaid"
      : status === "paid" ? "Paid" : "Draft";
    return '<span class="pill pill--' + status + '">' + label + "</span>";
  }

  function rowForInvoice(inv) {
    var s = statusOf(inv);
    var late = s === "overdue" ? " (" + daysOverdue(inv) + "d)" : "";
    var lane = [inv.origin, inv.destination].filter(Boolean).join(" → ");
    return "<tr>" +
      '<td><button class="ad-row-link" data-open="' + esc(inv.id) + '">' +
        esc(inv.number || "—") + "</button></td>" +
      "<td>" + esc(clientName(inv.clientId)) + "</td>" +
      '<td class="wrap-cell">' + (inv.loadRef ? esc(inv.loadRef) : "") +
        (lane ? '<div class="muted">' + esc(lane) + "</div>" : "") + "</td>" +
      "<td>" + fmtDate(inv.due) + esc(late) + "</td>" +
      '<td class="num">' + money(invoiceTotal(inv).total) + "</td>" +
      "<td>" + pill(s) + "</td>" +
      '<td class="num">' + (s === "paid" ? "" :
        '<button class="btn btn--dark btn--sm" data-paid="' + esc(inv.id) + '">Mark paid</button>') +
      "</td></tr>";
  }

  function renderInvoices() {
    var q = $("#inv-search").value.trim().toLowerCase();
    var status = $("#inv-status").value;
    var sort = $("#inv-sort").value;

    var list = state.invoices.filter(function (i) {
      if (status && statusOf(i) !== status) return false;
      if (!q) return true;
      return [i.number, clientName(i.clientId), i.loadRef, i.permit, i.origin, i.destination]
        .filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
    });

    list.sort(function (a, b) {
      if (sort === "amount") return invoiceTotal(b).total - invoiceTotal(a).total;
      if (sort === "customer") return clientName(a.clientId).localeCompare(clientName(b.clientId));
      var key = sort === "issued" ? "issued" : "due";
      return String(b[key] || "").localeCompare(String(a[key] || ""));
    });

    $("#inv-body").innerHTML = list.map(rowForInvoice).join("");
    $("#inv-empty").hidden = list.length > 0;
  }

  /* ----------------------------------------------------------- clients -- */

  function renderClients() {
    var q = $("#cl-search").value.trim().toLowerCase();
    var list = state.clients.filter(function (c) {
      return !q || (c.name + " " + (c.contact || "")).toLowerCase().indexOf(q) !== -1;
    });

    $("#cl-body").innerHTML = list.map(function (c) {
      var mine = state.invoices.filter(function (i) { return i.clientId === c.id; });
      var open = mine.filter(function (i) {
        var s = statusOf(i); return s === "unpaid" || s === "overdue";
      }).reduce(function (s, i) { return s + invoiceTotal(i).total; }, 0);
      var billed = mine.filter(function (i) { return i.status !== "draft"; })
        .reduce(function (s, i) { return s + invoiceTotal(i).total; }, 0);
      return "<tr>" +
        '<td><button class="ad-row-link" data-client="' + esc(c.id) + '">' + esc(c.name) + "</button></td>" +
        "<td>" + esc(c.contact || "") + "</td>" +
        "<td>" + esc(c.phone || "") + "</td>" +
        '<td class="num">' + (c.termsDays != null && c.termsDays !== "" ? c.termsDays + "d" : "—") + "</td>" +
        '<td class="num">' + money(open) + "</td>" +
        '<td class="num">' + money(billed) + "</td>" +
        '<td class="num"><button class="btn btn--dark btn--sm" data-bill="' + esc(c.id) + '">Invoice</button></td>' +
        "</tr>";
    }).join("");
    $("#cl-empty").hidden = list.length > 0;
  }

  /* ---------------------------------------------------------- settings -- */

  function renderSettings() {
    var s = state.settings;
    $$("#settings-form [name]").forEach(function (el) {
      if (s[el.name] != null) el.value = s[el.name];
    });

    $("#rates-form").innerHTML = RATE_DEFS.map(function (r) {
      return '<div class="rate-row">' +
        '<span class="rate-row__name">' + esc(r.label) + "</span>" +
        '<input class="ad-input ad-input--sm" type="number" step="0.01" min="0" ' +
          'data-rate="' + r.key + '" value="' + esc(s.rates[r.key]) + '" ' +
          'aria-label="' + esc(r.label) + ' rate">' +
        '<span class="rate-row__unit">per ' + esc(r.unit) + "</span></div>";
    }).join("");

    var n = state.invoices.length, c = state.clients.length;
    $("#backup-note").textContent =
      n + (n === 1 ? " invoice" : " invoices") + " and " +
      c + (c === 1 ? " customer" : " customers") + " stored in this browser.";
  }

  /* ---------------------------------------------------- invoice editor -- */

  var editing = null;   // invoice object being edited (live reference or new)

  function nextNumber() {
    return state.settings.prefix + state.settings.nextNumber;
  }

  function newInvoice(clientId) {
    var c = clientId ? clientById(clientId) : null;
    var terms = c && c.termsDays !== "" && c.termsDays != null
      ? num(c.termsDays) : num(state.settings.termsDays);
    return {
      id: uid(),
      number: nextNumber(),
      clientId: clientId || (state.clients[0] ? state.clients[0].id : ""),
      issued: isoDate(today()),
      due: isoDate(addDays(today(), terms)),
      loadRef: "", permit: "", origin: "", destination: "",
      items: [], adjustment: "", adjustmentNote: "", notes: "",
      status: "draft", paidDate: "", paidMethod: "", paidRef: "",
      isNew: true
    };
  }

  function openEditor(inv) {
    editing = inv;
    $("#editor-title").textContent = inv.isNew ? "New invoice" : "Invoice " + (inv.number || "");
    $("#delete-invoice").hidden = !!inv.isNew;

    var sel = $('#editor-form [name="clientId"]');
    sel.innerHTML = state.clients.length
      ? state.clients.map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>";
        }).join("")
      : '<option value="">— add a customer first —</option>';

    ["number", "clientId", "issued", "due", "loadRef", "permit", "origin",
     "destination", "adjustment", "adjustmentNote", "notes", "status",
     "paidDate", "paidMethod", "paidRef"].forEach(function (f) {
      var el = $('#editor-form [name="' + f + '"]');
      if (el) el.value = inv[f] == null ? "" : inv[f];
    });

    $("#quickadd").innerHTML = RATE_DEFS.map(function (r) {
      return '<button type="button" class="chip" data-add="' + r.key + '">+ ' + esc(r.label) + "</button>";
    }).join("");

    renderItems();
    $("#editor").showModal();
  }

  function renderItems() {
    $("#items-body").innerHTML = (editing.items || []).map(function (it, idx) {
      var amt = Math.round(num(it.qty) * toCents(it.rate));
      return "<tr>" +
        '<td><input class="ad-input ad-input--sm" data-i="' + idx + '" data-f="desc" value="' + esc(it.desc) + '"></td>' +
        '<td class="num"><input class="ad-input ad-input--sm num" type="number" step="0.01" data-i="' + idx + '" data-f="qty" value="' + esc(it.qty) + '"></td>' +
        '<td class="num"><input class="ad-input ad-input--sm num" type="number" step="0.01" data-i="' + idx + '" data-f="rate" value="' + esc(it.rate) + '"></td>' +
        '<td class="num line-amount">' + money(amt) + "</td>" +
        '<td class="num"><button type="button" class="icon-btn" data-del="' + idx + '" aria-label="Remove line">&times;</button></td>' +
        "</tr>";
    }).join("") || '<tr><td colspan="5" class="muted">No charges yet — use the buttons above.</td></tr>';
    renderTotals();
  }

  function renderTotals() {
    var t = invoiceTotal(editing);
    $("#t-subtotal").textContent = money(t.subtotal);
    $("#t-total").textContent = money(t.total);
  }

  function collectEditor() {
    ["number", "clientId", "issued", "due", "loadRef", "permit", "origin",
     "destination", "adjustment", "adjustmentNote", "notes", "status",
     "paidDate", "paidMethod", "paidRef"].forEach(function (f) {
      var el = $('#editor-form [name="' + f + '"]');
      if (el) editing[f] = el.value;
    });
    // Marking paid without a date is almost always "today".
    if (editing.status === "paid" && !editing.paidDate) editing.paidDate = isoDate(today());
    if (editing.status !== "paid") { editing.paidDate = ""; editing.paidMethod = ""; editing.paidRef = ""; }
  }

  function saveInvoice() {
    collectEditor();
    if (!editing.number.trim()) { toast("Give the invoice a number."); return; }
    if (!editing.clientId) { toast("Add a customer first, then invoice them."); return; }

    if (editing.isNew) {
      delete editing.isNew;
      state.invoices.push(editing);
      // Only burn the next number if this invoice actually used it.
      if (editing.number === nextNumber()) state.settings.nextNumber = num(state.settings.nextNumber) + 1;
    }
    save();
    $("#editor").close();
    toast("Invoice " + editing.number + " saved.");
    showView($$(".ad-view").filter(function (v) { return !v.hidden; })[0].id.replace("view-", ""));
  }

  /* ----------------------------------------------------- client editor -- */

  var editingClient = null;

  function openClientEditor(c) {
    editingClient = c || { id: uid(), name: "", contact: "", phone: "", email: "",
                           address: "", termsDays: state.settings.termsDays, vendorId: "", notes: "", isNew: true };
    $("#client-title").textContent = editingClient.isNew ? "New customer" : editingClient.name;
    $("#delete-client").hidden = !!editingClient.isNew;
    $$("#client-form [name]").forEach(function (el) {
      el.value = editingClient[el.name] == null ? "" : editingClient[el.name];
    });
    $("#client-editor").showModal();
  }

  function saveClient() {
    $$("#client-form [name]").forEach(function (el) { editingClient[el.name] = el.value; });
    if (!editingClient.name.trim()) { toast("The customer needs a name."); return; }
    if (editingClient.isNew) {
      delete editingClient.isNew;
      state.clients.push(editingClient);
    }
    save();
    $("#client-editor").close();
    toast("Customer saved.");
    renderClients();
  }

  /* ------------------------------------------------------------- print -- */

  function printInvoice(inv) {
    var c = clientById(inv.clientId);
    var s = state.settings;
    var t = invoiceTotal(inv);
    var lane = [inv.origin, inv.destination].filter(Boolean).join(" → ");

    var loadBits = [
      inv.loadRef ? "<span><b>Load</b> " + esc(inv.loadRef) + "</span>" : "",
      inv.permit ? "<span><b>Permit</b> " + esc(inv.permit) + "</span>" : "",
      lane ? "<span><b>Route</b> " + esc(lane) + "</span>" : ""
    ].filter(Boolean).join("");

    $("#print-sheet").innerHTML =
      '<div class="pr-head">' +
        '<div class="pr-biz"><strong>' + esc(s.bizName) + "</strong>" +
          (s.bizAddress ? "<span>" + esc(s.bizAddress).replace(/\n/g, "<br>") + "</span>" : "") +
          (s.bizPhone ? "<span>" + esc(s.bizPhone) + "</span>" : "") +
          (s.bizEmail ? "<span>" + esc(s.bizEmail) + "</span>" : "") +
        "</div>" +
        '<div class="pr-meta"><h1>Invoice</h1>' +
          "<div>#" + esc(inv.number) + "</div>" +
          "<div>Issued " + fmtDate(inv.issued) + "</div>" +
          '<div class="pr-due">Due ' + fmtDate(inv.due) + "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pr-parties"><div><h3>Bill to</h3>' +
        "<div><strong>" + esc(c ? c.name : "—") + "</strong></div>" +
        (c && c.contact ? "<div>" + esc(c.contact) + "</div>" : "") +
        (c && c.address ? "<div>" + esc(c.address).replace(/\n/g, "<br>") + "</div>" : "") +
        (c && c.phone ? "<div>" + esc(c.phone) + "</div>" : "") +
      "</div></div>" +

      (loadBits ? '<div class="pr-load">' + loadBits + "</div>" : "") +

      '<table class="pr-items"><thead><tr>' +
        "<th>Description</th><th class='num'>Qty</th>" +
        "<th class='num'>Rate</th><th class='num'>Amount</th>" +
      "</tr></thead><tbody>" +
      (inv.items || []).map(function (it) {
        return "<tr><td>" + esc(it.desc) + "</td>" +
          '<td class="num">' + esc(it.qty) + "</td>" +
          '<td class="num">' + money(toCents(it.rate)) + "</td>" +
          '<td class="num">' + money(Math.round(num(it.qty) * toCents(it.rate))) + "</td></tr>";
      }).join("") +
      "</tbody></table>" +

      '<div class="pr-totals"><table>' +
        '<tr><td>Subtotal</td><td class="num">' + money(t.subtotal) + "</td></tr>" +
        (toCents(inv.adjustment) !== 0
          ? "<tr><td>" + esc(inv.adjustmentNote || "Adjustment") + '</td><td class="num">' +
            money(toCents(inv.adjustment)) + "</td></tr>"
          : "") +
        '<tr class="grand"><td>Total due</td><td class="num">' + money(t.total) + "</td></tr>" +
      "</table></div>" +

      (inv.status === "paid"
        ? '<div class="pr-paid">Paid ' + fmtDate(inv.paidDate) +
          (inv.paidMethod ? " &middot; " + esc(inv.paidMethod) : "") +
          (inv.paidRef ? " &middot; " + esc(inv.paidRef) : "") + "</div>"
        : "") +

      '<div class="pr-foot">' +
        (inv.notes ? "<h3>Notes</h3><div>" + esc(inv.notes).replace(/\n/g, "<br>") + "</div>" : "") +
        (s.remit ? "<h3 style='margin-top:8pt'>Remit to</h3><div>" +
          esc(s.remit).replace(/\n/g, "<br>") + "</div>" : "") +
      "</div>";

    window.print();
  }

  /* ------------------------------------------------------------ export -- */

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var head = ["Invoice", "Status", "Customer", "Issued", "Due", "Paid",
                "Method", "Reference", "Load", "Permit", "Origin", "Destination",
                "Subtotal", "Adjustment", "Total"];
    var rows = state.invoices.map(function (i) {
      var t = invoiceTotal(i);
      return [i.number, statusOf(i), clientName(i.clientId), i.issued, i.due,
              i.paidDate, i.paidMethod, i.paidRef, i.loadRef, i.permit,
              i.origin, i.destination,
              (t.subtotal / 100).toFixed(2),
              (toCents(i.adjustment) / 100).toFixed(2),
              (t.total / 100).toFixed(2)].map(csvCell).join(",");
    });
    download("wells-safety-invoices-" + isoDate(today()) + ".csv",
             head.join(",") + "\n" + rows.join("\n"), "text/csv");
    toast("CSV exported — open it in Excel or hand it to your bookkeeper.");
  }

  /* -------------------------------------------------------- sample data -- */

  function seed() {
    var c1 = { id: uid(), name: "Kenworth Heavy Haul", contact: "Dana Reyes",
               phone: "(317) 555-0142", email: "", address: "1400 Industrial Dr\nIndianapolis, IN 46201",
               termsDays: 30, vendorId: "", notes: "Pays on time. Wants the permit # on every invoice." };
    var c2 = { id: uid(), name: "Midwest Machinery Transport", contact: "Cal Boyd",
               phone: "(765) 555-0177", email: "", address: "88 Depot St\nLafayette, IN 47901",
               termsDays: 45, vendorId: "WS-441", notes: "Slow payer — chase at day 40." };
    state.clients.push(c1, c2);

    var r = state.settings.rates;
    state.invoices.push(
      { id: uid(), number: "WS-1001", clientId: c1.id,
        issued: isoDate(addDays(today(), -52)), due: isoDate(addDays(today(), -22)),
        loadRef: "KHH-88213", permit: "IN-2291884", origin: "Indianapolis, IN",
        destination: "Columbus, OH",
        items: [{ desc: "Lead escort — Indianapolis to Columbus", qty: 176, rate: r.lead },
                { desc: "High pole", qty: 176, rate: r.highPole },
                { desc: "Hotel / per diem", qty: 1, rate: r.perDiem }],
        adjustment: "", adjustmentNote: "", notes: "", status: "unpaid",
        paidDate: "", paidMethod: "", paidRef: "" },

      { id: uid(), number: "WS-1002", clientId: c2.id,
        issued: isoDate(addDays(today(), -20)), due: isoDate(addDays(today(), 25)),
        loadRef: "MMT-5510", permit: "", origin: "Lafayette, IN", destination: "Joliet, IL",
        items: [{ desc: "Lead escort", qty: 128, rate: r.lead },
                { desc: "Chase escort", qty: 128, rate: r.chase },
                { desc: "Wait / detention at shipper", qty: 2.5, rate: r.wait }],
        adjustment: "", adjustmentNote: "", notes: "", status: "unpaid",
        paidDate: "", paidMethod: "", paidRef: "" },

      { id: uid(), number: "WS-1003", clientId: c1.id,
        issued: isoDate(addDays(today(), -14)), due: isoDate(addDays(today(), 16)),
        loadRef: "KHH-88440", permit: "IN-2294010", origin: "Terre Haute, IN",
        destination: "Nashville, TN",
        items: [{ desc: "Lead escort", qty: 288, rate: r.lead },
                { desc: "Route survey", qty: 288, rate: r.survey },
                { desc: "Day rate minimum", qty: 1, rate: r.dayMin }],
        adjustment: "-150", adjustmentNote: "Repeat-customer discount", notes: "",
        status: "paid", paidDate: isoDate(addDays(today(), -3)),
        paidMethod: "ACH", paidRef: "TR-99120" }
    );
    state.settings.nextNumber = 1004;
    save();
    toast("Sample data loaded — poke around, then erase it when you're ready.");
    showView("dashboard");
  }

  /* ------------------------------------------------------------- wiring -- */

  $$(".ad-tab").forEach(function (t) {
    t.addEventListener("click", function () { showView(t.dataset.view); });
  });

  $("#new-invoice").addEventListener("click", function () {
    if (!state.clients.length) {
      toast("Add a customer first — invoices need somebody to bill.");
      showView("clients");
      openClientEditor(null);
      return;
    }
    openEditor(newInvoice(null));
  });

  $("#new-client").addEventListener("click", function () { openClientEditor(null); });

  // Row actions, delegated across every table.
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-open],[data-paid],[data-client],[data-bill]");
    if (!t) return;

    if (t.dataset.open) {
      var inv = state.invoices.filter(function (i) { return i.id === t.dataset.open; })[0];
      if (inv) openEditor(inv);
    } else if (t.dataset.paid) {
      var i2 = state.invoices.filter(function (i) { return i.id === t.dataset.paid; })[0];
      if (i2) {
        i2.status = "paid";
        i2.paidDate = isoDate(today());
        save();
        toast("Invoice " + i2.number + " marked paid.");
        showView($$(".ad-view").filter(function (v) { return !v.hidden; })[0].id.replace("view-", ""));
      }
    } else if (t.dataset.client) {
      openClientEditor(clientById(t.dataset.client));
    } else if (t.dataset.bill) {
      openEditor(newInvoice(t.dataset.bill));
    }
  });

  // Invoice editor: quick-add chips, line edits, removal.
  $("#quickadd").addEventListener("click", function (e) {
    var b = e.target.closest("[data-add]");
    if (!b) return;
    var def = RATE_DEFS.filter(function (r) { return r.key === b.dataset.add; })[0];
    editing.items.push({ desc: def.label, qty: 1, rate: state.settings.rates[def.key] });
    renderItems();
  });

  $("#add-item").addEventListener("click", function () {
    editing.items.push({ desc: "", qty: 1, rate: 0 });
    renderItems();
  });

  $("#items-body").addEventListener("input", function (e) {
    var el = e.target;
    if (el.dataset.i == null) return;
    editing.items[+el.dataset.i][el.dataset.f] = el.value;
    // Update just this row's amount so focus and caret are not disturbed.
    var cell = el.closest("tr").querySelector(".line-amount");
    var it = editing.items[+el.dataset.i];
    cell.textContent = money(Math.round(num(it.qty) * toCents(it.rate)));
    renderTotals();
  });

  $("#items-body").addEventListener("click", function (e) {
    var b = e.target.closest("[data-del]");
    if (!b) return;
    editing.items.splice(+b.dataset.del, 1);
    renderItems();
  });

  $('#editor-form [name="adjustment"]').addEventListener("input", function (e) {
    editing.adjustment = e.target.value;
    renderTotals();
  });

  // Due date follows the customer's terms until it is set by hand.
  $('#editor-form [name="clientId"]').addEventListener("change", function (e) {
    var c = clientById(e.target.value);
    if (!c || c.termsDays === "" || c.termsDays == null) return;
    var issued = parseDate($('#editor-form [name="issued"]').value) || today();
    $('#editor-form [name="due"]').value = isoDate(addDays(issued, num(c.termsDays)));
  });

  $("#save-invoice").addEventListener("click", saveInvoice);

  $("#print-invoice").addEventListener("click", function () {
    collectEditor();
    printInvoice(editing);
  });

  $("#delete-invoice").addEventListener("click", function () {
    if (!confirm("Delete invoice " + editing.number + "? This cannot be undone.")) return;
    state.invoices = state.invoices.filter(function (i) { return i.id !== editing.id; });
    save();
    $("#editor").close();
    toast("Invoice deleted.");
    showView("invoices");
  });

  $("#save-client").addEventListener("click", saveClient);

  $("#delete-client").addEventListener("click", function () {
    var used = state.invoices.filter(function (i) { return i.clientId === editingClient.id; }).length;
    if (used) {
      alert("This customer is on " + used + " invoice(s). Delete or reassign those first.");
      return;
    }
    if (!confirm("Delete " + editingClient.name + "?")) return;
    state.clients = state.clients.filter(function (c) { return c.id !== editingClient.id; });
    save();
    $("#client-editor").close();
    renderClients();
  });

  // Filters
  ["#inv-search", "#inv-status", "#inv-sort"].forEach(function (sel) {
    $(sel).addEventListener("input", renderInvoices);
  });
  $("#cl-search").addEventListener("input", renderClients);

  // Settings persist as you type.
  $("#settings-form").addEventListener("input", function (e) {
    if (!e.target.name) return;
    state.settings[e.target.name] = e.target.value;
    save();
  });

  $("#rates-form").addEventListener("input", function (e) {
    if (!e.target.dataset.rate) return;
    state.settings.rates[e.target.dataset.rate] = e.target.value;
    save();
  });

  // Data management
  $("#export-csv").addEventListener("click", exportCsv);

  $("#backup").addEventListener("click", function () {
    download("wells-safety-backup-" + isoDate(today()) + ".json", JSON.stringify(state, null, 2));
    toast("Backup downloaded. Keep it somewhere off this machine.");
  });

  $("#restore").addEventListener("click", function () { $("#restore-file").click(); });

  $("#restore-file").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.invoices)) throw new Error("not a Dispatch Book backup");
        if (!confirm("Replace everything currently in this browser with the backup?")) return;
        state = data;
        // Re-run the merge so an older backup gains any newer defaults.
        localStorage.setItem(KEY, JSON.stringify(state));
        state = load();
        showView("dashboard");
        toast("Backup restored.");
      } catch (err) {
        alert("That file could not be read as a backup.\n\n" + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  $("#seed").addEventListener("click", function () {
    if (state.invoices.length && !confirm("Add sample invoices alongside your real ones?")) return;
    seed();
  });

  $("#wipe").addEventListener("click", function () {
    if (!confirm("Erase every invoice and customer in this browser?")) return;
    if (!confirm("Last chance — this cannot be undone. Have you downloaded a backup?")) return;
    localStorage.removeItem(KEY);
    state = blankState();
    save();
    showView("dashboard");
    toast("Everything erased.");
  });

  // Dialogs close on backdrop click.
  $$(".ad-dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
  });

  showView("dashboard");
})();
