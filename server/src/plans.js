/* ==========================================================================
   Wells Safety API — plans.

   Gating is enforced here, on the server, on every request. The client also
   hides locked features, but that is only so the UI reads honestly — hiding a
   button has never stopped anybody. A locked feature answers 402 with the plan
   that would unlock it, which is what the upgrade panel renders.
   ========================================================================== */

export const PLANS = {
  starter: {
    id: "starter",
    name: "Starter",
    price: "included",
    blurb: "The books on one machine. No server, no subscription.",
    features: ["book", "invoices", "print", "driverForm"],
    limits: { seats: 1, photoMb: 0, reports: 0 }
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "$29/mo",
    blurb: "Everything syncs. Drivers file straight into your book.",
    features: ["book", "invoices", "print", "driverForm", "sync", "accounts", "reports"],
    limits: { seats: 6, photoMb: 2048, reports: 100000 }
  },
  fleet: {
    id: "fleet",
    name: "Fleet",
    price: "$79/mo",
    blurb: "Send customers a live invoice link and see when they open it.",
    features: ["book", "invoices", "print", "driverForm", "sync", "accounts",
               "reports", "portal", "branding"],
    limits: { seats: 25, photoMb: 20480, reports: 1000000 }
  }
};

/* What each locked feature is actually worth — used by the upgrade panel. */
export const FEATURE_COPY = {
  sync: {
    title: "Books on every device",
    need: "pro",
    pitch: "Your phone and the office laptop show the same invoices. Clearing a browser stops being a disaster."
  },
  accounts: {
    title: "A login for each driver",
    need: "pro",
    pitch: "See who filed what, and cut off access the day somebody leaves — which one shared passcode can never do."
  },
  reports: {
    title: "Reports file themselves",
    need: "pro",
    pitch: "The driver hits Send and it lands in your Reports tab with the photos. No texting files around."
  },
  portal: {
    title: "Invoice links for customers",
    need: "fleet",
    pitch: "Email a broker a private link to their invoice, and see the moment they open it. Useful when you are chasing money."
  },
  branding: {
    title: "Your logo on everything",
    need: "fleet",
    pitch: "Put the Wells Safety mark on the customer invoice page, not just the printed sheet."
  }
};

/* How many times a paid feature works before it locks. Counted per account,
   per feature, and only on writes — reading back what you already put in
   should not burn a go. */
export const TRIAL_USES = Number(process.env.TRIAL_USES || 5);

export function planOf(id) {
  return PLANS[id] || PLANS.starter;
}

export function allows(planId, feature) {
  return planOf(planId).features.includes(feature);
}

/* The payload a 402 carries, so the client can render a real upgrade prompt. */
export function lockedPayload(feature, trial) {
  const copy = FEATURE_COPY[feature] || { title: feature, need: "pro", pitch: "" };
  const need = planOf(copy.need);
  return {
    error: "upgrade_required",
    feature,
    title: copy.title,
    pitch: copy.pitch,
    trial: trial || null,          // { used, limit } when a trial ran out
    requiresPlan: { id: need.id, name: need.name, price: need.price, blurb: need.blurb }
  };
}
