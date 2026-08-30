import { CashLedger } from "@/components/CashLedger";

export default function BankPage() {
  return (
    <CashLedger
      accountType="bank"
      // The owner sits here so repaying them is a transfer from a bank rather
      // than an outflow here plus a matching entry somewhere else.
      alsoShow={["owner"]}
      title="Bank"
      description="Inflow and outflow across your bank accounts and the owner"
      showAccountFilter
    />
  );
}
