import { redirect } from 'next/navigation';
import { getFirstPageHref } from '../lib/docs';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const firstHref = getFirstPageHref();
  if (firstHref) {
    redirect(firstHref);
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-2xl mb-4">📝</div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Welcome</h1>
      <p className="text-sm text-gray-400">No documentation pages found.</p>
    </div>
  );
}
