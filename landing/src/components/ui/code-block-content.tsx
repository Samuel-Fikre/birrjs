import { highlight } from "fumadocs-core/highlight";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export async function CodeBlockContent({ lang, code }: { lang: string; code: string }) {
  return highlight(code, {
    lang,
    themes: {
      light: "github-light",
      dark: "vitesse-dark",
    },
    defaultColor: false,
    components: {
      pre: (props: ComponentProps<"pre">) => (
        <pre
          {...props}
          data-line-numbers="true"
          style={{ ...props.style, counterSet: "line 0" } as React.CSSProperties}
          className={cn(props.className, "p-4 text-sm leading-relaxed")}
        >
          {props.children}
        </pre>
      ),
    },
  });
}
