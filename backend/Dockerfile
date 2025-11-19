FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY . .

# Create necessary directories
RUN mkdir -p files data

EXPOSE 5000

CMD ["python", "app.py"]
