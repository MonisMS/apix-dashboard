import {
  Calculator, ChartArea, ChartBar, Clock, CloudDownload, EyeOff, Filter,
  Grid3x3, Moon, PlaneTakeoff, Receipt, ReceiptText, Route, Scale, Server,
  Sun, Target,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { useDarkMode } from '../hooks/useDarkMode';
import { useCollection, useIndex } from '../api';
import { count, idx, sharePct, shortDate } from '../format';

const NAV = [
  {
    label: 'Index',
    items: [
      { to: '/overview', label: 'Overview', icon: ChartArea },
      { to: '/index', label: 'Index detail', icon: ChartBar },
      { to: '/windows', label: 'Booking windows', icon: Clock },
    ],
  },
  {
    label: 'Markets',
    items: [
      { to: '/routes', label: 'Routes', icon: Route },
      { to: '/carriers', label: 'Carriers', icon: PlaneTakeoff },
      { to: '/heatmap', label: 'Sector heatmap', icon: Grid3x3 },
      { to: '/tariffs', label: 'Published tariffs', icon: Receipt },
    ],
  },
  {
    label: 'Quality',
    items: [
      { to: '/cleaning', label: 'Cleaning', icon: Filter },
      { to: '/availability', label: 'Availability', icon: EyeOff },
      { to: '/split', label: 'Base fare & taxes', icon: ReceiptText },
      { to: '/validation', label: 'Validation', icon: Target },
    ],
  },
  {
    label: 'Method',
    items: [
      { to: '/weights', label: 'Basket & weights', icon: Scale },
      { to: '/methodology', label: 'Methodology', icon: Calculator },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/data', label: 'Collection', icon: CloudDownload },
      { to: '/api-docs', label: 'API', icon: Server },
    ],
  },
];

function isActive(pathname, to) {
  return pathname.startsWith(to);
}

function ThemeToggle() {
  const [dark, toggle] = useDarkMode();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-none text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

function AsideSummary() {
  const { data: index } = useIndex();
  const { data: coll } = useCollection();
  const points = index?.points ?? [];
  const last = points[points.length - 1];
  const cov = index?.coverage;
  const sweep = coll?.sweeps?.[0];

  return (
    <div className="hidden xl:flex xl:w-64 xl:shrink-0 xl:flex-col xl:gap-6 xl:border-l xl:border-border xl:p-5">
      <div>
        <p className="text-xs text-muted-foreground">Current level</p>
        <p className="tabular mt-0.5 text-[28px] font-medium leading-tight">{idx(last?.level)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {last ? shortDate(last.period_start) : '—'}
          {index?.reference?.is_provisional ? ' · provisional' : ''}
        </p>
      </div>
      <Separator />
      <div>
        <p className="text-xs text-muted-foreground">Route coverage</p>
        <p className="tabular mt-0.5 text-sm font-medium">
          {cov
            ? `${cov.routes_with_data} of ${cov.routes_in_basket} · ${sharePct(
                cov.routes_with_data / cov.routes_in_basket,
                0,
              )}`
            : '—'}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Last sweep</p>
        {sweep ? (
          <>
            <p className="mt-0.5 text-sm font-medium">
              {shortDate(sweep.date)} · {sweep.started}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {sweep.fetches} fetches · {count(sweep.quotes)} quotes
              {sweep.failed ? ` · ${sweep.failed} failed` : ''}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">No sweeps recorded yet.</p>
        )}
      </div>
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const { data: index } = useIndex();

  return (
    <SidebarProvider>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="px-3 py-3">
          <Link to="/" className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm font-semibold tracking-tight">APIx</span>
            <span className="text-xs text-muted-foreground">Airfare price index</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={isActive(location.pathname, to)}>
                        <Link to={to}>
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="px-3 py-3 text-xs text-muted-foreground">
          <p>SIH26056 · MoSPI</p>
          <p>Jevons · Young</p>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-[52px] items-center justify-between gap-3 border-b border-border px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              apix.dashboard
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {index?.reference?.label && (
              <p className="hidden max-w-[22.5rem] truncate text-xs text-muted-foreground sm:block">
                {index.reference.label}
              </p>
            )}
            <ThemeToggle />
          </div>
        </header>
        <main id="main-content" className="flex flex-1">
          <div className="apix-main mx-auto w-full max-w-[70rem] flex-1 p-4 md:p-6">
            <Outlet />
          </div>
          <AsideSummary />
        </main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
