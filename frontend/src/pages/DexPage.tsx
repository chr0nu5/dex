import React, { useState, useCallback, useEffect } from "react";
import { message, Progress, Card, List, Typography } from "antd";
import { FileTextOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../utils/api";
import { getUserId } from "../utils/userId";
import "../styles/liquidGlass.css";

const { Title, Text } = Typography;

interface UploadedFile {
  id: string;
  filename: string;
  user: string | null;
  date: string | null;
  upload_date: string;
  size: number;
  enriched: boolean;
}

interface ProgressData {
  current: number;
  total: number;
  status: string;
}

const DexPage: React.FC = () => {
  const navigate = useNavigate();
  const [isDragOver, setIsDragOver] = useState(false);
  const [snorlaxOpen, setSnorlaxOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [userFiles, setUserFiles] = useState<UploadedFile[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const userId = getUserId();

  // Load user files on mount
  useEffect(() => {
    loadUserFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll progress during upload
  useEffect(() => {
    if (!currentFileId || !uploading) return;

    const interval = setInterval(async () => {
      try {
        const prog = await apiClient.getProgress(currentFileId);
        setProgress(prog);

        if (prog.status === "completed") {
          setUploading(false);
          setCurrentFileId(null);
          loadUserFiles();
          message.success("File enriched successfully!");
        }
      } catch (error) {
        console.error("Error polling progress:", error);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [currentFileId, uploading]);

  const loadUserFiles = async () => {
    try {
      const response = await apiClient.getUserFiles(userId);
      setUserFiles(response.files || []);
    } catch (error) {
      console.error("Error loading files:", error);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
    setSnorlaxOpen(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setSnorlaxOpen(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      setSnorlaxOpen(false);

      const files = e.dataTransfer.files;
      if (files.length === 0) {
        message.error("No file was dropped!");
        return;
      }

      const file = files[0];
      if (!file.name.endsWith(".json")) {
        message.error("Please upload a JSON file!");
        return;
      }

      await uploadFile(file);
    },
    [userId]
  );

  const uploadFile = async (file: File) => {
    try {
      setUploading(true);
      setProgress({ current: 0, total: 100, status: "uploading" });

      const response = await apiClient.uploadFile("/api/upload", file, {
        user_id: userId,
      });

      message.success(`Uploaded: ${response.filename}`);
      setCurrentFileId(response.file_id);
      setProgress({
        current: 0,
        total: response.total_pokemon,
        status: "processing",
      });
    } catch (error: any) {
      message.error(`Upload failed: ${error.message}`);
      setUploading(false);
      setProgress(null);
    }
  };

  const progressPercent = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
        gap: "40px",
      }}
    >
      {/* Upload Area */}
      <div
        className={`liquid-glass-dropzone ${isDragOver ? "drag-over" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          width: "600px",
          minHeight: "400px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
          textAlign: "center",
        }}
      >
        <img
          src={snorlaxOpen ? "/img/open.png" : "/img/closed.png"}
          alt="Snorlax"
          style={{
            width: "200px",
            height: "auto",
            marginBottom: "30px",
            transition: "all 0.3s ease",
            filter: "drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5))",
          }}
        />

        <div
          style={{
            color: "rgba(255, 255, 255, 0.95)",
            fontSize: "20px",
            fontWeight: "400",
            textShadow: "0 2px 4px rgba(0, 0, 0, 0.5)",
            width: "100%",
          }}
        >
          {uploading ? (
            <>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "500",
                  marginBottom: "20px",
                }}
              >
                {progress?.status === "uploading"
                  ? "Uploading..."
                  : "Enriching Pokémon..."}
              </div>
              <Progress
                percent={progressPercent}
                status="active"
                strokeColor={{
                  "0%": "#667eea",
                  "100%": "#764ba2",
                }}
                style={{ marginBottom: "10px" }}
              />
              <div style={{ fontSize: "16px", opacity: 0.8 }}>
                {progress?.current} / {progress?.total}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "500",
                  marginBottom: "10px",
                }}
              >
                {isDragOver ? "Drop it here!" : "Drop your JSON here"}
              </div>
              <div style={{ fontSize: "16px", opacity: 0.8 }}>
                Snorlax is waiting...
              </div>
            </>
          )}
        </div>
      </div>

      {/* User Files List */}
      {userFiles.length > 0 && (
        <Card
          className="liquid-glass-card"
          style={{
            width: "600px",
            maxHeight: "400px",
            overflow: "auto",
          }}
          bodyStyle={{ padding: "20px" }}
        >
          <Title
            level={4}
            style={{
              color: "rgba(255, 255, 255, 0.95)",
              marginBottom: "16px",
              textAlign: "center",
            }}
          >
            Your Uploaded Files
          </Title>
          <List
            dataSource={userFiles}
            renderItem={(file) => (
              <List.Item
                style={{
                  borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                  padding: "12px 0",
                  cursor: file.enriched ? "pointer" : "default",
                }}
                onClick={() => {
                  if (file.enriched) {
                    navigate(`/dex/${file.id}`);
                  }
                }}
              >
                <List.Item.Meta
                  avatar={
                    <FileTextOutlined
                      style={{
                        fontSize: "24px",
                        color: "rgba(255, 255, 255, 0.9)",
                      }}
                    />
                  }
                  title={
                    <Text
                      style={{
                        color: "rgba(255, 255, 255, 0.95)",
                        fontSize: "16px",
                      }}
                    >
                      {file.filename}
                    </Text>
                  }
                  description={
                    <Text
                      style={{
                        color: "rgba(255, 255, 255, 0.7)",
                        fontSize: "14px",
                      }}
                    >
                      {file.user && `User: ${file.user} • `}
                      {new Date(file.upload_date).toLocaleDateString()}
                    </Text>
                  }
                />
                {file.enriched && (
                  <CheckCircleOutlined
                    style={{
                      fontSize: "20px",
                      color: "#52c41a",
                    }}
                  />
                )}
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
};

export default DexPage;
