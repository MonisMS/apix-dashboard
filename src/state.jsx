import { PageHeader, queryState } from './ui';

export { queryState };

/** Compatibility wrapper for pages still using the positional helper. */
export function pageHeader(title, description, badges = []) {
  return <PageHeader title={title} description={description} badges={badges} />;
}
