import React from "react";
import { useNavigate } from "react-router-dom";
import "../styles/liquidGlass.css";

interface LiquidGlassButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  to?: string;
  style?: React.CSSProperties;
}

const LiquidGlassButton: React.FC<LiquidGlassButtonProps> = ({
  children,
  onClick,
  to,
  style,
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (to) {
      navigate(to);
    }
    if (onClick) {
      onClick();
    }
  };

  return (
    <button className="liquid-glass-button" onClick={handleClick} style={style}>
      {children}
    </button>
  );
};

export default LiquidGlassButton;
