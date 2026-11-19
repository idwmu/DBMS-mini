// =====================================================================
// layout.js: Root layout (server component)
// =====================================================================

import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { THEME_KEY } from '@/lib/theme';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { getSessionUser } from '@/lib/session';

export const metadata = {
  title: 'Workload Analyzer • Student Workload & Deadline Collision Intelligence',
  description: 'Detect student overload and deadline collisions before they happen.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%230066cc'/><circle cx='50' cy='50' r='38' fill='none' stroke='white' stroke-width='6'/><polyline points='50,26 50,50 68,50' fill='none' stroke='white' stroke-width='6' stroke-linecap='round'/></svg>"
  }
};

const themeScript = `try{var t=localStorage.getItem('${THEME_KEY}');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light')}catch(e){}`;

export default async function RootLayout({ children }) {
  const user = await getSessionUser();

  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider initialUser={user}>
            <div className="app-layout">
              <Navbar />
              <main className="main-content">{children}</main>
              <Footer />
            </div>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
