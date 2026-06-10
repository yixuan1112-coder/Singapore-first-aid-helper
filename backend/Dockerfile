FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# The CSOT bridge: identity + MQTT<->Redis mirror + presence.
CMD ["python", "bridge.py"]
