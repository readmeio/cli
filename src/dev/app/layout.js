import { collectSidebar } from '../lib/docs';
import { SidebarNav, SidebarPanel } from './Sidebar';
import '@readme/markdown/dist/main.css';
import './globals.css';

export const metadata = {
  title: 'Dev Preview',
};

export default async function RootLayout({ children }) {
  const sidebar = collectSidebar();

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
          <SidebarNav sidebar={sidebar} />
        </header>

        <div className="flex pt-[48px] min-h-screen">
          {/* Sidebar */}
          <aside className="w-[300px] fixed top-[48px] left-0 bottom-0 bg-white rounded-tl-xl border-r border-gray-200 overflow-y-auto py-4 pl-5">
            <SidebarPanel sidebar={sidebar} />
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
