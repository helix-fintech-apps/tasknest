import type { ReactNode } from "react";
import { Dialog } from "../ui/Dialog";

/** The phone menu for public pages: a right-hand sheet built on the modal dialog (focus trap, Esc, inert). */
export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Dialog title="Menu" onClose={onClose} placement="right" testId="drawer">
      {children}
    </Dialog>
  );
}
