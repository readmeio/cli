import { redirect } from 'next/navigation';
import { getPage, collectSidebar } from '../../lib/docs';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = getPage(slug);
  return { title: page?.title || 'Page not found' };
}

export default async function SlugPage({ params }) {
  const { slug } = await params;

  // Bare section URLs (e.g. `/reference`, `/docs`) land here with a single-
  // element slug and no specific page. Redirect to that section's first
  // page so the Reference tab etc. always resolve to something real.
  if (slug.length === 1) {
    const sections = collectSidebar();
    const section = sections.find(s => s.dir === slug[0]);
    if (section?.firstHref) redirect(section.firstHref);
  }

  const page = getPage(slug);

  if (!page) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-2xl mb-4">?</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Page not found</h1>
        <p className="text-sm text-gray-400">No document found for this path.</p>
      </div>
    );
  }

  return (
    <div className="content markdown-body">
      <h1>{page.title}</h1>
      {page.excerpt && <p className="excerpt">{page.excerpt}</p>}
      <div dangerouslySetInnerHTML={{ __html: page.html }} />
    </div>
  );
}
