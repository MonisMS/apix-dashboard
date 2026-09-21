import Carriers from '@/views/Carriers';

export async function generateMetadata({ params }) {
  const { code } = await params; // params is a Promise in Next 16
  return { title: `${decodeURIComponent(code)} — APIx` };
}

export default function Page() {
  return <Carriers />;
}
