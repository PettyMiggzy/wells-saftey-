/* ==========================================================================
   Wells Safety — client for the dispatch API.

   The same pages are served two ways: as a plain static site (Vercel), where
   there is no API at all, and from the Node container, where there is. So
   every call here is optional. If /api/health does not answer, `available`
   stays false, the cloud UI hides itself, and the app runs exactly as it did
   before — on browser storage.

   A 402 from the server means the account's plan does not include that
   feature. The server is the one enforcing it; this just renders the reason.
   ========================================================================== */

window.WS_API = (function () {
  "use strict";

  var state = { available: false, me: null, catalogue: null, featureCopy: null };

  function req(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: opts.body ? { "content-type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      var ct = res.headers.get("content-type") || "";
      var parse = ct.indexOf("application/json") === 0 ? res.json() : res.text();
      return parse.then(function (data) {
        if (res.ok) return data;
        var err = new Error((data && data.error) || res.statusText);
        err.status = res.status;
        err.payload = data;
        if (res.status === 402) showUpgrade(data);
        throw err;
      });
    });
  }

  /* Probe once on load. A failure here is normal, not an error. */
  function init() {
    return fetch("/api/health", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function () {
        state.available = true;
        return req("/api/auth/me");
      })
      .then(function (d) {
        state.me = d.user || null;
        state.catalogue = (d.user && d.user.catalogue) || d.catalogue || null;
        state.featureCopy = (d.user && d.user.featureCopy) || d.featureCopy || null;
        return state;
      })
      .catch(function () { state.available = false; return state; });
  }

  function can(feature) {
    return !!(state.me && state.me.plan.features.indexOf(feature) !== -1);
  }

  /* ------------------------------------------------------- upgrade panel -- */

  function showUpgrade(payload) {
    if (!payload || !payload.requiresPlan) return;
    var dlg = document.getElementById("upgrade-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "upgrade-dialog";
      dlg.className = "ad-dialog ad-dialog--narrow";
      document.body.appendChild(dlg);
    }
    var p = payload.requiresPlan;
    dlg.innerHTML =
      '<form method="dialog" class="ad-dialog__form">' +
        '<header class="ad-dialog__head"><h2>' + esc(payload.title || "Upgrade") + "</h2>" +
          '<button class="ad-x" value="close" aria-label="Close">&times;</button></header>' +
        '<div class="ad-dialog__body">' +
          '<p class="up-pitch">' + esc(payload.pitch || "") + "</p>" +
          '<div class="up-plan"><div><strong>' + esc(p.name) + "</strong>" +
            "<span>" + esc(p.blurb || "") + "</span></div>" +
            '<div class="up-price">' + esc(p.price) + "</div></div>" +
          '<p class="ad-note" style="padding:0">' +
            "This one runs on the server &mdash; storage, backups and bandwidth cost real " +
            "money every month, so it sits above the free tier. Everything you already " +
            "use keeps working either way." +
          "</p>" +
        "</div>" +
        '<footer class="ad-dialog__foot">' +
          '<button class="btn btn--ghost-dark btn--sm" value="close">Not now</button>' +
          '<span class="ad-toolbar__spacer"></span>' +
          '<a class="btn btn--primary btn--sm" href="mailto:paul@wellssafety.com?subject=' +
            encodeURIComponent("Upgrade to " + p.name) + '">Talk about ' + esc(p.name) + "</a>" +
        "</footer></form>";
    if (typeof dlg.showModal === "function") dlg.showModal();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* -------------------------------------------------------------- calls -- */

  return {
    state: state,
    init: init,
    can: can,
    showUpgrade: showUpgrade,

    login: function (email, password) {
      return req("/api/auth/login", { method: "POST", body: { email: email, password: password } })
        .then(function (d) { state.me = d.user; return d.user; });
    },
    logout: function () {
      return req("/api/auth/logout", { method: "POST" })
        .then(function () { state.me = null; });
    },

    getBook: function () { return req("/api/book"); },
    putBook: function (doc, baseVersion) {
      return req("/api/book", { method: "PUT", body: { doc: doc, baseVersion: baseVersion } });
    },

    listReports: function () { return req("/api/reports"); },
    postReport: function (report, photos) {
      return req("/api/reports", { method: "POST", body: { report: report, photos: photos || [] } });
    },
    deleteReport: function (id) { return req("/api/reports/" + id, { method: "DELETE" }); },
    markInvoiced: function (id, invoiceId) {
      return req("/api/reports/" + id, { method: "PATCH", body: { invoiceId: invoiceId } });
    },
    photoUrl: function (reportId, idx) { return "/api/reports/" + reportId + "/photos/" + idx; },

    listTeam: function () { return req("/api/team"); },
    createUser: function (u) { return req("/api/team", { method: "POST", body: u }); },
    updateUser: function (id, patch) {
      return req("/api/team/" + id, { method: "PATCH", body: patch });
    },

    share: function (invoice, client, settings) {
      return req("/api/share", { method: "POST", body: { invoice: invoice, client: client, settings: settings } });
    },
    shareStats: function () { return req("/api/share"); }
  };
})();
