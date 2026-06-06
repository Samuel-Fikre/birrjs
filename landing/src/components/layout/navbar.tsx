"use client";

import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { Github } from "lucide-react";
import Link from "next/link";

import { BirrjsLogo } from "@/components/icons/birrjs-logo";
import { BrandAssetsMenu } from "@/components/ui/brand-assets-menu";
import { URLs } from "@/lib/consts";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="48 68 305 250" fill="none"><path d="M218.066 70.215L89.844 70.314V122.849V175.383L70.41 175.485L50.977 175.586L50.876 196.582L50.774 217.578H70.309H89.844V266.406V315.234H108.906C123.212 315.234 128.086 315.117 128.437 314.766C128.799 314.404 128.906 295.055 128.906 230.051C128.906 136.124 128.717 142.663 131.665 134.843C132.531 132.545 133.287 130.437 133.344 130.16C133.402 129.883 134.182 128.564 135.079 127.23C150.921 103.655 187.472 108.259 197.254 135.061C199.735 141.858 199.592 136.157 199.619 229.887L199.643 315.234H275.4H351.157L351.262 296.293C351.354 279.778 351.292 277.314 350.781 277.055C350.459 276.892 324.971 276.67 294.141 276.563L238.086 276.367L238.189 194.363C238.245 149.261 238.36 112.291 238.443 112.208C238.527 112.124 263.222 112.024 293.321 111.985L348.046 111.914V90.918V69.922L347.168 70.019C346.685 70.072 288.589 70.16 218.066 70.215Z" fill="currentColor"/></svg>`;

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 flex h-16 items-center border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4">
        <BrandAssetsMenu logoSVG={LOGO_SVG}>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xl font-semibold text-foreground"
          >
            <BirrjsLogo className="w-auto h-4.5" />
            <span className="text-2xl">BirrJS</span>
          </Link>
        </BrandAssetsMenu>

        <nav className="flex items-center gap-8">
          <Link
            href="/docs"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Docs
          </Link>
          <a
            href={URLs.githubRepo}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Github Repo"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Github className="size-4.5" aria-hidden="true" />
          </a>
          <ThemeSwitch />
        </nav>
      </div>
    </header>
  );
}
