import { Joyride, STATUS } from 'react-joyride';
import { useRouter } from 'next/navigation';
import { TourTooltip } from './TourTooltip';

/**
 * The judge-demo path. Content is drawn from the PS text itself (SIH26056)
 * and this project's own real coverage numbers -- not placeholder copy.
 */
const STEPS = [
  {
    target: 'body',
    placement: 'center',
    title: 'A real-time airfare price index for India',
    content:
      'Over 90% of domestic air tickets are now sold online, and the same route can vary ' +
      '200-400% within a single day depending on demand, day-of-week, and how far ahead you book. ' +
      'The official CPI still prices this mostly by hand. This is what an automated version looks like.',
  },
  {
    target: '[data-tour="route-map"]',
    title: 'A live network of basket routes',
    content:
      'Twelve city-pairs, selected from DGCA passenger-traffic data. Each line is colored by how ' +
      'today’s fare compares to its own baseline -- red rising, green falling, amber near baseline.',
  },
  {
    target: '[data-tour="snapshot"]',
    title: 'Every number here is live',
    content:
      'These aren’t mockups. The index level, observation count, and last-collected timestamp are ' +
      'pulled from the same API that powers the dashboard -- reload this page and they can change.',
  },
  {
    target: '[data-tour="nav-dashboard"]',
    title: 'Into the dashboard',
    content: 'From here we go into the full dashboard -- the index, five booking-window sub-indices ' +
      '(T+1, T+7, T+15, T+30, T+45 days), and the data quality pages.',
  },
];

const OVERVIEW_STEPS = [
  {
    target: '[data-tour="kpi-row"]',
    title: 'The headline numbers',
    content: 'Current index level, route coverage, real observation count, and data freshness -- ' +
      'the four things worth checking before trusting anything below.',
  },
  {
    target: '[data-tour="primary-chart"]',
    title: 'The composite index',
    content: 'A Jevons elementary index (geometric mean of matched price relatives) aggregated with a ' +
      'Young weighted arithmetic mean -- the same two-stage method MoSPI’s own CPI manual specifies.',
  },
  {
    target: '[data-tour="provenance"]',
    title: 'Where every number comes from',
    content: 'This line always says how many real observations, from how many sources, and when they ' +
      'were last verified -- click through to the full collection log at any time.',
  },
];

export function GuidedTour({ run, onFinish, page = 'landing' }) {
  const router = useRouter();
  // scrollOffset clears the sticky shortfall banner + header (~110px combined)
  // so a scrolled-to target doesn't land underneath them.
  const steps = (page === 'overview' ? OVERVIEW_STEPS : STEPS).map((s) => ({ ...s, scrollOffset: 120 }));

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showSkipButton
      tooltipComponent={TourTooltip}
      onEvent={({ status }) => {
        if (status === STATUS.FINISHED) {
          onFinish?.();
          if (page === 'landing') router.push('/overview');
          return;
        }
        if (status === STATUS.SKIPPED) {
          onFinish?.();
        }
      }}
      styles={{
        options: {
          arrowColor: 'var(--popover)',
          backgroundColor: 'var(--popover)',
          overlayColor: 'rgba(25, 25, 23, 0.55)',
          primaryColor: 'var(--primary)',
          textColor: 'var(--popover-foreground)',
          zIndex: 1000,
        },
      }}
    />
  );
}
