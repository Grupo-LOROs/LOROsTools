import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { NavBar } from "./navbar";

export const metadata = {
  title: "LOROs Tools",
  description: "Portal de automatizaciones internas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>
          <div className="shell">
            <NavBar />
            <main className="main">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
