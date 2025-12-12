import { loadingTracker } from "./loading";

// When served by Flask backend, use relative URLs. In dev mode, proxy handles it.
const API_URL =
  process.env.NODE_ENV === "development" ? "http://localhost:5001" : "";

const trackedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  loadingTracker.start();
  try {
    return await fetch(input, init);
  } finally {
    loadingTracker.stop();
  }
};

export const apiClient = {
  async get(endpoint: string) {
    const response = await trackedFetch(`${API_URL}${endpoint}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  async post(endpoint: string, data?: any) {
    const response = await trackedFetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  async uploadFile(
    endpoint: string,
    file: File,
    additionalData?: Record<string, string>
  ) {
    const formData = new FormData();
    formData.append("file", file);

    // Add additional form data if provided
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const response = await trackedFetch(`${API_URL}${endpoint}`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  async getUserFiles(userId: string) {
    return this.get(`/api/files/${userId}`);
  },

  async getProgress(fileId: string) {
    return this.get(`/api/progress/${fileId}`);
  },

  async getPvpCategories() {
    return this.get(`/api/pvp/categories`);
  },

  async getFileData(
    userId: string,
    fileId: string,
    params?: {
      search?: string;
      order_by?: string;
      order_dir?: string;
      unique?: boolean;
      pvp?: boolean;
      best_teams?: boolean;
      league?: "GL" | "UL" | "ML";
      category?: string;
    }
  ) {
    let endpoint = `/api/file/${userId}/${fileId}`;
    if (params) {
      const queryParams = new URLSearchParams();
      if (params.search) queryParams.append("search", params.search);
      if (params.order_by) queryParams.append("order_by", params.order_by);
      if (params.order_dir) queryParams.append("order_dir", params.order_dir);
      if (params.unique !== undefined)
        queryParams.append("unique", params.unique.toString());
      if (params.pvp !== undefined)
        queryParams.append("pvp", params.pvp.toString());
      if (params.best_teams !== undefined)
        queryParams.append("best_teams", params.best_teams.toString());
      if (params.league) queryParams.append("league", params.league);
      if (params.category) queryParams.append("category", params.category);
      const queryString = queryParams.toString();
      if (queryString) endpoint += `?${queryString}`;
    }
    return this.get(endpoint);
  },

  async getPublicFileData(
    fileId: string,
    params?: {
      search?: string;
      order_by?: string;
      order_dir?: string;
      unique?: boolean;
      pvp?: boolean;
      best_teams?: boolean;
      league?: "GL" | "UL" | "ML";
      category?: string;
    }
  ) {
    let endpoint = `/api/public/file/${fileId}`;
    if (params) {
      const queryParams = new URLSearchParams();
      if (params.search) queryParams.append("search", params.search);
      if (params.order_by) queryParams.append("order_by", params.order_by);
      if (params.order_dir) queryParams.append("order_dir", params.order_dir);
      if (params.unique !== undefined)
        queryParams.append("unique", params.unique.toString());
      if (params.pvp !== undefined)
        queryParams.append("pvp", params.pvp.toString());
      if (params.best_teams !== undefined)
        queryParams.append("best_teams", params.best_teams.toString());
      if (params.league) queryParams.append("league", params.league);
      if (params.category) queryParams.append("category", params.category);
      const queryString = queryParams.toString();
      if (queryString) endpoint += `?${queryString}`;
    }
    return this.get(endpoint);
  },

  async deleteFile(userId: string, fileId: string) {
    const response = await trackedFetch(
      `${API_URL}/api/file/${userId}/${fileId}`,
      {
        method: "DELETE",
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },
};

export default API_URL;
