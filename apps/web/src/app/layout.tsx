import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Momentum | AI receptionist for aesthetic clinics",
  description: "Turn WhatsApp conversations into confirmed appointments with Momentum."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
