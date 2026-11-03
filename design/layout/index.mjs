// Единый источник макета: список артбордов в порядке из CLAUDE.md (этап 1).
import designSystem from './screens/01-design-system.mjs';
import landingDesktop from './screens/02-landing-desktop.mjs';
import landingMobile from './screens/03-landing-mobile.mjs';
import clientWizard from './screens/04-client-wizard.mjs';
import clientApplication from './screens/05-client-application.mjs';
import expertReview from './screens/06-expert-review.mjs';
import courierMobile from './screens/07-courier-mobile.mjs';
import adminDashboard from './screens/08-admin-dashboard.mjs';

export const screens = [
  designSystem, landingDesktop, landingMobile, clientWizard,
  clientApplication, expertReview, courierMobile, adminDashboard,
];

export function buildMockup(only) {
  return screens
    .map((fn) => fn())
    .filter((ab) => !only || only.includes(ab.id))
    .map((ab, i) => ({ index: i + 1, id: ab.id, title: ab.title, w: ab.w, h: ab.h, bg: ab.bg, items: ab.root }));
}
