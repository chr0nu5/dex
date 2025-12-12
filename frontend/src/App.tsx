import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ConfigProvider } from "antd";
import Home from "./pages/Home";
import DexPage from "./pages/DexPage";
import GeneratorPage from "./pages/GeneratorPage";
import DexViewer from "./pages/DexViewer";
import LoadingOverlay from "./components/LoadingOverlay";
import "./App.css";

const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#1890ff",
          fontFamily: "'Roboto', sans-serif",
        },
      }}
    >
      <Router>
        <div className="App">
          <LoadingOverlay />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dex" element={<DexPage />} />
            <Route path="/dex/:fileId" element={<DexViewer />} />
            <Route path="/generator" element={<GeneratorPage />} />
          </Routes>
        </div>
      </Router>
    </ConfigProvider>
  );
};

export default App;
