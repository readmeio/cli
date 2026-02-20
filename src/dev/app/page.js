import { redirect } from 'next/navigation';
import { getFirstPageHref } from '../lib/docs';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const firstHref = getFirstPageHref();
  if (firstHref) {
    redirect(firstHref);
  }

  return (
    <div className="content">
      <h1>Welcome</h1>
      <p>No documentation pages found.</p>
    </div>
  );
}
