import React, { useMemo } from "react";
import { useParams } from "react-router-dom";
import Pokemon3DViewer from "../components/Pokemon3DViewer";

const VIEWPORT_W = 512;
const VIEWPORT_H = 512;

const pad4 = (n: number): string => String(Math.max(0, n)).padStart(4, "0");

const Render3DPage: React.FC = () => {
  const params = useParams();
  const pokemonId = useMemo(() => {
    const raw = (params as any)?.id;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  }, [params]);

  const title = useMemo(() => {
    const pm = `pm${pad4(pokemonId)}`;
    return `/render/3d/${pokemonId} (${pm})`;
  }, [pokemonId]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 12, fontWeight: 600 }}>{title}</div>

      <Pokemon3DViewer
        pokemonId={pokemonId}
        width={VIEWPORT_W}
        height={VIEWPORT_H}
        showError
      />
    </div>
  );
};

export default Render3DPage;
