import { useState } from "react";

export function useLocationSheet() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    openSheet: () => setIsOpen(true),
    closeSheet: () => setIsOpen(false),
  };
}
