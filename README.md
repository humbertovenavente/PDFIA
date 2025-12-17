# FilesToData v2.7 - AI Document & Design Processing

FilesToData is a document and design processing pipeline built on **C#/.NET 8, Azure Functions, and a lightweight static HTML/JavaScript frontend**.





## Architecture Overview

High‑level flow (current setup):

```text
┌───────────────────────────────────────────────┐
│           Static Frontend (HTML/JS)          │
│  - File upload (PDF / images)               │
│  - Job list & status (PENDING/COMPLETED)    │
│  - JSON result viewer & editor              │
└───────────────────────────────────────────────┘
                    │ HTTP (fetch)
                    ▼
┌───────────────────────────────────────────────┐
│      Azure Functions (python) │
│  HTTP triggers:                              │
│    - POST /api/jobs                          │
│    - GET  /api/jobs                          │
│    - GET  /api/jobs/{id}                     │
│    - PUT  /api/jobs/{id}/results             │
│    - GET  /api/health                        │
│  Queue triggers:                             │
│    - document-jobs → ProcessDocumentJob      │
│    - design-jobs   → ProcessDesignJob        │
└───────────────────────────────────────────────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
┌────────────────┐   ┌──────────────────────┐
│ In‑memory      │   │  OCR Service         │
│ storage (stub) │   │  - PDF text layer    │
│ SupabaseService│   │  - Image OCR (local) │
└────────────────┘   └──────────────────────┘
          │                   ▼
          │          ┌────────────────┐
          │          │ MaskingService │
          │          │  - Regex/heur. │
          │          └────────────────┘
          │                   ▼
          │          ┌────────────────┐
          │          │  AiService     │
          │          │  (stub JSON)   │
          │          └────────────────┘
```

---

## Technologies Used

### Backend

- **Language & Runtime**
  - C# / .NET 8
  - Azure Functions isolated worker (`dotnet-isolated`)

- **Azure Functions**
  - HTTP triggers for the public API (`JobFunctions`):
    - `POST /api/jobs?mode=DOCUMENT|DESIGN`
    - `GET  /api/jobs`
    - `GET  /api/jobs/{id}`
    - `PUT  /api/jobs/{id}/results`
    - `GET  /api/health`
  - Queue triggers for async processing (`QueueFunctions`):
    - `document-jobs` → document OCR + masking + AI
    - `design-jobs`   → design image analysis

- **Storage & Queues**
  - Azure Storage Queues (local dev via **Azurite**)
  - Connection via `AzureWebJobsStorage` (used by both Queue triggers and `QueueService`)
  - Queue names: `document-jobs`, `design-jobs` (+ poison queues managed by Functions)

- **SupabaseService (stub)**
  - `ISupabaseService` implemented as an **in‑memory** store:
    - Jobs (`CreateJobAsync`, `GetJobAsync`, `ListJobsAsync`, `UpdateJobStatusAsync`)
    - Results (`GetResultsAsync`, `UpsertResultsAsync`)
    - Masking logs (`CreateMaskingLogAsync`, `GetMaskingLogsAsync`)
    - File storage (`UploadFileAsync`, `DownloadFileAsync`, `GetFileUrlAsync`)
  - No real Postgres/Supabase is required in local development.

- **OCR Service** (`OcrService`)
  - Extracts PDF text layer when available.
  - Runs local OCR for images (e.g. embedded images in PDFs) when Tesseract is configured.
  - If OCR is not available, the service returns a placeholder string so jobs still complete.

- **Masking Service** (`MaskingService`)
  - Detects and masks sensitive data using regex/heuristics:
    - Emails, phone numbers, credit cards, bank accounts, IDs.
    - Names and company names (heuristics).
  - Returns:
    - Masked text.
    - A map of token → original value + type.
  - Can **unmask** structured JSON results using this map.

- **AI Service** (`AiService` – stub mode)
  - `ExtractDocumentDataAsync(maskedText)` and `AnalyzeDesignImageAsync(...)` are currently **stub implementations**.
  - They return simulated JSON objects (e.g. `"[EMISOR_STUB]"`, `"[RECEPTOR_STUB]"`) instead of calling a real model.
  - Intended to be replaced later with a real Claude/Opus or other model via HTTP API.

### Frontend

- **Static frontend (no Blazor)**
  - HTML/CSS/JavaScript only, located in `frontend/`:
    - `frontend/index.html`
    - `frontend/styles.css`
    - `frontend/app.js`
  - Replaces the previous Blazor WebAssembly client to avoid heavy WASM downloads and browser "Page Unresponsive" popups.

- **Functionality** (`app.js`)
  - Health check: `GET /api/health`.
  - Job list: `GET /api/jobs`.
  - Create job: `POST /api/jobs?mode=DOCUMENT|DESIGN` with `multipart/form-data` file upload.
  - Get job detail: `GET /api/jobs/{id}`.
  - Update job results: `PUT /api/jobs/{id}/results`.
  - Drag & drop + click‑to‑upload for files.
  - Sidebar with job list and statuses.
  - Detail view with JSON textarea and "Save" / "Refresh" actions.

### Tooling & Local Dev

- .NET 8 SDK
- Azure Functions Core Tools v4
- Node.js 18+
- Azurite (Azure Storage emulator)

---

## What Was Implemented in This Migration

- **Backend migration from Python to C#/.NET**
  - Reimplemented all HTTP and Queue triggers in `FilesToData.Api` using Azure Functions isolated worker.
  - Removed the old Python `backend/` and its HTTP/queue triggers and services.

- **New job API in C#** (`JobFunctions`)
  - `CreateJob`: parses multipart upload, stores the file via `SupabaseService`, creates a `Job` with status `PENDING`, and enqueues a message to the appropriate queue.
  - `ListJobs`, `GetJob`: expose job metadata and associated results.
  - `UpdateJobResults`: allows editing/saving the JSON result from the frontend.
  - `HealthCheck`: simple endpoint used by the frontend.

- **Async processing via queues** (`QueueFunctions`)
  - `ProcessDocumentJob`:
    - Reads `{ "job_id": ... }` messages from `document-jobs` (correctly mapped via `JsonPropertyName("job_id")`).
    - Loads the job from `SupabaseService` (in memory).
    - Downloads the stored file.
    - Runs OCR (PDF text layer + local image OCR when configured; otherwise placeholder text).
    - Masks sensitive data and logs masking events.
    - Calls `AiService` (stub) and then un‑masks the structured JSON.
    - Saves results and sets job status to `COMPLETED`.
    - Handles missing jobs gracefully (after host restarts) by logging a warning and skipping the message.
  - `ProcessDesignJob`:
    - Similar pattern for design images using `AiService.AnalyzeDesignImageAsync` (stub).

- **Queue and storage robustness improvements**
  - Unified all queue connections to `AzureWebJobsStorage` (used by both triggers and `QueueService`).
  - Fixed message schema mapping so that `job_id` correctly deserializes to `JobId` in `QueueMessage`.
  - Avoid unhandled exceptions when a job no longer exists in the in‑memory store (e.g. after Function host restarts).
  - Avoid unhandled exceptions on OCR HTTP errors by returning placeholder text.

- **In‑memory Supabase replacement**
  - Implemented `SupabaseService` as an in‑memory substitute for:
    - Job metadata.
    - Results JSON.
    - Masking logs.
    - File content.
  - Removes the need for a real Supabase/Postgres instance in local development.

- **Static frontend instead of Blazor**
  - Created a new static UI under `frontend/` with:
    - Sidebar job list.
    - Mode selector (DOCUMENT/DESIGN).
    - Drag‑and‑drop or click‑to‑upload area.
    - Job detail pane (status + JSON results + preview).
  - Frontend communicates directly with the Functions API (`http://localhost:7071/api`).
  - Eliminated the previous Blazor WebAssembly client to solve the "Page Unresponsive" issue.

---

## Project Structure (Current)

```text
prototype/
├── FilesToData.sln
├── src/
│   ├── FilesToData.Api/          # Azure Functions backend (C#)
│   │   ├── Functions/            # HTTP & Queue triggers
│   │   └── Services/             # SupabaseService (in‑memory), OCR, Masking, AI, Queue
│   ├── FilesToData.Shared/       # Shared C# models (Job, Results, MaskingLog, etc.)
│   │   └── Models/
│   └── FilesToData.Client/       # Legacy Blazor client (not required for current flow)
├── frontend/                     # New static HTML/JS frontend
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── database/
│   └── schema.sql                # Supabase/Postgres schema (optional for future real DB)
└── README.md
```

---

## Running Locally

### Prerequisites

- **Python 3.10+** (for the Python backend)
- **Azure Functions Core Tools v4**
- **Node.js 18+**
- **Azurite** (Azure Storage emulator, installed globally as `azurite`)
- **Tesseract OCR** (optional, for local image OCR)

### Python Backend Dependencies

The Python backend requires the following packages (see `src/FilesToData.ApiPy/requirements.txt`):

```
azure-functions>=1.17.0
azure-storage-queue>=12.9.0
pypdf>=4.0.0
requests>=2.31.0
PyMuPDF>=1.24.0
pytesseract>=0.3.10
Pillow>=10.0.0
opencv-python-headless>=4.8.0
numpy>=1.24.0
python-dotenv>=1.0.0
```

**Install dependencies:**

```powershell
cd C:\Users\<user>\Downloads\prototype\src\FilesToData.ApiPy
pip install -r requirements.txt
```

### Environment Variables

Copy `local.settings.example.json` to `local.settings.json` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_API_KEY` | **Yes** | API key for Claude AI (extraction) |
| `AZURE_DI_ENDPOINT` | Recommended | Azure Document Intelligence endpoint |
| `AZURE_DI_KEY` | Recommended | Azure Document Intelligence key |
| `TESSERACT_PATH` | Optional | Path to Tesseract executable (Windows) |

**Important:** Without `CLAUDE_API_KEY`, the AI extraction will fail. Without Azure DI credentials, OCR falls back to Tesseract or placeholder text.

### 1. Start Azurite (Storage emulator)

```powershell
cd C:\Users\<user>\Downloads\prototype
azurite
```

### 2. Start Azure Functions backend (Python)

```powershell
cd C:\Users\<user>\Downloads\prototype
func start --script-root .\src\FilesToData.ApiPy
```

The Functions host will listen on: `http://localhost:7071`.

### 3. Start the static frontend

```powershell
cd C:\Users\<user>\Downloads\prototype\frontend
npx serve .
```

Open the URL printed by `serve` (e.g. `http://localhost:3000`).

### Troubleshooting: Incomplete Data Extraction

If the system is not extracting all information:

1. **Check `CLAUDE_API_KEY`**: Must be set and valid
2. **Check `AZURE_DI_ENDPOINT` and `AZURE_DI_KEY`**: For better OCR quality
3. **Install Tesseract** (Windows): Download from https://github.com/UB-Mannheim/tesseract/wiki and set `TESSERACT_PATH`
4. **Check Python packages**: Run `pip install -r requirements.txt` to ensure all dependencies are installed
5. **Check console logs**: The Functions host shows detailed extraction progress

---

## API Endpoints

| Method | Route                                  | Description                         |
|--------|----------------------------------------|-------------------------------------|
| POST   | `/api/jobs?mode=DOCUMENT\|DESIGN`     | Create a new processing job         |
| GET    | `/api/jobs`                           | List jobs                           |
| GET    | `/api/jobs/{id}`                      | Get job details + results           |
| PUT    | `/api/jobs/{id}/results`              | Update job results JSON             |
| GET    | `/api/health`                         | Health check                        |

---

## Environment Variables (local.settings.json)

Key variables used by the current setup:

| Variable                | Description                                                  |
|-------------------------|--------------------------------------------------------------|
| `AzureWebJobsStorage`   | Azure Storage connection string (e.g. `UseDevelopmentStorage=true`) |
| `CLAUDE_API_KEY`        | (Planned) API key for a real AI model (e.g. Claude Opus)    |

If OCR tooling is not configured, OCR falls back to placeholder text.
If `CLAUDE_API_KEY` is not configured, `AiService` stays in stub mode.

---

## Processing Modes

### DOCUMENT

- Intended for invoices, purchase orders, receipts, etc.
- Flow:
  1. Upload PDF or image via frontend.
  2. `CreateJob` stores the file and enqueues a `document-jobs` message.
  3. `ProcessDocumentJob`:
     - Runs OCR (real or placeholder).
     - Masks sensitive data.
     - Calls AI stub to build a structured JSON.
     - Unmasks and saves the result.
  4. Frontend shows the JSON and lets the user edit/save it.

### DESIGN

- Intended for design images (e.g. garments with annotations) to suggest changes.
- Flow:
  1. Upload image via frontend with mode = DESIGN.
  2. `ProcessDesignJob` loads the image and calls `AiService.AnalyzeDesignImageAsync` (stub).
  3. Result JSON is stored and displayed in the frontend.

---

## Template System (v2.8)

The system now supports **multiple template types** for sewing worksheets and product specifications. When a PDF is uploaded, the system automatically detects the template type and extracts ALL data accordingly.

### Supported Template Types

| Template Type | Detection Patterns | Description |
|--------------|-------------------|-------------|
| `sewing_worksheet_jcrew` | "ORDEN DE TRABAJO DE COSTURA", "SEWING WORKSHEET" | Standard J.Crew 8-section format |
| `sewing_worksheet_korean` | "봉제 작업 지시서/Orden de Trabajo", "정작지" | Korean/Spanish hybrid style |
| `sewing_worksheet_target` | "TARGET MEN'S", "TARGET WOMEN'S" | Target brand format |
| `sewing_worksheet_express` | "EXPRESS FILE" | Express brand format |
| `sewing_worksheet_af` | "A&F F#", "ABERCROMBIE" | Abercrombie & Fitch format |
| `sewing_worksheet_urban` | "URBAN OUTFITTERS", "MODAS WIZ" | Urban Outfitters format |
| `sewing_worksheet_kontoor` | "KONTOOR", "WRANGLER" | Kontoor/Wrangler format |
| `sewing_worksheet_lucky` | "LUCKY BRAND" | Lucky Brand format |
| `sewing_worksheet_vineyard` | "VINEYARD VINES" | Vineyard Vines format |
| `product_spec` | "PRODUCT SPEC", "TECH PACK", "PID-" | Product specification / Tech Pack |

### Data Extraction

The system extracts the following data sections (when present):

- **Header**: Contact, date, requested by, work plant
- **Order Info**: File #, buyer, style, product, season, quantity, ship date, cost
- **Fabric Info**: Yarn, fabric, width, weight, rib, yield
- **Order Procedure**: Production process text
- **Quantity Lines**: Style, PO, color, sizes (XXS-XXXL, 1X-4X), totals
- **Cutting Details**: Notes and instructions
- **Sewing Details**: Notes and instructions
- **Measurements**: Points of measure with tolerances and size values
- **Labels/Packing Info**: Folding size, hangtag, pieces per box
- **Yield Info**: Body and rib consumption
- **Important Notes**: Any additional notes or instructions
- **Additional Tables**: Any other tables found in the document

### Excel Export

The Excel export generates a single-sheet document in the J.Crew Sewing Worksheet format with:
- Blue (celeste) headers for section titles and labels
- White cells for data values
- Yellow highlighting for important information
- All 8+ sections properly formatted
- Support for additional notes and tables

### Frontend Files

| File | Description |
|------|-------------|
| `templateDefinitions.js` | Template definitions and field mappings |
| `exportExcel.js` | Excel export with J.Crew format |
| `app.js` | Main application with editable tables |

### Backend Files

| File | Description |
|------|-------------|
| `services/template_definitions.py` | Template detection patterns and section definitions |
| `services/template_extractor.py` | Prompt building and data normalization |
| `services/ai_service.py` | Claude API integration with template-based extraction |

---

## Current Limitations & Next Steps

- Jobs and files are stored **only in memory** (Supabase/Postgres not yet wired).
- OCR is optional and falls back to placeholder text if the external API is not configured or returns an error.
- AI uses Claude API for extraction; requires `CLAUDE_API_KEY` environment variable.

Despite these limitations, the full end‑to‑end pipeline is in place and working, allowing easy future upgrades to real OCR and AI backends.

