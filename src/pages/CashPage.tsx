import { CashLedger } from "@/components/CashLedger";

export default function CashPage() {
  return (
    <CashLedger
      accountType="petty_cash"
      title="Cash"
      description="Inflow and outflow across your cash accounts"
      showAccountFilter
    />
  );
}
