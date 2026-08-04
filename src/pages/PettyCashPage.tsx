import { CashLedger } from "@/components/CashLedger";

export default function PettyCashPage() {
  return (
    <CashLedger
      accountType="petty_cash"
      title="Petty Cash"
      description="Inflow and outflow of petty cash"
    />
  );
}
