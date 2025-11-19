import React from "react";
import LiquidGlassButton from "../components/LiquidGlassButton";
import "../styles/liquidGlass.css";

const Home: React.FC = () => {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "30px",
      }}
    >
      <LiquidGlassButton to="/dex">My DEX</LiquidGlassButton>
      <LiquidGlassButton to="/generator">Generator</LiquidGlassButton>
    </div>
  );
};

export default Home;
