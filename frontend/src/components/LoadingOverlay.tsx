import React, { useEffect, useMemo, useState } from "react";
import { loadingTracker } from "../utils/loading";

const SHOW_DELAY_MS = 150;

const LoadingOverlay: React.FC = () => {
  const [pendingCount, setPendingCount] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return loadingTracker.subscribe(setPendingCount);
  }, []);

  useEffect(() => {
    if (pendingCount > 0) {
      const t = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      return () => window.clearTimeout(t);
    }
    setVisible(false);
  }, [pendingCount]);

  const style = useMemo<React.CSSProperties>(
    () => ({
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0.45)",
      backdropFilter: "blur(2px)",
    }),
    []
  );

  if (!visible) return null;

  return (
    <div style={style}>
      <img
        src="/loading.gif"
        alt="Loading"
        style={{ width: 120, height: 120 }}
      />
    </div>
  );
};

export default LoadingOverlay;
