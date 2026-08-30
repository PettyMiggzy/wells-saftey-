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
        bizEmail: "paul@wellssafety.com",
        prefix: "WS-",
        nextNumber: 1001,
        termsDays: 30,
        remit: "",
        rates: rates
      },
      clients: [],
      drivers: [],
      reports: [],
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
      data.drivers = data.drivers || [];
      data.reports = data.reports || [];
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

  var CERTS = [
    { key: "pevo",     label: "PEVO" },
    { key: "atssa",    label: "ATSSA flagger" },
    { key: "witpac",   label: "WITPAC" },
    { key: "tims",     label: "TIMS" },
    { key: "medical",  label: "Medical card" },
    { key: "insurance",label: "Insurance" }
  ];

  var CERT_WARN_DAYS = 60;

  // Every credential inside the warning window (or already lapsed), worst first.
  function expiringCerts() {
    var out = [];
    state.drivers.forEach(function (d) {
      if (d.status === "inactive") return;
      CERTS.forEach(function (c) {
        var iso = (d.certs || {})[c.key];
        var due = parseDate(iso);
        if (!due) return;
        var left = daysBetween(today(), due);
        if (left <= CERT_WARN_DAYS) out.push({ driver: d.name, label: c.label, iso: iso, left: left });
      });
    });
    return out.sort(function (a, b) { return a.left - b.left; });
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
    if (name === "drivers") renderDrivers();
    if (name === "reports") { renderReports(); pullReports(); }
    if (name === "settings") { renderSettings(); renderCloud(); }
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

    renderCompliance();
    renderAging(open);
    renderDebtors(open);
    renderAttention(open);
  }

  function renderCompliance() {
    var rows = expiringCerts();
    $("#compliance-card").hidden = rows.length === 0;
    if (!rows.length) return;
    $("#compliance-body").innerHTML = rows.map(function (r) {
      var lapsed = r.left < 0;
      var state_ = lapsed ? "overdue" : (r.left <= 14 ? "unpaid" : "draft");
      var word = lapsed ? "Expired " + Math.abs(r.left) + "d ago"
                        : (r.left === 0 ? "Expires today" : r.left + " days left");
      return "<tr><td>" + esc(r.driver) + "</td><td>" + esc(r.label) + "</td>" +
        "<td>" + fmtDate(r.iso) + "</td>" +
        '<td><span class="pill pill--' + state_ + '">' + esc(word) + "</span></td></tr>";
    }).join("");
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


  /* ----------------------------------------------------------- drivers -- */

  function certSummary(d) {
    var bits = CERTS.map(function (c) {
      var iso = (d.certs || {})[c.key];
      if (!iso) return null;
      var left = daysBetween(today(), parseDate(iso));
      var cls = left < 0 ? "overdue" : (left <= CERT_WARN_DAYS ? "unpaid" : "paid");
      return '<span class="pill pill--' + cls + '" title="' + esc(c.label) + " expires " +
             esc(fmtDate(iso)) + '">' + esc(c.label) + "</span>";
    }).filter(Boolean);
    return bits.length ? '<span class="cert-pills">' + bits.join("") + "</span>"
                       : '<span class="muted">none recorded</span>';
  }

  function renderDrivers() {
    var q = $("#dr-search").value.trim().toLowerCase();
    var list = state.drivers.filter(function (d) {
      return !q || (d.name + " " + (d.unit || "")).toLowerCase().indexOf(q) !== -1;
    });
    $("#dr-body").innerHTML = list.map(function (d) {
      return "<tr>" +
        '<td><button class="ad-row-link" data-driver="' + esc(d.id) + '">' + esc(d.name) + "</button></td>" +
        "<td>" + (d.phone ? '<a href="tel:' + esc(d.phone.replace(/[^0-9+]/g, "")) + '">' + esc(d.phone) + "</a>" : "") + "</td>" +
        "<td>" + esc(d.unit || "") + "</td>" +
        '<td class="wrap-cell">' + certSummary(d) + "</td>" +
        '<td><span class="pill pill--' + (d.status === "inactive" ? "draft" : "paid") + '">' +
          (d.status === "inactive" ? "Inactive" : "Active") + "</span></td>" +
        '<td class="num"><button class="btn btn--dark btn--sm" data-driver="' + esc(d.id) + '">Open</button></td>' +
        "</tr>";
    }).join("");
    $("#dr-empty").hidden = list.length > 0;
  }

  var editingDriver = null;

  function openDriverEditor(d) {
    editingDriver = d || { id: uid(), name: "", phone: "", email: "", unit: "",
                           status: "active", certs: {}, notes: "", isNew: true };
    $("#driver-title").textContent = editingDriver.isNew ? "New driver" : editingDriver.name;
    $("#delete-driver").hidden = !!editingDriver.isNew;

    $("#cert-grid").innerHTML = CERTS.map(function (c) {
      return '<label class="fld"><span>' + esc(c.label) + "</span>" +
        '<input class="ad-input" type="date" data-cert="' + c.key + '" value="' +
        esc((editingDriver.certs || {})[c.key] || "") + '"></label>';
    }).join("");

    $$("#driver-form [name]").forEach(function (el) {
      el.value = editingDriver[el.name] == null ? "" : editingDriver[el.name];
    });
    $("#driver-editor").showModal();
  }

  function saveDriver() {
    $$("#driver-form [name]").forEach(function (el) { editingDriver[el.name] = el.value; });
    editingDriver.certs = editingDriver.certs || {};
    $$("#cert-grid [data-cert]").forEach(function (el) {
      editingDriver.certs[el.dataset.cert] = el.value;
    });
    if (!editingDriver.name.trim()) { toast("The driver needs a name."); return; }
    if (editingDriver.isNew) {
      delete editingDriver.isNew;
      state.drivers.push(editingDriver);
    }
    save();
    $("#driver-editor").close();
    toast("Driver saved.");
    renderDrivers();
  }

  /* ----------------------------------------------------------- reports -- */

  function renderReports() {
    var q = $("#rp-search").value.trim().toLowerCase();
    var list = state.reports.filter(function (r) {
      return !q || [r.driver, r.customer, r.loadRef, r.origin, r.destination]
        .filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return String(b.filed).localeCompare(String(a.filed)); });

    $("#rp-body").innerHTML = list.map(function (r) {
      var lane = [r.origin, r.destination].filter(Boolean).join(" → ");
      return "<tr>" +
        "<td>" + fmtDate((r.filed || "").slice(0, 10)) +
          (r.invoiceId ? ' <span class="pill pill--paid">Invoiced</span>' : "") + "</td>" +
        "<td>" + esc(r.driver || "") + "</td>" +
        '<td class="wrap-cell">' + esc(r.loadRef || "") +
          (r.customer ? '<div class="muted">' + esc(r.customer) + "</div>" : "") + "</td>" +
        '<td class="wrap-cell">' + esc(lane) + "</td>" +
        '<td class="num">' + esc(r.miles || "0") + "</td>" +
        '<td class="wrap-cell muted">' + esc((r.roles || []).join(", ")) + "</td>" +
        '<td class="num"><button class="btn btn--dark btn--sm" data-report="' + esc(r.id) + '">Open</button></td>' +
        "</tr>";
    }).join("");
    $("#rp-empty").hidden = list.length > 0;
  }

  var viewingReport = null;

  function openReport(r) {
    viewingReport = r;
    $("#report-title").textContent = "Report — " + (r.loadRef || r.driver || r.id);
    var rows = [
      ["Driver", r.driver], ["Date of move", fmtDate(r.date)], ["Unit", r.unit],
      ["Customer", r.customer], ["Load", r.loadRef], ["Permit", r.permit],
      ["Ran", (r.roles || []).join(", ")],
      ["Route", [r.origin, r.destination].filter(Boolean).join(" → ")],
      ["Loaded miles", r.miles], ["Deadhead", r.deadhead],
      ["Wait (hrs)", r.waitHours], ["Nights out", r.nights],
      ["Filed", r.filed ? new Date(r.filed).toLocaleString() : ""],
      ["Photos attached", r.photoCount]
    ].filter(function (p) { return p[1]; });

    // A report is written by whoever filed it, so treat every field as hostile.
    // Coordinates are coerced to numbers — anything else is dropped rather than
    // rendered, since these land in the owner's page.
    var lat = r.geo ? Number(r.geo.lat) : NaN;
    var lng = r.geo ? Number(r.geo.lng) : NaN;
    var acc = r.geo ? Number(r.geo.accuracy) : NaN;
    var geo = (isFinite(lat) && isFinite(lng))
      ? '<p class="ad-note" style="padding:0">Location stamp: ' +
        '<a href="https://www.google.com/maps?q=' + encodeURIComponent(lat + "," + lng) +
        '" target="_blank" rel="noopener">' + esc(lat.toFixed(5)) + ", " +
        esc(lng.toFixed(5)) + "</a>" +
        (isFinite(acc) ? " (&plusmn;" + esc(Math.round(acc)) + "m)" : "") + "</p>"
      : "";

    $("#report-body").innerHTML =
      '<div class="dv-review"><dl>' + rows.map(function (p) {
        return "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>";
      }).join("") + "</dl></div>" + geo +
      (r.notes ? '<div><h3 style="margin:0 0 .3rem;font:700 .78rem/1 var(--sans);' +
        'letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Driver notes</h3>' +
        "<p style=\"margin:0;white-space:pre-wrap\">" + esc(r.notes) + "</p></div>" : "") +
      (Number(r.photoCount) > 0 ? '<p class="ad-note" style="padding:0">' + esc(Number(r.photoCount)) +
        " photo(s) were sent with this report — they arrive as separate image " +
        "attachments alongside the JSON, not inside it.</p>" : "");

    $("#report-to-invoice").disabled = !!r.invoiceId;
    $("#report-to-invoice").textContent = r.invoiceId
      ? "Already invoiced" : "Make an invoice from this";
    $("#report-viewer").showModal();
  }

  // Turn a filed report into a draft invoice, pricing it off the saved rates.
  function invoiceFromReport(r) {
    var rates = state.settings.rates;
    var items = [];
    var miles = num(r.miles);

    var ROLE_TO_RATE = {
      "Lead": "lead", "Chase": "chase", "High pole": "highPole",
      "Steer": "steer", "Route survey": "survey", "Traffic control": "lead"
    };
    (r.roles || []).forEach(function (role) {
      var key = ROLE_TO_RATE[role];
      if (key && miles) items.push({ desc: role + " escort", qty: miles, rate: rates[key] });
    });
    if (!items.length && miles) items.push({ desc: "Escort", qty: miles, rate: rates.lead });
    if (num(r.deadhead)) items.push({ desc: "Deadhead miles", qty: num(r.deadhead), rate: rates.deadhead });
    if (num(r.waitHours)) items.push({ desc: "Wait / detention", qty: num(r.waitHours), rate: rates.wait });
    if (num(r.nights)) items.push({ desc: "Hotel / per diem", qty: num(r.nights), rate: rates.perDiem });

    // Match the customer by name if we already know them.
    var match = state.clients.filter(function (c) {
      return c.name.toLowerCase() === String(r.customer || "").toLowerCase();
    })[0];

    var inv = newInvoice(match ? match.id : null);
    inv.loadRef = r.loadRef || "";
    inv.permit = r.permit || "";
    inv.origin = r.origin || "";
    inv.destination = r.destination || "";
    inv.items = items;
    inv.notes = r.driver ? "Run by " + r.driver + "." : "";
    inv.reportId = r.id;

    $("#report-viewer").close();
    openEditor(inv);
    toast(match ? "Priced from your saved rates — check it over."
                : "Priced from your rates. Pick the customer before saving.");
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
      if (editing.reportId) {
        var src = state.reports.filter(function (r) { return r.id === editing.reportId; })[0];
        if (src) src.invoiceId = editing.id;
      }
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

    var iso = function (n) { return isoDate(addDays(today(), n)); };
    state.drivers.push(
      { id: uid(), name: "Paul Wells", phone: "(765) 684-1909", email: "paul@wellssafety.com",
        unit: "W1", status: "active", notes: "Owner. Runs the long ones.",
        certs: { pevo: iso(410), atssa: iso(38), witpac: iso(520), tims: iso(240),
                 medical: iso(96), insurance: iso(150) } },
      { id: uid(), name: "Dell Harmon", phone: "(765) 555-0119", email: "",
        unit: "W2", status: "active", notes: "High pole certified.",
        certs: { pevo: iso(-9), atssa: iso(300), witpac: "", tims: iso(180),
                 medical: iso(19), insurance: iso(150) } }
    );

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


  /* --------------------------------------------------------------- cloud -- */

  var cloud = { version: 0, syncing: false, status: "Last sync: not yet this session." };

  var FEATURE_ROWS = [
    { key: "sync",     title: "Books on every device" },
    { key: "reports",  title: "Reports file themselves" },
    { key: "accounts", title: "A login for each driver" },
    { key: "portal",   title: "Invoice links for customers" }
  ];

  function renderCloud() {
    var body = $("#cloud-body"), sub = $("#cloud-sub");

    if (!WS_API.state.available) {
      sub.textContent = "Running on this browser only — no server is attached to this copy.";
      body.innerHTML = '<div class="cloud-in"><p class="sync-line">' +
        "Everything works exactly as it does now. Point this at the dispatch server " +
        "and the extras below switch on." + "</p>" + upgradeGrid(null) + "</div>";
      return;
    }

    var me = WS_API.state.me;
    if (!me) {
      sub.textContent = "A dispatch server is available. Sign in to sync.";
      body.innerHTML =
        '<div class="cloud-in"><div class="cloud-login">' +
          '<label class="fld"><span>Email</span><input class="ad-input" id="cl-email" type="email" autocomplete="username"></label>' +
          '<label class="fld"><span>Password</span><input class="ad-input" id="cl-pass" type="password" autocomplete="current-password"></label>' +
          '<button class="btn btn--primary btn--sm" id="cl-login">Sign in</button>' +
        "</div>" + upgradeGrid(null) + "</div>";
      $("#cl-login").addEventListener("click", doLogin);
      $("#cl-pass").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
      return;
    }

    sub.textContent = "Signed in. Your book syncs to the server.";
    body.innerHTML =
      '<div class="cloud-in">' +
        '<div class="cloud-who"><div><strong>' + esc(me.name) + "</strong> " +
          '<span>' + esc(me.email) + " &middot; " + esc(me.role) + "</span></div>" +
          '<span class="plan-tag">' + esc(me.plan.name) + "</span>" +
          '<span class="ad-toolbar__spacer"></span>' +
          '<button class="btn btn--dark btn--sm" id="cl-pull">Pull from server</button>' +
          '<button class="btn btn--primary btn--sm" id="cl-push">Push to server</button>' +
          '<button class="btn btn--ghost-dark btn--sm" id="cl-out">Sign out</button>' +
        "</div>" +
        '<p class="sync-line" id="cl-status">' + esc(cloud.status) + "</p>" +
        upgradeGrid(me) +
      "</div>";

    $("#cl-out").addEventListener("click", function () {
      WS_API.logout().then(function () { renderCloud(); toast("Signed out."); });
    });
    $("#cl-push").addEventListener("click", pushBook);
    $("#cl-pull").addEventListener("click", pullBook);
  }

  function upgradeGrid(me) {
    var copy = WS_API.state.featureCopy || {};
    var trials = (me && me.trials) || {};
    return '<div class="up-grid">' + FEATURE_ROWS.map(function (f) {
      var on = me && me.plan.features.indexOf(f.key) !== -1;
      var c = copy[f.key] || {};
      var need = c.need ? c.need.charAt(0).toUpperCase() + c.need.slice(1) : "Pro";
      var t = trials[f.key];
      var trying = !on && t && t.left > 0;
      var spent = !on && t && t.left === 0 && t.used > 0;

      var cls = on ? "up-card--on" : (trying ? "up-card--trial" : "up-card--locked");
      var mark = on ? "&#10003; " : (trying ? "&#9201; " : "&#128274; ");
      var note = on ? "Included in " + esc(me.plan.name)
        : trying ? t.left + " of " + t.limit + " free " + (t.left === 1 ? "go" : "goes") + " left"
        : spent ? "Free goes used up &mdash; needs " + esc(need)
        : "Needs " + esc(need);

      return '<div class="up-card ' + cls + '">' +
        "<h4>" + mark + esc(f.title) + "</h4>" +
        "<p>" + esc(c.pitch || "") + "</p>" +
        '<span class="need">' + note + "</span>" +
        (trying ? '<div class="trial-bar"><i style="width:' +
          Math.round((t.limit - t.left) / t.limit * 100) + '%"></i></div>' : "") +
        "</div>";
    }).join("") + "</div>";
  }

  function setSync(msg) {
    cloud.status = msg;
    var el = $("#cl-status");
    if (el) el.textContent = msg;
  }

  function doLogin() {
    var email = $("#cl-email").value.trim(), pass = $("#cl-pass").value;
    if (!email || !pass) { toast("Email and password, please."); return; }
    WS_API.login(email, pass).then(function () {
      renderCloud();
      toast("Signed in. Pull the book down to get started.");
    }).catch(function (err) {
      toast(err.status === 429 ? "Too many tries — wait 15 minutes."
                               : "That email and password did not match.");
    });
  }

  // The whole book is one document, so a push is a straight replace guarded by
  // a version number. A conflict means another device wrote first.
  function pushBook() {
    if (cloud.syncing) return;
    cloud.syncing = true;
    setSync("Pushing…");
    WS_API.putBook({
      settings: state.settings, clients: state.clients,
      drivers: state.drivers, invoices: state.invoices
    }, cloud.version).then(function (d) {
      cloud.version = d.version;
      setSync("Pushed at " + new Date().toLocaleTimeString() + " (version " + d.version + ").");
      toast("Book pushed to the server.");
      WS_API.refresh().then(renderCloud);   // a trial go may have just been spent
    }).catch(function (err) {
      if (err.status === 409) {
        cloud.version = err.payload.currentVersion;
        setSync("Another device wrote first (now at version " + err.payload.currentVersion +
          "). Pull, check it, then push again.");
        toast("Someone else saved first — pull before pushing.");
      } else if (err.status !== 402) {
        toast("Push failed: " + err.message);
      }
    }).finally(function () { cloud.syncing = false; });
  }

  function pullBook() {
    if (cloud.syncing) return;
    cloud.syncing = true;
    setSync("Pulling…");
    WS_API.getBook().then(function (d) {
      if (!d.doc) {
        setSync("Nothing on the server yet — push to seed it.");
        return;
      }
      if (!confirm("Replace what is in this browser with the server copy?\n\n" +
                   "Server version " + d.version + ", saved by " + (d.updatedBy || "someone") + ".")) {
        setSync("Pull cancelled.");
        return;
      }
      state.settings = Object.assign(state.settings, d.doc.settings || {});
      state.clients = d.doc.clients || [];
      state.drivers = d.doc.drivers || [];
      state.invoices = d.doc.invoices || [];
      cloud.version = d.version;
      save();
      showView("dashboard");
      toast("Book pulled from the server.");
    }).catch(function (err) {
      if (err.status !== 402) toast("Pull failed: " + err.message);
    }).finally(function () { cloud.syncing = false; });
  }

  // Reports filed straight to the server, merged in beside any imported by file.
  // Boot and the Reports tab can both ask at once, so a second call while one
  // is in flight joins the first rather than racing it — two concurrent merges
  // would each see an empty list and append the same reports twice.
  var reportPull = null;

  function pullReports() {
    if (!WS_API.can("reports")) return Promise.resolve(0);
    if (reportPull) return reportPull;

    reportPull = WS_API.listReports().then(function (d) {
      var byId = {};
      state.reports.forEach(function (r) { byId[r.id] = r; });
      var added = 0;
      (d.reports || []).forEach(function (r) {
        if (byId[r.id]) return;
        r.fromServer = true;
        byId[r.id] = r;
        state.reports.push(r);
        added++;
      });
      if (added) { save(); renderReports(); }
      return added;
    }).catch(function () {
      return 0;
    }).finally(function () {
      reportPull = null;
    });

    return reportPull;
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
    var t = e.target.closest("[data-open],[data-paid],[data-client],[data-bill],[data-driver],[data-report]");
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
    } else if (t.dataset.driver) {
      openDriverEditor(state.drivers.filter(function (d) { return d.id === t.dataset.driver; })[0]);
    } else if (t.dataset.report) {
      openReport(state.reports.filter(function (r) { return r.id === t.dataset.report; })[0]);
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


  /* --------------------------------------------------- drivers/reports -- */

  $("#new-driver").addEventListener("click", function () { openDriverEditor(null); });
  $("#save-driver").addEventListener("click", saveDriver);
  $("#dr-search").addEventListener("input", renderDrivers);
  $("#rp-search").addEventListener("input", renderReports);

  $("#delete-driver").addEventListener("click", function () {
    if (!confirm("Remove " + editingDriver.name + " from the roster?")) return;
    state.drivers = state.drivers.filter(function (d) { return d.id !== editingDriver.id; });
    save();
    $("#driver-editor").close();
    renderDrivers();
  });

  $("#copy-driver-link").addEventListener("click", function () {
    var url = location.href.replace(/admin\.html.*$/, "driver.html");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        toast("Driver form link copied — text it to your crew with the passcode.");
      }).catch(function () { prompt("Copy this link:", url); });
    } else {
      prompt("Copy this link:", url);
    }
  });

  $("#import-report").addEventListener("click", function () { $("#report-file").click(); });

  $("#report-file").addEventListener("change", function (e) {
    var list = Array.prototype.slice.call(e.target.files || []);
    var added = 0, skipped = 0, bad = 0;
    var pending = list.length;
    if (!pending) return;

    list.forEach(function (file) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var r = JSON.parse(fr.result);
          if (r.kind !== "wellssafety.jobreport") throw new Error("wrong file");
          if (state.reports.some(function (x) { return x.id === r.id; })) skipped++;
          else { state.reports.push(r); added++; }
        } catch (err) { bad++; }
        if (--pending === 0) finish();
      };
      fr.onerror = function () { bad++; if (--pending === 0) finish(); };
      fr.readAsText(file);
    });

    function finish() {
      save();
      renderReports();
      var msg = added + " report" + (added === 1 ? "" : "s") + " imported";
      if (skipped) msg += ", " + skipped + " already had";
      if (bad) msg += ", " + bad + " not a job report";
      toast(msg + ".");
    }
    e.target.value = "";
  });

  $("#report-to-invoice").addEventListener("click", function () {
    if (viewingReport) invoiceFromReport(viewingReport);
  });

  $("#delete-report").addEventListener("click", function () {
    if (!confirm("Delete this report?")) return;
    state.reports = state.reports.filter(function (r) { return r.id !== viewingReport.id; });
    save();
    $("#report-viewer").close();
    renderReports();
  });

  // Filters
  ["#inv-search", "#inv-status", "#inv-sort"].forEach(function (sel) {
    $(sel).addEventListener("input", renderInvoices);
  });
  $("#cl-search").addEventListener("input", renderClients);

  // Settings persist as you type.
  $("#settings-form").addEventListener("input", function (e) {
    if (!e.target.name || e.target.name === "newCode") return;
    state.settings[e.target.name] = e.target.value;
    save();
  });

  // The passcode is never kept in state — only its hash, held by the gate.
  $('#settings-form [name="newCode"]').addEventListener("change", function (e) {
    var code = e.target.value.trim();
    if (!code) return;
    if (code.length < 4) { toast("Use at least 4 characters."); return; }
    WS_AUTH.setCode(code).then(function () {
      e.target.value = "";
      toast("Passcode changed on this browser. Tell your drivers the new one.");
    });
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

  WS_AUTH.require({
    title: "Dispatch Book",
    subtitle: "Enter the passcode to open the books."
  }).then(function () {
    showView("dashboard");
    // Optional: only does anything when served from the dispatch server.
    WS_API.init().then(function () {
      if (WS_API.state.available) pullReports();
    });
  });
})();
