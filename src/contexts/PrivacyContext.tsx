import { createContext, useContext, useEffect, useState } from "react";
import { setAmountsHidden } from "@/lib/currency";

interface PrivacyValue {
  hidden: boolean;
  toggle: () => void;
}

const PrivacyContext = createContext<PrivacyValue>({ hidden: false, toggle: () => {} });

const STORAGE_KEY = "itshoppe.hideAmounts";

/**
 * Whether money is shown, for this browser.
 *
 * Kept per device rather than per account: it is about who can see the screen,
 * which changes with where you are, not with who you are. It is a screen
 * cover, not a permission — the figures are still fetched, and anyone who can
 * open the developer tools can still read them. Hiding data from a person who
 * should not have it is what roles are for.
 */
export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private windows and blocked site data throw rather than return null.
      return false;
    }
  });

  // Set during render, not in an effect: an effect runs after the paint, which
  // would flash every real figure on screen before blanking it.
  setAmountsHidden(hidden);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    } catch {
      /* not worth failing over */
    }
  }, [hidden]);

  return (
    <PrivacyContext.Provider value={{ hidden, toggle: () => setHidden((v) => !v) }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export const usePrivacy = () => useContext(PrivacyContext);
