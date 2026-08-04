import { CashLedger } from "@/components/CashLedger";

export default function BankPage() {
  return (
    <CashLedger
      accountType="bank"
      title="Bank"
      description="Inflow and outflow across BDO, Chinabank, and BPI"
      showAccountFilter
    />
  );
}
