import { useState } from "react";
import { Menu, X } from "lucide-react";

export default function MobileNavToggle({ navId }: { navId: string }) {
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    const nav = document.getElementById(navId);
    if (nav) nav.classList.toggle("nav-open", next);
  }

  return (
    <button className="menu-button" onClick={toggle} aria-label="Toggle navigation">
      {open ? <X /> : <Menu />}
    </button>
  );
}
