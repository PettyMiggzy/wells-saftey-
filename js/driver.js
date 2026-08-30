/* ==========================================================================
   Wells Safety — driver job report.

   Two ways home, picked at runtime:

   - Served from the dispatch server and signed in — the report and its photos
     POST straight to /api/reports and appear in the office's Reports tab.
   - Anywhere else (the static copy, or no login) — there is nothing to submit
     to, so it builds the report plus compressed photos and hands them to the
     phone's own share sheet. The driver texts or emails them, and dispatch
     imports the JSON on the other end.
   ========================================================================== */

(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var ROLES = ["Lead", "Chase", "High pole", "Steer", "Route survey", "Traffic control"];
  var MAX_EDGE = 1400;      // px on the long side
  var JPEG_Q = 0.7;

  var step = 1;
  var photos = [];          // { id, name, dataUrl, blob }
  var geo = null;

  /* ------------------------------------------------------------- helpers -- */

  function isoDate(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // Parse as local midnight; new Date("2026-08-30") would shift a day.
  function prettyDate(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return iso || "";
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? iso
      : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var toastTimer;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3600);
  }

  function val(id) { return ($("#" + id).value || "").trim(); }

  function selectedRoles() {
    return $$("#f-roles [aria-pressed='true']").map(function (b) { return b.textContent; });
  }

  /* ---------------------------------------------------------------- steps -- */

  function showStep(n) {
    step = n;
    $$(".dv-step").forEach(function (s) { s.hidden = +s.dataset.step !== n; });
    $("#dv-bar").style.width = (n / 4 * 100) + "%";
    $("#back").hidden = n === 1;
    $("#next").textContent = n === 4 ? "Done" : "Next";
    $("#next").hidden = n === 4;
    if (n === 4) renderReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* --------------------------------------------------------------- photos -- */

  // Phone photos are 3-5MB each and will not send. Redraw to a sane size.
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          if (!blob) { reject(new Error("Could not read that image")); return; }
          var fr = new FileReader();
          fr.onload = function () {
            resolve({ blob: blob, dataUrl: fr.result });
          };
          fr.readAsDataURL(blob);
        }, "image/jpeg", JPEG_Q);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Not an image")); };
      img.src = url;
    });
  }

  function renderShots() {
    $("#shots").innerHTML = photos.map(function (p, i) {
      return '<figure class="dv-shot"><img src="' + p.dataUrl + '" alt="Job photo ' + (i + 1) + '">' +
        '<button type="button" data-drop="' + p.id + '" aria-label="Remove photo">&times;</button></figure>';
    }).join("");
  }

  /* --------------------------------------------------------------- review -- */

  function reportObject() {
    return {
      kind: "wellssafety.jobreport",
      version: 1,
      id: "R" + Date.now().toString(36),
      filed: new Date().toISOString(),
      driver: val("f-driver"),
      date: val("f-date"),
      unit: val("f-unit"),
      customer: val("f-customer"),
      loadRef: val("f-loadRef"),
      permit: val("f-permit"),
      roles: selectedRoles(),
      origin: val("f-origin"),
      destination: val("f-destination"),
      miles: val("f-miles"),
      deadhead: val("f-deadhead"),
      waitHours: val("f-wait"),
      nights: val("f-nights"),
      notes: val("f-notes"),
      geo: geo,
      photoCount: photos.length
    };
  }

  function reportText(r) {
    var lines = [
      "WELLS SAFETY — JOB REPORT",
      "Driver: " + (r.driver || "—"),
      "Date: " + (r.date || "—") + (r.unit ? "   Unit: " + r.unit : ""),
      "Customer: " + (r.customer || "—"),
      "Load: " + (r.loadRef || "—") + (r.permit ? "   Permit: " + r.permit : ""),
      "Ran: " + (r.roles.length ? r.roles.join(", ") : "—"),
      "Route: " + [r.origin, r.destination].filter(Boolean).join(" -> ") || "—",
      "Miles: " + (r.miles || "0") + "   Deadhead: " + (r.deadhead || "0"),
      "Wait: " + (r.waitHours || "0") + " hr   Nights: " + (r.nights || "0"),
      r.geo ? "Filed at: " + r.geo.lat.toFixed(5) + ", " + r.geo.lng.toFixed(5) : "",
      "Photos: " + r.photoCount,
      "",
      r.notes ? "Notes:\n" + r.notes : ""
    ];
    return lines.filter(function (l) { return l !== ""; }).join("\n");
  }

  function renderReview() {
    var r = reportObject();
    var rows = [
      ["Driver", r.driver],
      ["Date", prettyDate(r.date)],
      ["Customer", r.customer],
      ["Load", r.loadRef],
      ["Ran", r.roles.join(", ")],
      ["Route", [r.origin, r.destination].filter(Boolean).join(" → ")],
      ["Miles", r.miles && (r.miles + (r.deadhead ? " + " + r.deadhead + " DH" : ""))],
      ["Wait", r.waitHours && r.waitHours + " hr"],
      ["Nights", r.nights],
      ["Location", r.geo ? r.geo.lat.toFixed(4) + ", " + r.geo.lng.toFixed(4) : ""],
      ["Photos", String(r.photoCount)]
    ].filter(function (p) { return p[1]; });

    $("#review").innerHTML = "<dl>" + rows.map(function (p) {
      return "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>";
    }).join("") + "</dl>";
  }

  /* --------------------------------------------------------------- submit -- */

  function files() {
    var r = reportObject();
    var out = photos.map(function (p, i) {
      return new File([p.blob], "photo-" + (i + 1) + ".jpg", { type: "image/jpeg" });
    });
    out.unshift(new File([JSON.stringify(r, null, 2)],
      "job-report-" + r.id + ".json", { type: "application/json" }));
    return { report: r, files: out };
  }

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function validate() {
    if (!val("f-driver")) { toast("Put your name on it first."); showStep(1); return false; }
    if (!val("f-date")) { toast("Which day was the move?"); showStep(1); return false; }
    return true;
  }

  /* --------------------------------------------------------------- wiring -- */

  function start() {
    $("#dv-date").textContent = new Date().toLocaleDateString("en-US",
      { weekday: "short", month: "short", day: "numeric" });
    $("#f-date").value = isoDate(new Date());

    // Suggest names if this device happens to have the office roster on it.
    try {
      var book = JSON.parse(localStorage.getItem("wellssafety.dispatchbook.v1") || "{}");
      var names = (book.drivers || []).map(function (d) { return d.name; }).filter(Boolean);
      $("#driver-list").innerHTML = names.map(function (n) {
        return '<option value="' + esc(n) + '">';
      }).join("");
      // Remember whoever filed last on this phone.
      var last = localStorage.getItem("wellssafety.driver.name");
      if (last) $("#f-driver").value = last;
    } catch (e) { /* no roster here, free text is fine */ }

    $("#f-roles").innerHTML = ROLES.map(function (r) {
      return '<button type="button" class="dv-chip" aria-pressed="false">' + esc(r) + "</button>";
    }).join("");

    $("#f-roles").addEventListener("click", function (e) {
      var b = e.target.closest(".dv-chip");
      if (!b) return;
      b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });

    $("#next").addEventListener("click", function () {
      if (step === 1 && !validate()) return;
      showStep(Math.min(4, step + 1));
    });
    $("#back").addEventListener("click", function () { showStep(Math.max(1, step - 1)); });

    $("#geo-btn").addEventListener("click", function () {
      var out = $("#geo-out");
      if (!navigator.geolocation) { out.textContent = "This phone will not share a location."; return; }
      out.textContent = "Getting a fix…";
      navigator.geolocation.getCurrentPosition(function (pos) {
        geo = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          at: new Date().toISOString()
        };
        out.textContent = "Stamped: " + geo.lat.toFixed(4) + ", " + geo.lng.toFixed(4) +
          " (±" + geo.accuracy + "m)";
        out.classList.add("is-set");
      }, function (err) {
        out.textContent = err.code === 1
          ? "Location permission was declined — that is fine, it is optional."
          : "Could not get a fix right now.";
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });

    $("#f-photos").addEventListener("change", function (e) {
      var list = Array.prototype.slice.call(e.target.files || []);
      if (!list.length) return;
      toast("Shrinking " + list.length + " photo" + (list.length > 1 ? "s" : "") + "…");
      Promise.all(list.map(function (f) {
        return compress(f).then(function (out) {
          return { id: Math.random().toString(36).slice(2), name: f.name, dataUrl: out.dataUrl, blob: out.blob };
        }).catch(function () { return null; });
      })).then(function (added) {
        photos = photos.concat(added.filter(Boolean));
        renderShots();
        toast(photos.length + " photo" + (photos.length === 1 ? "" : "s") + " attached.");
      });
      e.target.value = "";
    });

    $("#shots").addEventListener("click", function (e) {
      var b = e.target.closest("[data-drop]");
      if (!b) return;
      photos = photos.filter(function (p) { return p.id !== b.dataset.drop; });
      renderShots();
    });

    $("#send-share").addEventListener("click", function () {
      if (!validate()) return;

      // Signed in to the dispatch server: file it directly, photos and all.
      if (WS_API.state.available && WS_API.state.me && WS_API.can("reports")) {
        var r = reportObject();
        var btn = $("#send-share");
        btn.disabled = true;
        btn.textContent = "Sending\u2026";
        WS_API.postReport(r, photos.map(function (p) { return p.dataUrl; }))
          .then(function (out) {
            try { localStorage.setItem("wellssafety.driver.name", r.driver); } catch (e) {}
            $("#send-note").textContent = out.duplicate
              ? "Dispatch already had this one."
              : "Filed with dispatch \u2014 " + out.photosStored + " photo(s) uploaded." +
                (out.photosSkipped ? " " + out.photosSkipped + " would not fit." : "");
            btn.textContent = "Sent \u2713";
            toast("Filed with dispatch. Nothing else to do.");
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = "Send to dispatch";
            if (err.status === 402) return;   // upgrade panel already shown
            toast("Could not reach dispatch — use Save and send it manually.");
          });
        return;
      }

      var bundle = files();
      try { localStorage.setItem("wellssafety.driver.name", bundle.report.driver); } catch (e) {}

      var payload = {
        title: "Job report — " + (bundle.report.loadRef || bundle.report.date),
        text: reportText(bundle.report)
      };

      if (navigator.canShare && navigator.canShare({ files: bundle.files })) {
        navigator.share(Object.assign({ files: bundle.files }, payload))
          .then(function () { toast("Sent. Nice work."); })
          .catch(function (err) { if (err.name !== "AbortError") toast("Share cancelled."); });
      } else if (navigator.share) {
        // Text-only share: photos cannot ride along, so save them separately.
        navigator.share(payload).catch(function () {});
        toast("Your phone will not attach files here — use Save instead for the photos.");
      } else {
        toast("Sharing is not available in this browser — saving instead.");
        saveAll(bundle);
      }
    });

    $("#send-download").addEventListener("click", function () {
      if (!validate()) return;
      saveAll(files());
    });

    function saveAll(bundle) {
      bundle.files.forEach(function (f, i) {
        setTimeout(function () { download(f.name, f); }, i * 250);
      });
      toast("Saved to your phone — attach them to an email or text.");
    }

    $("#lock").addEventListener("click", function () { WS_AUTH.lock(); });

    showStep(1);
  }

  // The API is optional: on the static copy there is no server, and the form
  // falls back to the phone's share sheet exactly as before.
  WS_API.init().then(function () {
    return WS_AUTH.require({
      title: "Driver Sign-In",
      subtitle: "Enter the crew passcode to file a job report."
    });
  }).then(start);
})();
