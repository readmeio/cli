'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function SidebarIcon({ icon }) {
  if (!icon) {
    return <span className="w-5 shrink-0" />;
  }

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
    return <i className={`${cls} text-[14px] w-5 text-left shrink-0 opacity-40 mt-[4px]`} />;
  }

  return <span className="text-[14px] w-5 text-center shrink-0 leading-none mt-[4px]">{icon}</span>;
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

        if (hasChildren) {
          return (
            <li key={i} data-sidebar-group data-expanded={isExpanded ? 'true' : 'false'}>
              <Link
                href={item.href || '#'}
                data-sidebar-toggle
                className={[
                  'flex items-start gap-2 py-[5px] pr-3 mr-3 text-[15px] no-underline transition-colors duration-150 rounded-lg',
                  depth === 0 ? 'pl-3' : depth === 1 ? 'pl-6' : 'pl-9',
                  isActive
                    ? 'text-[#018ef5] bg-[#018ef5]/[0.07] font-medium'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/60',
                ].join(' ')}
              >
                <SidebarIcon icon={item.icon} />
                <span className="flex-1">{item.title}</span>
                <i className="fa-solid fa-chevron-right text-[9px] text-gray-300 transition-transform duration-200 sidebar-chevron mt-[7px]" />
              </Link>
              <div className="sidebar-children overflow-hidden">
                <SidebarItems items={item.children} depth={depth + 1} activePath={activePath} />
              </div>
            </li>
          );
        }

        return (
          <li key={i}>
            <Link
              href={item.href}
              className={[
                'flex items-start gap-2 py-[5px] pr-3 mr-3 text-[15px] no-underline transition-colors duration-150 rounded-lg',
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
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ sidebar }) {
  const pathname = usePathname();
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  const activeSectionDir = sidebar.find(s => s.dir === firstSegment)?.dir || sidebar[0]?.dir;

  return (
    <>
      <nav className="flex h-full items-stretch gap-1">
        {sidebar.map((section, i) => (
          <Link
            key={i}
            href={section.firstHref}
            className={`flex items-center px-3 text-[13px] font-medium no-underline border-b-2 transition-colors duration-150 ${
              section.dir === activeSectionDir
                ? 'border-[#018ef5] text-white'
                : 'border-transparent text-white/40 hover:text-white/70'
            }`}
          >
            {section.title}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function SidebarPanel({ sidebar }) {
  const pathname = usePathname();
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  const activeSectionDir = sidebar.find(s => s.dir === firstSegment)?.dir || sidebar[0]?.dir;

  return (
    <>
      {sidebar
        .filter(s => s.dir === activeSectionDir)
        .map((section, i) => (
          <SidebarItems key={i} items={section.children} activePath={pathname} />
        ))}
    </>
  );
}
