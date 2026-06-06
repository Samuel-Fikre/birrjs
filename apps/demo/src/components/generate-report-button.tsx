"use client";

import { Button } from "@demo/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { generateReport } from "@/app/account/action";

export function GenerateReportButton({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();

  return (
    <Button
      onClick={async () => {
        const result = await generateReport();
        queryClient.invalidateQueries({ queryKey: ["entitlement", customerId] });
        if (result.success) {
          toast.success("Report generated — 100 API calls used");
        } else {
          toast.error(result.error ?? "Failed");
        }
      }}
    >
      Generate Report (100 calls)
    </Button>
  );
}
