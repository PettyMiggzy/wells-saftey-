/* ==========================================================================
   Wells Safety — public reviews.

   Reads approved reviews from the dispatch server and takes new submissions.
   On the static copy there is no server, so the list says so plainly rather
   than showing an empty page that looks broken.
   ========================================================================== */

(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var API = "/api/reviews";
  var picked = 0;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stars(n) {
    var out = "";
    for (var i = 1; i <= 5; i++) {
      out += '<span class="star' + (i <= n ? " star--on" : "") + '">&#9733;</span>';
    }
    return out;
  }

  function fmt(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? ""
      : d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  /* ---------------------------------------------------------------- list -- */

  function render(data) {
    var list = $("#rv-list");
    var reviews = data.reviews || [];

    if (!reviews.length) {
      list.innerHTML = "";
      $("#rv-empty").hidden = false;
      return;
    }

    $("#rv-empty").hidden = true;
    $("#rv-summary").hidden = false;
    $("#rv-avg").textContent = data.average != null ? data.average.toFixed(1) : "—";
    $("#rv-avg-stars").innerHTML = stars(Math.round(data.average || 0));
    $("#rv-count").textContent =
      data.count + (data.count === 1 ? " review" : " reviews");

    list.innerHTML = reviews.map(function (r) {
      var who = [r.role, r.company].filter(Boolean).join(", ");
      return '<figure class="rv">' +
        '<div class="rv-stars" aria-label="' + r.rating + ' out of 5">' + stars(r.rating) + "</div>" +
        "<blockquote><p>" + esc(r.body) + "</p></blockquote>" +
        "<figcaption><strong>" + esc(r.author) + "</strong>" +
          (who ? "<span>" + esc(who) + "</span>" : "") +
          (r.load_ref ? '<span class="rv-load">Load ' + esc(r.load_ref) + "</span>" : "") +
          (r.decided_at ? '<span class="rv-date">' + esc(fmt(r.decided_at)) + "</span>" : "") +
        "</figcaption></figure>";
    }).join("");
  }

  function load() {
    fetch(API, { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(render)
      .catch(function () {
        // No server behind this copy of the site.
        $("#rv-list").innerHTML = "";
        $("#rv-empty").hidden = false;
        $("#rv-empty").innerHTML =
          "<h2>Reviews are not switched on yet</h2>" +
          "<p>The review board runs on the dispatch server, which is not " +
          "connected to this copy of the site. Call dispatch and we will " +
          "gladly put you in touch with carriers we run for.</p>";
        var form = $("#review-form");
        if (form) {
          form.setAttribute("hidden", "");
          var head = document.querySelector("#leave .section-head .lede");
          if (head) head.textContent =
            "Review submission needs the dispatch server, which is not connected here yet.";
        }
      });
  }

  /* -------------------------------------------------------------- rating -- */

  function buildPicker() {
    var box = $("#rv-rating");
    if (!box) return;
    var labels = ["Poor", "Fair", "Good", "Great", "Excellent"];
    box.innerHTML = [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" class="rv-pick__btn" role="radio" aria-checked="false" ' +
        'data-n="' + n + '" aria-label="' + n + ' star' + (n > 1 ? "s" : "") + ' — ' +
        labels[n - 1] + '"><span>&#9733;</span></button>';
    }).join("");

    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-n]");
      if (!b) return;
      picked = +b.dataset.n;
      Array.prototype.forEach.call(box.children, function (c) {
        var on = +c.dataset.n <= picked;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-checked", +c.dataset.n === picked ? "true" : "false");
      });
      box.parentNode.classList.remove("has-error");
    });
  }

  /* -------------------------------------------------------------- submit -- */

  function fail(form, name, msg) {
    var field = form.querySelector('[name="' + name + '"]');
    var wrap = field ? field.closest(".field") : form.querySelector(".field");
    if (wrap) {
      wrap.classList.add("has-error");
      if (msg) {
        var err = wrap.querySelector(".err");
        if (err) err.textContent = msg;
      }
      (field || wrap).focus();
    }
  }

  function submit(e) {
    e.preventDefault();
    var form = e.target;
    var status = $("#rv-status");

    Array.prototype.forEach.call(form.querySelectorAll(".has-error"), function (el) {
      el.classList.remove("has-error");
    });

    var author = form.elements.author.value.trim();
    var body = form.elements.body.value.trim();

    if (!picked) { $("#rv-rating").parentNode.classList.add("has-error"); return; }
    if (author.length < 2) { fail(form, "author"); return; }
    if (body.length < 20) { fail(form, "body"); return; }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Sending…";

    fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        author: author,
        company: form.elements.company.value.trim(),
        role: form.elements.role.value.trim(),
        loadRef: form.elements.loadRef.value.trim(),
        rating: picked,
        body: body,
        website: form.elements.website.value    // honeypot
      })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (out) {
      if (!out.ok) {
        btn.disabled = false;
        btn.textContent = "Send Review";
        status.hidden = false;
        status.dataset.state = "err";
        status.textContent =
          out.d.error === "no_links" ? "Please leave links out of the review."
          : out.d.error === "review_too_short" ? "Give us a sentence or two more."
          : out.d.error === "too_many_reviews" ? "That is a few reviews from one place — try again later."
          : "That did not go through. Call dispatch and we will sort it out.";
        return;
      }
      form.innerHTML =
        '<div class="rv-thanks"><h3>Thank you &mdash; that means a lot.</h3>' +
        "<p>It goes up once we have read it. If you left a load number we will " +
        "match it to the move.</p></div>";
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = "Send Review";
      status.hidden = false;
      status.dataset.state = "err";
      status.textContent = "Could not reach us just now. Please try again shortly.";
    });
  }

  buildPicker();
  load();
  var form = $("#review-form");
  if (form) form.addEventListener("submit", submit);
})();
