import React, { ReactNode, useEffect, useState } from "react";
import { branding } from "../../lib/branding";

const panelFeatures = [
  {
    title: "Jitsu Functions",
    href: "https://jitsu.com/features/functions",
    description: "Transform, enrich, and route events in-flight with TypeScript — call APIs, persist state.",
  },
  {
    title: "Real-time streaming",
    href: "https://jitsu.com/features/event-streaming",
    description: "Land events in your warehouse the moment they happen.",
  },
  {
    title: "Drop-in for Segment",
    href: "https://jitsu.com/features/segment-compatibility",
    description: "Same SDK shape — keep your existing instrumentation.",
  },
];

const customers: { name: string; href?: string }[] = [
  { name: "Investing.com", href: "https://jitsu.com/customers/investing" },
  { name: "PandaDoc" },
  { name: "Rarible" },
  { name: "Census" },
  { name: "Embeddables" },
];

const snippets = [
  {
    file: "enrich.ts",
    badge: "JITSU FUNCTION",
    code: `export default async function (event, { store }) {
  const geo = await store.get(event.ip);
  event.country = geo?.country ?? "unknown";
  return event;
}`,
  },
  {
    file: "track.ts",
    badge: "BROWSER SDK",
    code: `import { jitsuAnalytics } from "@jitsu/js";

const jitsu = jitsuAnalytics({ writeKey: "KEY" });
jitsu.identify("user_42", { email });
jitsu.track("Signup Completed", { plan: "pro" });`,
  },
];

// Tiny token highlighter for the (fixed, trusted) code samples — keeps the
// snippets as plain strings instead of hand-written colored JSX.
const CODE_TOKEN =
  /(`[^`]*`|"[^"]*"|'[^']*'|\b(?:import|from|export|default|async|function|const|await|return|new)\b)/g;
const KEYWORD = /^(?:import|from|export|default|async|function|const|await|return|new)$/;

function highlightLine(line: string): ReactNode {
  if (line === "") {
    return " ";
  }
  return line.split(CODE_TOKEN).map((part, i) => {
    if (!part) {
      return null;
    }
    if (part[0] === "`" || part[0] === '"' || part[0] === "'") {
      return (
        <span key={i} className="text-[#c3e88d]">
          {part}
        </span>
      );
    }
    if (KEYWORD.test(part)) {
      return (
        <span key={i} className="text-[#c792ea]">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Code card that auto-cycles through the snippets like switching tabs. */
const CodeShowcase: React.FC = () => {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive(a => (a + 1) % snippets.length), 4500);
    return () => clearInterval(t);
  }, []);
  const snippet = snippets[active];
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: "#0e0d18" }}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          {snippets.map((s, i) => (
            <span key={s.file} className={i === active ? "text-white" : "text-white/30"}>
              {s.file}
            </span>
          ))}
        </div>
        <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] tracking-[0.15em] text-white/40">
          {snippet.badge}
        </span>
      </div>
      <div className="whitespace-pre overflow-x-auto p-4 font-mono text-[12px] leading-[1.7] text-slate-200">
        {snippet.code.split("\n").map((line, i) => (
          <div key={i}>{highlightLine(line)}</div>
        ))}
      </div>
    </div>
  );
};

/** Left-hand testimonial / proof panel of the signup page. Hidden below `lg`. */
export const SignupMarketingPanel: React.FC = () => (
  <div
    className="hidden lg:flex lg:w-1/2 p-10 xl:p-14 text-white overflow-y-auto"
    style={{ background: "linear-gradient(155deg, #1c1640 0%, #2a1b53 55%, #211a48 100%)" }}
  >
    {/* one column — every section shares the same width */}
    <div className="flex w-full max-w-2xl flex-col justify-between gap-9">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7">{branding.logo}</div>
          <span className="text-xl font-bold tracking-tight">jitsu</span>
        </div>
        <a
          href="https://jitsu.com"
          className="text-sm text-white/55 hover:text-white hover:underline transition-colors"
        >
          ‹ Back to jitsu.com
        </a>
      </div>

      {/* testimonial */}
      <div>
        <div className="font-serif text-[80px] leading-[0.6] text-white/25">“</div>
        <p className="mt-5 text-2xl xl:text-3xl font-medium leading-snug">
          Jitsu Functions let us enrich events server-side with external APIs and a persistent KV store —{" "}
          <span className="text-white/45">killing the client-side code duplication across web, iOS, and Android.</span>
        </p>
        <div className="mt-8 flex items-center justify-between">
          <a
            href="https://jitsu.com/customers/investing"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 hover:underline"
          >
            <div
              className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-semibold"
              style={{ background: "linear-gradient(135deg, #a855f7, #7c3aed)" }}
            >
              YA
            </div>
            <div>
              <div className="font-semibold">Yonatan Adest</div>
              <div className="text-sm text-white/55">CTO · Investing.com</div>
            </div>
          </a>
          <div className="text-right">
            <div className="text-3xl font-bold leading-none">5B</div>
            <div className="mt-1 text-[10px] tracking-[0.2em] text-white/50">EVENTS / MONTH</div>
          </div>
        </div>
      </div>

      {/* code showcase */}
      <CodeShowcase />

      {/* features */}
      <div className="grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
        {panelFeatures.map(f => (
          <div key={f.title}>
            <a
              href={f.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-semibold hover:underline"
            >
              <span className="text-[#c3e88d]">✓</span>
              {f.title}
            </a>
            <p className="mt-1.5 text-sm text-white/55">{f.description}</p>
          </div>
        ))}
      </div>

      {/* social proof */}
      <div className="border-t border-white/10 pt-6">
        <a
          href="https://jitsu.com/customers"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] tracking-[0.18em] text-white/40 hover:underline"
        >
          IN PRODUCTION AT
        </a>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-white/80">
          {customers.map((c, i) => (
            <React.Fragment key={c.name}>
              {i > 0 && <span className="text-white/25">·</span>}
              {c.href ? (
                <a href={c.href} target="_blank" rel="noreferrer" className="hover:underline">
                  {c.name}
                </a>
              ) : (
                <span>{c.name}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  </div>
);
