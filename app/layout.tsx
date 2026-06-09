import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "슬라이드 연수 ✨",
  description: "구글 슬라이드 · 캔바 실시간 연수 플랫폼",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="/css/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
