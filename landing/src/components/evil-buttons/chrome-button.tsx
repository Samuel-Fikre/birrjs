import type { ReactNode } from "react";

import { LiquidChrome } from "@/components/evil-buttons/LiquidChrome/LiquidChrome";

type ChromeButtonProps = {
  children: ReactNode;
  href?: string;
};

export function ChromeButton({ children, href }: ChromeButtonProps) {
  const classes =
    "relative inline-flex overflow-hidden rounded-full border-2 border-neutral-900 bg-neutral-950 px-5 py-2.5 text-white shadow-lg transition-all duration-75 active:scale-95 group";

  const content = (
    <>
      <div className="absolute inset-0 z-0 opacity-80 transition-opacity duration-500 group-hover:opacity-100">
        <LiquidChrome
          baseColor={[0.0392156862745098, 0.0392156862745098, 0.0392156862745098]}
          speed={2}
          amplitude={0.1}
          interactive={false}
        />
      </div>
      <span className="relative z-10 mix-blend-difference">{children}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={classes}>
      {content}
    </button>
  );
}
