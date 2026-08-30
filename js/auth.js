/* ==========================================================================
   Wells Safety — shared passcode gate for the private tools.

   HONEST LIMITS. This is a static site: there is no server to check a password
   against, so the check happens in the visitor's own browser. The stored value
   is a SHA-256 hash rather than the passcode itself, which keeps it out of
   "view source" — but anyone determined can read the code, lift the hash and
   crack a short passcode, or simply skip the gate in devtools.

   What it genuinely does: keeps the tools out of reach of anyone who stumbles
   onto the URL, and keeps the passcode off the page. What it is not: real
   authentication. The data it guards lives only in this browser, so there is
   no server-side record for anyone to reach — that, not this gate, is what
   actually limits the exposure. Real accounts need a backend.
   ========================================================================== */

window.WS_AUTH = (function () {
  "use strict";

  var SALT = "wellssafety::";
  var HASH_KEY = "wellssafety.gate.hash";
  var SESSION_KEY = "wellssafety.gate.ok";

  // SHA-256 of "wellssafety::104Paul". Change the passcode in Settings and
  // this is replaced by the hash of the new one.
  var DEFAULT_HASH =
    "7081399126e5cf373a16160ca01d9ea337470184a7a03a3e971eab18be2963de";

  function storedHash() {
    try { return localStorage.getItem(HASH_KEY) || DEFAULT_HASH; }
    catch (e) { return DEFAULT_HASH; }
  }

  function hash(code) {
    var bytes = new TextEncoder().encode(SALT + code);
    return crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
      return Array.prototype.map
        .call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); })
        .join("");
    });
  }

  function setCode(code) {
    return hash(code).then(function (h) {
      localStorage.setItem(HASH_KEY, h);
      return h;
    });
  }

  function unlocked() {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; }
    catch (e) { return false; }
  }

  function lock() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    location.reload();
  }

  /* Renders a full-screen lock and resolves once the passcode is right. */
  function require(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (unlocked()) { resolve(); return; }

      // crypto.subtle only exists in a secure context (https or localhost).
      if (!window.crypto || !crypto.subtle) {
        document.body.innerHTML =
          '<div class="gate"><div class="gate__card"><h1>Not available here</h1>' +
          "<p>This page needs a secure (https) connection to check the passcode. " +
          "Open it over https.</p></div></div>";
        return;
      }

      var el = document.createElement("div");
      el.className = "gate";
      el.innerHTML =
        '<form class="gate__card" autocomplete="off">' +
          '<svg class="gate__mark" viewBox="0 0 48 48" aria-hidden="true">' +
            '<path d="M24 3 6 10v14c0 11 7.6 18.6 18 21 10.4-2.4 18-10 18-21V10L24 3Z" fill="#ffb020"/>' +
            '<path d="M24 3 6 10v14c0 11 7.6 18.6 18 21V3Z" fill="#e0930a"/>' +
            '<path d="m14 20 4 12h3l3-9 3 9h3l4-12h-3.5l-2.2 7.6L26 20h-4l-2.3 7.6L17.5 20H14Z" fill="#0e1420"/>' +
          "</svg>" +
          "<h1>" + (opts.title || "Wells Safety") + "</h1>" +
          "<p>" + (opts.subtitle || "Enter the passcode to continue.") + "</p>" +
          '<label class="gate__field"><span class="sr-only">Passcode</span>' +
            '<input type="password" name="code" placeholder="Passcode" autocomplete="current-password" ' +
              'inputmode="text" required autofocus></label>' +
          '<button class="btn btn--primary" type="submit">Unlock</button>' +
          '<p class="gate__err" hidden>That passcode is not right.</p>' +
          '<p class="gate__note">Keeps this page out of the way of anyone who finds the ' +
            "link. It is not a substitute for a real login &mdash; do not treat it as one.</p>" +
        "</form>";
      document.body.appendChild(el);
      document.body.classList.add("is-locked");

      var form = el.querySelector("form");
      var err = el.querySelector(".gate__err");

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = form.elements.code.value;
        hash(code).then(function (h) {
          if (h !== storedHash()) {
            err.hidden = false;
            form.elements.code.select();
            return;
          }
          try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e2) {}
          el.remove();
          document.body.classList.remove("is-locked");
          resolve();
        });
      });
    });
  }

  return { require: require, setCode: setCode, lock: lock, unlocked: unlocked };
})();
