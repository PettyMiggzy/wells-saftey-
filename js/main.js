(function () {
  "use strict";

  /* ------------------------------------------------------ mobile nav -- */

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!open));
      toggle.setAttribute("aria-expanded", String(!open));
    });

    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        nav.setAttribute("data-open", "false");
        toggle.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.getAttribute("data-open") === "true") {
        nav.setAttribute("data-open", "false");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  /* ------------------------------------------------------ quote form -- */

  var form = document.getElementById("quote-form");
  if (!form) return;

  var status = document.getElementById("form-status");

  function setError(input, message) {
    var wrap = input.closest(".field");
    var slot = wrap && wrap.querySelector(".field__error");
    if (slot) slot.textContent = message || "";
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function validate(input) {
    var value = input.value.trim();

    if (input.hasAttribute("required") && !value) {
      setError(input, "This field is required.");
      return false;
    }
    if (input.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setError(input, "Enter a valid email address.");
      return false;
    }
    if (input.type === "tel" && value && value.replace(/\D/g, "").length < 10) {
      setError(input, "Enter a 10-digit phone number.");
      return false;
    }
    setError(input, "");
    return true;
  }

  var fields = Array.prototype.slice.call(
    form.querySelectorAll("input:not([type=hidden]), select, textarea")
  ).filter(function (el) {
    return !el.closest(".hp");
  });

  fields.forEach(function (input) {
    input.addEventListener("blur", function () {
      validate(input);
    });
    input.addEventListener("input", function () {
      if (input.getAttribute("aria-invalid") === "true") validate(input);
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    // Honeypot: a real person never fills this in.
    var trap = form.querySelector('.hp input');
    if (trap && trap.value) return;

    var ok = true;
    var firstBad = null;

    fields.forEach(function (input) {
      if (!validate(input)) {
        ok = false;
        if (!firstBad) firstBad = input;
      }
    });

    if (!ok) {
      status.hidden = false;
      status.dataset.state = "error";
      status.textContent = "Please correct the highlighted fields and try again.";
      if (firstBad) firstBad.focus();
      return;
    }

    // No backend is wired up yet — hand the request off to email so the form
    // is usable on a static host. Replace with a real endpoint when available.
    var get = function (name) {
      var el = form.elements[name];
      return el ? el.value.trim() : "";
    };

    var lines = [
      "Company: " + get("company"),
      "Contact: " + get("name"),
      "Phone: " + get("phone"),
      "Email: " + get("email"),
      "Service: " + get("service"),
      "Pickup: " + get("origin"),
      "Delivery: " + get("destination"),
      "Move date: " + get("date"),
      "Dimensions: " + get("dimensions"),
      "",
      "Details:",
      get("details")
    ];

    status.hidden = false;
    status.dataset.state = "ok";

    // Until a dispatch inbox exists, there is nowhere to send this. Rather than
    // opening a mail client addressed to a dead mailbox, send people to the
    // phone — and copy their details so nothing they typed is lost.
    if (!form.dataset.email) {
      var summary = lines.join("\n");
      var phone = form.dataset.phone || "";
      status.textContent =
        "Thanks — your details are copied to your clipboard. Please call or text dispatch at " +
        phone +
        " to confirm, and paste them into a message.";
      if (navigator.clipboard) navigator.clipboard.writeText(summary).catch(function () {});
      return;
    }

    var mailto =
      "mailto:" +
      form.dataset.email +
      "?subject=" +
      encodeURIComponent("Escort quote request — " + (get("company") || get("name"))) +
      "&body=" +
      encodeURIComponent(lines.join("\n"));

    status.textContent =
      "Thanks — opening your email client to send this request. If nothing opens, call dispatch directly.";

    window.location.href = mailto;
  });
})();
