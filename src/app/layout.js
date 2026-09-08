import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import RegistrarServiceWorker from '@/components/RegistrarServiceWorker';
import './globals.css';

export const metadata = {
  title: 'Ábaco',
  description: 'Gestión financiera personal, inteligente y segura',
};

export const viewport = {
  themeColor: '#10B981',
};

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-plex-mono',
});

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <RegistrarServiceWorker />
        {children}
      </body>
    </html>
  );
}