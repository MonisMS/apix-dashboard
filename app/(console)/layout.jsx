import AppLayout from '@/layout/AppLayout';

// A route group: the (console) segment does not appear in the URL, it just
// scopes the sidebar chrome to these 17 routes. The landing page at app/page.jsx
// sits outside it and renders without the sidebar, exactly as it did under
// react-router's pathless layout route.
export default function ConsoleLayout({ children }) {
  return <AppLayout>{children}</AppLayout>;
}
