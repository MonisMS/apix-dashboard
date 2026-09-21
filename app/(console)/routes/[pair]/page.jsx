import RouteDetail from '@/views/RouteDetail';

export async function generateMetadata({ params }) {
  const { pair } = await params; // params is a Promise in Next 16
  return { title: `${pair.toUpperCase()} — APIx` };
}

export default function Page() {
  return <RouteDetail />;
}
