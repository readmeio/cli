import { getPage } from '../../lib/docs';

export const dynamic = 'force-dynamic';

export default async function SlugPage({ params }) {
  const { slug } = await params;
  const page = getPage(slug);

  if (!page) {
    return (
      <div className="content">
        <h1>Page not found</h1>
        <p>No document found for this path.</p>
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
