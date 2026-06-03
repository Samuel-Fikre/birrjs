import { Github, MessageCircle } from "lucide-react";
import Link from "next/link";

import { URLs } from "@/lib/consts";

const navLinks = [
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: URLs.githubRepo, external: true },
  { label: "Telegram", href: "https://t.me/birrjs", external: true },
];

const socialLinks = [
  { label: "Telegram", href: "https://t.me/birrjs", icon: <MessageCircle className="size-4" /> },
  { label: "GitHub", href: URLs.githubRepo, icon: <Github className="size-4" /> },
];

export function FooterSection() {
  return (
    <section className="mx-auto w-full max-w-[76rem] px-5 sm:px-8">
      <div className="flex flex-col items-center gap-4 border-t border-foreground/[0.08] py-8 sm:flex-row sm:justify-between">
        <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1.5 sm:justify-start">
          {navLinks.map((link, i) => (
            <span key={link.label} className="flex items-center">
              <Link
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className="font-mono text-xs text-foreground/45 transition-colors hover:text-foreground/70"
              >
                {link.label}
              </Link>
              {i < navLinks.length - 1 && (
                <span className="mx-2 select-none text-xs text-foreground/15">/</span>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {socialLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
              className="text-foreground/30 transition-colors hover:text-foreground/60"
            >
              {link.icon}
            </Link>
          ))}
          <span className="select-none text-foreground/15">·</span>
          <span className="font-mono text-xs text-foreground/45 dark:text-foreground/30">
            &copy; {new Date().getFullYear()} BirrJS
          </span>
        </div>
      </div>
    </section>
  );
}
