import type { ReactNode } from "react";

import { Navbar } from "@/components/layout/navbar";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
