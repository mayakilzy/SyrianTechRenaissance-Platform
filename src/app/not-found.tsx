import Link from "next/link";

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>404 — Page not found</h1>
        <p>The requested path does not match a valid locale.</p>
        <p>
          <a href="/" style={{ color: "blue" }}>→ Go to STR home (Arabic)</a>
        </p>
        <p>
          <a href="/en" style={{ color: "blue" }}>→ Go to STR home (English)</a>
        </p>
      </body>
    </html>
  );
}
