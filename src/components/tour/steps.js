/**
 * The guided tour: one ordered walkthrough across the dashboard.
 *
 * Replaces two disconnected tours (four steps on the landing page, three on
 * Overview) that never joined up and that pointed mostly at decoration. This
 * one takes somebody with no context from "what is this number" to "here is
 * how you would catch us lying", on the pages that actually hold the evidence.
 *
 * Two rules the copy here has to keep:
 *
 *  1. No figures in the text. The real value is under the spotlight; writing
 *     it into a sentence here would go stale the first time the data moved,
 *     which is the exact failure this project spends its effort avoiding.
 *  2. Plain English first, term of art second. The circled-i dots across the
 *     dashboard already carry the per-term glossary. The tour's job is the
 *     sequence, not the definitions.
 */

/** Set once by GuidedTour so steps can navigate without being re-created. */
export const nav = { push: null, prefetch: null };

/** Every route the tour visits, in order -- used to warm them on start. */
export const TOUR_ROUTES = [
  '/overview', '/data', '/methodology', '/weights',
  '/cleaning', '/validation', '/index-detail',
];

/**
 * Resolve once the selector matches something with real size on screen.
 *
 * Resolves `false` on timeout and NEVER rejects. Every console view returns a
 * skeleton from `queryState(...)` while its query is in flight, so immediately
 * after a route change the target does not exist yet; the width/height check
 * is what distinguishes the skeleton from the real thing.
 *
 * Polling rather than a MutationObserver on purpose: the failure we must rule
 * out is hanging in front of a judge, and an interval with a deadline is
 * trivially auditable. Eighty-odd querySelector calls over seven seconds costs
 * nothing.
 */
export function waitForTarget(selector, timeout = 7000) {
  return new Promise((resolve) => {
    const present = () => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    if (present()) return resolve(true);
    const deadline = Date.now() + timeout;
    const id = setInterval(() => {
      if (present()) {
        clearInterval(id);
        resolve(true);
      } else if (Date.now() > deadline) {
        clearInterval(id);
        resolve(false);
      }
    }, 80);
  });
}

/**
 * The whole cross-page mechanism: go to the page if we are not on it, then
 * block until the step's target is really there.
 *
 * Joyride waits on this promise before showing the step. If it resolves false
 * the step goes ahead anyway, finds nothing, and Joyride's own
 * TARGET_NOT_FOUND handling moves to the next step -- so a slow page costs a
 * step, never the tour. `window.location.pathname` rather than `usePathname()`
 * so navigation does not re-render the provider that owns Joyride.
 */
function goTo(href, selector) {
  return async () => {
    if (window.location.pathname !== href) nav.push?.(href);
    await waitForTarget(selector);
  };
}

/**
 * The bubble anchors to the whole highlighted block and sits BENEATH it.
 *
 * An earlier version anchored to the heading inside the block, which kept the
 * bubble small and on-screen but laid it over the very thing it was pointing
 * at. Anchoring to the container and placing below means the highlighted
 * content stays readable; the measured blocks here run 38-420px, so there is
 * room under all of them, and flipOptions falls back to above only when there
 * genuinely is not.
 */
const step = ({ route, anchor, title, content, placement = 'bottom' }) => {
  const container = `[data-tour="${anchor}"]`;
  return {
    target: container,
    spotlightTarget: container,
    scrollTarget: container,
    placement,
    title,
    content,
    before: goTo(route, container),
  };
};

export const STEPS = [
  step({
    route: '/overview',
    anchor: 'kpi-row',
    title: 'This is an index, not a price',
    content:
      'It compares what flights cost today against a fixed stretch of days, which is set to 100. ' +
      'Below 100 means fares are cheaper than they were then. It follows the change, not the ticket.',
  }),
  step({
    route: '/data',
    anchor: 'collection-stats',
    title: 'Where the fares come from',
    content:
      'Every number traces back to fares we collected ourselves, through licensed flight-search APIs, ' +
      'at the same time each day. The fixed hour matters: part of a day-to-day move can be the clock ' +
      'rather than the market, so we publish how far each sweep ran from its slot.',
  }),
  step({
    route: '/methodology',
    anchor: 'formulas',
    title: 'How a fare becomes an index',
    content:
      'We find the same flight on two consecutive days and measure how its price moved. Those moves are ' +
      'averaged inside each small group of comparable flights, then the groups are combined according to ' +
      'how much money is actually spent on them.',
  }),
  step({
    route: '/weights',
    anchor: 'route-weights',
    title: 'Why some routes count more',
    content:
      'Each slice of this bar is one route’s share of the index, from passengers carried times the fare ' +
      'they pay. A large swing on a small route moves the national number far less than it appears to.',
  }),
  step({
    route: '/cleaning',
    anchor: 'screening',
    title: 'What we do with fares that look wrong',
    content:
      'A fare that more than triples overnight is probably not the same seat repriced, so it is held out of ' +
      'the comparison. This chart shows what every rule we considered would have done to the published ' +
      'number — so a cleaning step cannot quietly become an editorial one.',
  }),
  step({
    route: '/validation',
    anchor: 'pass-criteria',
    title: 'How you would catch us',
    content:
      'These thresholds were written down before any comparison with the official index was possible. ' +
      'Fixing them in advance is what stops a test being adjusted afterwards to match whatever result ' +
      'turned up.',
  }),
  step({
    route: '/index-detail',
    anchor: 'frequency-tabs',
    title: 'And when we cannot answer',
    content:
      'Weekly and monthly are switched off, with the reason and the date they become possible. Averaging the ' +
      'days we have and calling it a weekly index would be a different measure wearing the same name. ' +
      'Wherever a number cannot honestly exist yet, this dashboard says so instead of filling the gap.',
  }),
];
