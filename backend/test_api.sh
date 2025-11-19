#!/bin/bash

echo "Testing Flask API endpoints..."
echo ""

echo "1. Health check:"
curl -s http://localhost:5000/api/health | python -m json.tool
echo ""

echo "2. List files for test user:"
curl -s http://localhost:5000/api/files/test-user-123 | python -m json.tool
echo ""

echo "Done!"
