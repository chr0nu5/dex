import React, { useState, useCallback, useEffect } from "react";
import {
  message,
  Progress,
  Card,
  List,
  Typography,
  Button,
  Popconfirm,
} from "antd";
import {
  FileTextOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleDeleteFile = async (fileId: string, fileName: string) => {
    try {
      await apiClient.deleteFile(userId, fileId);
      message.success(`File "${fileName}" deleted successfully`);
      loadUserFiles();
    } catch (error: any) {
      message.error(`Failed to delete file: ${error.message}`);
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
            color: "#e0e0e0",
            fontSize: "20px",
            fontWeight: "400",
            textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
            width: "100%",
          }}
        >
          {uploading ? (
            <>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "600",
                  marginBottom: "20px",
                  color: "#ffffff",
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
                  "0%": "#5555ff",
                  "100%": "#8a2be2",
                }}
                style={{ marginBottom: "10px" }}
              />
              <div style={{ fontSize: "16px", color: "#b0b0c0" }}>
                {progress?.current} / {progress?.total}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#ffffff",
                }}
              >
                {isDragOver ? "Drop it here!" : "Drop your JSON here"}
              </div>
              <div style={{ fontSize: "16px", color: "#b0b0c0" }}>
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
              color: "#ffffff",
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
                  padding: "12px 0",
                  transition: "background 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(85, 85, 255, 0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    flex: 1,
                    cursor: file.enriched ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
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
                          color: "#e0e0e0",
                        }}
                      />
                    }
                    title={
                      <Text
                        style={{
                          color: "#ffffff",
                          fontSize: "16px",
                          fontWeight: "500",
                        }}
                      >
                        {file.user && file.date
                          ? (() => {
                              const date = new Date(file.date);
                              const formattedDate = date.toLocaleDateString(
                                "pt-BR",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                }
                              );
                              return `${file.user} • ${formattedDate}`;
                            })()
                          : file.filename.replace(".json", "")}
                      </Text>
                    }
                  />
                </div>
                <div
                  style={{ display: "flex", gap: "12px", alignItems: "center" }}
                >
                  {file.enriched && (
                    <CheckCircleOutlined
                      style={{
                        fontSize: "20px",
                        color: "#52c41a",
                      }}
                    />
                  )}
                  <Popconfirm
                    title="Delete file"
                    description={`Are you sure you want to delete "${file.filename}"?`}
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDeleteFile(file.id, file.filename);
                    }}
                    okText="Yes"
                    cancelText="No"
                    okButtonProps={{
                      danger: true,
                      style: {
                        background: "#ff4d4f",
                        borderColor: "#ff4d4f",
                      },
                    }}
                  >
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        color: "#ff4d4f",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "rgba(255, 77, 79, 0.1)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    />
                  </Popconfirm>
                </div>
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
};

export default DexPage;
