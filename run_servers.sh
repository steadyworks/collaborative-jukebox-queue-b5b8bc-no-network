#!/bin/bash
set -e

cd /app/backend
pip install -r requirements.txt
python3 main.py &

cd /app/frontend
npm install
npm run build && npx next start --port 3000 --hostname 0.0.0.0 &
