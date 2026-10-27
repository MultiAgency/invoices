import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

function Host() {
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted: { unmount: () => void } | undefined, gone = false;
    import("invoices/Invoices").then(({ mount }) => mount(slot.current!, { apiBase: "/invoices-api" }))
      .then(m => { if (gone) m.unmount(); else mounted = m; }, e => setError(String(e)));
    return () => { gone = true; mounted?.unmount(); };
  }, []);
  return <div><h1 id="host-title">Test host</h1>{error && <p id="host-error">{error}</p>}<div id="invoices-slot" ref={slot} /></div>;
}
createRoot(document.getElementById("root")!).render(<Host />);
