import { headers } from 'next/headers';
import { collectSidebar } from '../lib/docs';
import '@readme/markdown/dist/main.css';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dev Preview',
};

function SidebarIcon({ icon }) {
  // Font Awesome icon (e.g. "fa-book", "fa-solid fa-book")
  if (icon && icon.includes('fa-')) {
    const cls = icon.startsWith('fa-') ? `fa-solid ${icon}` : icon;
    return <i className={`${cls} text-[12px] w-5 text-center shrink-0 opacity-40`} />;
  }

  // Emoji or other text
  if (icon) {
    return <span className="text-[14px] w-5 text-center shrink-0 leading-none">{icon}</span>;
  }

  // Empty spacer to keep alignment consistent
  return <span className="w-5 shrink-0" />;
}

function SidebarItems({ items, depth = 0, activePath }) {
  return (
    <ul className="list-none m-0 p-0">
      {items.map((item, i) => {
        const isActive = item.href && activePath === item.href;
        return (
          <li key={i}>
            {item.href ? (
              <a
                href={item.href}
                className={[
                  'flex items-center gap-2 py-[7px] pr-3 text-[14px] no-underline transition-colors duration-150',
                  depth === 0 ? 'pl-5' : depth === 1 ? 'pl-9' : 'pl-12',
                  item.hidden ? 'opacity-40' : '',
                  isActive
                    ? 'text-[#018ef5] bg-[#018ef5]/[0.07] font-medium'
                    : item.hidden
                      ? 'text-gray-400 hover:text-gray-500 hover:bg-gray-100/40'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/60',
                ].join(' ')}
                {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <SidebarIcon icon={item.icon} />
                <span>{item.title}{item.external ? ' ↗' : ''}</span>
              </a>
            ) : (
              <span className="block pl-5 pr-3 pt-6 pb-[6px] text-[11px] font-bold uppercase tracking-wider text-gray-400 first:pt-3">
                {item.title}
              </span>
            )}
            {item.children?.length > 0 && <SidebarItems items={item.children} depth={depth + 1} activePath={activePath} />}
          </li>
        );
      })}
    </ul>
  );
}

export default async function RootLayout({ children }) {
  const sidebar = collectSidebar();
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '';
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  const activeSectionDir = sidebar.find(s => s.dir === firstSegment)?.dir || sidebar[0]?.dir;

  return (
    <html lang="en">
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
      </head>
      <body className="bg-white text-gray-900 antialiased">
        {/* Top Navigation */}
        <header className="fixed top-0 inset-x-0 h-[52px] bg-white border-b border-gray-200 flex items-center px-5 z-50">
          <div className="flex items-center gap-2.5 mr-8 shrink-0">
            <span className="text-[#018ef5] font-bold text-[15px] tracking-tight">ReadMe</span>
            <span className="text-[10px] font-semibold bg-blue-50 text-[#018ef5]/70 px-2 py-0.5 rounded-full ring-1 ring-blue-100/80">
              Preview
            </span>
          </div>
          <nav className="flex h-full items-stretch gap-0.5">
            {sidebar.map((section, i) => (
              <a
                key={i}
                href={section.firstHref}
                className={`flex items-center px-3.5 text-[14px] font-medium no-underline border-b-2 transition-colors duration-150 ${
                  section.dir === activeSectionDir
                    ? 'border-[#018ef5] text-[#018ef5]'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {section.title}
              </a>
            ))}
          </nav>
        </header>

        <div className="flex pt-[52px] min-h-screen">
          {/* Sidebar */}
          <aside className="w-[250px] fixed top-[52px] left-0 bottom-0 bg-white border-r border-gray-200 overflow-y-auto py-4">
            {sidebar
              .filter(s => s.dir === activeSectionDir)
              .map((section, i) => (
                <SidebarItems key={i} items={section.children} activePath={pathname} />
              ))}
          </aside>

          {/* Content */}
          <main className="ml-[250px] flex-1 min-w-0">
            <div className="max-w-[820px] py-10 px-16">
              {children}
            </div>
          </main>
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
