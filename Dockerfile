FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils openssl \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir PyMuPDF==1.26.6
WORKDIR /app
COPY inspect_pdf.py server.py ./
USER 65534:65534
EXPOSE 8080
CMD ["python", "server.py"]
