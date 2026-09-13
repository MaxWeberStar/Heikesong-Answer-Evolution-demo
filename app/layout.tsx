import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "答案演进论",
  description: "知乎问答观点的时间演进与溯源分析",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          @media (max-width: 820px){ .ae-split{ grid-template-columns: 1fr !important; } }
        ` }} />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
          background: "#f6f7f9",
          color: "#1a1c1f",
        }}
      >
        {children}
      </body>
    </html>
  );
}
