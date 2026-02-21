import { headers } from 'next/headers';
import { collectSidebar } from '../lib/docs';
import '@readme/markdown/dist/main.css';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dev Preview',
};

function SidebarItems({ items }) {
  return (
    <ul className="sidebar-children">
      {items.map((item, i) => (
        <li key={i}>
          {item.href ? (
            <a href={item.href} className="sidebar-link" {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {item.title}{item.external ? ' ↗' : ''}
            </a>
          ) : (
            <span className="sidebar-group">{item.title}</span>
          )}
          {item.children?.length > 0 && <SidebarItems items={item.children} />}
        </li>
      ))}
    </ul>
  );
}

export default async function RootLayout({ children }) {
  const sidebar = collectSidebar();
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '';
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';

  // Find active section based on URL, default to first
  const activeSectionDir = sidebar.find(s => s.dir === firstSegment)?.dir || sidebar[0]?.dir;

  return (
    <html lang="en">
      <body>
        <div className="topnav">
          <div className="topnav-tabs">
            {sidebar.map((section, i) => (
              <a
                key={i}
                href={section.firstHref}
                className={`topnav-tab${section.dir === activeSectionDir ? ' topnav-tab-active' : ''}`}
              >
                {section.title}
              </a>
            ))}
          </div>
        </div>
        <div className="layout">
          <nav className="sidebar">
            {sidebar
              .filter(s => s.dir === activeSectionDir)
              .map((section, i) => (
                <SidebarItems key={i} items={section.children} />
              ))}
          </nav>
          <main className="main">{children}</main>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var es=new EventSource('/__reload');es.onmessage=function(e){if(e.data==='reload')location.reload()};})();`,
          }}
        />
      </body>
    </html>
  );
}
