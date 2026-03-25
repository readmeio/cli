import { headers } from 'next/headers';
import { collectSidebar } from '../lib/docs';
import '@readme/markdown/dist/main.css';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dev Preview',
};

function SidebarIcon({ icon }) {
  if (!icon) {
    return <span className="w-5 shrink-0" />;
  }

  // Font Awesome shorthand map
  const FA_STYLE_MAP = { far: 'fa-regular', fas: 'fa-solid', fab: 'fa-brands', fal: 'fa-light', fad: 'fa-duotone' };

  const parts = icon.split(' ');
  let cls;
  if (FA_STYLE_MAP[parts[0]]) {
    cls = `${FA_STYLE_MAP[parts[0]]} ${parts.slice(1).join(' ')}`;
  } else if (icon.includes('fa-')) {
    cls = icon.includes(' ') ? icon : `fa-solid ${icon}`;
  } else if (/^[a-z][a-z0-9-]*$/.test(icon)) {
    cls = `fa-solid fa-${icon}`;
  }

  if (cls) {
    return <i className={`${cls} text-[14px] w-5 text-left shrink-0 opacity-40`} />;
  }

  // Emoji or other text
  return <span className="text-[14px] w-5 text-center shrink-0 leading-none">{icon}</span>;
}

function hasActiveChild(items, activePath) {
  for (const item of items) {
    if (item.href && activePath === item.href) return true;
    if (item.children?.length && hasActiveChild(item.children, activePath)) return true;
  }
  return false;
}

function SidebarItems({ items, depth = 0, activePath }) {
  return (
    <ul className="list-none m-0 p-0">
      {items.map((item, i) => {
        const isActive = item.href && activePath === item.href;
        const hasChildren = item.children?.length > 0;
        const isExpanded = hasChildren && (isActive || hasActiveChild(item.children, activePath));

        // Category header (no href — always expanded, not collapsible)
        if (!item.href) {
          return (
            <li key={i}>
              <span className="block pl-3 pr-3 pt-9 pb-1 text-[12px] font-bold uppercase tracking-wider text-gray-500 first:pt-3">
                {item.title}
              </span>
              {hasChildren && <SidebarItems items={item.children} depth={depth} activePath={activePath} />}
            </li>
          );
        }

        // Page with subpages (collapsible)
        if (hasChildren) {
          return (
            <li key={i} data-sidebar-group data-expanded={isExpanded ? 'true' : 'false'}>
              <a
                href={item.href || '#'}
                data-sidebar-toggle
                className={[
                  'flex items-center gap-2 py-[5px] pr-3 text-[15px] no-underline transition-colors duration-150',
                  depth === 0 ? 'pl-3' : depth === 1 ? 'pl-6' : 'pl-9',
                  isActive
                    ? 'text-[#018ef5] bg-[#018ef5]/[0.07] font-medium'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/60',
                ].join(' ')}
              >
                <SidebarIcon icon={item.icon} />
                <span className="flex-1">{item.title}</span>
                <i className="fa-solid fa-chevron-right text-[9px] text-gray-300 transition-transform duration-200 sidebar-chevron" />
              </a>
              <div className="sidebar-children overflow-hidden">
                <SidebarItems items={item.children.filter(c => c.href !== item.href)} depth={depth + 1} activePath={activePath} />
              </div>
            </li>
          );
        }

        // Leaf item
        return (
          <li key={i}>
            <a
              href={item.href}
              className={[
                'flex items-center gap-2 py-[5px] pr-3 text-[15px] no-underline transition-colors duration-150',
                depth === 0 ? 'pl-3' : depth === 1 ? 'pl-6' : 'pl-9',
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
              <span className="flex-1">{item.title}</span>
              {item.external && <span className="text-gray-300 text-[11px]">↗</span>}
            </a>
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
        <link rel="stylesheet" href="https://kit.fontawesome.com/b331e91c9c.css" crossOrigin="anonymous" />
      </head>
      <body className="bg-[#000343] text-gray-900 antialiased">
        {/* Top Navigation */}
        <header className="fixed top-0 inset-x-0 h-[48px] bg-[#000343] flex items-center px-5 z-50" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
        }}>
          <div className="flex items-center gap-3 mr-8 shrink-0">
            <div className="flex items-center gap-2">
              <i className="fa-brands fa-readme text-[#018ef5] text-[18px] relative top-[1px]" />
              <span className="text-white/90 font-mono text-[13px] tracking-tight mr-1">dev server</span>
            </div>
            <span className="text-[8px] font-semibold bg-white/10 text-white/35 px-1.5 py-[1px] rounded uppercase tracking-wider">
              beta
            </span>
          </div>
          <nav className="flex h-full items-stretch gap-1">
            {sidebar.map((section, i) => (
              <a
                key={i}
                href={section.firstHref}
                className={`flex items-center px-3 text-[13px] font-medium no-underline border-b-2 transition-colors duration-150 ${
                  section.dir === activeSectionDir
                    ? 'border-[#018ef5] text-white'
                    : 'border-transparent text-white/40 hover:text-white/70'
                }`}
              >
                {section.title}
              </a>
            ))}
          </nav>
        </header>

        <div className="flex pt-[48px] min-h-screen">
          {/* Sidebar */}
          <aside className="w-[300px] fixed top-[48px] left-0 bottom-0 bg-white rounded-tl-xl border-r border-gray-200 overflow-y-auto py-4 pl-5">
            {sidebar
              .filter(s => s.dir === activeSectionDir)
              .map((section, i) => (
                <SidebarItems key={i} items={section.children} activePath={pathname} />
              ))}
          </aside>

          {/* Content */}
          <main className="ml-[300px] flex-1 min-w-0 bg-white rounded-tr-xl">
            <div className="max-w-[820px] py-10 px-16">
              {children}
            </div>
          </main>
        </div>

        <style dangerouslySetInnerHTML={{ __html: `
          [data-sidebar-group][data-expanded="false"] .sidebar-children { display: none; }
          [data-sidebar-group][data-expanded="true"] .sidebar-children { display: block; }
          [data-sidebar-group][data-expanded="true"] .sidebar-chevron { transform: rotate(90deg); }
        `}} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var es=new EventSource('/__reload');es.onmessage=function(e){if(e.data==='reload')location.reload()};})();
document.addEventListener('click',function(e){var t=e.target.closest('[data-sidebar-toggle]');if(!t)return;var g=t.closest('[data-sidebar-group]');if(!g)return;if(t.getAttribute('href')==='#'){e.preventDefault();}var ex=g.getAttribute('data-expanded')==='true';g.setAttribute('data-expanded',ex?'false':'true');});`,
          }}
        />
      </body>
    </html>
  );
}
